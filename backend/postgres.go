package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// These names are compile-time identifiers, never user-provided SQL.
type entityTable struct {
	field, table   string
	keys, nullable []string
}

var entityTables = []entityTable{
	{"Skills", "skills", []string{"skill_id"}, nil},
	{"Roles", "role_profiles", []string{"role", "grade"}, nil},
	{"Employees", "employees", []string{"employee_id"}, nil},
	{"Events", "events", []string{"event_id"}, nil},
	{"History", "activity_history", []string{"record_id"}, []string{"due_date"}},
	{"Users", "app_users", []string{"id"}, []string{"employee_id"}},
	{"Requests", "requests", []string{"id"}, []string{"session_date", "confirmed_by"}},
	{"Audits", "audit_log", []string{"id"}, []string{"employee_id"}},
	{"Recommendations", "recommendations", []string{"id"}, nil},
	{"AgentRuns", "agent_runs", []string{"id"}, nil},
	{"AgentWatches", "agent_watches", []string{"employee_id"}, nil},
	{"Courses", "courses", []string{"event_id"}, nil},
	{"CourseProgress", "course_progress", []string{"id"}, nil},
	{"CourseUploads", "course_uploads", []string{"id"}, nil},
	{"Exams", "exam_attempts", []string{"id"}, nil},
}

func connectPostgres(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, errors.New("invalid DATABASE_URL (expected a PostgreSQL connection URL)")
	}
	cfg.MaxConns = 8
	cfg.ConnConfig.ConnectTimeout = 5 * time.Second
	cfg.ConnConfig.RuntimeParams["application_name"] = "career-quest"
	cfg.ConnConfig.RuntimeParams["statement_timeout"] = "10000"
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err == nil {
		err = pool.Ping(ctx)
	}
	if err != nil {
		if pool != nil {
			pool.Close()
		}
		// Driver errors may contain connection details. Keep credentials out of logs.
		return nil, errors.New("cannot connect to Supabase PostgreSQL; check DATABASE_URL and database availability")
	}
	return pool, nil
}

func loadPostgres(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}) (State, error) {
	parts := make([]string, 0, len(entityTables)*2)
	for _, t := range entityTables {
		parts = append(parts, "'"+t.field+"'", "(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY sort_order), '[]'::jsonb) FROM career_quest."+t.table+" t)")
	}
	var raw []byte
	var state State
	err := q.QueryRow(ctx, "SELECT jsonb_build_object("+strings.Join(parts, ",")+")").Scan(&raw)
	if err == nil {
		err = json.Unmarshal(raw, &state)
	}
	return state, err
}

func (st *Store) read(ctx context.Context) (State, error) {
	if st.DB != nil {
		ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		return loadPostgres(ctx, st.DB)
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	return clone(st.State), nil
}

func tableRows(s State, t entityTable) ([]map[string]any, error) {
	b, err := json.Marshal(reflect.ValueOf(s).FieldByName(t.field).Interface())
	if err != nil {
		return nil, err
	}
	var rows []map[string]any
	if err = json.Unmarshal(b, &rows); err != nil {
		return nil, err
	}
	for index, row := range rows {
		row["sort_order"] = index
		for _, field := range t.nullable {
			if row[field] == "" {
				row[field] = nil
			}
		}
	}
	return rows, nil
}

func rowKey(row map[string]any, t entityTable) string {
	values := make([]any, len(t.keys))
	for i, key := range t.keys {
		values[i] = row[key]
	}
	b, _ := json.Marshal(values)
	return string(b)
}

// Save only changed rows. The application never deletes business records.
func savePostgres(ctx context.Context, tx pgx.Tx, before, after State) error {
	batch := &pgx.Batch{}
	for _, t := range entityTables {
		oldRows, err := tableRows(before, t)
		if err != nil {
			return err
		}
		newRows, err := tableRows(after, t)
		if err != nil {
			return err
		}
		old := map[string][]byte{}
		for _, row := range oldRows {
			old[rowKey(row, t)], _ = json.Marshal(row)
		}
		for _, row := range newRows {
			key := rowKey(row, t)
			raw, err := json.Marshal(row)
			if err != nil {
				return err
			}
			if bytes.Equal(old[key], raw) {
				delete(old, key)
				continue
			}
			delete(old, key)
			// jsonb_populate_record applies PostgreSQL types and constraints.
			columns := []string{}
			for field := range row {
				columns = append(columns, pgx.Identifier{field}.Sanitize())
			}
			assignments := make([]string, len(columns))
			for i, column := range columns {
				assignments[i] = column + " = EXCLUDED." + column
			}
			batch.Queue("INSERT INTO career_quest."+t.table+" SELECT * FROM jsonb_populate_record(NULL::career_quest."+t.table+", $1::jsonb) ON CONFLICT ("+strings.Join(t.keys, ",")+") DO UPDATE SET "+strings.Join(assignments, ","), string(raw))
		}
		if len(old) != 0 {
			return fmt.Errorf("deleting %s records is not supported", t.table)
		}
	}
	return tx.SendBatch(ctx, batch).Close()
}

func (st *Store) transactPostgres(fn func(*State) error) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tx, err := st.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	var version int
	// A transaction-scoped row lock serializes validation + changes across servers.
	if err = tx.QueryRow(ctx, "SELECT schema_version FROM career_quest.store_meta WHERE id = 1 FOR UPDATE").Scan(&version); err != nil {
		return err
	}
	if version != 1 {
		return errors.New("unsupported database schema version")
	}
	before, err := loadPostgres(ctx, tx)
	if err != nil {
		return err
	}
	next := clone(before)
	if err = fn(&next); err != nil {
		return err
	}
	if err = savePostgres(ctx, tx, before, next); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	st.State = next
	return nil
}
