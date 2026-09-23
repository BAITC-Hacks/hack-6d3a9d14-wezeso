package main

import (
	"context"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestPostgresDeploymentUpgrade(t *testing.T) {
	db := testDatabase(t)
	ctx := context.Background()
	upgrade, err := os.ReadFile("../supabase/upgrade.sql")
	if err != nil {
		t.Fatal(err)
	}
	// A mistaken upgrade must not seed a fresh database and block a full import.
	conn, err := db.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = conn.Exec(ctx, string(upgrade), pgx.QueryExecModeSimpleProtocol); err == nil {
		t.Fatal("upgrade accepted an empty database")
	}
	_, _ = conn.Exec(ctx, "ROLLBACK")
	conn.Release()

	a := fixture(t)
	sql, err := exportSQL(a.Store.State)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, sql, pgx.QueryExecModeSimpleProtocol); err != nil {
		t.Fatal(err)
	}
	// Reproduce a deployed core-only database, before the agent/course extensions.
	if _, err = db.Exec(ctx, `DROP TABLE career_quest.agent_runs, career_quest.agent_watches,
	 career_quest.courses, career_quest.course_progress, career_quest.course_uploads, career_quest.exam_attempts`); err != nil {
		t.Fatal(err)
	}
	want := clone(a.Store.State)
	ensureCourses(&want)
	for i := 0; i < 2; i++ {
		if _, err = db.Exec(ctx, string(upgrade), pgx.QueryExecModeSimpleProtocol); err != nil {
			t.Fatal(err)
		}
		got, err := loadPostgres(ctx, db)
		if err != nil {
			t.Fatal(err)
		}
		equalBusinessData(t, want, got)
	}
	// Verify on a read-only connection; failure must identify security regressions.
	tx, err := db.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, deploymentVerificationSQL, pgx.QueryExecModeSimpleProtocol); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, "ALTER TABLE career_quest.course_uploads DISABLE ROW LEVEL SECURITY"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, deploymentVerificationSQL, pgx.QueryExecModeSimpleProtocol); err == nil {
		t.Fatal("verification accepted disabled RLS on uploaded assignments")
	}
	if _, err = db.Exec(ctx, string(upgrade), pgx.QueryExecModeSimpleProtocol); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, "GRANT SELECT ON career_quest.app_users TO PUBLIC"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, deploymentVerificationSQL, pgx.QueryExecModeSimpleProtocol); err == nil {
		t.Fatal("verification accepted PUBLIC access to password hashes")
	}
	if _, err = db.Exec(ctx, string(upgrade), pgx.QueryExecModeSimpleProtocol); err != nil {
		t.Fatal(err)
	}
	// Confirm real startup and preserved login against this isolated test database.
	config := db.Config()
	connectionURL, err := url.Parse(os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	connectionURL.Path = "/" + config.ConnConfig.Database
	t.Setenv("STORAGE_BACKEND", "supabase")
	t.Setenv("DATABASE_URL", connectionURL.String())
	_, closeStore, err := openStore()
	if err != nil {
		t.Fatal(err)
	}
	closeStore()
	api := databaseAPI(t, db, a.Auth.DummyHash)
	employee := client(t, api, "employee")
	expect(t, employee.do("GET", "workspace", ""), 200)
}
