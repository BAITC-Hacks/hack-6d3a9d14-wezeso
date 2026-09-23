package main

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func courseJSON(v any) string { b, _ := json.Marshal(v); return string(b) }
func uploadCourseFile(t *testing.T, c testClient, request, filename, content string) *httptest.ResponseRecorder {
	t.Helper()
	var b bytes.Buffer
	writer := multipart.NewWriter(&b)
	_ = writer.WriteField("request_id", request)
	_ = writer.WriteField("question_id", "file")
	file, _ := writer.CreateFormFile("file", filename)
	_, _ = file.Write([]byte(content))
	_ = writer.Close()
	r := httptest.NewRequest("POST", "/api/courses/upload", &b)
	r.AddCookie(c.cookie)
	r.Header.Set("X-CSRF-Token", c.csrf)
	r.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	c.a.handler(w, r)
	return w
}
func exerciseCourse(t *testing.T, a *API) {
	t.Helper()
	employee := client(t, a, "employee")
	manager := client(t, a, "manager")
	other := client(t, a, "colleague")
	hr := client(t, a, "hr")
	expect(t, employee.do("POST", "requests", `{"event_id":"COURSE_COMMUNICATION","confirmed":true}`), 200)
	s, err := a.Store.read(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	q := s.Requests[len(s.Requests)-1]
	course := *s.course(q.Event)
	endpoint := "courses/view?request_id=" + q.ID
	expect(t, employee.do("GET", endpoint, ""), 409)
	expect(t, employee.do("POST", "transition", transitionJSON(q.ID, "approve", "")), 403)
	expect(t, manager.do("POST", "transition", transitionJSON(q.ID, "approve", "")), 200)
	expect(t, other.do("GET", endpoint, ""), 403)
	expect(t, manager.do("GET", endpoint, ""), 403)
	view := employee.do("GET", endpoint, "")
	expect(t, view, 200)
	if strings.Contains(view.Body.String(), `"rubric"`) || strings.Contains(view.Body.String(), `"correct"`) {
		t.Fatal("answer key leaked")
	}
	workspace := employee.do("GET", "workspace", "").Body.String()
	if strings.Contains(workspace, `"questions"`) || strings.Contains(workspace, `"lessons"`) {
		t.Fatal("content leaked through catalog")
	}
	expect(t, employee.do("POST", "transition", transitionJSON(q.ID, "submit", "Bypassing the required course exam.")), 409)
	expect(t, hr.do("POST", "transition", transitionJSON(q.ID, "complete", "Bypassing the required course exam.")), 409)
	expect(t, employee.do("POST", "courses/exam", courseJSON(map[string]any{"request_id": q.ID, "idempotency_key": "early-key", "answers": []ExamAnswer{}})), 409)
	for _, id := range []string{"audience", "action"} {
		expect(t, employee.do("POST", "courses/lesson", courseJSON(map[string]string{"request_id": q.ID, "lesson_id": id})), 200)
	}
	expect(t, employee.do("POST", "courses/lesson", courseJSON(map[string]string{"request_id": q.ID, "lesson_id": "invented"})), 400)
	expect(t, uploadCourseFile(t, other, q.ID, "work.txt", "Unauthorized file"), 403)
	expect(t, uploadCourseFile(t, employee, q.ID, "work.exe", "invalid type"), 400)
	expect(t, uploadCourseFile(t, employee, q.ID, "work.txt", strings.Repeat("a", 65537)), 400)
	expect(t, uploadCourseFile(t, employee, q.ID, "work.txt", "binary\x00content"), 400)
	fileResponse := uploadCourseFile(t, employee, q.ID, "work.md", "Demo moves to Friday because the test environment is unavailable. Anna will confirm the new time. Please confirm receipt.")
	expect(t, fileResponse, 200)
	var file CourseUpload
	_ = json.Unmarshal(fileResponse.Body.Bytes(), &file)
	expect(t, other.do("GET", "courses/file?id="+file.ID, ""), 403)
	expect(t, employee.do("GET", "courses/file?id="+file.ID, ""), 200)
	answers := []ExamAnswer{{Question: "short", Text: "Контекст, факт, влияние и конкретная просьба."}, {Question: "choice", Text: course.Questions[1].Correct}, {Question: "essay", Text: strings.Repeat("Я уточню факты, влияние и ожидаемый срок. Затем согласую ответственного и попрошу подтвердить решение. ", 7)}, {Question: "file", Upload: file.ID}}
	submit := func(key string) ExamAttempt {
		w := employee.do("POST", "courses/exam", courseJSON(map[string]any{"request_id": q.ID, "idempotency_key": key, "answers": answers}))
		expect(t, w, 200)
		var attempt ExamAttempt
		_ = json.Unmarshal(w.Body.Bytes(), &attempt)
		return attempt
	}
	attempt := submit("attempt-1")
	if again := submit("attempt-1"); again.ID != attempt.ID {
		t.Fatal("duplicate submission")
	}
	expect(t, employee.do("POST", "courses/exam", courseJSON(map[string]any{"request_id": q.ID, "idempotency_key": "another-key", "answers": answers})), 409)
	var mode atomic.Int32
	var sawFile atomic.Bool
	entered := make(chan struct{}, 1)
	release := make(chan struct{})
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		if len(payload.Messages) > 1 && strings.Contains(payload.Messages[1].Content, "Demo moves to Friday") {
			sawFile.Store(true)
		}
		if mode.Load() == 1 {
			send(w, 200, map[string]any{"message": map[string]string{"content": `{"grades":[],"feedback":"broken response"}`}})
			return
		}
		if mode.Load() == 2 {
			w.WriteHeader(503)
			return
		}
		if mode.Load() == 3 {
			entered <- struct{}{}
			<-release
		}
		grades := []QuestionGrade{}
		for _, question := range course.Questions {
			points := 0
			if mode.Load() == 3 {
				points = question.Points
			}
			grades = append(grades, QuestionGrade{Question: question.ID, Points: points, Feedback: "Проверено по содержанию ответа."})
		}
		send(w, 200, map[string]any{"message": map[string]string{"content": courseJSON(ExamGrade{Grades: grades, Feedback: "Повторите конспект и уточните обоснование решения."})}})
	}))
	defer provider.Close()
	a.Agent = &AgentSettings{Provider: "ollama", Model: "test-model", URL: provider.URL}
	gradeBody := courseJSON(map[string]string{"attempt_id": attempt.ID})
	expect(t, other.do("POST", "courses/grade", gradeBody), 403)
	before := s.effective(*s.employee("E0002"))
	expect(t, employee.do("POST", "courses/grade", gradeBody), 200)
	s, _ = a.Store.read(context.Background())
	if s.exam(attempt.ID).Score != 20 || s.courseRequest(q.ID).Status != "approved" || courseJSON(before) != courseJSON(s.effective(*s.employee("E0002"))) {
		t.Fatal("failed exam awarded skills or ignored deterministic MC")
	}
	attempt = submit("attempt-2")
	gradeBody = courseJSON(map[string]string{"attempt_id": attempt.ID})
	mode.Store(1)
	expect(t, employee.do("POST", "courses/grade", gradeBody), 200)
	s, _ = a.Store.read(context.Background())
	if s.exam(attempt.ID).Status != "grading_failed" {
		t.Fatal("malformed AI response accepted")
	}
	mode.Store(2)
	expect(t, employee.do("POST", "courses/grade", gradeBody), 200)
	mode.Store(3)
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- employee.do("POST", "courses/grade", gradeBody) }()
	<-entered
	expect(t, employee.do("POST", "courses/grade", gradeBody), 409)
	close(release)
	expect(t, <-done, 200)
	expect(t, employee.do("POST", "courses/grade", gradeBody), 200)
	if again := submit("attempt-2"); again.ID != attempt.ID {
		t.Fatal("duplicate completed submission")
	}
	s, err = a.Store.read(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !sawFile.Load() || !s.exam(attempt.ID).Passed || s.courseRequest(q.ID).Status != "completed" || len(s.Exams) != 2 {
		t.Fatal("exam did not persist correctly")
	}
	after := s.effective(*s.employee("E0002"))
	for id, gain := range s.courseRequest(q.ID).Gains {
		if after[id] != before[id]+gain {
			t.Fatal("skills not applied exactly once")
		}
	}
	if a.Store.DB == nil {
		reloaded, err := loadRows(filepath.Join(a.Store.Dir, "state.csv"))
		if err != nil {
			t.Fatal(err)
		}
		if len(reloaded.Exams) != 2 || reloaded.upload(file.ID).Content == "" || len(reloaded.CourseProgress) != 1 {
			t.Fatal("CSV restart lost data")
		}
	} else {
		loaded, err := loadPostgres(context.Background(), a.Store.DB)
		if err != nil {
			t.Fatal(err)
		}
		equalBusinessData(t, s, loaded)
	}
}
func TestCourseWorkflowCSV(t *testing.T) {
	a := fixture(t)
	if err := a.Store.transact(func(s *State) error { ensureCourses(s); return nil }); err != nil {
		t.Fatal(err)
	}
	exerciseCourse(t, a)
}
func TestCourseWorkflowPostgres(t *testing.T) {
	db := testDatabase(t)
	a := fixture(t)
	sql, err := exportSQL(a.Store.State)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(context.Background(), sql, pgx.QueryExecModeSimpleProtocol); err != nil {
		t.Fatal(err)
	}
	seed, err := os.ReadFile("migrations/004_course_examples.sql")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := db.Exec(context.Background(), courseSchemaSQL+string(seed), pgx.QueryExecModeSimpleProtocol); err != nil {
			t.Fatal(err)
		}
	}
	loaded, err := loadPostgres(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Courses) != 3 || len(loaded.Events) != len(a.Store.State.Events)+3 {
		t.Fatal("seed not idempotent")
	}
	exerciseCourse(t, databaseAPI(t, db, a.Auth.DummyHash))
}
func TestExamValidation(t *testing.T) {
	var s State
	ensureCourses(&s)
	c := s.Courses[0]
	if err := validateExam(&s, c, "request", []ExamAnswer{}); err == nil {
		t.Fatal("missing answers accepted")
	}
	invalid := ExamGrade{Feedback: "Invalid model answer.", Grades: []QuestionGrade{{Question: "short", Points: 21, Feedback: "Too many points"}, {Question: "choice", Feedback: "A choice"}, {Question: "essay", Feedback: "An essay"}, {Question: "file", Feedback: "A file"}}}
	if _, err := validateGrade([]byte(courseJSON(invalid)), c, ExamAttempt{}); err == nil {
		t.Fatal("out-of-range grade accepted")
	}
	invalid.Grades[0].Points = 10
	invalid.Grades[1].Question = "short"
	if _, err := validateGrade([]byte(courseJSON(invalid)), c, ExamAttempt{}); err == nil {
		t.Fatal("duplicate grade accepted")
	}
}
