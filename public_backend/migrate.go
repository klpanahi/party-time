package main

import (
	"embed"
	"fmt"
	"log"

	"github.com/jmoiron/sqlx"
	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var embeddedMigrations embed.FS

// runMigrations wires goose to the embedded migration files and the
// party_time schema, then runs the given goose subcommand ("up", "status",
// "down", etc.) against dsn. Production and tests both call this so they
// can't drift onto different migration paths.
func runMigrations(dsn string, args []string) error {
	db, err := sqlx.Connect("postgres", dsn)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer db.Close()

	goose.SetBaseFS(embeddedMigrations)
	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("set dialect: %w", err)
	}
	// goose's own version table needs to live in party_time alongside every
	// other table, not in public. Table-qualify it explicitly rather than
	// relying on search_path — search_path is a connection-level setting and
	// we don't want goose's bookkeeping to depend on the caller having set it
	// correctly.
	goose.SetTableName("party_time.goose_db_version")

	// goose creates its version table on first use, but that CREATE TABLE
	// targets the party_time schema by name (see SetTableName above) — it
	// does not create the schema itself. Migration 00001 creates the schema
	// too, but that's the first migration goose *applies*, which is too late:
	// goose needs to write to party_time.goose_db_version before it applies
	// anything. So we ensure the schema exists here, in Go, before calling
	// goose at all.
	if _, err := db.Exec(`CREATE SCHEMA IF NOT EXISTS party_time`); err != nil {
		return fmt.Errorf("ensure party_time schema: %w", err)
	}

	command := "up"
	if len(args) > 0 {
		command = args[0]
	}

	switch command {
	case "up":
		return goose.Up(db.DB, "migrations")
	case "status":
		return goose.Status(db.DB, "migrations")
	case "down":
		return goose.Down(db.DB, "migrations")
	default:
		return fmt.Errorf("unknown migrate command %q (want up|status|down)", command)
	}
}

// runMigrateSubcommand is invoked from main() when the process is launched as
// `party-time-backend migrate [up|status|down]`. It reuses loaddbconfig() —
// the same DSN builder the server uses — so migrate and the server can never
// connect to different databases.
func runMigrateSubcommand(args []string) {
	if err := runMigrations(loaddbconfig(), args); err != nil {
		log.Fatalf("migrate: %v", err)
	}
}
