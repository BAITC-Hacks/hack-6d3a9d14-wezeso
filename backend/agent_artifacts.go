package main

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

func icsEscape(v string) string {
	r := strings.NewReplacer("\\", "\\\\", "\r", "", "\n", "\\n", ";", "\\;", ",", "\\,")
	return r.Replace(v)
}
func foldICS(v string) string {
	var out strings.Builder
	for len(v) > 75 {
		n := 75
		for n > 0 && !utf8.RuneStart(v[n]) {
			n--
		}
		out.WriteString(v[:n] + "\r\n")
		v = " " + v[n:]
	}
	out.WriteString(v + "\r\n")
	return out.String()
}
func planArtifacts(run AgentRun) []PlanArtifact {
	if len(run.Steps) == 0 {
		return []PlanArtifact{}
	}
	var plan, evidence, calendar strings.Builder
	fmt.Fprintf(&plan, "# План развития: %s %s\n\n%s\n\nИсточник: %s (%s).\n\n", run.Target.Grade, run.Target.Role, run.Summary, run.Mode, run.Model)
	fmt.Fprintf(&plan, "Прогноз соответствия навыков: %d%% → %d%% после выполнения и подтверждения HR. Текущий грейд не изменяется.\n\nПлан: %.0f ч. Текущие активности: %.0f ч. Бюджет: %d ч/неделю × %d недель (общая оценка нагрузки, не бронирование времени).\n\n", run.Before, run.After, run.Hours, run.ExistingHours, run.Input.Constraints.HoursPerWeek, run.Input.Constraints.Weeks)
	if run.Warning != "" {
		fmt.Fprintf(&plan, "Ограничение: %s\n\n", run.Warning)
	}
	evidence.WriteString("# Рабочая тетрадь результатов\n\nЭто незаполненный шаблон, а не подтверждение прохождения. Заполните после реальной работы и передайте HR через заявку.\n\n")
	calendar.WriteString("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Career Quest//Development Plan//RU\r\nCALSCALE:GREGORIAN\r\n")
	at, _ := time.Parse(time.RFC3339Nano, run.At)
	for i, step := range run.Steps {
		fmt.Fprintf(&plan, "## %d. %s\n\n%s\n\n", i+1, step.Title, step.Rationale)
		for _, f := range step.Facts {
			fmt.Fprintf(&plan, "- %s\n", f)
		}
		fmt.Fprintf(&plan, "\nТрудозатраты: %.0f ч.\n", step.Hours)
		if step.Session != "" {
			fmt.Fprintf(&plan, "Доступная сессия: %s (участие требует согласования; время начала неизвестно).\n", step.Session)
		}
		for _, task := range step.Checklist {
			fmt.Fprintf(&plan, "- [ ] %s\n", task)
		}
		fmt.Fprintf(&evidence, "## %d. %s\n\n### Что я выполнил(а)\n[Заполните]\n\n### Ссылка или описание проверяемого результата\n[Заполните]\n\n### Как применил(а) навыки\n", i+1, step.Title)
		for _, f := range step.Facts {
			if !strings.HasPrefix(f, "История:") && !strings.HasPrefix(f, "Нагрузка:") {
				fmt.Fprintf(&evidence, "- %s\n", f)
			}
		}
		evidence.WriteString("\n### Что получилось и что ещё нужно улучшить\n[Заполните]\n\n")
		kind := "VTODO"
		if step.Session != "" {
			kind = "VEVENT"
		}
		lines := []string{"BEGIN:" + kind, fmt.Sprintf("UID:%s-%s@careerquest.local", run.ID, step.Event), "DTSTAMP:" + at.UTC().Format("20060102T150405Z"), "SUMMARY:" + icsEscape(step.Title), "DESCRIPTION:" + icsEscape(fmt.Sprintf("Черновик плана. Нужно согласование руководителя. Трудозатраты %.0f ч; время начала не задано. Навыки меняются после проверки HR.", step.Hours))}
		if step.Session != "" {
			start, _ := time.Parse("2006-01-02", step.Session)
			lines = append(lines, "DTSTART;VALUE=DATE:"+start.Format("20060102"), "DTEND;VALUE=DATE:"+start.AddDate(0, 0, 1).Format("20060102"), "STATUS:TENTATIVE", "TRANSP:TRANSPARENT")
		} else {
			lines = append(lines, "STATUS:NEEDS-ACTION")
		}
		lines = append(lines, "END:"+kind)
		for _, line := range lines {
			calendar.WriteString(foldICS(line))
		}
	}
	calendar.WriteString("END:VCALENDAR\r\n")
	return []PlanArtifact{{"plan", "development-plan.md", plan.String()}, {"workbook", "result-workbook.md", evidence.String()}, {"calendar", "development-plan.ics", calendar.String()}}
}
