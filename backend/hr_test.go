package main

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestHRPermissionsAndEventPersistence(t *testing.T) {
	a := fixture(t)
	h := client(t, a, "hr")
	employee := client(t, a, "employee")
	manager := client(t, a, "manager")
	for _, c := range []testClient{employee, manager} {
		expect(t, c.do("GET", "hr/insights", ""), 403)
		expect(t, c.do("POST", "hr/events", `{}`), 403)
		expect(t, c.do("POST", "hr/simulate", `{}`), 403)
	}
	ev := Event{ID: "EV_HR_test_persist", Title: "Практикум по архитектуре", Description: "Разберём архитектурные решения и выполним практическое задание.", Type: "workshop", Format: "self_paced", Hours: 4, Roles: []string{a.Store.State.Roles[0].Role}, Grades: []string{"Middle"}, Gains: []Gain{{Skill: a.Store.State.Skills[0].ID, Gain: 1, Max: 5}}}
	raw, _ := json.Marshal(ev)
	before := len(a.Store.State.Events)
	noCSRF := h
	noCSRF.csrf = ""
	expect(t, noCSRF.do("POST", "hr/events", string(raw)), 403)
	expect(t, h.do("POST", "hr/events", string(raw)), 201)
	expect(t, h.do("POST", "hr/events", string(raw)), 409)
	if len(a.Store.State.Events) != before+1 {
		t.Fatal("duplicate or missing event")
	}
	restored, err := loadRows(a.Store.Dir + "/state.csv")
	if err != nil || restored.event(ev.ID) == nil {
		t.Fatal("event was not persisted", err)
	}
	if !strings.Contains(h.do("GET", "workspace", "").Body.String(), ev.Title) {
		t.Fatal("event missing from workspace")
	}
	last := a.Store.State.Audits[len(a.Store.State.Audits)-1]
	if last.Action != "event_created" || last.Role != "hr" {
		t.Fatal("missing audit")
	}
	for name, mutate := range map[string]func(*Event){
		"past date":         func(e *Event) { e.Format = "online"; e.Sessions = []string{"2026-09-01"} },
		"missing sessions":  func(e *Event) { e.Format = "online"; e.Sessions = nil },
		"unknown skill":     func(e *Event) { e.Gains = []Gain{{Skill: "missing", Gain: 1, Max: 5}} },
		"duplicate skill":   func(e *Event) { e.Gains = append(e.Gains, e.Gains[0]) },
		"invalid gain":      func(e *Event) { e.Gains = []Gain{{Skill: a.Store.State.Skills[0].ID, Gain: 4, Max: 2}} },
		"unknown role":      func(e *Event) { e.Roles = []string{"unknown"} },
		"missing grades":    func(e *Event) { e.Grades = nil },
		"negative duration": func(e *Event) { e.Hours = -3 },
		"missing gains":     func(e *Event) { e.Gains = nil },
	} {
		t.Run(name, func(t *testing.T) {
			bad := ev
			bad.ID = "EV_HR_test_invalid"
			mutate(&bad)
			b, _ := json.Marshal(bad)
			expect(t, h.do("POST", "hr/events", string(b)), 400)
			if len(a.Store.State.Events) != before+1 {
				t.Fatal("invalid event persisted")
			}
		})
	}
}

func TestHRRiskWindowAndSparseData(t *testing.T) {
	e := Employee{ID: "E", Role: "Dev", Grade: "Middle", Skills: map[string]int{"s": 1}, LastReview: "2025-01-01"}
	s := State{Employees: []Employee{e}, Skills: []Skill{{ID: "s", Name: "Skill"}}, Roles: []RoleProfile{{Role: "Dev", Grade: "Senior", Required: map[string]int{"s": 3}}}, History: []History{
		{Employee: "E", Date: "2026-06-01", Status: "completed"},
		{Employee: "E", Date: "2026-06-15", Status: "completed"},
		{Employee: "E", Date: "2026-09-01", Status: "no_show"},
		{Employee: "E", Date: "2026-09-20", Status: "overdue"},
	}}
	p := hrPerson(&s, e, 30)
	if p.Band != "high" || p.Score < 60 || p.Score > 100 {
		t.Fatalf("unexpected risk: %+v", p)
	}
	sum := 0
	for _, f := range p.Factors {
		sum += f.Points
	}
	if sum != p.Score {
		t.Fatal("factors do not explain score")
	}
	long := hrPerson(&s, e, 180)
	if p.Score != long.Score || long.Activities <= p.Activities {
		t.Fatal("reporting period changed risk or failed to change activity")
	}
	s.History = s.History[:1]
	p = hrPerson(&s, e, 90)
	if p.Band != "unknown" || p.Score != 0 || len(p.Factors) != 0 {
		t.Fatal("sparse evidence reported as prediction")
	}
}

func TestHRInsightsDepartmentAndPeriod(t *testing.T) {
	a := fixture(t)
	h := client(t, a, "hr")
	expect(t, h.do("GET", "hr/insights?days=7", ""), 400)
	w := h.do("GET", "hr/insights?days=30&department=missing", "")
	expect(t, w, 200)
	var out struct {
		People []HRPerson `json:"people"`
		Trend  []HRDay    `json:"trend"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.People) != 0 || len(out.Trend) != 30 {
		t.Fatal("invalid empty department response")
	}
	w = h.do("GET", "hr/insights?days=90", "")
	expect(t, w, 200)
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if len(out.People) != len(a.Store.State.Employees) || len(out.Trend) != 90 {
		t.Fatal("missing analytics rows")
	}
	for _, p := range out.People {
		if p.Progress < 0 || p.Progress > 100 || p.Score < 0 || p.Score > 100 {
			t.Fatal("out of range metrics")
		}
	}
}

func TestHRSimulationPrerequisitesCapsScheduleAndNoMutation(t *testing.T) {
	s := State{Employees: []Employee{{ID: "E", Role: "Dev", Grade: "Middle", Skills: map[string]int{"s": 1}}}, Skills: []Skill{{ID: "s", Name: "Skill"}}, Roles: []RoleProfile{{Role: "Dev", Grade: "Senior", Required: map[string]int{"s": 5}, Critical: []string{"s"}}}, Events: []Event{
		{ID: "one", Title: "Foundation", Format: "self_paced", Hours: 8, Roles: []string{"Dev"}, Grades: []string{"Middle"}, Gains: []Gain{{Skill: "s", Gain: 2, Max: 3}}},
		{ID: "two", Title: "Advanced", Format: "online", Hours: 8, Roles: []string{"Dev"}, Grades: []string{"Middle"}, Gains: []Gain{{Skill: "s", Gain: 4, Max: 5}}, Prereq: map[string]int{"s": 3}, Sessions: []string{"2026-11-15"}},
	}}
	before := clone(s)
	in := SimulationInput{Employee: "E", Role: "Dev", Grade: "Senior", Weeks: 4, Hours: 4}
	baseline, err := simulateGrade(&s, in)
	if err != nil || baseline.Before != 20 || baseline.After != 20 || baseline.CriticalGaps != 1 {
		t.Fatal(baseline, err)
	}
	in.Events = []string{"two"}
	if _, err = simulateGrade(&s, in); err == nil {
		t.Fatal("prerequisite bypass")
	}
	in.Events = []string{"one", "one"}
	if _, err = simulateGrade(&s, in); err == nil {
		t.Fatal("duplicate event applied twice")
	}
	in.Events = []string{"one", "two"}
	out, err := simulateGrade(&s, in)
	if err != nil || out.After != 100 || out.CriticalGaps != 0 || out.Feasible || out.Hours != 16 || out.Weeks < 8 {
		t.Fatal(out, err)
	}
	if !reflect.DeepEqual(before, clone(s)) {
		t.Fatal("simulation mutated employee or state")
	}
	in.Weeks = 12
	out, err = simulateGrade(&s, in)
	if err != nil || !out.Feasible {
		t.Fatal("budget not recomputed", out, err)
	}
	in.Grade = "invalid"
	if _, err = simulateGrade(&s, in); err == nil {
		t.Fatal("unknown target accepted")
	}
}

func TestHRRecentCompletionsAndEngagement(t *testing.T) {
	e := Employee{ID: "E", Role: "Dev", Grade: "Middle", Skills: map[string]int{}}
	s := State{Employees: []Employee{e}, History: []History{
		{Employee: "E", Date: "2026-09-01", Status: "no_show"},
		{Employee: "E", Date: "2026-09-02", Status: "no_show"},
		{Employee: "E", Date: "2026-09-03", Status: "no_show"},
	}, Requests: []Request{{Employee: "E", Event: "event", Status: "completed", Updated: "2025-01-01T12:00:00Z"}}, Events: []Event{{ID: "event", Hours: 4}}}
	p := hrPerson(&s, e, 90)
	if p.Engagements != 0 || p.Completed != 0 || p.Activities != 3 {
		t.Fatal("absence or old completion counted as engagement", p)
	}
	if !strings.Contains(p.Factors[0].Label, "Пауза") {
		t.Fatal("old completion masked inactivity")
	}
	s.Requests[0].Updated = "2026-09-20T12:00:00Z"
	p = hrPerson(&s, e, 90)
	if p.Engagements != 1 || p.Completed != 1 || p.Activities != 4 || p.Hours != 4 || p.LastActivity != "2026-09-20" {
		t.Fatal("live completion missing from analytics", p)
	}
}
