package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"time"
)

type Goal struct {
	Role  string `json:"target_role"`
	Grade string `json:"target_grade"`
}
type Employee struct {
	ID         string         `json:"employee_id"`
	Name       string         `json:"full_name"`
	Department string         `json:"department"`
	Role       string         `json:"role"`
	Grade      string         `json:"grade"`
	Manager    *string        `json:"manager_id"`
	HireDate   string         `json:"hire_date"`
	Tenure     int            `json:"tenure_months"`
	Format     string         `json:"work_format"`
	Language   string         `json:"preferred_language"`
	Goal       *Goal          `json:"career_goal"`
	Skills     map[string]int `json:"skills"`
	LastReview string         `json:"last_review_date"`
}
type Gain struct {
	Skill string `json:"skill_id"`
	Gain  int    `json:"gain"`
	Max   int    `json:"max_level"`
}
type Event struct {
	ID          string         `json:"event_id"`
	Title       string         `json:"title"`
	Description string         `json:"description"`
	Type        string         `json:"type"`
	Format      string         `json:"format"`
	Hours       float64        `json:"duration_hours"`
	Mandatory   bool           `json:"mandatory"`
	Roles       []string       `json:"target_roles"`
	Grades      []string       `json:"target_grades"`
	Gains       []Gain         `json:"develops_skills"`
	Prereq      map[string]int `json:"prerequisites"`
	Sessions    []string       `json:"upcoming_sessions"`
}
type Skill struct {
	ID          string `json:"skill_id"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	Category    string `json:"category"`
	Description string `json:"description"`
}
type RoleProfile struct {
	Role     string         `json:"role"`
	Grade    string         `json:"grade"`
	Required map[string]int `json:"required_skills"`
	Critical []string       `json:"critical_skills"`
}
type History struct {
	ID       string `json:"record_id"`
	Employee string `json:"employee_id"`
	Event    string `json:"event_id"`
	Date     string `json:"date"`
	Due      string `json:"due_date"`
	Status   string `json:"status"`
	Pct      int    `json:"completion_pct"`
	Score    string `json:"score"`
	Feedback string `json:"feedback_rating"`
	Assigned string `json:"assigned_by"`
}
type User struct {
	ID       string `json:"id"`
	Login    string `json:"login"`
	Hash     string `json:"password_hash"`
	Role     string `json:"role"`
	Employee string `json:"employee_id"`
}
type Request struct {
	ID          string         `json:"id"`
	Employee    string         `json:"employee_id"`
	Event       string         `json:"event_id"`
	Status      string         `json:"status"`
	Session     string         `json:"session_date"`
	Created     string         `json:"created_at"`
	Updated     string         `json:"updated_at"`
	Evidence    string         `json:"evidence"`
	Note        string         `json:"note"`
	Gains       map[string]int `json:"gains"`
	ConfirmedBy string         `json:"confirmed_by"`
}
type Audit struct {
	ID       string `json:"id"`
	Actor    string `json:"actor"`
	Role     string `json:"role"`
	Employee string `json:"employee_id"`
	Entity   string `json:"entity_id"`
	Action   string `json:"action"`
	Detail   string `json:"detail"`
	At       string `json:"at"`
}
type AIChoice struct {
	Event     string   `json:"event_id"`
	Rationale string   `json:"rationale"`
	Unknowns  []string `json:"unknowns"`
}
type Recommendation struct {
	ID        string              `json:"id"`
	Employee  string              `json:"employee_id"`
	Model     string              `json:"model"`
	At        string              `json:"at"`
	Choices   []AIChoice          `json:"choices"`
	Signature string              `json:"signature"`
	Evidence  map[string][]string `json:"evidence"`
}
type State struct {
	Employees       []Employee
	Events          []Event
	Skills          []Skill
	Roles           []RoleProfile
	History         []History
	Users           []User
	Requests        []Request
	Audits          []Audit
	Recommendations []Recommendation
}
type Gap struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Current  int    `json:"current"`
	Required int    `json:"required"`
	Critical bool   `json:"critical"`
}
type Candidate struct {
	Event      Event          `json:"event"`
	Score      float64        `json:"score"`
	Facts      []string       `json:"facts"`
	Gains      map[string]int `json:"gains"`
	Blocked    string         `json:"blocked"`
	PriorSkips int            `json:"prior_skips"`
}

const snapshot = "2026-10-01"

func uid(prefix string) string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return prefix + hex.EncodeToString(b)
}
func stamp() string { return time.Now().UTC().Format(time.RFC3339Nano) }
func (s *State) employee(id string) *Employee {
	for i := range s.Employees {
		if s.Employees[i].ID == id {
			return &s.Employees[i]
		}
	}
	return nil
}
func (s *State) event(id string) *Event {
	for i := range s.Events {
		if s.Events[i].ID == id {
			return &s.Events[i]
		}
	}
	return nil
}
func (s *State) skillName(id string) string {
	for _, v := range s.Skills {
		if v.ID == id {
			return v.Name
		}
	}
	return id
}
func (s *State) target(e Employee) RoleProfile {
	role, grade := e.Role, e.Grade
	if e.Goal != nil {
		role, grade = e.Goal.Role, e.Goal.Grade
	} else {
		grades := []string{"Junior", "Middle", "Senior", "Lead"}
		i := slices.Index(grades, grade)
		if i >= 0 && i < 3 {
			grade = grades[i+1]
		}
	}
	for _, r := range s.Roles {
		if r.Role == role && r.Grade == grade {
			return r
		}
	}
	return RoleProfile{Role: role, Grade: grade, Required: map[string]int{}}
}
func grow(level int, g Gain) int { return max(level, min(5, min(g.Max, level+g.Gain))) }
func (s *State) effective(e Employee) map[string]int {
	levels := map[string]int{}
	for k, v := range e.Skills {
		levels[k] = v
	}
	history := append([]History{}, s.History...)
	sort.SliceStable(history, func(i, j int) bool { return history[i].Date < history[j].Date })
	for _, h := range history {
		if h.Employee == e.ID && h.Status == "completed" && h.Date > e.LastReview {
			if ev := s.event(h.Event); ev != nil {
				for _, g := range ev.Gains {
					levels[g.Skill] = grow(levels[g.Skill], g)
				}
			}
		}
	}
	for _, r := range s.Requests {
		if r.Employee == e.ID && r.Status == "completed" {
			for k, g := range r.Gains {
				levels[k] = min(5, levels[k]+g)
			}
		}
	}
	return levels
}
func (s *State) gaps(e Employee) ([]Gap, int) {
	levels := s.effective(e)
	target := s.target(e)
	gaps := []Gap{}
	have, total := 0, 0
	for id, req := range target.Required {
		gaps = append(gaps, Gap{id, s.skillName(id), levels[id], req, slices.Contains(target.Critical, id)})
		have += min(req, levels[id])
		total += req
	}
	sort.Slice(gaps, func(i, j int) bool {
		if gaps[i].Critical != gaps[j].Critical {
			return gaps[i].Critical
		}
		a, b := gaps[i].Required-gaps[i].Current, gaps[j].Required-gaps[j].Current
		if a == b {
			return gaps[i].ID < gaps[j].ID
		}
		return a > b
	})
	pct := 100
	if total > 0 {
		pct = 100 * have / total
	}
	return gaps, pct
}
func active(status string) bool {
	return status == "pending_manager" || status == "approved" || status == "pending_hr"
}
func (s *State) candidates(e Employee) []Candidate {
	levels := s.effective(e)
	target := s.target(e)
	out := []Candidate{}
	activeCount := 0
	for _, r := range s.Requests {
		if r.Employee == e.ID && active(r.Status) {
			activeCount++
		}
	}
	for _, ev := range s.Events {
		if ev.Mandatory {
			continue
		}
		c := Candidate{Event: ev, Facts: []string{}, Gains: map[string]int{}}
		block := func(v string) {
			if c.Blocked == "" {
				c.Blocked = v
			}
		}
		if !slices.Contains(ev.Roles, e.Role) || !slices.Contains(ev.Grades, e.Grade) {
			block("Не соответствует текущей роли или грейду")
		}
		for id, req := range ev.Prereq {
			if levels[id] < req {
				block(fmt.Sprintf("Для участия нужен %s: %d, сейчас %d", s.skillName(id), req, levels[id]))
			}
		}
		available := ev.Format == "self_paced"
		for _, date := range ev.Sessions {
			if date >= snapshot {
				available = true
			}
		}
		if !available {
			block("Нет будущих сессий")
		}
		similar, finished, load := 0, 0, 0
		onTime := 0
		for _, h := range s.History {
			if h.Employee != e.ID {
				continue
			}
			prev := s.event(h.Event)
			if h.Status == "completed" {
				finished++
				if h.Due == "" || h.Date <= h.Due {
					onTime++
				}
				if h.Event == ev.ID && ev.ID != "EV_036" {
					block("Уже завершено: повтор не предусмотрен")
				}
			}
			if h.Status == "in_progress" {
				load++
				if h.Event == ev.ID {
					block("Активность уже выполняется по исходной истории")
				}
			}
			if h.Status == "no_show" || h.Status == "dropped" || h.Status == "declined" {
				if h.Event == ev.ID {
					c.PriorSkips++
				}
				if prev != nil {
					overlap := false
					for _, a := range prev.Gains {
						for _, b := range ev.Gains {
							if a.Skill == b.Skill {
								overlap = true
							}
						}
					}
					if overlap {
						similar++
					}
				}
			}
		}
		for _, r := range s.Requests {
			if r.Employee == e.ID && r.Event == ev.ID {
				if active(r.Status) {
					block("Заявка уже в работе")
				}
				if r.Status == "completed" && ev.ID != "EV_036" {
					block("Уже подтверждено HR")
				}
				if r.Status == "declined" {
					block("Вы отказались от этого предложения")
				}
			}
		}
		for _, g := range ev.Gains {
			before := levels[g.Skill]
			delta := grow(before, g) - before
			c.Gains[g.Skill] = delta
			gap := max(0, target.Required[g.Skill]-before)
			covered := min(gap, delta)
			weight := 4.0
			if slices.Contains(target.Critical, g.Skill) {
				weight = 12
			}
			c.Score += float64(covered) * weight
			if gap > 0 && delta > 0 {
				c.Facts = append(c.Facts, fmt.Sprintf("%s: %d → %d при цели %d; %s", s.skillName(g.Skill), before, before+delta, target.Required[g.Skill], map[bool]string{true: "критичен для цели", false: "навык целевой роли"}[slices.Contains(target.Critical, g.Skill)]))
			}
		}
		if len(c.Facts) == 0 {
			block("Не сокращает текущий разрыв до цели")
		}
		c.Score -= float64(similar)*2 + float64(c.PriorSkips)*3 + ev.Hours*.15 + float64(load+activeCount)*.2
		if e.Format == "remote" && ev.Format == "offline" {
			c.Score -= 4
			c.Facts = append(c.Facts, "Офлайн-формат при удалённой работе: требуется договориться о присутствии")
		}
		c.Facts = append(c.Facts, fmt.Sprintf("История: %d завершено, %d без просрочки; %d пропусков/отказов по похожим навыкам", finished, onTime, similar), fmt.Sprintf("Нагрузка: %.0f ч; %d текущих активностей. Формат: %s", ev.Hours, load+activeCount, ev.Format))
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if (out[i].Blocked == "") != (out[j].Blocked == "") {
			return out[i].Blocked == ""
		}
		if out[i].Score == out[j].Score {
			return out[i].Event.ID < out[j].Event.ID
		}
		return out[i].Score > out[j].Score
	})
	return out
}
func (s *State) audit(u User, emp, entity, action, detail string) {
	s.Audits = append(s.Audits, Audit{uid("A"), u.ID, u.Role, emp, entity, action, detail, stamp()})
}
func clone(s State) State {
	b, _ := json.Marshal(s)
	var out State
	_ = json.Unmarshal(b, &out)
	return out
}
