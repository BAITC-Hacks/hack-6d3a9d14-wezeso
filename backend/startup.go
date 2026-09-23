package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5"
)

func openStore() (*Store, func(), error) {
	backend := os.Getenv("STORAGE_BACKEND")
	if backend == "" {
		backend = "csv"
		if os.Getenv("DATABASE_URL") != "" {
			backend = "supabase"
		}
	}
	if backend == "supabase" {
		url := os.Getenv("DATABASE_URL")
		if url == "" {
			return nil, nil, errors.New("DATABASE_URL is required for Supabase. Set it in .env and apply data/supabase-migration.sql; use STORAGE_BACKEND=csv only for the legacy local mode")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		db, err := connectPostgres(ctx, url)
		if err != nil {
			return nil, nil, err
		}
		var version int
		var ready bool
		err = db.QueryRow(ctx, "SELECT schema_version, ready FROM career_quest.store_meta WHERE id = 1").Scan(&version, &ready)
		if err != nil || version != 1 || !ready {
			db.Close()
			return nil, nil, errors.New("Supabase schema/data not ready. Generate SQL with npm run db:export and apply it before starting the app")
		}
		// Additive extension only: preserve all existing accounts and business data.
		if _, err = db.Exec(ctx, agentSchemaSQL, pgx.QueryExecModeSimpleProtocol); err != nil {
			db.Close()
			return nil, nil, errors.New("cannot apply agent extension; apply backend/migrations/002_agent.sql using the database owner")
		}
		if _, err = db.Exec(ctx, courseSchemaSQL, pgx.QueryExecModeSimpleProtocol); err != nil {
			db.Close()
			return nil, nil, errors.New("cannot apply course extension; apply backend/migrations/003_courses.sql using the database owner")
		}
		state, err := loadPostgres(ctx, db)
		if err != nil {
			db.Close()
			return nil, nil, err
		}
		if len(state.Users) == 0 {
			db.Close()
			return nil, nil, errors.New("Supabase has no app accounts; import the complete state.csv export")
		}
		st := &Store{DB: db, State: state}
		if err := st.transact(func(s *State) error { ensureCourses(s); return nil }); err != nil {
			db.Close()
			return nil, nil, err
		}
		return st, db.Close, nil
	}
	if backend != "csv" {
		return nil, nil, errors.New("STORAGE_BACKEND must be supabase or csv")
	}
	dir := env("DATA_DIR", "data")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, nil, err
	}
	lock := filepath.Join(dir, "state.lock")
	lf, err := os.OpenFile(lock, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, nil, fmt.Errorf("CSV store locked; stop the other writer before using legacy mode: %w", err)
	}
	_, _ = fmt.Fprint(lf, os.Getpid())
	_ = lf.Close()
	cleanup := func() { _ = os.Remove(lock) }
	state, err := loadRows(filepath.Join(dir, "state.csv"))
	if os.IsNotExist(err) {
		state, err = initialState(dir)
		if err == nil {
			err = writeRows(filepath.Join(dir, "state.csv"), state)
		}
	}
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	ensureCourses(&state)
	if err := writeRows(filepath.Join(dir, "state.csv"), state); err != nil {
		cleanup()
		return nil, nil, err
	}
	return &Store{State: state, Dir: dir}, cleanup, nil
}

func initialState(dir string) (State, error) {
	s, err := seed(env("DATASET_DIR", "."))
	if err != nil {
		return s, err
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		return s, err
	}
	pass := os.Getenv("DEMO_PASSWORD")
	if pass == "" {
		pass = "Quest-" + uid("")[:18]
	}
	hash, err := hashPassword(pass)
	if err != nil {
		return s, err
	}
	s.Users = []User{{"U_employee", "employee", hash, "employee", "E0002"}, {"U_manager", "manager", hash, "manager", "E0175"}, {"U_hr", "hr", hash, "hr", ""}, {"U_other", "colleague", hash, "employee", "E0001"}}
	// Never replace an existing credential file when exporting a fresh dataset.
	f, err := os.OpenFile(filepath.Join(dir, "demo-accounts.txt"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return s, fmt.Errorf("choose a fresh DATA_DIR for dataset initialization: %w", err)
	}
	_, err = fmt.Fprintln(f, "Local demo accounts: employee, manager, hr, colleague\nPassword: "+pass)
	closeErr := f.Close()
	if err != nil {
		return s, err
	}
	return s, closeErr
}
