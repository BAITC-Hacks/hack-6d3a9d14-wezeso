package main

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

//go:embed migrations/001_supabase.sql
var schemaSQL string

//go:embed migrations/002_agent.sql
var agentSchemaSQL string

//go:embed migrations/003_courses.sql
var courseSchemaSQL string

func dollarQuote(value string) string {
	tag := "$cq$"
	for strings.Contains(value, tag) {
		tag = strings.TrimSuffix(tag, "$") + "x$"
	}
	return tag + value + tag
}

func exportSQL(state State) (string, error) {
	if len(state.Users) == 0 {
		return "", errors.New("source has no user accounts; export state.csv, not demo.csv")
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	checksum := hex.EncodeToString(sum[:])
	var body, counts strings.Builder
	fmt.Fprintf(&body, "BEGIN\nPERFORM 1 FROM career_quest.store_meta WHERE id = 1 FOR UPDATE;\nIF EXISTS (SELECT 1 FROM career_quest.imports WHERE checksum = '%s') THEN RETURN; END IF;\n", checksum)
	checks := []string{"(SELECT ready FROM career_quest.store_meta WHERE id = 1)"}
	for _, t := range entityTables {
		checks = append(checks, "EXISTS (SELECT 1 FROM career_quest."+t.table+")")
	}
	fmt.Fprintf(&body, "IF %s THEN\nRAISE EXCEPTION 'Import refused: Career Quest already contains data. This export only initializes an empty database.';\nEND IF;\n", strings.Join(checks, " OR "))
	for _, t := range entityTables {
		rows, err := tableRows(state, t)
		if err != nil {
			return "", err
		}
		seen := map[string]bool{}
		for _, row := range rows {
			key := rowKey(row, t)
			if seen[key] {
				return "", fmt.Errorf("duplicate key in %s", t.table)
			}
			seen[key] = true
		}
		fmt.Fprintf(&counts, "-- %s: %d\n", t.table, len(rows))
		if len(rows) == 0 {
			continue
		}
		payload, err := json.Marshal(rows)
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&body, "INSERT INTO career_quest.%s SELECT * FROM jsonb_populate_recordset(NULL::career_quest.%s, %s::jsonb);\n", t.table, t.table, dollarQuote(string(payload)))
	}
	fmt.Fprintf(&body, "INSERT INTO career_quest.imports (checksum) VALUES ('%s');\nUPDATE career_quest.store_meta SET ready = true WHERE id = 1;\nEND\n", checksum)
	return "-- Career Quest: schema + complete data migration. Contains private password hashes.\n" + counts.String() + schemaSQL + "\n" + agentSchemaSQL + "\n" + courseSchemaSQL + "\nBEGIN;\nSET LOCAL standard_conforming_strings = on;\nSET CONSTRAINTS ALL DEFERRED;\nDO " + dollarQuote(body.String()) + ";\nCOMMIT;\n" + verificationSQL(), nil
}

func verificationSQL() string {
	queries := []string{}
	for _, t := range entityTables {
		queries = append(queries, "SELECT '"+t.table+"' AS table_name, count(*) AS rows FROM career_quest."+t.table)
	}
	return strings.Join(queries, "\nUNION ALL\n") + ";\n"
}

func databaseCommand() (bool, error) {
	flags := flag.NewFlagSet("careerquest", flag.ContinueOnError)
	exportPath := flags.String("export-sql", "", "write schema and all local data as SQL")
	importPath := flags.String("import-sql", "", "apply the generated SQL to DATABASE_URL")
	source := flags.String("source", filepath.Join(env("DATA_DIR", "data"), "state.csv"), "source state.csv")
	fromDataset := flags.Bool("from-dataset", false, "initialize a fresh DATA_DIR from original dataset before exporting")
	if len(os.Args) == 1 {
		return false, nil
	}
	if err := flags.Parse(os.Args[1:]); err != nil {
		return true, err
	}
	if (*exportPath == "") == (*importPath == "") {
		return true, errors.New("specify exactly one of --export-sql or --import-sql")
	}
	if *exportPath != "" {
		var s State
		var err error
		if *fromDataset {
			if _, err = os.Stat(*source); !os.IsNotExist(err) {
				return true, errors.New("--from-dataset requires a new source path and fresh DATA_DIR")
			}
			s, err = initialState(env("DATA_DIR", "data"))
			if err == nil {
				err = writeRows(*source, s)
			}
		} else {
			s, err = loadRows(*source)
		}
		if err != nil {
			return true, fmt.Errorf("cannot export source state: %w", err)
		}
		ensureCourses(&s)
		sql, err := exportSQL(s)
		if err != nil {
			return true, err
		}
		if err = os.MkdirAll(filepath.Dir(*exportPath), 0700); err != nil {
			return true, err
		}
		f, err := os.CreateTemp(filepath.Dir(*exportPath), "migration-*.tmp")
		if err != nil {
			return true, err
		}
		defer os.Remove(f.Name())
		if err = f.Chmod(0600); err == nil {
			_, err = f.WriteString(sql)
		}
		if err == nil {
			err = f.Sync()
		}
		closeErr := f.Close()
		if err != nil {
			return true, err
		}
		if closeErr != nil {
			return true, closeErr
		}
		if err = replaceFile(f.Name(), *exportPath); err != nil {
			return true, err
		}
		fmt.Printf("SQL migration written to %s\n", *exportPath)
		for _, t := range entityTables {
			rows, _ := tableRows(s, t)
			fmt.Printf("  %s: %d\n", t.table, len(rows))
		}
		return true, nil
	}
	if os.Getenv("DATABASE_URL") == "" {
		return true, errors.New("set DATABASE_URL in .env before importing")
	}
	sql, err := os.ReadFile(*importPath)
	if err != nil {
		return true, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	db, err := connectPostgres(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		return true, err
	}
	defer db.Close()
	// Simple protocol permits the SQL editor-compatible multi-statement file.
	_, err = db.Exec(ctx, string(sql), pgx.QueryExecModeSimpleProtocol)
	if err != nil {
		return true, fmt.Errorf("SQL import failed: %w", err)
	}
	fmt.Println("Supabase schema and data imported successfully.")
	return true, nil
}
