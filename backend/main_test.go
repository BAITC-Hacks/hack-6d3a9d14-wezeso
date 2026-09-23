package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func fixture(t *testing.T) *API {
	t.Helper()
	s, e := seed("..")
	if e != nil {
		t.Fatal(e)
	}
	hash, e := hashPassword("Local-Test-Password!42")
	if e != nil {
		t.Fatal(e)
	}
	s.Users = []User{{"Ue", "employee", hash, "employee", "E0002"}, {"Um", "manager", hash, "manager", "E0175"}, {"Uh", "hr", hash, "hr", ""}, {"Ux", "colleague", hash, "employee", "E0001"}}
	dir := t.TempDir()
	st := &Store{State: s, Dir: dir}
	if e = writeRows(filepath.Join(dir, "state.csv"), s); e != nil {
		t.Fatal(e)
	}
	return &API{Store: st, Auth: &Auth{Sessions: map[string]Session{}, Attempts: map[string]Attempt{}, DummyHash: hash}, Origin: "http://localhost:3000", AIClient: &http.Client{Timeout: 9 * time.Second}}
}

type testClient struct {
	a      *API
	cookie *http.Cookie
	csrf   string
}

func (c testClient) do(method, path, raw string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "/api/"+path, strings.NewReader(raw))
	r.RemoteAddr = "127.0.0.1:2000"
	r.Header.Set("Origin", "http://localhost:3000")
	if c.cookie != nil {
		r.AddCookie(c.cookie)
	}
	r.Header.Set("X-CSRF-Token", c.csrf)
	w := httptest.NewRecorder()
	c.a.handler(w, r)
	return w
}
func client(t *testing.T, a *API, login string) testClient {
	t.Helper()
	c := testClient{a: a}
	w := c.do("POST", "login", `{"login":"`+login+`","password":"Local-Test-Password!42"}`)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var response struct {
		CSRF string `json:"csrf"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &response)
	c.cookie = w.Result().Cookies()[0]
	c.csrf = response.CSRF
	return c
}
func expect(t *testing.T, w *httptest.ResponseRecorder, code int) {
	t.Helper()
	if w.Code != code {
		t.Fatalf("want %d got %d: %s", code, w.Code, w.Body.String())
	}
}
func candidate(t *testing.T, a *API) Candidate {
	t.Helper()
	for _, c := range a.Store.State.candidates(*a.Store.State.employee("E0002")) {
		if c.Blocked == "" {
			return c
		}
	}
	t.Fatal("no eligible event")
	return Candidate{}
}
func chooseRequest(t *testing.T, a *API, c testClient) Request {
	ev := candidate(t, a)
	session := ""
	for _, d := range ev.Event.Sessions {
		if d >= snapshot {
			session = d
			break
		}
	}
	expect(t, c.do("POST", "requests", fmt.Sprintf(`{"event_id":%q,"session_date":%q,"confirmed":true}`, ev.Event.ID, session)), 200)
	return a.Store.State.Requests[len(a.Store.State.Requests)-1]
}
func transitionJSON(id, action, note string) string {
	b, _ := json.Marshal(map[string]any{"id": id, "action": action, "note": note, "confirmed": true})
	return string(b)
}

func TestAuthenticationAndPermissions(t *testing.T) {
	a := fixture(t)
	anon := testClient{a: a}
	expect(t, anon.do("GET", "workspace", ""), 401)
	expect(t, anon.do("POST", "login", `{"login":"employee","password":"wrong"}`), 401)
	e := client(t, a, "employee")
	m := client(t, a, "manager")
	h := client(t, a, "hr")
	for _, c := range []testClient{e, m, h} {
		expect(t, c.do("GET", "workspace", ""), 200)
	}
	expect(t, e.do("GET", "workspace?employee=E0001", ""), 403)
	expect(t, m.do("GET", "workspace?employee=E0001", ""), 403)
	expect(t, h.do("GET", "workspace?employee=E0001", ""), 200)
	expect(t, e.do("POST", "accounts", `{}`), 403)
	expect(t, e.do("POST", "import", `{}`), 403)
	withoutCSRF := e
	withoutCSRF.csrf = "wrong"
	expect(t, withoutCSRF.do("POST", "logout", `{}`), 403)
	r := httptest.NewRequest("POST", "/api/goal", strings.NewReader(`{}`))
	r.Header.Set("Origin", "https://evil.example")
	r.AddCookie(e.cookie)
	r.Header.Set("X-CSRF-Token", e.csrf)
	w := httptest.NewRecorder()
	a.handler(w, r)
	expect(t, w, 403)
	if !e.cookie.HttpOnly || e.cookie.SameSite != http.SameSiteStrictMode {
		t.Fatal("unsafe cookie")
	}
	expect(t, e.do("POST", "logout", `{}`), 200)
	expect(t, e.do("GET", "workspace", ""), 401)
	if strings.Contains(h.do("GET", "workspace", "").Body.String(), "password_hash") {
		t.Fatal("hash leaked")
	}
}

func TestFullWorkflowExactlyOnceAndPersistence(t *testing.T) {
	a := fixture(t)
	e := client(t, a, "employee")
	m := client(t, a, "manager")
	h := client(t, a, "hr")
	other := client(t, a, "colleague")
	before := a.Store.State.effective(*a.Store.State.employee("E0002"))
	q := chooseRequest(t, a, e)
	expect(t, e.do("POST", "transition", transitionJSON(q.ID, "approve", "")), 403)
	expect(t, other.do("POST", "transition", transitionJSON(q.ID, "cancel", "")), 403)
	expect(t, e.do("POST", "transition", transitionJSON(q.ID, "submit", "Демо-результат с проверяемым описанием работы")), 409)
	expect(t, m.do("POST", "transition", transitionJSON(q.ID, "approve", "")), 200)
	expect(t, e.do("POST", "transition", transitionJSON(q.ID, "submit", "Подготовлена схема и разбор решения для проверки HR.")), 200)
	mid := a.Store.State.effective(*a.Store.State.employee("E0002"))
	for k, v := range before {
		if mid[k] != v {
			t.Fatal("premature skill increase")
		}
	}
	expect(t, h.do("POST", "transition", transitionJSON(q.ID, "complete", "Проверено описание результата и демонстрационная работа.")), 200)
	expect(t, h.do("POST", "transition", transitionJSON(q.ID, "complete", "Повторное подтверждение результата.")), 409)
	after := a.Store.State.effective(*a.Store.State.employee("E0002"))
	delta := 0
	for k, v := range after {
		delta += v - before[k]
		if v < before[k] || v > 5 {
			t.Fatal("invalid growth")
		}
	}
	if delta == 0 {
		t.Fatal("no growth")
	}
	reloaded, err := loadRows(filepath.Join(a.Store.Dir, "state.csv"))
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Requests[0].Status != "completed" || len(reloaded.Audits) != 4 {
		t.Fatal("not durable")
	}
	for k, v := range reloaded.effective(*reloaded.employee("E0002")) {
		if after[k] != v {
			t.Fatal("growth changed after reload")
		}
	}
}

func TestRejectionReturnCancelAndExplicitConfirmation(t *testing.T) {
	a := fixture(t)
	e := client(t, a, "employee")
	m := client(t, a, "manager")
	h := client(t, a, "hr")
	expect(t, e.do("POST", "requests", `{"event_id":"EV_005"}`), 400)
	q := chooseRequest(t, a, e)
	expect(t, m.do("POST", "transition", transitionJSON(q.ID, "reject", "")), 400)
	expect(t, m.do("POST", "transition", transitionJSON(q.ID, "reject", "Не подходит выбранное время, выберите другую сессию.")), 200)
	q = chooseRequest(t, a, e)
	expect(t, m.do("POST", "transition", transitionJSON(q.ID, "approve", "")), 200)
	expect(t, e.do("POST", "transition", transitionJSON(q.ID, "submit", "Подготовлен подробный демонстрационный результат.")), 200)
	expect(t, h.do("POST", "transition", transitionJSON(q.ID, "return", "Нужен пример проверки результата.")), 200)
	if a.Store.State.Requests[1].Status != "approved" {
		t.Fatal("return transition failed")
	}
	expect(t, e.do("POST", "transition", transitionJSON(q.ID, "cancel", "")), 200)
	expect(t, h.do("POST", "transition", transitionJSON(q.ID, "complete", "Подтверждение после отмены запрещено.")), 409)
}

func TestConcurrentConfirmation(t *testing.T) {
	a := fixture(t)
	e := client(t, a, "employee")
	m := client(t, a, "manager")
	h := client(t, a, "hr")
	q := chooseRequest(t, a, e)
	expect(t, m.do("POST", "transition", transitionJSON(q.ID, "approve", "")), 200)
	expect(t, e.do("POST", "transition", transitionJSON(q.ID, "submit", "Демонстрационный результат готов к проверке.")), 200)
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes <- h.do("POST", "transition", transitionJSON(q.ID, "complete", "Результат успешно проверен HR.")).Code
		}()
	}
	wg.Wait()
	close(codes)
	ok, conflict := 0, 0
	for c := range codes {
		if c == 200 {
			ok++
		}
		if c == 409 {
			conflict++
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatal(ok, conflict)
	}
}

func TestSkillGrowthChronologyAndCaps(t *testing.T) {
	s := State{Events: []Event{{ID: "EV_A", Gains: []Gain{{"S", 2, 3}}}, {ID: "EV_B", Gains: []Gain{{"S", 2, 5}}}}, History: []History{{Employee: "E", Event: "EV_B", Date: "2026-09-22", Status: "completed"}, {Employee: "E", Event: "EV_A", Date: "2026-09-21", Status: "completed"}, {Employee: "E", Event: "EV_A", Date: "2026-09-01", Status: "completed"}}}
	e := Employee{ID: "E", Skills: map[string]int{"S": 1}, LastReview: "2026-09-10"}
	if got := s.effective(e)["S"]; got != 5 {
		t.Fatal(got)
	}
	if grow(5, Gain{"S", 1, 3}) != 5 || grow(2, Gain{"S", 2, 3}) != 3 {
		t.Fatal("max_level lowers skill or ignored")
	}
}

func TestMultiFactorCounterexample(t *testing.T) {
	e := Employee{ID: "E", Role: "Engineer", Grade: "Middle", Format: "remote", Skills: map[string]int{"SPEAK": 0, "DESIGN": 2}, Goal: &Goal{"Engineer", "Senior"}}
	s := State{Employees: []Employee{e}, Roles: []RoleProfile{{"Engineer", "Senior", map[string]int{"SPEAK": 1, "DESIGN": 4}, []string{"DESIGN"}}}, Events: []Event{{ID: "SPEECH", Title: "Speech", Format: "self_paced", Roles: []string{"Engineer"}, Grades: []string{"Middle"}, Gains: []Gain{{"SPEAK", 1, 3}}}, {ID: "DESIGN", Title: "Design", Format: "self_paced", Roles: []string{"Engineer"}, Grades: []string{"Middle"}, Gains: []Gain{{"DESIGN", 1, 4}}}}, History: []History{{Employee: "E", Event: "SPEECH", Status: "no_show"}, {Employee: "E", Event: "SPEECH", Status: "no_show"}, {Employee: "E", Event: "SPEECH", Status: "no_show"}}}
	c := s.candidates(e)
	if c[0].Event.ID != "DESIGN" || len(c[0].Facts) < 3 {
		t.Fatal("single-factor ranking")
	}
	s.Events[1].Prereq = map[string]int{"SPEAK": 2}
	c = s.candidates(e)
	if c[0].Event.ID != "SPEECH" || c[1].Blocked == "" {
		t.Fatal("prerequisites ignored")
	}
}

func TestAtomicSaveFailureKeepsState(t *testing.T) {
	a := fixture(t)
	before := len(a.Store.State.Audits)
	a.Store.Dir = filepath.Join(a.Store.Dir, "missing", "folder")
	err := a.Store.transact(func(s *State) error { s.audit(s.Users[0], "E0002", "x", "test", "must rollback"); return nil })
	if err == nil || len(a.Store.State.Audits) != before {
		t.Fatal("failed transaction changed state")
	}
}

func TestImportAndAccountIssuance(t *testing.T) {
	a := fixture(t)
	h := client(t, a, "hr")
	profile := *a.Store.State.employee("E0002")
	profile.ID = "JURY_01"
	profile.Name = "Synthetic Jury Example"
	data, _ := json.Marshal(map[string]any{"employees": map[string]any{"employees": []Employee{profile}}, "history_csv": "record_id,employee_id,event_id,date,due_date,status,completion_pct,score,feedback_rating,assigned_by\nJURY_R1,JURY_01,EV_036,2026-09-25,,no_show,0,,,self\n", "confirmed": true})
	expect(t, h.do("POST", "import", string(data)), 200)
	expect(t, h.do("POST", "import", string(data)), 400)
	if len(a.Store.State.Employees) != 201 {
		t.Fatal("non-atomic import")
	}
	expect(t, h.do("POST", "accounts", `{"employee_id":"JURY_01","login":"jury","password":"Jury-Secure-Password42","role":"manager","confirmed":true}`), 400)
	expect(t, h.do("POST", "accounts", `{"employee_id":"JURY_01","login":"jury","password":"Jury-Secure-Password42","role":"employee","confirmed":true}`), 200)
	expect(t, (testClient{a: a}).do("POST", "login", `{"login":"jury","password":"Jury-Secure-Password42"}`), 200)
	if len(a.Store.State.Users) != 5 {
		t.Fatal("account missing")
	}
	if checkPassword("wrong", a.Store.State.Users[4].Hash) || !strings.HasPrefix(a.Store.State.Users[4].Hash, "pbkdf2-sha256$600000$") {
		t.Fatal("password storage")
	}
	profile.ID = "JURY_02"
	profile.Skills = map[string]int{"UNKNOWN": 2}
	if validateImport(&a.Store.State, []Employee{profile}, nil) == nil {
		t.Fatal("invalid skills accepted")
	}
	expect(t, h.do("POST", "import", `{"history_csv":"bad,header\n1,2","confirmed":true}`), 400)
}

func TestAIUnavailableSuccessFailureAndValidation(t *testing.T) {
	a := fixture(t)
	e := client(t, a, "employee")
	expect(t, e.do("POST", "recommendations", `{"confirmed":true}`), 503)
	a.AIKey = "test-key"
	expect(t, e.do("POST", "recommendations", `{"confirmed":true}`), 503)
	a.AllowAI = true
	choice := candidate(t, a)
	reply := `{"choices":[{"event_id":"` + choice.Event.ID + `","rationale":"Критичный навык целевого грейда и история участия делают этот шаг подходящим.","unknowns":["Доступность сотрудника"]}]}`
	mode := "success"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-goog-api-key") != "test-key" {
			t.Error("key not server-side")
		}
		var in map[string]any
		_ = json.NewDecoder(r.Body).Decode(&in)
		raw, _ := json.Marshal(in)
		if strings.Contains(string(raw), "Arman Zhaksylykov") || strings.Contains(string(raw), "E0002") {
			t.Error("identity was transmitted")
		}
		switch mode {
		case "error":
			w.WriteHeader(429)
		case "invalid":
			fmt.Fprint(w, `{"candidates":[{"content":{"parts":[{"text":"not-json"}]}}]}`)
		case "unsafe":
			json.NewEncoder(w).Encode(map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{map[string]string{"text": strings.ReplaceAll(reply, choice.Event.ID, "EV_NOT_ALLOWED")}}}}}})
		default:
			json.NewEncoder(w).Encode(map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{map[string]string{"text": reply}}}}}})
		}
	}))
	defer server.Close()
	a.AIURL = server.URL
	expect(t, e.do("POST", "recommendations", `{"confirmed":false}`), 400)
	expect(t, e.do("POST", "recommendations", `{"confirmed":true}`), 200)
	if len(a.Store.State.Recommendations) != 1 || len(a.Store.State.Requests) != 0 {
		t.Fatal("AI executed action or not saved")
	}
	mode = "error"
	expect(t, e.do("POST", "recommendations", `{"confirmed":true}`), 502)
	mode = "invalid"
	expect(t, e.do("POST", "recommendations", `{"confirmed":true}`), 502)
	mode = "unsafe"
	expect(t, e.do("POST", "recommendations", `{"confirmed":true}`), 502)
	if len(a.Store.State.Recommendations) != 1 {
		t.Fatal("invalid response saved")
	}
}

func TestAITimeout(t *testing.T) {
	a := fixture(t)
	e := client(t, a, "employee")
	a.AIKey = "test-only"
	a.AllowAI = true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(200 * time.Millisecond):
		}
	}))
	defer server.Close()
	a.AIURL = server.URL
	a.AIClient = &http.Client{Timeout: 70 * time.Millisecond}
	start := time.Now()
	expect(t, e.do("POST", "recommendations", `{"confirmed":true}`), 504)
	if time.Since(start) > time.Second {
		t.Fatal("timeout unbounded")
	}
}

func TestWorkspacePerformanceAndDataset(t *testing.T) {
	a := fixture(t)
	h := client(t, a, "hr")
	if len(a.Store.State.Employees) != 200 || len(a.Store.State.Events) != 40 || len(a.Store.State.Skills) != 60 || len(a.Store.State.History) != 2743 {
		t.Fatal("wrong dataset size")
	}
	start := time.Now()
	w := h.do("GET", "workspace", "")
	expect(t, w, 200)
	elapsed := time.Since(start)
	t.Logf("HR workspace: %s", elapsed)
	if elapsed > 2*time.Second {
		t.Fatal("UI API over 2 seconds")
	}
	start = time.Now()
	employee := client(t, a, "employee")
	expect(t, employee.do("GET", "workspace", ""), 200)
	t.Logf("Employee login + workspace: %s", time.Since(start))
	if _, e := os.Stat(filepath.Join(a.Store.Dir, "state.csv")); e != nil {
		t.Fatal(e)
	}
}

func TestJuryFixtures(t *testing.T) {
	a := fixture(t)
	var file struct {
		Employees []Employee `json:"employees"`
	}
	if err := readJSON("../fixtures/employees.json", &file); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open("../fixtures/activity_history.csv")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	history, err := parseHistory(f)
	if err != nil {
		t.Fatal(err)
	}
	if err = validateImport(&a.Store.State, file.Employees, history); err != nil {
		t.Fatal(err)
	}
	a.Store.State.Employees = append(a.Store.State.Employees, file.Employees...)
	a.Store.State.History = append(a.Store.State.History, history...)
	first := a.Store.State.candidates(file.Employees[0])
	if len(first) == 0 || first[0].Blocked != "" || strings.Contains(first[0].Event.Title, "Public Speaking") {
		t.Fatal("lowest-skill trap")
	}
	second := a.Store.State.candidates(file.Employees[1])
	blocked := false
	for _, c := range second {
		if strings.Contains(c.Blocked, "Для участия нужен") {
			blocked = true
		}
	}
	if !blocked {
		t.Fatal("prerequisite trap")
	}
	for _, c := range a.Store.State.candidates(file.Employees[2]) {
		if c.Blocked == "" {
			t.Fatal("fully reached goal should have no artificial gaps")
		}
	}
	t.Logf("Jury fixture 1 first: %s; fixture 2 prerequisites enforced; fixture 3 empty state", first[0].Event.Title)
}
