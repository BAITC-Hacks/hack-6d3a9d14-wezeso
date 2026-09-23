package main

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

func hashPassword(password string) (string, error) {
	if utf8.RuneCountInString(password) < 12 || len(password) > 128 {
		return "", errors.New("Пароль должен содержать 12–128 символов")
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := pbkdf2.Key(sha256.New, password, salt, 600000, 32)
	if err != nil {
		return "", err
	}
	return "pbkdf2-sha256$600000$" + hex.EncodeToString(salt) + "$" + hex.EncodeToString(key), nil
}
func checkPassword(password, hash string) bool {
	p := strings.Split(hash, "$")
	if len(p) != 4 || p[0] != "pbkdf2-sha256" || p[1] != "600000" || len(password) > 128 {
		return false
	}
	salt, e := hex.DecodeString(p[2])
	if e != nil {
		return false
	}
	expected, e := hex.DecodeString(p[3])
	if e != nil {
		return false
	}
	actual, e := pbkdf2.Key(sha256.New, password, salt, 600000, 32)
	return e == nil && subtle.ConstantTimeCompare(expected, actual) == 1
}

type Session struct {
	User    User
	CSRF    string
	Expires time.Time
}
type Attempt struct {
	Count int
	Until time.Time
}
type Auth struct {
	mu        sync.Mutex
	Sessions  map[string]Session
	Attempts  map[string]Attempt
	DummyHash string
}

func (a *Auth) session(r *http.Request) (Session, bool) {
	c, e := r.Cookie("cq_session")
	if e != nil {
		return Session{}, false
	}
	h := sha256.Sum256([]byte(c.Value))
	a.mu.Lock()
	defer a.mu.Unlock()
	key := hex.EncodeToString(h[:])
	s, ok := a.Sessions[key]
	if ok && time.Now().After(s.Expires) {
		delete(a.Sessions, key)
		ok = false
	}
	return s, ok
}
func (a *Auth) issue(w http.ResponseWriter, u User, secure bool) Session {
	token := uid("")
	h := sha256.Sum256([]byte(token))
	s := Session{u, uid(""), time.Now().Add(8 * time.Hour)}
	a.mu.Lock()
	a.Sessions[hex.EncodeToString(h[:])] = s
	a.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "cq_session", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: secure, MaxAge: 8 * 3600})
	return s
}
func (a *Auth) logout(w http.ResponseWriter, r *http.Request, secure bool) {
	if c, e := r.Cookie("cq_session"); e == nil {
		h := sha256.Sum256([]byte(c.Value))
		a.mu.Lock()
		delete(a.Sessions, hex.EncodeToString(h[:]))
		a.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: "cq_session", Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: secure, MaxAge: -1})
}
func publicUser(u User) map[string]string {
	return map[string]string{"id": u.ID, "login": u.Login, "role": u.Role, "employee_id": u.Employee}
}
