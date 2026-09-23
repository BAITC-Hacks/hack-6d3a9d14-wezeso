package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

func planInput(key string) AgentInput {
	return AgentInput{Message: "Create a development plan for critical skills", Constraints: PlanConstraints{20, 12, 3, "any"}, Key: key}
}
func asJSON(v any) string { b, _ := json.Marshal(v); return string(b) }
func createPlan(t *testing.T, c testClient, in AgentInput) AgentRun {
	t.Helper()
	w := c.do("POST", "agent/runs", asJSON(in))
	expect(t, w, 200)
	var run AgentRun
	if err := json.Unmarshal(w.Body.Bytes(), &run); err != nil {
		t.Fatal(err)
	}
	return run
}
func agentActionJSON(id, action string) string {
	return asJSON(map[string]any{"id": id, "action": action, "confirmed": true})
}
func offlineAPI(t *testing.T) (*API, testClient) {
	a := fixture(t)
	a.Agent = &AgentSettings{Provider: "off"}
	return a, client(t, a, "employee")
}

func TestAgentCreatesArtifactsAndExecutesFullWorkflow(t *testing.T) {
	a, c := offlineAPI(t)
	before := a.Store.State.effective(*a.Store.State.employee("E0002"))
	run := createPlan(t, c, planInput("workflow-one"))
	if run.Mode != "planner" || run.Warning == "" || len(run.Steps) == 0 || len(run.Steps) > 3 || len(run.Artifacts) != 3 {
		t.Fatalf("bad run: %+v", run)
	}
	if len(a.Store.State.Requests) != 0 || !reflect.DeepEqual(before, a.Store.State.effective(*a.Store.State.employee("E0002"))) {
		t.Fatal("planning performed unapproved writes")
	}
	for _, artifact := range run.Artifacts {
		w := c.do("GET", "agent/run?id="+run.ID+"&artifact="+artifact.Kind, "")
		expect(t, w, 200)
		if w.Body.String() != artifact.Content || w.Header().Get("Content-Disposition") == "" {
			t.Fatal("download differs from saved artifact")
		}
	}
	expect(t, c.do("POST", "agent/action", agentActionJSON(run.ID, "apply")), 200)
	expect(t, c.do("POST", "agent/action", agentActionJSON(run.ID, "apply")), 200)
	if len(a.Store.State.Requests) != len(run.Steps) {
		t.Fatal("duplicate apply created requests twice")
	}
	manager := client(t, a, "manager")
	hr := client(t, a, "hr")
	requests := append([]Request{}, a.Store.State.Requests...)
	for _, q := range requests {
		expect(t, c.do("POST", "transition", transitionJSON(q.ID, "complete", "Agent claims it is done")), 403)
		expect(t, manager.do("POST", "transition", transitionJSON(q.ID, "approve", "")), 200)
		expect(t, c.do("POST", "transition", transitionJSON(q.ID, "submit", "Created the required artifact and attached verifiable work.")), 200)
		expect(t, hr.do("POST", "transition", transitionJSON(q.ID, "complete", "Reviewed and verified the submitted work.")), 200)
		expect(t, hr.do("POST", "transition", transitionJSON(q.ID, "complete", "Duplicate verification")), 409)
	}
	_, progress := a.Store.State.gaps(*a.Store.State.employee("E0002"))
	if progress != run.After {
		t.Fatalf("projection %d != actual %d", run.After, progress)
	}
	loaded, err := loadRows(filepath.Join(a.Store.Dir, "state.csv"))
	if err != nil || loaded.AgentRuns[0].Status != "applied" {
		t.Fatalf("run did not survive CSV reload: %v", err)
	}
	if loaded.AgentRuns[0].Steps[0].RequestID == "" {
		t.Fatal("missing request linkage")
	}
	t.Logf("Created %d requests + 3 files, completed manager/employee/HR cycle; progress %d%% -> %d%%", len(run.Steps), run.Before, progress)
}

func TestAgentPrivacyConsentAndStalePlan(t *testing.T) {
	a, c := offlineAPI(t)
	run := createPlan(t, c, planInput("private-one"))
	for _, login := range []string{"colleague", "manager", "hr"} {
		other := client(t, a, login)
		expect(t, other.do("GET", "agent/run?id="+run.ID, ""), 404)
		expect(t, other.do("GET", "agent/run?id="+run.ID+"&artifact=plan", ""), 404)
		expect(t, other.do("POST", "agent/action", agentActionJSON(run.ID, "apply")), 404)
		if strings.Contains(other.do("GET", "workspace", "").Body.String(), run.Input.Message) {
			t.Fatal("private prompt leaked to another user")
		}
	}
	expect(t, c.do("POST", "agent/action", asJSON(map[string]any{"id": run.ID, "action": "apply", "confirmed": false})), 400)
	if err := a.Store.transact(func(s *State) error { s.employee("E0002").Skills["SK_SYSTEM_DESIGN"]++; return nil }); err != nil {
		t.Fatal(err)
	}
	expect(t, c.do("POST", "agent/action", agentActionJSON(run.ID, "apply")), 409)
	if len(a.Store.State.Requests) != 0 {
		t.Fatal("stale plan created a partial batch")
	}
	expect(t, c.do("POST", "agent/action", agentActionJSON(run.ID, "cancel")), 200)
	expect(t, c.do("POST", "agent/action", agentActionJSON(run.ID, "apply")), 409)
	hr := client(t, a, "hr")
	expect(t, hr.do("POST", "agent/runs", asJSON(planInput("hr-no-plan"))), 403)
}

func TestAgentIdempotencyAndConcurrentApply(t *testing.T) {
	a, c := offlineAPI(t)
	in := planInput("idempotency-one")
	one := createPlan(t, c, in)
	two := createPlan(t, c, in)
	if one.ID != two.ID || len(a.Store.State.AgentRuns) != 1 {
		t.Fatal("run retry duplicated plan")
	}
	in.Message = "A different task with the same key"
	expect(t, c.do("POST", "agent/runs", asJSON(in)), 409)
	var wg sync.WaitGroup
	codes := make(chan int, 5)
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); codes <- c.do("POST", "agent/action", agentActionJSON(one.ID, "apply")).Code }()
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != 200 {
			t.Fatalf("concurrent apply: %d", code)
		}
	}
	if len(a.Store.State.Requests) != len(one.Steps) {
		t.Fatal("concurrent duplicate requests")
	}
}

func mockAgentModel(t *testing.T, a *API, provider string, invalidFirst bool) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	calls := &atomic.Int32{}
	event := candidate(t, a).Event.ID
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		var payload map[string]json.RawMessage
		if json.NewDecoder(r.Body).Decode(&payload) != nil {
			t.Error("bad request JSON")
		}
		raw := asJSON(payload)
		for _, secret := range []string{"full_name", "employee_id", "password_hash", a.Store.State.employee("E0002").Name, "manager_id"} {
			if (n == 1 || secret != "employee_id") && strings.Contains(raw, secret) {
				t.Errorf("model context leaked %s", secret)
			}
		}
		name := "simulate_plan"
		args := any(map[string]any{"event_ids": []string{event}})
		if invalidFirst && n == 1 {
			name = "complete_request"
			args = map[string]any{"employee_id": "E0001"}
		} else if n > 1 && (!invalidFirst || n > 2) {
			name = "save_plan"
			args = map[string]any{"summary": "План учитывает критичные навыки, доступное время и историю участия.", "choices": []AIChoice{{Event: event, Rationale: "Критичный разрыв цели закрывается доступным шагом; история участия и длительность проверены инструментами.", Unknowns: []string{"Согласовать время с руководителем."}}}}
		}
		if provider == "gemini" {
			if r.Header.Get("x-goog-api-key") != "test-key" {
				t.Error("missing Gemini key header")
			}
			if n > 1 && !strings.Contains(raw, "test-thought-signature") {
				t.Error("lost Gemini thought signature")
			}
			send(w, 200, map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"role": "model", "parts": []any{map[string]any{"thoughtSignature": "test-thought-signature", "functionCall": map[string]any{"name": name, "args": args}}}}}}})
		} else {
			if n > 1 && !strings.Contains(raw, "tool_name") {
				t.Error("missing tool result in next model turn")
			}
			send(w, 200, map[string]any{"message": map[string]any{"role": "assistant", "tool_calls": []any{map[string]any{"function": map[string]any{"name": name, "arguments": args}}}}, "done": true})
		}
	}))
	a.Agent = &AgentSettings{Provider: provider, Model: "test-tool-model", URL: server.URL}
	a.AIKey, a.AllowAI = "test-key", true
	t.Cleanup(server.Close)
	return server, calls
}

func TestAgentRealToolLoopAndRepairContract(t *testing.T) {
	for _, provider := range []string{"ollama", "gemini"} {
		t.Run(provider, func(t *testing.T) {
			a, c := offlineAPI(t)
			_, calls := mockAgentModel(t, a, provider, true)
			in := planInput("model-loop-one")
			in.ExternalConsent = true
			run := createPlan(t, c, in)
			if run.Mode != "llm" || calls.Load() != 3 || len(run.Artifacts) != 3 {
				t.Fatalf("model did not execute tools: mode=%s calls=%d warning=%s", run.Mode, calls.Load(), run.Warning)
			}
			if len(a.Store.State.Requests) != 0 {
				t.Fatal("model bypassed approval")
			}
			found := false
			for _, trace := range run.Trace {
				if trace.Tool == "complete_request" && trace.Status == "rejected" {
					found = true
				}
			}
			if !found {
				t.Fatal("rejected tool missing from trace")
			}
		})
	}
}

func TestAgentExternalConsentAndLocalTransport(t *testing.T) {
	a, c := offlineAPI(t)
	_, calls := mockAgentModel(t, a, "gemini", false)
	run := createPlan(t, c, planInput("no-consent-one"))
	if run.Mode != "planner" || calls.Load() != 0 {
		t.Fatal("external request without consent")
	}
	a.AllowAI = false
	in := planInput("no-permission-one")
	in.ExternalConsent = true
	createPlan(t, c, in)
	if calls.Load() != 0 {
		t.Fatal("external request despite disabled server flag")
	}
	for _, raw := range []string{"https://example.com/api/chat", "http://127.0.0.1.evil.example/api/chat", "http://user:password@localhost/api/chat", "file:///tmp/model", "http://localhost/api/chat?target=cloud"} {
		if localModelURL(raw, "qwen3:4b") {
			t.Errorf("unsafe local URL accepted: %s", raw)
		}
	}
	if localModelURL("http://localhost:11434/api/chat", "model:cloud") {
		t.Fatal("cloud model allowed as local")
	}
}

func TestAgentTimeoutAndInvalidProviderFallback(t *testing.T) {
	a, _ := offlineAPI(t)
	s := a.Store.State
	p := newPlanEngine(&s, *s.employee("E0002"), planInput("timeout-one"))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(150 * time.Millisecond):
		}
	}))
	defer server.Close()
	a.Agent = &AgentSettings{Provider: "ollama", Model: "test", URL: server.URL}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	start := time.Now()
	if err := a.runAgentModel(ctx, p); err == nil {
		t.Fatal("timeout accepted")
	}
	if time.Since(start) > time.Second {
		t.Fatal("deadline not propagated")
	}
	if err := p.fallback(); err != nil || len(p.run.Steps) == 0 {
		t.Fatalf("failed to recover: %v", err)
	}
}

func TestAgentConstraintsNoMatchAndToolValidation(t *testing.T) {
	a, c := offlineAPI(t)
	in := planInput("no-match-one")
	in.Constraints = PlanConstraints{1, 1, 1, "offline"}
	run := createPlan(t, c, in)
	if run.Status != "no_match" || len(run.Steps) != 0 || len(run.Artifacts) != 0 {
		t.Fatal("impossible budget did not return honest empty result")
	}
	p := newPlanEngine(&a.Store.State, *a.Store.State.employee("E0002"), planInput("tool-validation"))
	if _, err := p.call("save_plan", json.RawMessage(`{"summary":"An invalid plan","choices":[]}`)); err == nil {
		t.Fatal("saved without simulation")
	}
	if _, err := p.call("read_profile", json.RawMessage(`{"employee_id":"E0001"}`)); err == nil {
		t.Fatal("accepted another employee argument")
	}
	_, _ = p.call("read_profile", json.RawMessage(`{}`))
	_, _ = p.call("search_activities", json.RawMessage(`{}`))
	for _, ids := range [][]string{{"EV_001"}, {"invented"}, {candidate(t, a).Event.ID, candidate(t, a).Event.ID}} {
		if _, _, _, _, err := p.simulate(ids); err == nil {
			t.Fatalf("accepted invalid activity sequence: %v", ids)
		}
	}
	in.Constraints.HoursPerWeek = 0
	expect(t, c.do("POST", "agent/runs", asJSON(in)), 400)
}

func TestAgentAllDatasetProfilesAndJuryInputs(t *testing.T) {
	s, err := seed("..")
	if err != nil {
		t.Fatal(err)
	}
	var jury struct {
		Employees []Employee `json:"employees"`
	}
	if err = readJSON("../fixtures/employees.json", &jury); err != nil {
		t.Fatal(err)
	}
	s.Employees = append(s.Employees, jury.Employees...)
	historyFile, err := os.Open("../fixtures/activity_history.csv")
	if err != nil {
		t.Fatal(err)
	}
	juryHistory, err := parseHistory(historyFile)
	historyFile.Close()
	if err != nil {
		t.Fatal(err)
	}
	s.History = append(s.History, juryHistory...)
	// These are original-schema jury fixtures, not special-cased IDs.
	start := time.Now()
	plans, empty := 0, 0
	for _, e := range s.Employees {
		in := planInput("dataset-" + e.ID)
		in.Constraints = PlanConstraints{8, 8, 3, "any"}
		p := newPlanEngine(&s, e, in)
		if err = p.fallback(); err != nil {
			t.Fatalf("%s: %v", e.ID, err)
		}
		if p.run.After < p.run.Before || p.run.Hours > p.budget() {
			t.Fatalf("invalid simulation for %s", e.ID)
		}
		if p.run.Status == "no_match" {
			empty++
			continue
		}
		plans++
		ids := []string{}
		for _, step := range p.run.Steps {
			ids = append(ids, step.Event)
			if len(step.Facts) < 2 {
				t.Fatal("single-factor explanation")
			}
		}
		if _, _, _, _, err = p.simulate(ids); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("Evaluated %d original-schema profiles: %d plans, %d honest no-match results in %s", len(s.Employees), plans, empty, time.Since(start))
}

func TestAgentCalendarIsValidUTF8AndNotAnInvitation(t *testing.T) {
	line := foldICS("SUMMARY:" + strings.Repeat("Қазақша русский, ", 20))
	if !utf8.ValidString(line) {
		t.Fatal("folding split UTF-8")
	}
	for _, part := range strings.Split(line, "\r\n") {
		if len(part) > 75 {
			t.Fatal("calendar line exceeds 75 octets")
		}
	}
	run := AgentRun{ID: "test", At: stamp(), Steps: []PlanStep{{Event: "scheduled", Title: "Course\r\nATTENDEE:evil", Session: "2026-10-15"}, {Event: "self", Title: "Self study"}}}
	files := planArtifacts(run)
	calendar := files[2].Content
	for _, want := range []string{"BEGIN:VEVENT", "DTEND;VALUE=DATE:20261016", "BEGIN:VTODO", "STATUS:TENTATIVE", "STATUS:NEEDS-ACTION"} {
		if !strings.Contains(calendar, want) {
			t.Errorf("missing %s", want)
		}
	}
	if strings.Contains(calendar, "\r\nATTENDEE:") || strings.Contains(calendar, "METHOD:REQUEST") {
		t.Fatal("calendar injection or unsolicited invite")
	}
}

func TestAgentSupabasePersistenceAndRestart(t *testing.T) {
	db := testDatabase(t)
	a, c := offlineAPI(t)
	run := createPlan(t, c, planInput("postgres-agent"))
	sql, err := exportSQL(a.Store.State)
	if err != nil {
		t.Fatal(err)
	}
	// Use the same SQL importer as the existing database workflow tests.
	if _, err = db.Exec(context.Background(), sql, pgx.QueryExecModeSimpleProtocol); err != nil {
		t.Fatal(err)
	}
	b := databaseAPI(t, db, a.Auth.DummyHash)
	bc := client(t, b, "employee")
	expect(t, bc.do("POST", "agent/action", agentActionJSON(run.ID, "apply")), 200)
	loaded, err := loadPostgres(context.Background(), db)
	if err != nil || loaded.AgentRuns[0].Status != "applied" || len(loaded.Requests) != len(run.Steps) {
		t.Fatalf("database run did not persist: %v", err)
	}
	restarted := databaseAPI(t, db, a.Auth.DummyHash)
	bc.a = restarted
	expect(t, bc.do("GET", "agent/run?id="+run.ID, ""), 200)
	t.Log(fmt.Sprintf("Supabase saved plan, %d requests and files across API instances", len(run.Steps)))
}

func TestAgentProactivelyReplansWithoutPromptAndSurvivesRestart(t *testing.T) {
	a, _ := offlineAPI(t)
	if err := a.Store.transact(func(s *State) error {
		s.AgentWatches = append(s.AgentWatches, AgentWatch{Employee: "E0002", Enabled: true, Constraints: PlanConstraints{8, 8, 3, "any"}, Status: "queued", Updated: stamp()})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	a.processAgentWatch(context.Background(), "E0002")
	if len(a.Store.State.AgentRuns) != 1 || a.Store.State.AgentRuns[0].Trigger != "autopilot" {
		t.Fatal("agent did not independently create the initial plan")
	}
	first := a.Store.State.AgentRuns[0]
	for i := 0; i < 3; i++ {
		a.processAgentWatch(context.Background(), "E0002")
	}
	if len(a.Store.State.AgentRuns) != 1 {
		t.Fatal("unchanged profile caused repeated model work")
	}
	loaded, err := loadRows(filepath.Join(a.Store.Dir, "state.csv"))
	if err != nil {
		t.Fatal(err)
	}
	a.Store.State = loaded
	if err = a.Store.transact(func(s *State) error { s.employee("E0002").Goal = &Goal{"Backend Engineer", "Lead"}; return nil }); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); a.processAgentWatch(context.Background(), "E0002") }()
	}
	wg.Wait()
	if len(a.Store.State.AgentRuns) != 2 {
		t.Fatalf("goal change should create exactly one plan: %d", len(a.Store.State.AgentRuns))
	}
	second := a.Store.State.AgentRuns[1]
	if second.Input.Previous != first.ID || second.Target.Grade != "Lead" {
		t.Fatal("agent did not retain memory and adapt to goal")
	}
	if len(a.Store.State.Requests) != 0 {
		t.Fatal("proactive recommendations forced participation")
	}
	if err = a.Store.transact(func(s *State) error {
		s.agentWatch("E0002").Enabled = false
		s.employee("E0002").Skills["SK_SYSTEM_DESIGN"] = 5
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	a.processAgentWatch(context.Background(), "E0002")
	if len(a.Store.State.AgentRuns) != 2 {
		t.Fatal("agent ignored pause")
	}
	t.Log("No prompt: generated a plan, stayed quiet on unchanged data, recovered subscription from CSV, replanned once after goal change, respected pause")
}

func TestAgentPrefersCriticalGapOverLowestSkippedSkill(t *testing.T) {
	manager := "boss"
	e := Employee{ID: "jury", Role: "Engineer", Grade: "Middle", Manager: &manager, Skills: map[string]int{"system": 2, "speaking": 0}, LastReview: "2026-09-30"}
	s := State{Employees: []Employee{e}, Skills: []Skill{{ID: "system", Name: "System Design"}, {ID: "speaking", Name: "Public Speaking"}}, Roles: []RoleProfile{{Role: "Engineer", Grade: "Senior", Required: map[string]int{"system": 4, "speaking": 3}, Critical: []string{"system"}}}, Events: []Event{
		{ID: "critical", Title: "System Design", Roles: []string{"Engineer"}, Grades: []string{"Middle"}, Format: "self_paced", Hours: 12, Gains: []Gain{{Skill: "system", Gain: 2, Max: 4}}},
		{ID: "lowest", Title: "Public Speaking", Roles: []string{"Engineer"}, Grades: []string{"Middle"}, Format: "self_paced", Hours: 4, Gains: []Gain{{Skill: "speaking", Gain: 2, Max: 4}}},
	}, History: []History{{Employee: "jury", Event: "lowest", Status: "no_show"}, {Employee: "jury", Event: "lowest", Status: "declined"}, {Employee: "jury", Event: "lowest", Status: "dropped"}}}
	in := planInput("counterexample")
	in.Constraints.MaxSteps = 1
	p := newPlanEngine(&s, e, in)
	if err := p.fallback(); err != nil {
		t.Fatal(err)
	}
	if len(p.run.Steps) != 1 || p.run.Steps[0].Event != "critical" {
		t.Fatal("fell for lowest-skill heuristic")
	}
	in.Constraints = PlanConstraints{1, 4, 1, "any"}
	p = newPlanEngine(&s, e, in)
	if err := p.fallback(); err != nil {
		t.Fatal(err)
	}
	if len(p.run.Steps) != 1 || p.run.Steps[0].Event != "lowest" {
		t.Fatal("ignored the real time budget")
	}
}
