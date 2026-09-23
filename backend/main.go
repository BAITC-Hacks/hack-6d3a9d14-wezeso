package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type API struct {
	Store    *Store
	Auth     *Auth
	Origin   string
	Secure   bool
	AIKey    string
	AllowAI  bool
	AIURL    string
	AIClient *http.Client
}
type apiError struct {
	Code    int
	Message string
}

func (e apiError) Error() string      { return e.Message }
func fail(code int, msg string) error { return apiError{code, msg} }
func send(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
func problem(w http.ResponseWriter, e error) {
	code := 500
	msg := "Не удалось сохранить действие. Попробуйте снова; данные не изменены."
	var ae apiError
	if errors.As(e, &ae) {
		code, msg = ae.Code, ae.Message
	} else {
		log.Printf("operation failed: %v", e)
	}
	send(w, code, map[string]string{"error": msg})
}
func body(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if e := dec.Decode(v); e != nil {
		return fail(400, "Неверные данные запроса")
	}
	return nil
}
func visible(u User, e *Employee) bool {
	return e != nil && (u.Role == "hr" || u.Employee == e.ID || (u.Role == "manager" && e.Manager != nil && *e.Manager == u.Employee))
}
func (a *API) handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	if r.Method != "GET" && r.Method != "POST" {
		problem(w, fail(405, "Метод не поддерживается"))
		return
	}
	if r.Method == "POST" && r.Header.Get("Origin") != "" && r.Header.Get("Origin") != a.Origin {
		problem(w, fail(403, "Источник запроса не разрешён"))
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/")
	if path == "health" && r.Method == "GET" {
		send(w, 200, map[string]any{"ok": true, "model": "gemini-3.8-flash", "snapshot": snapshot})
		return
	}
	if path == "login" && r.Method == "POST" {
		a.login(w, r)
		return
	}
	session, ok := a.Auth.session(r)
	if !ok {
		problem(w, fail(401, "Войдите в учётную запись"))
		return
	}
	if r.Method == "POST" && r.Header.Get("X-CSRF-Token") != session.CSRF {
		problem(w, fail(403, "Обновите страницу: защита сессии не пройдена"))
		return
	}
	u := session.User
	if path == "session" && r.Method == "GET" {
		send(w, 200, map[string]any{"user": publicUser(u), "csrf": session.CSRF})
		return
	}
	if path == "logout" && r.Method == "POST" {
		a.Auth.logout(w, r, a.Secure)
		send(w, 200, map[string]bool{"ok": true})
		return
	}
	if path == "workspace" && r.Method == "GET" {
		a.workspace(w, r, u)
		return
	}
	if path == "recommendations" && r.Method == "POST" {
		a.recommend(w, r, u)
		return
	}
	if path == "import" && r.Method == "POST" {
		a.importData(w, r, u)
		return
	}
	if r.Method != "POST" {
		problem(w, fail(404, "Страница API не найдена"))
		return
	}
	var err error
	switch path {
	case "goal":
		var in struct {
			Goal      Goal `json:"goal"`
			Confirmed bool `json:"confirmed"`
		}
		if err = body(r, &in); err == nil {
			err = a.Store.transact(func(s *State) error {
				if !in.Confirmed {
					return fail(400, "Подтвердите изменение цели")
				}
				e := s.employee(u.Employee)
				if e == nil {
					return fail(403, "Профиль не найден")
				}
				found := false
				for _, rp := range s.Roles {
					if rp.Role == in.Goal.Role && rp.Grade == in.Goal.Grade {
						found = true
					}
				}
				if !found {
					return fail(400, "Такой роли или грейда нет в каталоге")
				}
				e.Goal = &in.Goal
				s.audit(u, e.ID, e.ID, "goal_changed", in.Goal.Role+" / "+in.Goal.Grade)
				return nil
			})
		}
	case "requests":
		var in struct {
			Event     string `json:"event_id"`
			Session   string `json:"session_date"`
			Confirmed bool   `json:"confirmed"`
			Decline   bool   `json:"decline"`
		}
		if err = body(r, &in); err == nil {
			err = a.Store.transact(func(s *State) error {
				if !in.Confirmed {
					return fail(400, "Нужно явное подтверждение")
				}
				e := s.employee(u.Employee)
				if e == nil || u.Role == "hr" {
					return fail(403, "Заявку подаёт сотрудник из своего профиля")
				}
				var candidate *Candidate
				for _, c := range s.candidates(*e) {
					if c.Event.ID == in.Event {
						cc := c
						candidate = &cc
					}
				}
				if candidate == nil {
					return fail(400, "Активность недоступна")
				}
				if candidate.Blocked != "" {
					return fail(409, candidate.Blocked)
				}
				status := "pending_manager"
				if in.Decline {
					status = "declined"
				} else {
					if e.Manager == nil {
						return fail(409, "Нет непосредственного руководителя: HR должен проверить профиль")
					}
					if candidate.Event.Format != "self_paced" && (!slices.Contains(candidate.Event.Sessions, in.Session) || in.Session < snapshot) {
						return fail(400, "Выберите доступную сессию")
					}
				}
				now := stamp()
				req := Request{ID: uid("Q"), Employee: e.ID, Event: in.Event, Status: status, Session: in.Session, Created: now, Updated: now, Gains: map[string]int{}}
				s.Requests = append(s.Requests, req)
				s.audit(u, e.ID, req.ID, status, candidate.Event.Title)
				return nil
			})
		}
	case "transition":
		var in struct {
			ID        string `json:"id"`
			Action    string `json:"action"`
			Note      string `json:"note"`
			Confirmed bool   `json:"confirmed"`
		}
		if err = body(r, &in); err == nil {
			err = a.Store.transact(func(s *State) error {
				return transition(s, u, in.ID, in.Action, strings.TrimSpace(in.Note), in.Confirmed)
			})
		}
	case "accounts":
		if u.Role != "hr" {
			err = fail(403, "Выдача учётных записей доступна только HR")
			break
		}
		var in struct {
			Employee  string `json:"employee_id"`
			Login     string `json:"login"`
			Password  string `json:"password"`
			Role      string `json:"role"`
			Confirmed bool   `json:"confirmed"`
		}
		if err = body(r, &in); err == nil {
			var hash string
			hash, err = hashPassword(in.Password)
			if err != nil {
				err = fail(400, err.Error())
				break
			}
			err = a.Store.transact(func(s *State) error {
				e := s.employee(in.Employee)
				if e == nil || !in.Confirmed {
					return fail(400, "Выберите профиль и подтвердите выдачу доступа")
				}
				if in.Role != "employee" && !(in.Role == "manager" && e.Grade == "Lead") {
					return fail(400, "Роль руководителя доступна только Lead")
				}
				login := strings.ToLower(strings.TrimSpace(in.Login))
				if len(login) < 3 || len(login) > 80 || strings.ContainsAny(login, " \n\r\t") {
					return fail(400, "Логин: 3–80 символов без пробелов")
				}
				for _, v := range s.Users {
					if v.Login == login || v.Employee == e.ID {
						return fail(409, "Логин или профиль уже имеет учётную запись")
					}
				}
				nu := User{uid("U"), login, hash, in.Role, e.ID}
				s.Users = append(s.Users, nu)
				s.audit(u, e.ID, nu.ID, "account_issued", in.Role)
				return nil
			})
		}
	default:
		err = fail(404, "Действие не найдено")
	}
	if err != nil {
		problem(w, err)
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}
func transition(s *State, u User, id, action, note string, confirmed bool) error {
	if !confirmed {
		return fail(400, "Подтвердите действие")
	}
	if len(note) > 4000 {
		return fail(400, "Текст длиннее 4000 символов")
	}
	var req *Request
	for i := range s.Requests {
		if s.Requests[i].ID == id {
			req = &s.Requests[i]
		}
	}
	if req == nil {
		return fail(404, "Заявка не найдена")
	}
	e := s.employee(req.Employee)
	if !visible(u, e) {
		return fail(403, "Заявка недоступна")
	}
	before := req.Status
	switch action {
	case "approve", "reject":
		if u.Role != "manager" || e.Manager == nil || *e.Manager != u.Employee || u.Employee == e.ID {
			return fail(403, "Нужен непосредственный руководитель")
		}
		if before != "pending_manager" {
			return fail(409, "Этап уже изменился")
		}
		if action == "approve" {
			req.Status = "approved"
		} else {
			if len(note) < 8 {
				return fail(400, "Укажите причину отказа, минимум 8 символов")
			}
			req.Status = "rejected"
		}
	case "submit":
		if u.Employee != req.Employee {
			return fail(403, "Результат отправляет сотрудник")
		}
		if before != "approved" {
			return fail(409, "Сначала нужно согласование руководителя")
		}
		if len(note) < 20 {
			return fail(400, "Опишите результат минимум в 20 символах")
		}
		req.Evidence = note
		req.Status = "pending_hr"
	case "complete", "return":
		if u.Role != "hr" || u.Employee == req.Employee {
			return fail(403, "Результат подтверждает HR")
		}
		if before != "pending_hr" {
			return fail(409, "Результат уже рассмотрен или ещё не представлен")
		}
		if len(note) < 8 {
			return fail(400, "Запишите основание решения, минимум 8 символов")
		}
		if action == "return" {
			req.Status = "approved"
		} else {
			ev := s.event(req.Event)
			if ev == nil {
				return fail(409, "Активность отсутствует")
			}
			levels := s.effective(*e)
			req.Gains = map[string]int{}
			for _, g := range ev.Gains {
				req.Gains[g.Skill] = grow(levels[g.Skill], g) - levels[g.Skill]
			}
			req.Status = "completed"
			req.ConfirmedBy = u.ID
		}
	case "cancel":
		if u.Employee != req.Employee {
			return fail(403, "Отменить может сам сотрудник")
		}
		if !active(before) {
			return fail(409, "Эта заявка уже закрыта")
		}
		req.Status = "cancelled"
	default:
		return fail(400, "Неизвестный переход")
	}
	req.Note = note
	req.Updated = stamp()
	s.audit(u, e.ID, req.ID, action, fmt.Sprintf("%s → %s. %s", before, req.Status, note))
	return nil
}
func (a *API) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Login    string `json:"login"`
		Password string `json:"password"`
	}
	if e := body(r, &in); e != nil {
		problem(w, e)
		return
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	a.Auth.mu.Lock()
	attempt := a.Auth.Attempts[host]
	if time.Now().After(attempt.Until) {
		attempt = Attempt{Until: time.Now().Add(5 * time.Minute)}
	}
	attempt.Count++
	a.Auth.Attempts[host] = attempt
	a.Auth.mu.Unlock()
	if attempt.Count > 15 {
		problem(w, fail(429, "Слишком много попыток. Повторите через 5 минут"))
		return
	}
	a.Store.mu.Lock()
	var found *User
	for _, u := range a.Store.State.Users {
		if u.Login == strings.ToLower(strings.TrimSpace(in.Login)) {
			v := u
			found = &v
		}
	}
	a.Store.mu.Unlock()
	hash := a.Auth.DummyHash
	if found != nil {
		hash = found.Hash
	}
	valid := checkPassword(in.Password, hash)
	if !valid || found == nil {
		problem(w, fail(401, "Неверный логин или пароль"))
		return
	}
	s := a.Auth.issue(w, *found, a.Secure)
	a.Auth.mu.Lock()
	delete(a.Auth.Attempts, host)
	a.Auth.mu.Unlock()
	send(w, 200, map[string]any{"user": publicUser(*found), "csrf": s.CSRF})
}
func (a *API) workspace(w http.ResponseWriter, r *http.Request, u User) {
	a.Store.mu.Lock()
	defer a.Store.mu.Unlock()
	s := &a.Store.State
	empID := r.URL.Query().Get("employee")
	if empID == "" {
		empID = u.Employee
	}
	e := s.employee(empID)
	if empID != "" && !visible(u, e) {
		problem(w, fail(403, "Нет доступа к этому профилю"))
		return
	}
	out := map[string]any{"user": publicUser(u), "snapshot": snapshot, "roles": s.Roles, "ai": map[string]any{"available": a.AIKey != "" && a.AllowAI, "has_key": a.AIKey != "", "external_allowed": a.AllowAI, "model": "gemini-3.8-flash"}, "counts": map[string]int{"employees": len(s.Employees), "events": len(s.Events), "skills": len(s.Skills), "history": len(s.History)}}
	if e != nil {
		g, p := s.gaps(*e)
		history := []History{}
		for _, h := range s.History {
			if h.Employee == e.ID {
				history = append(history, h)
			}
		}
		out["profile"] = e
		out["levels"] = s.effective(*e)
		out["gaps"] = g
		out["progress"] = p
		out["target"] = s.target(*e)
		out["candidates"] = s.candidates(*e)
		out["history"] = history
		recs := []Recommendation{}
		for _, rec := range s.Recommendations {
			if rec.Employee == e.ID {
				recs = append(recs, rec)
			}
		}
		out["recommendations"] = recs
	}
	requests := []Request{}
	audits := []Audit{}
	for _, q := range s.Requests {
		if visible(u, s.employee(q.Employee)) {
			requests = append(requests, q)
		}
	}
	for _, h := range s.Audits {
		if h.Employee == "" && u.Role == "hr" || visible(u, s.employee(h.Employee)) {
			audits = append(audits, h)
		}
	}
	out["requests"] = requests
	out["audit"] = audits
	out["events"] = s.Events
	roster := []map[string]any{}
	if u.Role != "employee" {
		for _, e := range s.Employees {
			if !visible(u, &e) {
				continue
			}
			g, p := s.gaps(e)
			skips, recent := 0, 0
			for _, h := range s.History {
				if h.Employee == e.ID && h.Date >= "2026-07-03" {
					if h.Status == "dropped" || h.Status == "no_show" || h.Status == "declined" {
						skips++
					}
					if h.Status == "completed" || h.Status == "in_progress" {
						recent++
					}
				}
			}
			for _, q := range s.Requests {
				if q.Employee == e.ID && (active(q.Status) || q.Status == "completed") {
					recent++
				}
			}
			hasAccount := false
			for _, a := range s.Users {
				if a.Employee == e.ID {
					hasAccount = true
				}
			}
			roster = append(roster, map[string]any{"employee_id": e.ID, "full_name": e.Name, "department": e.Department, "role": e.Role, "grade": e.Grade, "progress": p, "gaps": g, "skips": skips, "recent": recent, "has_account": hasAccount})
		}
	}
	out["roster"] = roster
	send(w, 200, out)
}
func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func main() {
	dir := env("DATA_DIR", "data")
	if e := os.MkdirAll(dir, 0700); e != nil {
		log.Fatal(e)
	}
	lock := filepath.Join(dir, "state.lock")
	lf, e := os.OpenFile(lock, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		log.Fatal("CSV-хранилище занято или остался state.lock после сбоя. Убедитесь, что другого процесса нет, затем удалите lock: ", e)
	}
	_, _ = fmt.Fprint(lf, os.Getpid())
	_ = lf.Close()
	defer os.Remove(lock)
	st := &Store{Dir: dir}
	st.State, e = loadRows(filepath.Join(dir, "state.csv"))
	if os.IsNotExist(e) {
		st.State, e = seed(env("DATASET_DIR", "."))
		if e != nil {
			log.Print(e)
			return
		}
		if e = writeRows(filepath.Join(dir, "demo.csv"), st.State); e != nil {
			log.Print(e)
			return
		}
		pass := os.Getenv("DEMO_PASSWORD")
		if pass == "" {
			pass = "Quest-" + uid("")[:18]
		}
		hash, err := hashPassword(pass)
		if err != nil {
			log.Print(err)
			return
		}
		st.State.Users = []User{{"U_employee", "employee", hash, "employee", "E0002"}, {"U_manager", "manager", hash, "manager", "E0175"}, {"U_hr", "hr", hash, "hr", ""}, {"U_other", "colleague", hash, "employee", "E0001"}}
		if err = os.WriteFile(filepath.Join(dir, "demo-accounts.txt"), []byte("Локальные демо-аккаунты (не добавлять в git)\nЛогины: employee, manager, hr, colleague\nПароль: "+pass+"\n"), 0600); err != nil {
			log.Print(err)
			return
		}
		e = writeRows(filepath.Join(dir, "state.csv"), st.State)
	}
	if e != nil {
		log.Print(e)
		return
	}
	dummy, _ := hashPassword(uid(""))
	auth := &Auth{Sessions: map[string]Session{}, Attempts: map[string]Attempt{}, DummyHash: dummy}
	a := &API{Store: st, Auth: auth, Origin: env("APP_ORIGIN", "http://localhost:3000"), Secure: os.Getenv("COOKIE_SECURE") == "true", AIKey: os.Getenv("GEMINI_API_KEY"), AllowAI: os.Getenv("ALLOW_EXTERNAL_AI") == "true", AIURL: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent", AIClient: &http.Client{Timeout: 9 * time.Second}}
	server := &http.Server{Addr: "127.0.0.1:" + env("PORT", "8080"), Handler: http.HandlerFunc(a.handler), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-signals
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	log.Printf("Career Quest API: %s · CSV records: %s · credentials: %s", server.Addr, strconv.Itoa(len(st.State.History)), filepath.Join(dir, "demo-accounts.txt"))
	if e = server.ListenAndServe(); e != nil && e != http.ErrServerClosed {
		log.Print(e)
	}
}
