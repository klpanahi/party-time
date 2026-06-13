package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
)

var (
	testEnv *Env
	testDB  *sqlx.DB
)

func TestMain(m *testing.M) {
	gin.SetMode(gin.TestMode)

	// Connect to the default postgres database to create the test database.
	adminDB, err := sqlx.Connect("postgres",
		"host=127.0.0.1 port=5432 user=myuser password=mypassword dbname=postgres sslmode=disable")
	if err != nil {
		log.Fatalf("connect admin: %v", err)
	}
	if _, err = adminDB.Exec(`CREATE DATABASE party_time_test`); err != nil {
		if !strings.Contains(err.Error(), "already exists") {
			log.Fatalf("create test db: %v", err)
		}
	}
	adminDB.Close()

	testDB, err = sqlx.Connect("postgres",
		"host=127.0.0.1 port=5432 user=myuser password=mypassword dbname=party_time_test sslmode=disable")
	if err != nil {
		log.Fatalf("connect test db: %v", err)
	}

	// Drop and recreate schema so every run starts from a clean slate.
	mustExec(testDB, `DROP SCHEMA public CASCADE`)
	mustExec(testDB, `CREATE SCHEMA public`)
	mustExec(testDB, `GRANT ALL ON SCHEMA public TO myuser`)
	schemaSQL, err := os.ReadFile("../schema.sql")
	if err != nil {
		log.Fatalf("read schema: %v", err)
	}
	mustExec(testDB, string(schemaSQL))

	testEnv = &Env{db: testDB, inviteeBase: "http://test.local"}

	code := m.Run()
	testDB.Close()
	os.Exit(code)
}

func mustExec(db *sqlx.DB, sql string) {
	if _, err := db.Exec(sql); err != nil {
		log.Fatalf("mustExec: %v\nSQL: %.200s", err, sql)
	}
}

// cleanDB truncates all tables and resets identity sequences between tests.
func cleanDB(t *testing.T) {
	t.Helper()
	if _, err := testDB.Exec(
		`TRUNCATE texts, messages, invites, events, contacts RESTART IDENTITY CASCADE`,
	); err != nil {
		t.Fatalf("cleanDB: %v", err)
	}
}

// newRouter builds the full router (admin + public) against the test Env.
func newRouter() *gin.Engine {
	r := gin.New()
	r.GET("/invites", testEnv.getInvites)
	r.GET("/invite/:id", testEnv.getInviteByID)
	r.PUT("/invite/:id", testEnv.updateInvite)
	r.GET("/event/:id", testEnv.getEventByID)
	admin := r.Group("/admin")
	admin.GET("/contacts", testEnv.adminGetContacts)
	admin.POST("/contacts", testEnv.adminCreateContact)
	admin.PUT("/contacts/:id", testEnv.adminUpdateContact)
	admin.GET("/events", testEnv.adminGetEvents)
	admin.POST("/events", testEnv.adminCreateEvent)
	admin.GET("/events/:id", testEnv.adminGetEvent)
	admin.PUT("/events/:id", testEnv.adminUpdateEvent)
	admin.POST("/events/:id/invites", testEnv.adminAddInvitee)
	admin.POST("/events/:id/messages", testEnv.adminSendMessage)
	admin.GET("/events/:id/texts", testEnv.adminGetTexts)
	admin.POST("/events/:id/launch", testEnv.adminLaunchEvent)
	admin.POST("/texts/:id/resend", testEnv.adminResendText)
	return r
}

// do fires an HTTP request against the router and returns the response recorder.
func do(t *testing.T, r http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reqBody *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request body: %v", err)
		}
		reqBody = bytes.NewReader(b)
	} else {
		reqBody = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reqBody)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// mustDecode unmarshals the response body into v, failing the test on error.
func mustDecode(t *testing.T, w *httptest.ResponseRecorder, v any) {
	t.Helper()
	if err := json.NewDecoder(w.Body).Decode(v); err != nil {
		t.Fatalf("decode response: %v\nbody: %s", err, w.Body.String())
	}
}

// assertStatus fails if the response code doesn't match.
func assertStatus(t *testing.T, w *httptest.ResponseRecorder, want int) {
	t.Helper()
	if w.Code != want {
		t.Errorf("HTTP status = %d, want %d\nbody: %s", w.Code, want, w.Body.String())
	}
}

// --- DB seed helpers ---

func seedContact(t *testing.T, firstName, lastName, phone string) int {
	t.Helper()
	var id int
	err := testDB.QueryRow(
		`INSERT INTO contacts (first_name, last_name, phone_number) VALUES ($1, $2, $3) RETURNING id`,
		firstName, lastName, phone,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seedContact: %v", err)
	}
	return id
}

func seedEvent(t *testing.T, name string, date time.Time, status string) int {
	t.Helper()
	var id int
	err := testDB.QueryRow(
		`INSERT INTO events (name, date, description, location, plus_ones_allowed, status)
		 VALUES ($1, $2, 'Test description', 'Test venue', true, $3) RETURNING id`,
		name, date, status,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seedEvent: %v", err)
	}
	return id
}

func seedInvite(t *testing.T, eventID, contactID int) string {
	t.Helper()
	var id string
	err := testDB.QueryRow(
		`INSERT INTO invites (event_id, contact_id) VALUES ($1, $2) RETURNING id`,
		eventID, contactID,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seedInvite: %v", err)
	}
	return id
}

func futureDate() time.Time { return time.Now().Add(30 * 24 * time.Hour) }
func pastDate() time.Time   { return time.Now().Add(-30 * 24 * time.Hour) }
