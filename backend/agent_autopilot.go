package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"
)

// Durable subscriptions make recommendations event-driven, not dependent on a
// chat prompt. A short lease allows another server/restart to recover a job.
type AgentWatch struct {
	Employee    string          `json:"employee_id"`
	Enabled     bool            `json:"enabled"`
	Constraints PlanConstraints `json:"constraints"`
	Signature   string          `json:"signature"`
	LastRun     string          `json:"last_run_id"`
	Status      string          `json:"status"`
	Claim       string          `json:"claim"`
	Lease       string          `json:"lease_until"`
	Updated     string          `json:"updated_at"`
	Reason      string          `json:"reason"`
}

func (s *State) agentWatch(employee string) *AgentWatch {
	for i := range s.AgentWatches {
		if s.AgentWatches[i].Employee == employee {
			return &s.AgentWatches[i]
		}
	}
	return nil
}
func (a *API) watchSignature(s *State, e Employee, c PlanConstraints) string {
	return digest([]any{agentSignature(s, e), c, a.agentSettings(), a.AIKey != "", a.AllowAI})
}
func (a *API) autopilot(w http.ResponseWriter, r *http.Request, u User) {
	if u.Role == "hr" || u.Employee == "" {
		problem(w, fail(403, "Автоподбор доступен для своего профиля"))
		return
	}
	var in struct {
		Enabled     *bool            `json:"enabled"`
		Constraints *PlanConstraints `json:"constraints"`
	}
	if err := body(r, &in); err != nil {
		problem(w, err)
		return
	}
	if in.Constraints != nil {
		check := AgentInput{Message: "automatic plan", Key: "automatic-settings", Constraints: *in.Constraints}
		if err := validateAgentInput(&check); err != nil {
			problem(w, err)
			return
		}
	}
	var watch AgentWatch
	err := a.Store.transact(func(s *State) error {
		if s.employee(u.Employee) == nil {
			return fail(403, "Профиль не найден")
		}
		v := s.agentWatch(u.Employee)
		if v == nil {
			s.AgentWatches = append(s.AgentWatches, AgentWatch{Employee: u.Employee, Enabled: true, Constraints: PlanConstraints{6, 8, 3, "any"}, Status: "queued", Updated: stamp(), Reason: "Первый анализ профиля"})
			v = s.agentWatch(u.Employee)
		}
		if in.Enabled != nil {
			v.Enabled = *in.Enabled
		}
		if in.Constraints != nil {
			v.Constraints = *in.Constraints
		}
		v.Updated = stamp()
		watch = *v
		return nil
	})
	if err != nil {
		problem(w, err)
		return
	}
	// A fast acknowledgement keeps UI latency separate from model latency.
	send(w, 202, watch)
	if watch.Enabled {
		go a.processAgentWatch(context.WithoutCancel(r.Context()), u.Employee)
	}
}

var errWatchUnchanged = errors.New("agent subscription unchanged or already claimed")

func watchRunning(w AgentWatch) bool {
	lease, err := time.Parse(time.RFC3339Nano, w.Lease)
	return err == nil && lease.After(time.Now())
}
func (a *API) processAgentWatch(parent context.Context, employee string) {
	ctx, cancel := context.WithTimeout(parent, 12*time.Second)
	defer cancel()
	state, err := a.Store.read(ctx)
	if err != nil {
		return
	}
	w := state.agentWatch(employee)
	e := state.employee(employee)
	if w == nil || !w.Enabled || e == nil || watchRunning(*w) || w.Signature == a.watchSignature(&state, *e, w.Constraints) {
		return
	}
	if ctx.Value(uiLanguageKey{}) == nil {
		ctx = withUILanguage(ctx, e.Language)
	}
	claim := uid("lease")
	var actor User
	var signature, reason string
	var in AgentInput
	err = a.Store.transact(func(s *State) error {
		watch := s.agentWatch(employee)
		emp := s.employee(employee)
		if watch == nil || emp == nil || !watch.Enabled || watchRunning(*watch) {
			return errWatchUnchanged
		}
		signature = a.watchSignature(s, *emp, watch.Constraints)
		if signature == watch.Signature {
			return errWatchUnchanged
		}
		for _, u := range s.Users {
			if u.Employee == employee && u.Role != "hr" {
				actor = u
				break
			}
		}
		if actor.ID == "" {
			return errWatchUnchanged
		}
		reason = "Профиль, цель, история или нагрузка изменились"
		if watch.LastRun == "" {
			reason = "Первый анализ профиля: агент сам определил следующий шаг"
		}
		watch.Claim, watch.Lease, watch.Status, watch.Reason = claim, time.Now().Add(20*time.Second).UTC().Format(time.RFC3339Nano), "running", reason
		watch.Updated = stamp()
		in = AgentInput{Message: "Проактивно пересмотри траекторию сотрудника по текущей цели, навыкам, истории и нагрузке. Предложи 1–3 посильных следующих шага, объясни выбор, создай план и материалы. Учитывай подтверждённые результаты и не повторяй уже выполняемые активности.", Constraints: watch.Constraints, Key: "auto-" + signature, Previous: watch.LastRun, ExternalConsent: a.AllowAI}
		state = clone(*s)
		return nil
	})
	if err != nil {
		return
	}
	run, buildErr := a.buildAgentRun(ctx, state, *state.employee(employee), in)
	err = a.Store.transact(func(s *State) error {
		watch := s.agentWatch(employee)
		if watch == nil || watch.Claim != claim {
			return errWatchUnchanged
		}
		watch.Claim, watch.Lease = "", ""
		watch.Updated = stamp()
		if buildErr != nil {
			watch.Status = "error"
			watch.Reason = "Не удалось завершить анализ; агент повторит попытку"
			return nil
		}
		emp := s.employee(employee)
		if !watch.Enabled || emp == nil || a.watchSignature(s, *emp, watch.Constraints) != signature {
			watch.Status = "queued"
			return nil
		}
		run.Trigger = "autopilot"
		for _, previous := range s.AgentRuns {
			if previous.Employee == employee && previous.Input.Key == in.Key {
				watch.Signature, watch.LastRun, watch.Status = signature, previous.ID, "idle"
				return nil
			}
		}
		run.Trace = append([]ToolTrace{{"observe_change", "ok", reason, 0}}, run.Trace...)
		run.Trace = append(run.Trace, ToolTrace{"persist_plan", "ok", fmt.Sprintf("Агент самостоятельно сохранил %d шагов и %d файла. Заявки не отправлены.", len(run.Steps), len(run.Artifacts)), 0})
		s.AgentRuns = append(s.AgentRuns, run)
		watch.Signature, watch.LastRun, watch.Status = signature, run.ID, "idle"
		s.audit(actor, employee, run.ID, "agent_proactive_plan", fmt.Sprintf("%s. Сохранено %d шагов", reason, len(run.Steps)))
		return nil
	})
	if err != nil && !errors.Is(err, errWatchUnchanged) {
		log.Printf("agent plan persistence failed")
	}
}
func (a *API) agentWorker(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			state, err := a.Store.read(ctx)
			if err != nil {
				continue
			}
			for _, w := range state.AgentWatches {
				if ctx.Err() != nil {
					return
				}
				if w.Enabled {
					a.processAgentWatch(ctx, w.Employee)
				}
			}
		}
	}
}
