package main

import (
	"context"
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

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func hashPassword(password string) (string, error) {
	if utf8.RuneCountInString(password) < 12 || len(password) > 128 {
		return "", errors.New("Пароль должен содержать от 12 до 128 символов")
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
	DB        *pgxpool.Pool
}

func (a *Auth) session(r *http.Request) (Session, bool, error) {
	c, e := r.Cookie("cq_session")
	if e != nil {
		return Session{}, false, nil
	}
	h := sha256.Sum256([]byte(c.Value))
	if a.DB != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		var s Session
		err := a.DB.QueryRow(ctx, `SELECT u.id, u.login, u.role, coalesce(u.employee_id, ''), s.csrf, s.expires_at
			FROM career_quest.sessions s JOIN career_quest.app_users u ON u.id = s.user_id
			WHERE s.token_hash = $1 AND s.expires_at > now()`, hex.EncodeToString(h[:])).Scan(&s.User.ID, &s.User.Login, &s.User.Role, &s.User.Employee, &s.CSRF, &s.Expires)
		if errors.Is(err, pgx.ErrNoRows) {
			return Session{}, false, nil
		}
		return s, err == nil, err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	key := hex.EncodeToString(h[:])
	s, ok := a.Sessions[key]
	if ok && time.Now().After(s.Expires) {
		delete(a.Sessions, key)
		ok = false
	}
	return s, ok, nil
}
func (a *Auth) issue(w http.ResponseWriter, u User, secure bool) (Session, error) {
	token := uid("")
	h := sha256.Sum256([]byte(token))
	s := Session{u, uid(""), time.Now().Add(8 * time.Hour)}
	if a.DB != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, err := a.DB.Exec(ctx, `WITH expired AS (DELETE FROM career_quest.sessions WHERE expires_at <= now())
			INSERT INTO career_quest.sessions (token_hash, user_id, csrf, expires_at) VALUES ($1, $2, $3, $4)`, hex.EncodeToString(h[:]), u.ID, s.CSRF, s.Expires)
		if err != nil {
			return Session{}, err
		}
	} else {
		a.mu.Lock()
		a.Sessions[hex.EncodeToString(h[:])] = s
		a.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: "cq_session", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: secure, MaxAge: 8 * 3600})
	return s, nil
}
func (a *Auth) logout(w http.ResponseWriter, r *http.Request, secure bool) error {
	if c, e := r.Cookie("cq_session"); e == nil {
		h := sha256.Sum256([]byte(c.Value))
		if a.DB != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			defer cancel()
			if _, err := a.DB.Exec(ctx, "DELETE FROM career_quest.sessions WHERE token_hash = $1", hex.EncodeToString(h[:])); err != nil {
				return err
			}
		} else {
			a.mu.Lock()
			delete(a.Sessions, hex.EncodeToString(h[:]))
			a.mu.Unlock()
		}
	}
	http.SetCookie(w, &http.Cookie{Name: "cq_session", Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: secure, MaxAge: -1})
	return nil
}

func (a *Auth) attempt(ctx context.Context, host string) (bool, error) {
	if a.DB != nil {
		ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		var count int
		err := a.DB.QueryRow(ctx, `INSERT INTO career_quest.login_attempts AS attempts (host, count, until_at)
			VALUES ($1, 1, now() + interval '5 minutes') ON CONFLICT (host) DO UPDATE
			SET count = CASE WHEN attempts.until_at <= now() THEN 1 ELSE attempts.count + 1 END,
			until_at = CASE WHEN attempts.until_at <= now() THEN now() + interval '5 minutes' ELSE attempts.until_at END
			RETURNING count`, host).Scan(&count)
		return count <= 15, err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	attempt := a.Attempts[host]
	if time.Now().After(attempt.Until) {
		attempt = Attempt{Until: time.Now().Add(5 * time.Minute)}
	}
	attempt.Count++
	a.Attempts[host] = attempt
	return attempt.Count <= 15, nil
}

func (a *Auth) clearAttempts(ctx context.Context, host string) error {
	if a.DB != nil {
		ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		_, err := a.DB.Exec(ctx, "DELETE FROM career_quest.login_attempts WHERE host = $1 OR until_at <= now()", host)
		return err
	}
	a.mu.Lock()
	delete(a.Attempts, host)
	a.mu.Unlock()
	return nil
}
func publicUser(u User) map[string]string {
	return map[string]string{"id": u.ID, "login": u.Login, "role": u.Role, "employee_id": u.Employee}
}
