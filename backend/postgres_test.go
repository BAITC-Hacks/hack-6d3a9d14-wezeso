package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to run real PostgreSQL integration tests")
	}
	ctx := context.Background()
	admin, err := connectPostgres(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	name := "career_quest_test_" + uid("")
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{name}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(ctx, "DROP DATABASE "+pgx.Identifier{name}.Sanitize()+" WITH (FORCE)"); err != nil {
			t.Error(err)
		}
	})
	cfg := admin.Config().Copy()
	cfg.ConnConfig.Database = name
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	return db
}

func databaseAPI(t *testing.T, db *pgxpool.Pool, hash string) *API {
	t.Helper()
	s, err := loadPostgres(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	return &API{Store: &Store{State: s, DB: db}, Auth: &Auth{DB: db, DummyHash: hash}, Origin: "http://localhost:3000", AIClient: &http.Client{Timeout: time.Second}}
}

func equalBusinessData(t *testing.T, want, got State) {
	t.Helper()
	for _, table := range entityTables {
		a, _ := tableRows(want, table)
		b, _ := tableRows(got, table)
		if len(a) != len(b) || (len(a) > 0 && !reflect.DeepEqual(a, b)) {
			t.Fatalf("%s did not round-trip losslessly", table.table)
		}
	}
}

func TestPostgresMigrationAndWorkflow(t *testing.T) {
	db := testDatabase(t)
	ctx := context.Background()
	local := fixture(t)
	// Exercise SQL quoting, Unicode, empty optional values and all entity types.
	local.Store.State.Employees[0].Name = "O'Brien \\ Unicode Қазақ $cq$ $cq_import$"
	local.Store.State.Recommendations = []Recommendation{{ID: "AI-test", Employee: "E0002", Model: "test", At: stamp(), Choices: []AIChoice{{Event: "EV_001", Rationale: "Saved original explanation", Unknowns: []string{"Test unknown"}}}, Signature: "original", Evidence: map[string][]string{"EV_001": {"original evidence"}}}}
	sql, err := exportSQL(local.Store.State)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, sql, pgx.QueryExecModeSimpleProtocol); err != nil {
		t.Fatal(err)
	}
	loaded, err := loadPostgres(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	equalBusinessData(t, local.Store.State, loaded)

	var unsecured int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM pg_tables WHERE schemaname = 'career_quest' AND NOT rowsecurity").Scan(&unsecured); err != nil || unsecured != 0 {
		t.Fatalf("RLS missing: %d, %v", unsecured, err)
	}

	a := databaseAPI(t, db, local.Auth.DummyHash)
	b := databaseAPI(t, db, local.Auth.DummyHash)
	employee := client(t, a, "employee")
	manager := client(t, b, "manager")
	hr := client(t, b, "hr")
	expect(t, employee.do("GET", "workspace?employee=E0001", ""), 403)
	expect(t, employee.do("GET", "health", ""), 200)

	// A different server instance can read the same login session immediately.
	restarted := employee
	restarted.a = databaseAPI(t, db, local.Auth.DummyHash)
	expect(t, restarted.do("GET", "session", ""), 200)
	request := chooseRequest(t, a, employee)
	expect(t, manager.do("POST", "transition", transitionJSON(request.ID, "approve", "")), 200)
	expect(t, restarted.do("POST", "transition", transitionJSON(request.ID, "submit", "Completed the task and attached my test evidence.")), 200)
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for _, api := range []*API{a, b} {
		wg.Add(1)
		go func(api *API) {
			defer wg.Done()
			c := hr
			c.a = api
			codes <- c.do("POST", "transition", transitionJSON(request.ID, "complete", "Evidence verified by HR.")).Code
		}(api)
	}
	wg.Wait()
	close(codes)
	counts := map[int]int{}
	for code := range codes {
		counts[code]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatalf("concurrent approval was not exactly once: %v", counts)
	}
	completed, err := loadPostgres(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	if len(completed.Requests) != 1 || completed.Requests[0].Status != "completed" {
		t.Fatal("workflow not persisted")
	}

	// A late FK failure must roll back an earlier profile change in the same transaction.
	err = a.Store.transact(func(s *State) error {
		s.Employees[0].Name = "must roll back"
		s.Audits = append(s.Audits, Audit{ID: uid("A"), Actor: "missing-user", Role: "hr", Entity: "test", Action: "test", At: stamp()})
		return nil
	})
	if err == nil {
		t.Fatal("invalid foreign key accepted")
	}
	afterFailure, err := loadPostgres(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	equalBusinessData(t, completed, afterFailure)

	// Reapplying the identical migration is harmless and cannot undo new work.
	if _, err = db.Exec(ctx, sql, pgx.QueryExecModeSimpleProtocol); err != nil {
		t.Fatal(err)
	}
	afterRepeat, err := loadPostgres(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	equalBusinessData(t, completed, afterRepeat)
	different := clone(local.Store.State)
	different.Employees[0].Name = "different snapshot"
	differentSQL, _ := exportSQL(different)
	if _, err = db.Exec(ctx, differentSQL, pgx.QueryExecModeSimpleProtocol); err == nil {
		t.Fatal("different import overwrote live database")
	}

	// Imports and account issuance go through the same PostgreSQL transaction path.
	profile := local.Store.State.Employees[0]
	profile.ID = "E9000"
	profile.Name = "Imported test employee"
	body, _ := json.Marshal(map[string]any{"employees": []Employee{profile}, "confirmed": true})
	expect(t, hr.do("POST", "import", string(body)), 200)
	expect(t, hr.do("POST", "accounts", `{"employee_id":"E9000","login":"imported-user","password":"Local-Test-Password!42","role":"employee","confirmed":true}`), 200)
	newUser := client(t, a, "imported-user")
	expect(t, newUser.do("GET", "workspace", ""), 200)
	if strings.Contains(hr.do("GET", "workspace", "").Body.String(), "password_hash") {
		t.Fatal("password hash leaked")
	}

	// Rate limits and logout are shared, and expired sessions fail closed.
	for i := 0; i < 16; i++ {
		allowed, err := a.Auth.attempt(ctx, "rate-test")
		if err != nil || allowed != (i < 15) {
			t.Fatalf("rate attempt %d: %v %v", i, allowed, err)
		}
	}
	if allowed, err := b.Auth.attempt(ctx, "rate-test"); err != nil || allowed {
		t.Fatal("rate limit not shared")
	}
	expect(t, restarted.do("POST", "logout", `{}`), 200)
	expect(t, employee.do("GET", "session", ""), 401)
	if _, err = db.Exec(ctx, "UPDATE career_quest.sessions SET expires_at = now() - interval '1 second'"); err != nil {
		t.Fatal(err)
	}
	expect(t, manager.do("GET", "session", ""), 401)
	db.Close()
	expect(t, employee.do("GET", "health", ""), 503)
	expect(t, employee.do("GET", "workspace", ""), 503)
	if err := a.Store.transact(func(s *State) error { s.Employees[0].Name = "offline write"; return nil }); err == nil {
		t.Fatal("database outage accepted a write")
	}

	t.Logf("Migrated %d employees and %d history rows; workflow, cross-instance sessions, concurrency, rollback, safe reruns and imports passed", len(loaded.Employees), len(loaded.History))
}

func TestSupabaseStartupRequiresConfiguration(t *testing.T) {
	t.Setenv("STORAGE_BACKEND", "supabase")
	t.Setenv("DATABASE_URL", "")
	if _, _, err := openStore(); err == nil {
		t.Fatal("missing DATABASE_URL silently fell back to CSV")
	}
	t.Setenv("STORAGE_BACKEND", "unknown")
	if _, _, err := openStore(); err == nil {
		t.Fatal("unknown storage backend accepted")
	}
}

func TestExportRejectsMissingAccountsAndDuplicateKeys(t *testing.T) {
	if _, err := exportSQL(State{}); err == nil {
		t.Fatal("export without logins succeeded")
	}
	s := State{Users: []User{{ID: "one"}, {ID: "one"}}}
	if _, err := exportSQL(s); err == nil {
		t.Fatal("duplicate keys accepted")
	}
	for _, input := range []string{"plain", "quotes ' and \\", "$cq$ and $cqx$"} {
		quoted := dollarQuote(input)
		if !strings.Contains(quoted, input) {
			t.Fatal(fmt.Sprintf("quote lost input %q", input))
		}
	}
}
