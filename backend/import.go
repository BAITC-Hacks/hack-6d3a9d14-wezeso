package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

func validDate(v string) bool { _, err := time.Parse("2006-01-02", v); return err == nil }

var safeID = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{1,63}$`)

func validateImport(s *State, employees []Employee, history []History) error {
	if len(employees) == 0 && len(history) == 0 {
		return fail(400, "Нет данных для импорта")
	}
	if len(employees) > 500 || len(history) > 10000 {
		return fail(400, "Пакет слишком большой: максимум 500 профилей и 10 000 записей")
	}
	known := map[string]bool{}
	for _, e := range s.Employees {
		known[e.ID] = true
	}
	skills := map[string]bool{}
	for _, sk := range s.Skills {
		skills[sk.ID] = true
	}
	for _, e := range employees {
		if known[e.ID] || !safeID.MatchString(e.ID) {
			return fail(400, "Повторяющийся или неверный employee_id: "+e.ID)
		}
		known[e.ID] = true
		if strings.TrimSpace(e.Name) == "" || len(e.Name) > 160 || e.Department == "" || e.Tenure < 0 || e.Tenure > 600 || !validDate(e.LastReview) || e.LastReview > snapshot || !validDate(e.HireDate) || e.HireDate > snapshot {
			return fail(400, "Неполный или некорректный профиль "+e.ID)
		}
		if !slices.Contains([]string{"office", "hybrid", "remote"}, e.Format) || !slices.Contains([]string{"ru", "kk", "en"}, e.Language) {
			return fail(400, "Неверный формат работы/язык "+e.ID)
		}
		roleOK := false
		goalOK := e.Goal == nil
		for _, r := range s.Roles {
			if r.Role == e.Role && r.Grade == e.Grade {
				roleOK = true
			}
			if e.Goal != nil && r.Role == e.Goal.Role && r.Grade == e.Goal.Grade {
				goalOK = true
			}
		}
		if !roleOK || !goalOK || e.Skills == nil {
			return fail(400, "Неизвестная роль/цель или отсутствуют skills: "+e.ID)
		}
		for id, level := range e.Skills {
			if !skills[id] || level < 0 || level > 5 {
				return fail(400, "Неверный навык "+id+" в "+e.ID)
			}
		}
	}
	all := append(append([]Employee{}, s.Employees...), employees...)
	for _, e := range employees {
		if e.Manager != nil {
			found := false
			for _, m := range all {
				if m.ID == *e.Manager && m.ID != e.ID && m.Grade == "Lead" && m.Department == e.Department {
					found = true
				}
			}
			if !found {
				return fail(400, "manager_id должен указывать на Lead своего подразделения: "+e.ID)
			}
		}
	}
	ids := map[string]bool{}
	completed := map[string]bool{}
	for _, h := range s.History {
		ids[h.ID] = true
		if h.Status == "completed" {
			completed[h.Employee+"/"+h.Event] = true
		}
	}
	for _, q := range s.Requests {
		if q.Status == "completed" {
			completed[q.Employee+"/"+q.Event] = true
		}
	}
	for _, h := range history {
		if !safeID.MatchString(h.ID) || ids[h.ID] {
			return fail(400, "Повторяющийся record_id: "+h.ID)
		}
		ids[h.ID] = true
		if h.Status == "completed" {
			key := h.Employee + "/" + h.Event
			if h.Event != "EV_036" && completed[key] {
				return fail(400, "Повторное завершение активности: "+h.ID)
			}
			completed[key] = true
		}
		if !known[h.Employee] || s.event(h.Event) == nil || !validDate(h.Date) || h.Date > snapshot || (h.Due != "" && !validDate(h.Due)) {
			return fail(400, "Неверная ссылка или дата в истории: "+h.ID)
		}
		if !slices.Contains([]string{"completed", "in_progress", "dropped", "no_show", "declined", "overdue"}, h.Status) || !slices.Contains([]string{"self", "manager", "hr"}, h.Assigned) {
			return fail(400, "Неверный статус/assigned_by: "+h.ID)
		}
		if (h.Status == "completed" && h.Pct != 100) || ((h.Status == "no_show" || h.Status == "declined") && h.Pct != 0) || ((h.Status == "in_progress" || h.Status == "overdue" || h.Status == "dropped") && h.Pct > 95) {
			return fail(400, "Процент не соответствует статусу: "+h.ID)
		}
		for _, n := range []struct {
			value    string
			min, max int
		}{{h.Score, 0, 100}, {h.Feedback, 1, 5}} {
			if n.value != "" {
				v, e := strconv.Atoi(n.value)
				if e != nil || v < n.min || v > n.max {
					return fail(400, "Неверная оценка: "+h.ID)
				}
			}
		}
	}
	return nil
}
func (a *API) importData(w http.ResponseWriter, r *http.Request, u User) {
	if u.Role != "hr" {
		problem(w, fail(403, "Импорт доступен только HR"))
		return
	}
	var in struct {
		Employees json.RawMessage `json:"employees"`
		History   string          `json:"history_csv"`
		Confirmed bool            `json:"confirmed"`
	}
	if e := body(r, &in); e != nil {
		problem(w, e)
		return
	}
	if !in.Confirmed {
		problem(w, fail(400, "Подтвердите импорт"))
		return
	}
	var profiles []Employee
	if len(in.Employees) > 0 && string(in.Employees) != "null" {
		if bytes.HasPrefix(bytes.TrimSpace(in.Employees), []byte("[")) {
			if e := json.Unmarshal(in.Employees, &profiles); e != nil {
				problem(w, fail(400, "Некорректный employees JSON"))
				return
			}
		} else {
			var file struct {
				Employees []Employee `json:"employees"`
			}
			if e := json.Unmarshal(in.Employees, &file); e != nil {
				problem(w, fail(400, "Некорректный employees.json"))
				return
			}
			profiles = file.Employees
		}
	}
	var history []History
	if strings.TrimSpace(in.History) != "" {
		var e error
		history, e = parseHistory(strings.NewReader(in.History))
		if e != nil {
			problem(w, fail(400, e.Error()))
			return
		}
	}
	err := a.Store.transact(func(s *State) error {
		if e := validateImport(s, profiles, history); e != nil {
			return e
		}
		s.Employees = append(s.Employees, profiles...)
		s.History = append(s.History, history...)
		s.audit(u, "", "dataset", "dataset_imported", fmt.Sprintf("Добавлено %d профилей и %d записей истории", len(profiles), len(history)))
		return nil
	})
	if err != nil {
		problem(w, err)
		return
	}
	send(w, 200, map[string]int{"employees_added": len(profiles), "history_added": len(history)})
}
