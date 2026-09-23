package main

import (
	"bufio"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

type Store struct {
	mu    sync.Mutex
	State State
	Dir   string
}

func readJSON(path string, out any) error {
	b, e := os.ReadFile(path)
	if e != nil {
		return e
	}
	return json.Unmarshal(b, out)
}
func parseHistory(r io.Reader) ([]History, error) {
	cr := csv.NewReader(r)
	cr.TrimLeadingSpace = true
	rows, err := cr.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, errors.New("CSV пуст")
	}
	rows[0][0] = strings.TrimPrefix(rows[0][0], "\ufeff")
	expected := []string{"record_id", "employee_id", "event_id", "date", "due_date", "status", "completion_pct", "score", "feedback_rating", "assigned_by"}
	if strings.Join(rows[0], ",") != strings.Join(expected, ",") {
		return nil, errors.New("Заголовки activity_history.csv не соответствуют исходной схеме")
	}
	out := []History{}
	for i, r := range rows[1:] {
		if len(r) != 10 {
			return nil, fmt.Errorf("Строка %d: ожидается 10 полей", i+2)
		}
		pct, e := strconv.Atoi(r[6])
		if e != nil || pct < 0 || pct > 100 {
			return nil, fmt.Errorf("Строка %d: неверный completion_pct", i+2)
		}
		out = append(out, History{r[0], r[1], r[2], r[3], r[4], r[5], pct, r[7], r[8], r[9]})
	}
	return out, nil
}
func seed(dataset string) (State, error) {
	var s State
	var em struct {
		Employees []Employee `json:"employees"`
	}
	var ev struct {
		Events []Event `json:"events"`
	}
	var sk struct {
		Skills []Skill       `json:"skills"`
		Roles  []RoleProfile `json:"role_profiles"`
	}
	for _, a := range []struct {
		name string
		out  any
	}{{"employees.json", &em}, {"events.json", &ev}, {"skills.json", &sk}} {
		if err := readJSON(filepath.Join(dataset, a.name), a.out); err != nil {
			return s, err
		}
	}
	f, err := os.Open(filepath.Join(dataset, "activity_history.csv"))
	if err != nil {
		return s, err
	}
	defer f.Close()
	h, err := parseHistory(f)
	s.Employees = em.Employees
	s.Events = ev.Events
	s.Skills = sk.Skills
	s.Roles = sk.Roles
	s.History = h
	return s, err
}
func writeRows(path string, s State) error {
	f, err := os.CreateTemp(filepath.Dir(path), "snapshot-*.tmp")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err != nil {
		f.Close()
		return err
	}
	w := csv.NewWriter(f)
	err = w.Write([]string{"kind", "id", "payload"})
	write := func(kind, id string, v any) {
		if err != nil {
			return
		}
		b, e := json.Marshal(v)
		if e != nil {
			err = e
			return
		}
		err = w.Write([]string{kind, id, string(b)})
	}
	for _, v := range s.Employees {
		write("employee", v.ID, v)
	}
	for _, v := range s.Events {
		write("event", v.ID, v)
	}
	for _, v := range s.Skills {
		write("skill", v.ID, v)
	}
	for _, v := range s.Roles {
		write("role", v.Role+"/"+v.Grade, v)
	}
	for _, v := range s.History {
		write("history", v.ID, v)
	}
	for _, v := range s.Users {
		write("user", v.ID, v)
	}
	for _, v := range s.Requests {
		write("request", v.ID, v)
	}
	for _, v := range s.Audits {
		write("audit", v.ID, v)
	}
	for _, v := range s.Recommendations {
		write("recommendation", v.ID, v)
	}
	w.Flush()
	if err == nil {
		err = w.Error()
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return replaceFile(name, path)
}
func loadRows(path string) (State, error) {
	var s State
	f, e := os.Open(path)
	if e != nil {
		return s, e
	}
	defer f.Close()
	r := csv.NewReader(bufio.NewReader(f))
	header, e := r.Read()
	if e != nil || strings.Join(header, ",") != "kind,id,payload" {
		return s, errors.New("Повреждён заголовок state.csv")
	}
	for {
		row, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return s, err
		}
		if len(row) != 3 {
			return s, errors.New("Повреждена строка state.csv")
		}
		var target any
		switch row[0] {
		case "employee":
			target = &Employee{}
		case "event":
			target = &Event{}
		case "skill":
			target = &Skill{}
		case "role":
			target = &RoleProfile{}
		case "history":
			target = &History{}
		case "user":
			target = &User{}
		case "request":
			target = &Request{}
		case "audit":
			target = &Audit{}
		case "recommendation":
			target = &Recommendation{}
		default:
			return s, errors.New("Неизвестная запись state.csv")
		}
		if err = json.Unmarshal([]byte(row[2]), target); err != nil {
			return s, err
		}
		switch v := target.(type) {
		case *Employee:
			s.Employees = append(s.Employees, *v)
		case *Event:
			s.Events = append(s.Events, *v)
		case *Skill:
			s.Skills = append(s.Skills, *v)
		case *RoleProfile:
			s.Roles = append(s.Roles, *v)
		case *History:
			s.History = append(s.History, *v)
		case *User:
			s.Users = append(s.Users, *v)
		case *Request:
			s.Requests = append(s.Requests, *v)
		case *Audit:
			s.Audits = append(s.Audits, *v)
		case *Recommendation:
			s.Recommendations = append(s.Recommendations, *v)
		}
	}
	return s, nil
}
func (st *Store) transact(fn func(*State) error) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	next := clone(st.State)
	if err := fn(&next); err != nil {
		return err
	}
	if err := writeRows(filepath.Join(st.Dir, "state.csv"), next); err != nil {
		return fmt.Errorf("Не удалось сохранить CSV: %w", err)
	}
	st.State = next
	return nil
}
