package main

import (
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

func courseAccess(s *State, u User, id string, write bool) (*Request, *Course, error) {
	q := s.courseRequest(id)
	if q == nil {
		return nil, nil, fail(404, "Заявка не найдена")
	}
	if q.Employee != u.Employee || u.Role == "hr" {
		return nil, nil, fail(403, "Курс доступен только владельцу заявки")
	}
	c := s.course(q.Event)
	if c == nil {
		return nil, nil, fail(404, "Для этой активности нет встроенного курса")
	}
	if q.Status != "approved" && (write || q.Status != "completed") {
		return nil, nil, fail(409, "Материалы доступны после согласования руководителем")
	}
	return q, c, nil
}

func (a *API) courseHandler(w http.ResponseWriter, r *http.Request, u User, path string) {
	if path == "courses/view" && r.Method == "GET" {
		a.courseView(w, r, u)
		return
	}
	if path == "courses/file" && r.Method == "GET" {
		a.courseFile(w, r, u)
		return
	}
	if r.Method != "POST" {
		problem(w, fail(405, "Метод не поддерживается"))
		return
	}
	switch path {
	case "courses/lesson":
		a.courseLesson(w, r, u)
	case "courses/upload":
		a.courseUpload(w, r, u)
	case "courses/exam":
		a.courseExam(w, r, u)
	case "courses/grade":
		a.courseGrade(w, r, u)
	default:
		problem(w, fail(404, "Действие не найдено"))
	}
}
func (a *API) courseView(w http.ResponseWriter, r *http.Request, u User) {
	s, err := a.Store.read(r.Context())
	if err != nil {
		problem(w, err)
		return
	}
	q, c, err := courseAccess(&s, u, r.URL.Query().Get("request_id"), false)
	if err != nil {
		problem(w, err)
		return
	}
	// Never return the private scoring rubric or correct choice, even after completion.
	public := *c
	public.Questions = append([]ExamQuestion{}, c.Questions...)
	for i := range public.Questions {
		public.Questions[i].Rubric = ""
		public.Questions[i].Correct = ""
	}
	lessons := []string{}
	for _, p := range s.CourseProgress {
		if p.Request == q.ID {
			lessons = p.Lessons
		}
	}
	attempts := []ExamAttempt{}
	for _, e := range s.Exams {
		if e.Request == q.ID {
			e.Lease = ""
			attempts = append(attempts, e)
		}
	}
	uploads := []CourseUpload{}
	for _, f := range s.CourseUploads {
		if f.Request == q.ID {
			f.Content = ""
			uploads = append(uploads, f)
		}
	}
	settings := a.examSettings()
	send(w, 200, map[string]any{"course": public, "request": q, "completed_lessons": lessons, "attempts": attempts, "uploads": uploads,
		"ai": map[string]any{"provider": settings.Provider, "model": settings.Model, "external": settings.Provider == "gemini", "configured": a.examConfigured()}})
}
func (a *API) courseLesson(w http.ResponseWriter, r *http.Request, u User) {
	var in struct {
		Request string `json:"request_id"`
		Lesson  string `json:"lesson_id"`
	}
	if err := body(r, &in); err != nil {
		problem(w, err)
		return
	}
	err := a.Store.transact(func(s *State) error {
		q, c, err := courseAccess(s, u, in.Request, true)
		if err != nil {
			return err
		}
		found := false
		for _, l := range c.Lessons {
			if l.ID == in.Lesson {
				found = true
			}
		}
		if !found {
			return fail(400, "Урок не найден")
		}
		for i := range s.CourseProgress {
			p := &s.CourseProgress[i]
			if p.Request == q.ID {
				if !slices.Contains(p.Lessons, in.Lesson) {
					p.Lessons = append(p.Lessons, in.Lesson)
					p.Updated = stamp()
				}
				return nil
			}
		}
		s.CourseProgress = append(s.CourseProgress, CourseProgress{ID: uid("CP"), Request: q.ID, Lessons: []string{in.Lesson}, Updated: stamp()})
		return nil
	})
	if err != nil {
		problem(w, err)
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}
func (a *API) courseUpload(w http.ResponseWriter, r *http.Request, u User) {
	// The global request limit is an additional bound. This handler never writes user filenames to disk.
	if err := r.ParseMultipartForm(128 << 10); err != nil {
		problem(w, fail(400, "Не удалось прочитать файл"))
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	f, h, err := r.FormFile("file")
	if err != nil {
		problem(w, fail(400, "Выберите файл"))
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, (64<<10)+1))
	ext := strings.ToLower(filepath.Ext(h.Filename))
	if err != nil || len(data) == 0 || len(data) > 64<<10 || !utf8.Valid(data) || strings.ContainsRune(string(data), 0) || !slices.Contains([]string{".txt", ".md", ".csv", ".json", ".sql"}, ext) {
		problem(w, fail(400, "Нужен текстовый UTF-8 файл TXT, MD, CSV, JSON или SQL до 64 КБ"))
		return
	}
	name := filepath.Base(strings.ReplaceAll(h.Filename, "\\", "/"))
	if len(name) > 160 || strings.ContainsAny(name, "\r\n") {
		problem(w, fail(400, "Слишком длинное или неверное имя файла"))
		return
	}
	upload := CourseUpload{ID: uid("F"), Request: r.FormValue("request_id"), Question: r.FormValue("question_id"), Name: name, Content: string(data), Size: len(data), Created: stamp()}
	err = a.Store.transact(func(s *State) error {
		_, c, err := courseAccess(s, u, upload.Request, true)
		if err != nil {
			return err
		}
		found := false
		for _, q := range c.Questions {
			if q.ID == upload.Question && q.Type == "file" {
				found = true
			}
		}
		if !found {
			return fail(400, "Файл не относится к заданию")
		}
		count := 0
		for _, f := range s.CourseUploads {
			if f.Request == upload.Request {
				count++
			}
		}
		if count >= 20 {
			return fail(409, "Достигнут лимит 20 файлов; выберите уже загруженный файл")
		}
		s.CourseUploads = append(s.CourseUploads, upload)
		return nil
	})
	if err != nil {
		problem(w, err)
		return
	}
	upload.Content = ""
	send(w, 200, upload)
}
func (a *API) courseFile(w http.ResponseWriter, r *http.Request, u User) {
	s, err := a.Store.read(r.Context())
	if err != nil {
		problem(w, err)
		return
	}
	f := s.upload(r.URL.Query().Get("id"))
	if f == nil {
		problem(w, fail(404, "Файл не найден"))
		return
	}
	if _, _, err := courseAccess(&s, u, f.Request, false); err != nil {
		problem(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": f.Name}))
	_, _ = io.WriteString(w, f.Content)
}
func validateExam(s *State, c Course, request string, answers []ExamAnswer) error {
	if len(answers) != len(c.Questions) {
		return fail(400, "Ответьте на все задания")
	}
	seen := map[string]bool{}
	for _, answer := range answers {
		if seen[answer.Question] {
			return fail(400, "Задание повторяется")
		}
		seen[answer.Question] = true
		found := false
		for _, q := range c.Questions {
			if q.ID != answer.Question {
				continue
			}
			found = true
			text := strings.TrimSpace(answer.Text)
			if utf8.RuneCountInString(text) > 12000 {
				return fail(400, "Ответ длиннее 12 000 символов")
			}
			if q.Type != "file" && answer.Upload != "" {
				return fail(400, "Файл допускается только в файловом задании")
			}
			switch q.Type {
			case "short":
				if utf8.RuneCountInString(text) < 10 {
					return fail(400, "Короткий ответ: минимум 10 символов")
				}
			case "essay":
				if utf8.RuneCountInString(text) < 400 {
					return fail(400, "Эссе: минимум 400 символов")
				}
			case "multiple_choice":
				if !slices.Contains(q.Options, text) {
					return fail(400, "Выберите один из предложенных ответов")
				}
			case "file":
				f := s.upload(answer.Upload)
				if f == nil || f.Request != request || f.Question != q.ID {
					return fail(400, "Прикрепите свой файл к соответствующему заданию")
				}
			default:
				return fail(409, "Неизвестный тип задания")
			}
		}
		if !found {
			return fail(400, "Неизвестное задание")
		}
	}
	return nil
}
func (a *API) courseExam(w http.ResponseWriter, r *http.Request, u User) {
	var in struct {
		Request string       `json:"request_id"`
		Key     string       `json:"idempotency_key"`
		Answers []ExamAnswer `json:"answers"`
	}
	if err := body(r, &in); err != nil {
		problem(w, err)
		return
	}
	if len(in.Key) < 8 || len(in.Key) > 100 {
		problem(w, fail(400, "Неверный ключ отправки"))
		return
	}
	var result ExamAttempt
	err := a.Store.transact(func(s *State) error {
		// Repeat submission returns the original attempt, including after successful completion.
		q, c, err := courseAccess(s, u, in.Request, false)
		if err != nil {
			return err
		}
		for _, e := range s.Exams {
			if e.Request == q.ID && e.Key == in.Key {
				result = e
				return nil
			}
		}
		if q.Status != "approved" {
			return fail(409, "Курс уже завершён")
		}
		complete := []string{}
		for _, p := range s.CourseProgress {
			if p.Request == q.ID {
				complete = p.Lessons
			}
		}
		for _, l := range c.Lessons {
			if !slices.Contains(complete, l.ID) {
				return fail(409, "Сначала завершите все уроки")
			}
		}
		for _, e := range s.Exams {
			if e.Request == q.ID && e.Status != "graded" {
				return fail(409, "Предыдущая попытка сохранена: сначала завершите её проверку")
			}
		}
		if err := validateExam(s, *c, q.ID, in.Answers); err != nil {
			return err
		}
		result = ExamAttempt{ID: uid("EX"), Request: q.ID, Key: in.Key, Created: stamp(), Updated: stamp(), Status: "submitted", Answers: in.Answers, Grades: []QuestionGrade{}}
		s.Exams = append(s.Exams, result)
		s.audit(u, q.Employee, result.ID, "exam_submitted", "Ответы сохранены для проверки ИИ")
		return nil
	})
	if err != nil {
		problem(w, err)
		return
	}
	result.Lease = ""
	send(w, 200, result)
}
func (a *API) courseGrade(w http.ResponseWriter, r *http.Request, u User) {
	var in struct {
		ID      string `json:"attempt_id"`
		Consent bool   `json:"external_consent"`
	}
	if err := body(r, &in); err != nil {
		problem(w, err)
		return
	}
	var state State
	var attempt ExamAttempt
	var course Course
	var lease string
	err := a.Store.transact(func(s *State) error {
		e := s.exam(in.ID)
		if e == nil {
			return fail(404, "Попытка не найдена")
		}
		_, c, err := courseAccess(s, u, e.Request, false)
		if err != nil {
			return err
		}
		if e.Status == "graded" {
			attempt = *e
			return nil
		}
		if !a.examConfigured() {
			return fail(503, "Настройте Ollama или Gemini на сервере. Ответы сохранены.")
		}
		if a.examSettings().Provider == "gemini" && !in.Consent {
			return fail(400, "Подтвердите передачу ответов и файлов в Gemini")
		}
		if e.Status == "grading" {
			at, _ := time.Parse(time.RFC3339Nano, e.Updated)
			if time.Since(at) < 2*time.Minute {
				return fail(409, "Проверка уже выполняется. Обновите результат через минуту.")
			}
		}
		lease = uid("L")
		e.Status = "grading"
		e.Lease = lease
		e.Updated = stamp()
		e.Feedback = ""
		attempt = *e
		course = *c
		state = clone(*s)
		return nil
	})
	if err != nil {
		problem(w, err)
		return
	}
	if attempt.Status == "graded" {
		attempt.Lease = ""
		send(w, 200, attempt)
		return
	}
	result, modelErr := a.gradeExam(r.Context(), state, course, attempt)
	// Persist the outcome even if the browser disconnected while the provider was running.
	err = a.Store.transact(func(s *State) error {
		e := s.exam(in.ID)
		if e == nil || e.Lease != lease {
			return fail(409, "Попытка уже обновилась; загрузите результат")
		}
		e.Updated = stamp()
		e.Lease = ""
		if modelErr != nil {
			e.Status = "grading_failed"
			e.Feedback = modelErr.Error()
			attempt = *e
			return nil
		}
		q := s.courseRequest(e.Request)
		if q == nil || q.Status != "approved" {
			e.Status = "grading_failed"
			e.Feedback = "Заявка закрыта во время проверки; навыки не изменены."
			attempt = *e
			return nil
		}
		e.Status = "graded"
		e.Grades = result.Grades
		e.Score = result.Score
		e.Passed = result.Score >= course.PassScore
		e.Feedback = result.Feedback
		e.Model = a.examSettings().Model
		if e.Passed {
			employee := s.employee(q.Employee)
			event := s.event(q.Event)
			if employee == nil || event == nil {
				return fail(409, "Данные курса изменились")
			}
			levels := s.effective(*employee)
			q.Gains = map[string]int{}
			for _, g := range event.Gains {
				q.Gains[g.Skill] = grow(levels[g.Skill], g) - levels[g.Skill]
			}
			q.Status = "completed"
			q.Updated = stamp()
			q.Evidence = fmt.Sprintf("Экзамен: %d/100. Проверка ИИ: %s. %s", e.Score, e.Model, e.Feedback)
		}
		s.audit(u, q.Employee, e.ID, "exam_graded", fmt.Sprintf("%d/100, passed=%t, model=%s", e.Score, e.Passed, e.Model))
		attempt = *e
		return nil
	})
	if err != nil {
		problem(w, err)
		return
	}
	attempt.Lease = ""
	send(w, 200, attempt)
}

// Keep schema details and grading keys out of all workspace responses.
func courseCatalog(s *State) []map[string]any {
	out := []map[string]any{}
	for _, c := range s.Courses {
		out = append(out, map[string]any{"event_id": c.Event, "lesson_count": len(c.Lessons), "question_count": len(c.Questions), "pass_score": c.PassScore})
	}
	return out
}

// The model returns only points and feedback; totals and pass/fail are server-computed.
type ExamGrade struct {
	Grades   []QuestionGrade `json:"grades"`
	Feedback string          `json:"feedback"`
	Score    int             `json:"-"`
}

func validateGrade(raw []byte, c Course, attempt ExamAttempt) (ExamGrade, error) {
	var out ExamGrade
	if json.Unmarshal(raw, &out) != nil || len(out.Grades) != len(c.Questions) || len(strings.TrimSpace(out.Feedback)) < 10 || len(out.Feedback) > 6000 {
		return out, fail(502, "Ответ ИИ не прошёл проверку. Повторите проверку сохранённой попытки.")
	}
	seen := map[string]bool{}
	total := 0
	for i := range out.Grades {
		g := &out.Grades[i]
		found := false
		for _, q := range c.Questions {
			if g.Question != q.ID {
				continue
			}
			found = true
			if seen[g.Question] || g.Points < 0 || g.Points > q.Points || len(strings.TrimSpace(g.Feedback)) < 5 || len(g.Feedback) > 3000 {
				return out, fail(502, "ИИ вернул недопустимые оценки. Повторите проверку.")
			}
			seen[g.Question] = true
			if q.Type == "multiple_choice" {
				g.Points = 0
				for _, answer := range attempt.Answers {
					if answer.Question == q.ID && strings.TrimSpace(answer.Text) == q.Correct {
						g.Points = q.Points
					}
				}
				if g.Points == q.Points {
					g.Feedback = "Правильный выбор."
				} else {
					g.Feedback = "Неверный выбор. Повторите материал урока."
				}
			}
			out.Score += g.Points
			total += q.Points
		}
		if !found {
			return out, fail(502, "ИИ вернул неизвестное задание")
		}
	}
	if total != 100 {
		return out, fail(409, "Сумма баллов экзамена должна быть равна 100")
	}
	return out, nil
}
