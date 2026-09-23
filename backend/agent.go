package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"slices"
	"sort"
	"strings"
	"time"
)

// Only these tools are exposed to the model. Approval and skill writes are
// deliberately separate, authenticated commands, never model-callable tools.
type PlanConstraints struct {
	HoursPerWeek int    `json:"hours_per_week"`
	Weeks        int    `json:"weeks"`
	MaxSteps     int    `json:"max_steps"`
	Format       string `json:"format"`
}
type AgentInput struct {
	Message         string          `json:"message"`
	Constraints     PlanConstraints `json:"constraints"`
	Key             string          `json:"idempotency_key"`
	Previous        string          `json:"previous_run_id"`
	ExternalConsent bool            `json:"external_consent"`
}
type ToolTrace struct {
	Tool    string `json:"tool"`
	Status  string `json:"status"`
	Summary string `json:"summary"`
	Millis  int64  `json:"duration_ms"`
}
type PlanStep struct {
	Event     string         `json:"event_id"`
	Title     string         `json:"title"`
	Rationale string         `json:"rationale"`
	Facts     []string       `json:"facts"`
	Gains     map[string]int `json:"gains"`
	Hours     float64        `json:"hours"`
	Session   string         `json:"session_date"`
	Checklist []string       `json:"checklist"`
	RequestID string         `json:"request_id"`
}
type PlanArtifact struct {
	Kind     string `json:"kind"`
	Filename string `json:"filename"`
	Content  string `json:"content"`
}
type AgentRun struct {
	ID            string         `json:"id"`
	Employee      string         `json:"employee_id"`
	At            string         `json:"created_at"`
	Updated       string         `json:"updated_at"`
	Status        string         `json:"status"`
	Trigger       string         `json:"trigger"`
	Mode          string         `json:"mode"`
	Model         string         `json:"model"`
	Warning       string         `json:"warning"`
	Input         AgentInput     `json:"input"`
	InputHash     string         `json:"input_hash"`
	Signature     string         `json:"signature"`
	Target        Goal           `json:"target"`
	Summary       string         `json:"summary"`
	Steps         []PlanStep     `json:"steps"`
	Before        int            `json:"progress_before"`
	After         int            `json:"progress_after"`
	Gaps          []Gap          `json:"projected_gaps"`
	Hours         float64        `json:"total_hours"`
	ExistingHours float64        `json:"existing_hours"`
	Trace         []ToolTrace    `json:"trace"`
	Artifacts     []PlanArtifact `json:"artifacts"`
	Millis        int64          `json:"duration_ms"`
}

func digest(v any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// Hash authoritative inputs, not explanations whose order can change.
func agentSignature(s *State, e Employee) string {
	history := []History{}
	requests := []Request{}
	for _, h := range s.History {
		if h.Employee == e.ID {
			history = append(history, h)
		}
	}
	for _, q := range s.Requests {
		if q.Employee == e.ID {
			requests = append(requests, q)
		}
	}
	return digest([]any{e, s.target(e), s.Events, s.Skills, history, requests})
}
func (s *State) agentRun(id string) *AgentRun {
	for i := range s.AgentRuns {
		if s.AgentRuns[i].ID == id {
			return &s.AgentRuns[i]
		}
	}
	return nil
}
func validateAgentInput(in *AgentInput) error {
	in.Message = strings.TrimSpace(in.Message)
	if len([]rune(in.Message)) < 3 || len([]rune(in.Message)) > 1200 {
		return fail(400, "Опишите задачу: от 3 до 1200 символов")
	}
	if len(in.Key) < 8 || len(in.Key) > 100 {
		return fail(400, "Нужен идентификатор запуска (от 8 до 100 символов)")
	}
	c := in.Constraints
	if c.HoursPerWeek < 1 || c.HoursPerWeek > 20 || c.Weeks < 1 || c.Weeks > 12 || c.MaxSteps < 1 || c.MaxSteps > 3 || !slices.Contains([]string{"any", "online", "offline", "self_paced"}, c.Format) {
		return fail(400, "Проверьте ограничения: от 1 до 20 ч/неделю, от 1 до 12 недель, от 1 до 3 шагов и формат")
	}
	return nil
}

type planEngine struct {
	state                 *State
	emp                   Employee
	run                   AgentRun
	candidates            []Candidate
	readProfile, searched bool
	simulated             string
}

func newPlanEngine(s *State, e Employee, in AgentInput) *planEngine {
	t := s.target(e)
	_, before := s.gaps(e)
	p := &planEngine{state: s, emp: e, candidates: s.candidates(e)}
	p.run = AgentRun{ID: uid("AG"), Employee: e.ID, At: stamp(), Updated: stamp(), Status: "draft", Mode: "planner", Model: "multi-factor-planner-v1", Input: in, InputHash: digest(in), Signature: agentSignature(s, e), Target: Goal{t.Role, t.Grade}, Before: before, After: before, Steps: []PlanStep{}, Trace: []ToolTrace{}, Artifacts: []PlanArtifact{}, Gaps: []Gap{}}
	seen := map[string]bool{}
	for _, h := range s.History {
		if h.Employee == e.ID && h.Status == "in_progress" {
			seen[h.Event] = true
		}
	}
	for _, q := range s.Requests {
		if q.Employee == e.ID && active(q.Status) {
			seen[q.Event] = true
		}
	}
	for id := range seen {
		if ev := s.event(id); ev != nil {
			p.run.ExistingHours += ev.Hours
		}
	}
	return p
}
func (p *planEngine) budget() float64 {
	return math.Max(0, float64(p.run.Input.Constraints.HoursPerWeek*p.run.Input.Constraints.Weeks)-p.run.ExistingHours)
}
func (p *planEngine) session(ev Event) (string, bool) {
	if ev.Format == "self_paced" {
		return "", true
	}
	start, _ := time.Parse("2006-01-02", snapshot)
	end := start.AddDate(0, 0, p.run.Input.Constraints.Weeks*7).Format("2006-01-02")
	dates := append([]string{}, ev.Sessions...)
	sort.Strings(dates)
	for _, d := range dates {
		if d >= snapshot && d <= end {
			return d, true
		}
	}
	return "", false
}
func (p *planEngine) blocked(c Candidate) string {
	if c.Blocked != "" {
		return c.Blocked
	}
	f := p.run.Input.Constraints.Format
	if f != "any" && c.Event.Format != f && !(f == "online" && c.Event.Format == "self_paced") {
		return "Не подходит выбранный формат"
	}
	if c.Event.Hours > p.budget() {
		return "Не помещается в бюджет времени с учётом текущих активностей"
	}
	if _, ok := p.session(c.Event); !ok {
		return "Нет сессии в выбранном периоде"
	}
	return ""
}
func (p *planEngine) available() []Candidate {
	out := []Candidate{}
	for _, c := range p.candidates {
		if p.blocked(c) == "" {
			out = append(out, c)
		}
	}
	return out
}
func strictArgs(raw json.RawMessage, out any) error {
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return fail(400, "Неверные аргументы инструмента")
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return fail(400, "Лишние данные в аргументах")
	}
	return nil
}
func (p *planEngine) call(name string, raw json.RawMessage) (any, error) {
	start := time.Now()
	result, summary, err := p.execute(name, raw)
	status := "ok"
	if err != nil {
		status, summary = "rejected", err.Error()
	}
	p.run.Trace = append(p.run.Trace, ToolTrace{name, status, summary, time.Since(start).Milliseconds()})
	return result, err
}
func (p *planEngine) execute(name string, raw json.RawMessage) (any, string, error) {
	switch name {
	case "read_profile":
		if err := strictArgs(raw, &struct{}{}); err != nil {
			return nil, "", err
		}
		p.readProfile = true
		gaps, progress := p.state.gaps(p.emp)
		history := map[string]int{}
		for _, h := range p.state.History {
			if h.Employee == p.emp.ID {
				history[h.Status]++
			}
		}
		return map[string]any{"role": p.emp.Role, "grade": p.emp.Grade, "tenure_months": p.emp.Tenure, "work_format": p.emp.Format, "target": p.run.Target, "gaps": gaps, "progress": progress, "history_counts": history, "existing_hours": p.run.ExistingHours, "remaining_hours": p.budget(), "constraints": p.run.Input.Constraints}, fmt.Sprintf("Проверены цель, %d навыков и история участия. Свободно %.0f ч.", len(gaps), p.budget()), nil
	case "search_activities":
		if err := strictArgs(raw, &struct{}{}); err != nil {
			return nil, "", err
		}
		if !p.readProfile {
			return nil, "", fail(400, "Сначала вызовите read_profile")
		}
		p.searched = true
		allowed := p.available()
		rejected := []map[string]string{}
		for _, c := range p.candidates {
			if why := p.blocked(c); why != "" {
				rejected = append(rejected, map[string]string{"event_id": c.Event.ID, "reason": why})
			}
		}
		return map[string]any{"candidates": allowed, "excluded": rejected}, fmt.Sprintf("Проверено %d добровольных активностей: доступно %d, исключено %d.", len(p.candidates), len(allowed), len(rejected)), nil
	case "simulate_plan":
		var args struct {
			Events []string `json:"event_ids"`
		}
		if err := strictArgs(raw, &args); err != nil {
			return nil, "", err
		}
		steps, gaps, hours, after, err := p.simulate(args.Events)
		if err != nil {
			return nil, "", err
		}
		p.simulated = digest(args.Events)
		return map[string]any{"steps": steps, "projected_gaps": gaps, "total_hours": hours, "progress_before": p.run.Before, "progress_after": after, "conditional": "Прогноз после выполнения и проверки HR; не новое состояние навыков"}, fmt.Sprintf("Моделирование: %d%% → %d%%, %.0f ч. Подтверждённые навыки не изменены.", p.run.Before, after, hours), nil
	case "save_plan":
		var args struct {
			Summary string     `json:"summary"`
			Choices []AIChoice `json:"choices"`
		}
		if err := strictArgs(raw, &args); err != nil {
			return nil, "", err
		}
		if len([]rune(args.Summary)) < 10 || len([]rune(args.Summary)) > 1600 {
			return nil, "", fail(400, "Нужно краткое описание плана (от 10 до 1600 символов)")
		}
		ids := []string{}
		for _, c := range args.Choices {
			ids = append(ids, c.Event)
		}
		if digest(ids) != p.simulated {
			return nil, "", fail(400, "Сначала вызовите simulate_plan с теми же event_ids в том же порядке")
		}
		if err := validateChoices(args.Choices, p.available()); err != nil {
			return nil, "", err
		}
		for _, choice := range args.Choices {
			if len(choice.Unknowns) > 4 {
				return nil, "", fail(400, "Укажите не больше четырёх ограничений на шаг")
			}
		}
		steps, gaps, hours, after, err := p.simulate(ids)
		if err != nil {
			return nil, "", err
		}
		for i := range steps {
			steps[i].Rationale = args.Choices[i].Rationale
			for _, unknown := range args.Choices[i].Unknowns {
				if len([]rune(unknown)) > 500 {
					return nil, "", fail(400, "Слишком длинное ограничение")
				}
				steps[i].Checklist = append(steps[i].Checklist, unknown)
			}
		}
		p.run.Steps, p.run.Gaps, p.run.Hours, p.run.After, p.run.Summary = steps, gaps, hours, after, args.Summary
		return map[string]any{"staged": true, "steps": len(steps)}, fmt.Sprintf("Подготовлен план из %d шагов; запись после проверки актуальности.", len(steps)), nil
	default:
		return nil, "", fail(403, "Инструмент не разрешён: "+name)
	}
}
func (p *planEngine) simulate(ids []string) ([]PlanStep, []Gap, float64, int, error) {
	bad := func(msg string) ([]PlanStep, []Gap, float64, int, error) { return nil, nil, 0, 0, fail(400, msg) }
	if !p.searched {
		return bad("Сначала вызовите search_activities")
	}
	if len(ids) < 1 || len(ids) > p.run.Input.Constraints.MaxSteps {
		return bad("Число шагов превышает выбранное ограничение")
	}
	levels := p.state.effective(p.emp)
	target := p.state.target(p.emp)
	steps := []PlanStep{}
	hours := 0.0
	seen := map[string]bool{}
	for _, id := range ids {
		var found *Candidate
		for _, c := range p.candidates {
			if c.Event.ID == id {
				v := c
				found = &v
				break
			}
		}
		if found == nil || seen[id] {
			return bad("Неизвестная или повторная активность")
		}
		seen[id] = true
		if why := p.blocked(*found); why != "" {
			return bad(why)
		}
		c := *found
		hours += c.Event.Hours
		if hours > p.budget() {
			return bad("План превышает общий бюджет времени")
		}
		session, _ := p.session(c.Event)
		step := PlanStep{Event: id, Title: c.Event.Title, Hours: c.Event.Hours, Session: session, Gains: map[string]int{}, Facts: []string{}, Checklist: []string{"Согласовать время и формат с руководителем.", "Выполнить активность и сохранить проверяемый результат.", "Описать результат и отправить HR для проверки."}}
		useful := false
		for _, g := range c.Event.Gains {
			before := levels[g.Skill]
			levels[g.Skill] = grow(before, g)
			step.Gains[g.Skill] = levels[g.Skill] - before
			if target.Required[g.Skill] > before && levels[g.Skill] > before {
				useful = true
				critical := "навык цели"
				if slices.Contains(target.Critical, g.Skill) {
					critical = "критичен для цели"
				}
				step.Facts = append(step.Facts, fmt.Sprintf("%s: %d → %d, цель %d; %s", p.state.skillName(g.Skill), before, levels[g.Skill], target.Required[g.Skill], critical))
			}
		}
		if !useful {
			return bad("Шаг не даёт дополнительного прогресса после предыдущих шагов")
		}
		// Candidate tail contains verified history and workload, not model claims.
		for _, f := range c.Facts {
			if strings.HasPrefix(f, "История:") || strings.HasPrefix(f, "Нагрузка:") || strings.HasPrefix(f, "Офлайн-") {
				step.Facts = append(step.Facts, f)
			}
		}
		steps = append(steps, step)
	}
	gaps, before := p.state.gaps(p.emp)
	_ = before
	have, total := 0, 0
	for i := range gaps {
		gaps[i].Current = levels[gaps[i].ID]
		have += min(gaps[i].Required, gaps[i].Current)
		total += gaps[i].Required
	}
	after := 100
	if total > 0 {
		after = 100 * have / total
	}
	return steps, gaps, hours, after, nil
}

// Deterministic fallback: recompute marginal gains after each choice so two
// courses cannot both claim the same capped skill gain. This is NOT an LLM.
func (p *planEngine) fallback() error {
	p.run.Mode, p.run.Model = "planner", "multi-factor-planner-v1"
	p.run.Steps = []PlanStep{}
	p.simulated = ""
	_, _ = p.call("read_profile", json.RawMessage(`{}`))
	_, _ = p.call("search_activities", json.RawMessage(`{}`))
	ids := []string{}
	choices := []AIChoice{}
	levels := p.state.effective(p.emp)
	target := p.state.target(p.emp)
	for len(ids) < p.run.Input.Constraints.MaxSteps {
		var best *Candidate
		bestScore := math.Inf(-1)
		for _, c := range p.available() {
			if slices.Contains(ids, c.Event.ID) {
				continue
			}
			trial := append(append([]string{}, ids...), c.Event.ID)
			if _, _, _, _, err := p.simulate(trial); err != nil {
				continue
			}
			score := c.Score
			original := p.state.effective(p.emp)
			for _, g := range c.Event.Gains {
				weight := 4.0
				if slices.Contains(target.Critical, g.Skill) {
					weight = 12
				}
				initial := min(max(0, target.Required[g.Skill]-original[g.Skill]), grow(original[g.Skill], g)-original[g.Skill])
				marginal := min(max(0, target.Required[g.Skill]-levels[g.Skill]), grow(levels[g.Skill], g)-levels[g.Skill])
				score += float64(marginal-initial) * weight
			}
			if score > bestScore {
				v := c
				best = &v
				bestScore = score
			}
		}
		if best == nil {
			break
		}
		ids = append(ids, best.Event.ID)
		for _, g := range best.Event.Gains {
			levels[g.Skill] = grow(levels[g.Skill], g)
		}
		choices = append(choices, AIChoice{Event: best.Event.ID, Rationale: strings.Join(best.Facts, ". ") + ". Выбор учитывает сокращение разрыва, историю участия и доступное время.", Unknowns: []string{"Причины прошлых пропусков неизвестны; удобство времени нужно обсудить."}})
	}
	if len(ids) == 0 {
		p.run.Status = "no_match"
		p.run.Summary = "Подходящих шагов в этих ограничениях нет. Проверьте бюджет времени, период, цель и текущие активности."
		p.run.Gaps, _ = p.state.gaps(p.emp)
		return nil
	}
	raw, _ := json.Marshal(map[string]any{"event_ids": ids})
	if _, err := p.call("simulate_plan", raw); err != nil {
		return err
	}
	raw, _ = json.Marshal(map[string]any{"summary": fmt.Sprintf("План для %s %s: %d шага с учётом истории, доступности и бюджета времени.", target.Grade, target.Role, len(ids)), "choices": choices})
	_, err := p.call("save_plan", raw)
	return err
}

func (a *API) agentCreate(w http.ResponseWriter, r *http.Request, u User) {
	if u.Role == "hr" || u.Employee == "" {
		problem(w, fail(403, "План создаётся сотрудником для себя"))
		return
	}
	var in AgentInput
	if err := body(r, &in); err != nil {
		problem(w, err)
		return
	}
	if err := validateAgentInput(&in); err != nil {
		problem(w, err)
		return
	}
	state, err := a.Store.read(r.Context())
	if err != nil {
		problem(w, err)
		return
	}
	e := state.employee(u.Employee)
	if e == nil {
		problem(w, fail(403, "Профиль не найден"))
		return
	}
	for _, run := range state.AgentRuns {
		if run.Employee == e.ID && run.Input.Key == in.Key {
			if run.InputHash != digest(in) {
				problem(w, fail(409, "Идентификатор уже использован для другой задачи"))
			} else {
				send(w, 200, run)
			}
			return
		}
	}
	if in.Previous != "" {
		previous := state.agentRun(in.Previous)
		if previous == nil || previous.Employee != u.Employee {
			problem(w, fail(404, "Предыдущий план не найден"))
			return
		}
	}
	run, err := a.buildAgentRun(r.Context(), state, *e, in)
	if err != nil {
		problem(w, err)
		return
	}
	run.Trigger = "manual"
	err = a.Store.transact(func(s *State) error {
		for _, saved := range s.AgentRuns {
			if saved.Employee == u.Employee && saved.Input.Key == in.Key {
				if saved.InputHash != run.InputHash {
					return fail(409, "Идентификатор уже использован для другой задачи")
				}
				run = saved
				return nil
			}
		}
		current := s.employee(u.Employee)
		if current == nil || agentSignature(s, *current) != run.Signature {
			return fail(409, "Профиль или активности изменились. Создайте план заново.")
		}
		run.Trace = append(run.Trace, ToolTrace{"persist_plan", "ok", fmt.Sprintf("Сохранены план и %d файла. Заявки пока не отправлены.", len(run.Artifacts)), 0})
		s.AgentRuns = append(s.AgentRuns, run)
		s.audit(u, u.Employee, run.ID, "agent_plan_created", fmt.Sprintf("%s: сохранено %d шагов", run.Mode, len(run.Steps)))
		return nil
	})
	if err != nil {
		problem(w, err)
		return
	}
	send(w, 200, run)
}

func (a *API) buildAgentRun(parent context.Context, state State, e Employee, in AgentInput) (AgentRun, error) {
	started := time.Now()
	p := newPlanEngine(&state, e, in)
	// All model turns and repairs share a single deadline.
	ctx, cancel := context.WithTimeout(parent, 8*time.Second)
	err := a.runAgentModel(ctx, p)
	cancel()
	if parent.Err() != nil {
		return AgentRun{}, parent.Err()
	}
	if err != nil {
		p.run.Warning = err.Error() + " Расчёт использует цель профиля и поля ограничений; свободный текст не интерпретируется."
		p.run.Trace = append(p.run.Trace, ToolTrace{"model", "unavailable", err.Error(), time.Since(started).Milliseconds()})
		if err = p.fallback(); err != nil {
			return AgentRun{}, err
		}
	}
	p.run.Artifacts = planArtifacts(p.run)
	p.run.Millis = time.Since(started).Milliseconds()
	return p.run, nil
}

func (a *API) agentAction(w http.ResponseWriter, r *http.Request, u User) {
	var in struct {
		ID        string `json:"id"`
		Action    string `json:"action"`
		Confirmed bool   `json:"confirmed"`
	}
	if err := body(r, &in); err != nil {
		problem(w, err)
		return
	}
	var out AgentRun
	err := a.Store.transact(func(s *State) error {
		run := s.agentRun(in.ID)
		if run == nil || run.Employee != u.Employee || u.Role == "hr" {
			return fail(404, "План не найден")
		}
		if !in.Confirmed {
			return fail(400, "Подтвердите выбранное действие")
		}
		if in.Action == "apply" && run.Status == "applied" {
			out = *run
			return nil
		}
		if in.Action == "cancel" && run.Status == "cancelled" {
			out = *run
			return nil
		}
		if run.Status != "draft" {
			return fail(409, "План уже обработан; используйте текущие заявки")
		}
		if in.Action == "cancel" {
			run.Status = "cancelled"
		} else if in.Action == "apply" {
			e := s.employee(u.Employee)
			if e == nil || e.Manager == nil {
				return fail(409, "Сначала HR должен указать непосредственного руководителя")
			}
			if agentSignature(s, *e) != run.Signature {
				return fail(409, "Данные изменились после расчёта. Перестройте план перед отправкой.")
			}
			// Validate the whole batch before committing any request.
			for i := range run.Steps {
				step := &run.Steps[i]
				q, err := createRequest(s, u, step.Event, step.Session, false)
				if err != nil {
					return err
				}
				step.RequestID = q.ID
			}
			run.Status = "applied"
			run.Trace = append(run.Trace, ToolTrace{"submit_requests", "ok", fmt.Sprintf("Создано %d заявок руководителю. Навыки обновятся после проверки HR.", len(run.Steps)), 0})
		} else {
			return fail(400, "Неизвестное действие с планом")
		}
		run.Updated = stamp()
		s.audit(u, u.Employee, run.ID, "agent_plan_"+run.Status, fmt.Sprintf("%d шагов", len(run.Steps)))
		out = *run
		return nil
	})
	if err != nil {
		problem(w, err)
		return
	}
	send(w, 200, out)
}

func (a *API) agentGet(w http.ResponseWriter, r *http.Request, u User) {
	s, err := a.Store.read(r.Context())
	if err != nil {
		problem(w, err)
		return
	}
	run := s.agentRun(r.URL.Query().Get("id"))
	// Planning notes are private even from colleagues/managers. Requests expose
	// only the information needed for normal approval.
	if run == nil || run.Employee != u.Employee || u.Role == "hr" {
		problem(w, fail(404, "План не найден"))
		return
	}
	kind := r.URL.Query().Get("artifact")
	if kind == "" {
		send(w, 200, run)
		return
	}
	for _, f := range run.Artifacts {
		if f.Kind == kind {
			mime := "text/markdown; charset=utf-8"
			if kind == "calendar" {
				mime = "text/calendar; charset=utf-8"
			}
			w.Header().Set("Content-Type", mime)
			w.Header().Set("Content-Disposition", `attachment; filename="`+f.Filename+`"`)
			_, _ = io.WriteString(w, f.Content)
			return
		}
	}
	problem(w, fail(404, "Файл не найден"))
}

func createRequest(s *State, u User, eventID, session string, decline bool) (Request, error) {
	e := s.employee(u.Employee)
	if e == nil || u.Role == "hr" {
		return Request{}, fail(403, "Заявку подаёт сотрудник из своего профиля")
	}
	var candidate *Candidate
	for _, c := range s.candidates(*e) {
		if c.Event.ID == eventID {
			v := c
			candidate = &v
			break
		}
	}
	if candidate == nil {
		return Request{}, fail(400, "Активность недоступна")
	}
	if candidate.Blocked != "" {
		return Request{}, fail(409, candidate.Blocked)
	}
	status := "pending_manager"
	if decline {
		status = "declined"
	} else {
		if e.Manager == nil {
			return Request{}, fail(409, "Нет непосредственного руководителя: HR должен проверить профиль")
		}
		if candidate.Event.Format != "self_paced" && (!slices.Contains(candidate.Event.Sessions, session) || session < snapshot) {
			return Request{}, fail(400, "Выберите доступную сессию")
		}
	}
	if candidate.Event.Format == "self_paced" {
		session = ""
	}
	now := stamp()
	q := Request{ID: uid("Q"), Employee: e.ID, Event: eventID, Status: status, Session: session, Created: now, Updated: now, Gains: map[string]int{}}
	s.Requests = append(s.Requests, q)
	s.audit(u, e.ID, q.ID, status, candidate.Event.Title)
	return q, nil
}
