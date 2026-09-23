package main

import (
	_ "embed"
	"encoding/json"
)

type Lesson struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Content     string `json:"content"`
	Video       string `json:"video_id"`
	Source      string `json:"source_url"`
	SourceLabel string `json:"source_label"`
}
type ExamQuestion struct {
	ID      string   `json:"id"`
	Type    string   `json:"type"`
	Prompt  string   `json:"prompt"`
	Options []string `json:"options"`
	Points  int      `json:"points"`
	Rubric  string   `json:"rubric,omitempty"`
	Correct string   `json:"correct,omitempty"`
}
type Course struct {
	Event     string         `json:"event_id"`
	PassScore int            `json:"pass_score"`
	Lessons   []Lesson       `json:"lessons"`
	Questions []ExamQuestion `json:"questions"`
}
type CourseProgress struct {
	ID      string   `json:"id"`
	Request string   `json:"request_id"`
	Lessons []string `json:"completed_lessons"`
	Updated string   `json:"updated_at"`
}
type ExamAnswer struct {
	Question string `json:"question_id"`
	Text     string `json:"text"`
	Upload   string `json:"upload_id"`
}
type QuestionGrade struct {
	Question string `json:"question_id"`
	Points   int    `json:"points"`
	Feedback string `json:"feedback"`
}
type ExamAttempt struct {
	ID       string          `json:"id"`
	Request  string          `json:"request_id"`
	Key      string          `json:"idempotency_key"`
	Created  string          `json:"created_at"`
	Updated  string          `json:"updated_at"`
	Status   string          `json:"status"`
	Answers  []ExamAnswer    `json:"answers"`
	Grades   []QuestionGrade `json:"grades"`
	Score    int             `json:"score"`
	Passed   bool            `json:"passed"`
	Feedback string          `json:"feedback"`
	Model    string          `json:"model"`
	Lease    string          `json:"lease"`
}

// Small UTF-8 assignment files stay in the same private, transactional database.
type CourseUpload struct {
	ID       string `json:"id"`
	Request  string `json:"request_id"`
	Question string `json:"question_id"`
	Name     string `json:"name"`
	Content  string `json:"content"`
	Size     int    `json:"size"`
	Created  string `json:"created_at"`
}

//go:embed course_examples.json
var courseExamples []byte

func ensureCourses(s *State) {
	var examples []struct {
		Event  Event  `json:"event"`
		Course Course `json:"course"`
	}
	if err := json.Unmarshal(courseExamples, &examples); err != nil {
		panic(err)
	}
	for _, example := range examples {
		if s.event(example.Event.ID) == nil {
			s.Events = append(s.Events, example.Event)
		}
		if s.course(example.Course.Event) == nil {
			s.Courses = append(s.Courses, example.Course)
		}
	}
}
func (s *State) course(event string) *Course {
	for i := range s.Courses {
		if s.Courses[i].Event == event {
			return &s.Courses[i]
		}
	}
	return nil
}
func (s *State) courseRequest(id string) *Request {
	for i := range s.Requests {
		if s.Requests[i].ID == id {
			return &s.Requests[i]
		}
	}
	return nil
}
func (s *State) exam(id string) *ExamAttempt {
	for i := range s.Exams {
		if s.Exams[i].ID == id {
			return &s.Exams[i]
		}
	}
	return nil
}
func (s *State) upload(id string) *CourseUpload {
	for i := range s.CourseUploads {
		if s.CourseUploads[i].ID == id {
			return &s.CourseUploads[i]
		}
	}
	return nil
}
