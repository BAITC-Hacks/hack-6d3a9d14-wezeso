package main

import (
	"fmt"
	"math"
	"net/http"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type RiskFactor struct {
	Label  string `json:"label"`
	Points int    `json:"points"`
	Detail string `json:"detail"`
}
type HRPerson struct {
	ID           string       `json:"employee_id"`
	Name         string       `json:"full_name"`
	Department   string       `json:"department"`
	Role         string       `json:"role"`
	Grade        string       `json:"grade"`
	Progress     int          `json:"progress"`
	Score        int          `json:"score"`
	Band         string       `json:"band"`
	Factors      []RiskFactor `json:"factors"`
	Completed    int          `json:"completed"`
	Activities   int          `json:"activities"`
	Engagements  int          `json:"engagements"`
	Hours        float64      `json:"hours"`
	LastActivity string       `json:"last_activity"`
	Gaps         []Gap        `json:"gaps"`
}
type HRDay struct {
	Date       string `json:"date"`
	Completed  int    `json:"completed"`
	Activities int    `json:"activities"`
}

// The score is an explainable attention index, not a calibrated attrition probability.
// Only development activity is used; the dataset contains no departure labels.
func hrPerson(s *State, e Employee, days int) HRPerson {
	now, _ := time.Parse(time.DateOnly, snapshot)
	start := now.AddDate(0, 0, -days).Format(time.DateOnly)
	cut90 := now.AddDate(0, 0, -90).Format(time.DateOnly)
	cut180 := now.AddDate(0, 0, -180).Format(time.DateOnly)
	gaps, progress := s.gaps(e)
	p := HRPerson{ID: e.ID, Name: e.Name, Department: e.Department, Role: e.Role, Grade: e.Grade, Progress: progress, Factors: []RiskFactor{}, Gaps: gaps}
	total, recent, previous, skipped, overdue, attempts := 0, 0, 0, 0, 0, 0
	for _, h := range s.History {
		if h.Employee != e.ID || h.Date >= snapshot {
			continue
		}
		total++
		engaged := h.Status == "completed" || h.Status == "in_progress"
		if engaged && h.Date > p.LastActivity {
			p.LastActivity = h.Date
		}
		if h.Date >= cut90 {
			attempts++
			if engaged {
				recent++
			}
			if slices.Contains([]string{"dropped", "no_show", "declined"}, h.Status) {
				skipped++
			}
			if h.Status == "overdue" {
				overdue++
			}
		} else if h.Date >= cut180 && engaged {
			previous++
		}
		if h.Date >= start {
			p.Activities++
			if engaged {
				p.Engagements++
			}
			if h.Status == "completed" {
				p.Completed++
				if ev := s.event(h.Event); ev != nil {
					p.Hours += ev.Hours
				}
			}
		}
	}
	// Current requests are useful engagement evidence even when created before the demo snapshot.
	for _, q := range s.Requests {
		if q.Employee != e.ID {
			continue
		}
		day := hrRequestDay(q)
		if active(q.Status) {
			recent++
			p.LastActivity = snapshot
		} else if q.Status == "completed" && day != "" && day < snapshot {
			if day >= cut90 {
				recent++
			} else if day >= cut180 {
				previous++
			}
			if day > p.LastActivity {
				p.LastActivity = day
			}
		}
		if day >= start && day < snapshot {
			p.Activities++
			p.Engagements++
			if q.Status == "completed" {
				p.Completed++
				if ev := s.event(q.Event); ev != nil {
					p.Hours += ev.Hours
				}
			}
		}
	}
	add := func(label string, points int, detail string) {
		if points > 0 {
			p.Factors = append(p.Factors, RiskFactor{label, points, detail})
			p.Score += points
		}
	}
	if recent == 0 {
		add("Пауза в развитии", 35, "Нет завершённых или текущих активностей за 90 дней")
	}
	if attempts > 0 {
		add("Пропуски и отказы", int(math.Round(25*float64(skipped)/float64(attempts))), fmt.Sprintf("%d из %d участий за 90 дней", skipped, attempts))
	}
	add("Просроченное обучение", min(15, overdue*5), fmt.Sprintf("%d просроченных активностей за 90 дней", overdue))
	if previous >= 2 && recent*2 < previous {
		add("Снижение активности", 10, fmt.Sprintf("Было %d активностей, стало %d за сопоставимые 90 дней", previous, recent))
	}
	if e.Goal == nil {
		add("Нет карьерной цели", 10, "Цель развития ещё не выбрана")
	}
	if review, err := time.Parse(time.DateOnly, e.LastReview); err == nil && now.Sub(review).Hours()/24 > 180 {
		add("Давняя оценка навыков", 5, "С последней оценки прошло более 180 дней")
	}
	p.Band = "low"
	if p.Score >= 30 {
		p.Band = "medium"
	}
	if p.Score >= 60 {
		p.Band = "high"
	}
	if total < 3 {
		p.Band = "unknown"
		p.Score = 0
		p.Factors = []RiskFactor{}
	}
	sort.SliceStable(p.Factors, func(i, j int) bool { return p.Factors[i].Points > p.Factors[j].Points })
	return p
}

// Use the completion date for completed requests and creation date for other participation.
// Declined/rejected/cancelled requests are decisions, not learning participation.
func hrRequestDay(q Request) string {
	if !active(q.Status) && q.Status != "completed" {
		return ""
	}
	value := q.Created
	if q.Status == "completed" {
		value = q.Updated
	}
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed.Format(time.DateOnly)
	}
	return ""
}

func (a *API) hrHandler(w http.ResponseWriter, r *http.Request, u User, path string) {
	if u.Role != "hr" {
		problem(w, fail(403, "Раздел доступен только HR"))
		return
	}
	if path == "hr/events" && r.Method == "POST" {
		var ev Event
		if err := body(r, &ev); err != nil {
			problem(w, err)
			return
		}
		err := a.Store.transact(func(s *State) error {
			if err := validateHREvent(s, &ev); err != nil {
				return err
			}
			// A client-created ID makes retries safe after a lost response.
			if old := s.event(ev.ID); old != nil {
				return fail(409, "Событие с этим ID уже опубликовано. Обновите каталог.")
			}
			s.Events = append(s.Events, ev)
			s.audit(u, "", ev.ID, "event_created", ev.Title)
			return nil
		})
		if err != nil {
			problem(w, err)
			return
		}
		send(w, 201, ev)
		return
	}
	state, err := a.Store.read(r.Context())
	if err != nil {
		problem(w, err)
		return
	}
	if path == "hr/insights" && r.Method == "GET" {
		days, _ := strconv.Atoi(r.URL.Query().Get("days"))
		if days == 0 {
			days = 90
		}
		if !slices.Contains([]int{30, 90, 180}, days) {
			problem(w, fail(400, "Выберите период 30, 90 или 180 дней"))
			return
		}
		department := r.URL.Query().Get("department")
		people := []HRPerson{}
		ids := map[string]bool{}
		for _, e := range state.Employees {
			if department == "" || e.Department == department {
				people = append(people, hrPerson(&state, e, days))
				ids[e.ID] = true
			}
		}
		now, _ := time.Parse(time.DateOnly, snapshot)
		trend := []HRDay{}
		index := map[string]int{}
		for i := days; i > 0; i-- {
			day := now.AddDate(0, 0, -i).Format(time.DateOnly)
			index[day] = len(trend)
			trend = append(trend, HRDay{Date: day})
		}
		for _, h := range state.History {
			if i, ok := index[h.Date]; ok && ids[h.Employee] {
				trend[i].Activities++
				if h.Status == "completed" {
					trend[i].Completed++
				}
			}
		}
		for _, q := range state.Requests {
			if i, ok := index[hrRequestDay(q)]; ok && ids[q.Employee] {
				trend[i].Activities++
				if q.Status == "completed" {
					trend[i].Completed++
				}
			}
		}
		send(w, 200, map[string]any{"people": people, "trend": trend, "days": days, "snapshot": snapshot})
		return
	}
	if path == "hr/simulate" && r.Method == "POST" {
		var in SimulationInput
		if err := body(r, &in); err != nil {
			problem(w, err)
			return
		}
		out, err := simulateGrade(&state, in)
		if err != nil {
			problem(w, err)
			return
		}
		send(w, 200, out)
		return
	}
	problem(w, fail(404, "Страница API не найдена"))
}

func validateHREvent(s *State, ev *Event) error {
	ev.Title = strings.TrimSpace(ev.Title)
	ev.Description = strings.TrimSpace(ev.Description)
	if !strings.HasPrefix(ev.ID, "EV_HR_") || len(ev.ID) < 12 || len(ev.ID) > 64 {
		return fail(400, "Некорректный ID события")
	}
	if utf8.RuneCountInString(ev.Title) < 4 || utf8.RuneCountInString(ev.Title) > 160 || utf8.RuneCountInString(ev.Description) < 20 || utf8.RuneCountInString(ev.Description) > 4000 {
		return fail(400, "Название: от 4 до 160 символов; описание: от 20 до 4000 символов")
	}
	if !slices.Contains([]string{"course", "workshop", "mentoring", "certification", "meetup", "compliance", "onboarding"}, ev.Type) || !slices.Contains([]string{"online", "offline", "self_paced"}, ev.Format) {
		return fail(400, "Выберите тип и формат события")
	}
	if math.IsNaN(ev.Hours) || math.IsInf(ev.Hours, 0) || ev.Hours < 0.5 || ev.Hours > 500 {
		return fail(400, "Длительность: от 0,5 до 500 часов")
	}
	if len(ev.Roles) == 0 || len(ev.Grades) == 0 {
		return fail(400, "Выберите роли и грейды участников")
	}
	for _, role := range ev.Roles {
		if !slices.ContainsFunc(s.Roles, func(r RoleProfile) bool { return r.Role == role }) {
			return fail(400, "Неизвестная роль участника")
		}
	}
	for _, grade := range ev.Grades {
		if !slices.Contains([]string{"Junior", "Middle", "Senior", "Lead"}, grade) {
			return fail(400, "Неизвестный грейд")
		}
	}
	known := func(id string) bool { return slices.ContainsFunc(s.Skills, func(sk Skill) bool { return sk.ID == id }) }
	seen := map[string]bool{}
	for _, g := range ev.Gains {
		if !known(g.Skill) || seen[g.Skill] || g.Gain < 1 || g.Gain > 5 || g.Max < 1 || g.Max > 5 || g.Gain > g.Max {
			return fail(400, "Проверьте навыки: без повторов, прирост и предел от 1 до 5")
		}
		seen[g.Skill] = true
	}
	if !ev.Mandatory && len(ev.Gains) == 0 {
		return fail(400, "Добавьте хотя бы один развиваемый навык")
	}
	if (ev.Type == "compliance" || ev.Type == "onboarding") && !ev.Mandatory {
		return fail(400, "Комплаенс и адаптация должны быть обязательными")
	}
	for id, level := range ev.Prereq {
		if !known(id) || level < 1 || level > 5 {
			return fail(400, "Проверьте требования к навыкам")
		}
	}
	if ev.Format == "self_paced" {
		ev.Sessions = []string{}
	} else {
		if len(ev.Sessions) == 0 || len(ev.Sessions) > 30 {
			return fail(400, "Добавьте от 1 до 30 дат проведения")
		}
		for _, d := range ev.Sessions {
			if _, err := time.Parse(time.DateOnly, d); err != nil || d < snapshot {
				return fail(400, "Дата проведения должна быть не раньше даты среза")
			}
		}
		sort.Strings(ev.Sessions)
		ev.Sessions = slices.Compact(ev.Sessions)
	}
	if ev.Gains == nil {
		ev.Gains = []Gain{}
	}
	if ev.Prereq == nil {
		ev.Prereq = map[string]int{}
	}
	return nil
}

type SimulationInput struct {
	Employee string   `json:"employee_id"`
	Role     string   `json:"target_role"`
	Grade    string   `json:"target_grade"`
	Events   []string `json:"event_ids"`
	Weeks    int      `json:"weeks"`
	Hours    float64  `json:"hours_per_week"`
}
type SimulationSkill struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Before   int    `json:"before"`
	After    int    `json:"after"`
	Required int    `json:"required"`
	Critical bool   `json:"critical"`
}
type SimulationOption struct {
	Event   Event  `json:"event"`
	Blocked string `json:"blocked"`
	Gain    int    `json:"gain"`
}
type SimulationResult struct {
	Before       int                `json:"before"`
	After        int                `json:"after"`
	Hours        float64            `json:"hours"`
	Weeks        int                `json:"required_weeks"`
	Feasible     bool               `json:"feasible"`
	CriticalGaps int                `json:"critical_gaps"`
	Skills       []SimulationSkill  `json:"skills"`
	Options      []SimulationOption `json:"options"`
}

func simulationBlock(s *State, e Employee, ev Event, levels map[string]int) string {
	if ev.Mandatory {
		return "Обязательное обучение не входит в сценарий развития"
	}
	if !slices.Contains(ev.Roles, e.Role) || !slices.Contains(ev.Grades, e.Grade) {
		return "Не подходит текущей роли или грейду"
	}
	keys := make([]string, 0, len(ev.Prereq))
	for id := range ev.Prereq {
		keys = append(keys, id)
	}
	sort.Strings(keys)
	for _, id := range keys {
		if levels[id] < ev.Prereq[id] {
			return fmt.Sprintf("Требуется %s: уровень %d", s.skillName(id), ev.Prereq[id])
		}
	}
	if ev.Format != "self_paced" && !slices.ContainsFunc(ev.Sessions, func(d string) bool { return d >= snapshot }) {
		return "Нет будущих сессий"
	}
	for _, h := range s.History {
		if h.Employee == e.ID && h.Event == ev.ID && ((h.Status == "completed" && ev.ID != "EV_036") || h.Status == "in_progress") {
			return "Уже завершено или выполняется"
		}
	}
	for _, q := range s.Requests {
		if q.Employee == e.ID && q.Event == ev.ID && (active(q.Status) || (q.Status == "completed" && ev.ID != "EV_036")) {
			return "Уже выбрано или подтверждено"
		}
	}
	return ""
}

func simulateGrade(s *State, in SimulationInput) (SimulationResult, error) {
	out := SimulationResult{Skills: []SimulationSkill{}, Options: []SimulationOption{}}
	e := s.employee(in.Employee)
	if e == nil {
		return out, fail(404, "Сотрудник не найден")
	}
	if in.Weeks < 1 || in.Weeks > 52 || in.Hours < 1 || in.Hours > 40 || len(in.Events) > 20 {
		return out, fail(400, "Горизонт: от 1 до 52 недели, нагрузка: от 1 до 40 часов, до 20 событий")
	}
	var target *RoleProfile
	for i := range s.Roles {
		if s.Roles[i].Role == in.Role && s.Roles[i].Grade == in.Grade {
			target = &s.Roles[i]
			break
		}
	}
	if target == nil || len(target.Required) == 0 {
		return out, fail(400, "Целевая роль или грейд не найдены")
	}
	before := s.effective(*e)
	levels := make(map[string]int, len(before))
	for k, v := range before {
		levels[k] = v
	}
	selected := map[string]bool{}
	now, _ := time.Parse(time.DateOnly, snapshot)
	finish := now
	for _, id := range in.Events {
		ev := s.event(id)
		if ev == nil || selected[id] {
			return out, fail(400, "Событие не найдено или повторяется")
		}
		if blocked := simulationBlock(s, *e, *ev, levels); blocked != "" {
			return out, fail(400, ev.Title+": "+blocked)
		}
		if ev.Format != "self_paced" {
			sessions := append([]string{}, ev.Sessions...)
			sort.Strings(sessions)
			found := false
			for _, d := range sessions {
				session, err := time.Parse(time.DateOnly, d)
				if err == nil && !session.Before(finish) {
					finish = session
					found = true
					break
				}
			}
			if !found {
				return out, fail(400, ev.Title+": нет сессии после предыдущего шага")
			}
		}
		finish = finish.Add(time.Duration(math.Ceil(ev.Hours/in.Hours*7)) * 24 * time.Hour)
		selected[id] = true
		out.Hours += ev.Hours
		for _, g := range ev.Gains {
			levels[g.Skill] = grow(levels[g.Skill], g)
		}
	}
	have, projected, total := 0, 0, 0
	for id, req := range target.Required {
		critical := slices.Contains(target.Critical, id)
		out.Skills = append(out.Skills, SimulationSkill{id, s.skillName(id), before[id], levels[id], req, critical})
		have += min(req, before[id])
		projected += min(req, levels[id])
		total += req
		if critical && levels[id] < req {
			out.CriticalGaps++
		}
	}
	sort.Slice(out.Skills, func(i, j int) bool {
		if out.Skills[i].Critical != out.Skills[j].Critical {
			return out.Skills[i].Critical
		}
		return out.Skills[i].ID < out.Skills[j].ID
	})
	out.Before = 100 * have / total
	out.After = 100 * projected / total
	out.Weeks = int(math.Ceil(finish.Sub(now).Hours() / 24 / 7))
	out.Feasible = out.Weeks <= in.Weeks
	for _, ev := range s.Events {
		if selected[ev.ID] || ev.Mandatory || !slices.Contains(ev.Roles, e.Role) || !slices.Contains(ev.Grades, e.Grade) {
			continue
		}
		gain := 0
		for _, g := range ev.Gains {
			gain += max(0, min(target.Required[g.Skill], grow(levels[g.Skill], g))-min(target.Required[g.Skill], levels[g.Skill]))
		}
		if gain == 0 {
			continue
		}
		blocked := simulationBlock(s, *e, ev, levels)
		if blocked == "" && ev.Format != "self_paced" && !slices.ContainsFunc(ev.Sessions, func(d string) bool { return d >= finish.Format(time.DateOnly) }) {
			blocked = "Нет сессии после предыдущего шага"
		}
		out.Options = append(out.Options, SimulationOption{ev, blocked, gain})
	}
	sort.SliceStable(out.Options, func(i, j int) bool {
		if (out.Options[i].Blocked == "") != (out.Options[j].Blocked == "") {
			return out.Options[i].Blocked == ""
		}
		return out.Options[i].Gain > out.Options[j].Gain
	})
	return out, nil
}
