package main

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"testing"
)

// fakeSender is an in-memory SMSSender for tests — no network calls.
type fakeSender struct {
	mu      sync.Mutex
	calls   []sentCall
	sid     string
	err     error            // applied to every send when non-nil
	failFor map[string]error // per-recipient errors, keyed by phone number
}

type sentCall struct{ To, Body string }

func (f *fakeSender) Send(to, body string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, sentCall{To: to, Body: body})
	if f.failFor != nil {
		if e, ok := f.failFor[to]; ok {
			return "", e
		}
	}
	if f.err != nil {
		return "", f.err
	}
	sid := f.sid
	if sid == "" {
		sid = "SMtest123"
	}
	return sid, nil
}

func (f *fakeSender) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

// seedText inserts a pending text and returns its id.
func seedText(t *testing.T, contactID, eventID int, content string) int64 {
	t.Helper()
	var id int64
	err := testDB.QueryRow(
		`INSERT INTO texts (contact_id, event_id, status, content) VALUES ($1, $2, 'pending', $3) RETURNING id`,
		contactID, eventID, content,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seedText: %v", err)
	}
	return id
}

type textRow struct {
	Status      string  `db:"status"`
	Error       *string `db:"error"`
	ProviderSid *string `db:"provider_sid"`
	SentAt      *string `db:"sent_at"`
}

func getText(t *testing.T, id int64) textRow {
	t.Helper()
	var row textRow
	if err := testDB.Get(&row,
		`SELECT status, error, provider_sid, sent_at::text AS sent_at FROM texts WHERE id = $1`, id,
	); err != nil {
		t.Fatalf("getText: %v", err)
	}
	return row
}

func TestTextWorker(t *testing.T) {
	t.Run("sends pending text and marks it sent", func(t *testing.T) {
		cleanDB(t)
		contactID := seedContact(t, "Alice", "Smith", "+15555550100")
		eventID := seedEvent(t, "Party", futureDate(), "launched")
		textID := seedText(t, contactID, eventID, "Hey Alice!")

		fake := &fakeSender{sid: "SMabc"}
		env := &Env{db: testDB, sender: fake}
		env.processPendingTexts(context.Background(), 0)

		row := getText(t, textID)
		if row.Status != "sent" {
			t.Errorf("status = %q, want sent", row.Status)
		}
		if row.ProviderSid == nil || *row.ProviderSid != "SMabc" {
			t.Errorf("provider_sid = %v, want SMabc", row.ProviderSid)
		}
		if row.SentAt == nil {
			t.Error("sent_at should be set")
		}
		if row.Error != nil {
			t.Errorf("error = %v, want nil", *row.Error)
		}
		if fake.callCount() != 1 {
			t.Fatalf("sender called %d times, want 1", fake.callCount())
		}
		if fake.calls[0].To != "+15555550100" || fake.calls[0].Body != "Hey Alice!" {
			t.Errorf("unexpected send: %+v", fake.calls[0])
		}
	})

	t.Run("marks text failed when sender errors", func(t *testing.T) {
		cleanDB(t)
		contactID := seedContact(t, "Bob", "Jones", "+15555550101")
		eventID := seedEvent(t, "Party", futureDate(), "launched")
		textID := seedText(t, contactID, eventID, "Hey Bob!")

		fake := &fakeSender{err: errors.New("invalid number")}
		env := &Env{db: testDB, sender: fake}
		env.processPendingTexts(context.Background(), 0)

		row := getText(t, textID)
		if row.Status != "failed" {
			t.Errorf("status = %q, want failed", row.Status)
		}
		if row.Error == nil || *row.Error != "invalid number" {
			t.Errorf("error = %v, want \"invalid number\"", row.Error)
		}
		if row.ProviderSid != nil {
			t.Errorf("provider_sid = %v, want nil", *row.ProviderSid)
		}
	})

	t.Run("does not resend already-processed texts", func(t *testing.T) {
		cleanDB(t)
		contactID := seedContact(t, "Cara", "Lee", "+15555550102")
		eventID := seedEvent(t, "Party", futureDate(), "launched")
		seedText(t, contactID, eventID, "Hey Cara!")

		fake := &fakeSender{}
		env := &Env{db: testDB, sender: fake}
		env.processPendingTexts(context.Background(), 0) // sends it
		env.processPendingTexts(context.Background(), 0) // nothing left to send

		if fake.callCount() != 1 {
			t.Errorf("sender called %d times, want 1 (sent rows must not be reclaimed)", fake.callCount())
		}
	})

	t.Run("only claims pending rows", func(t *testing.T) {
		cleanDB(t)
		contactID := seedContact(t, "Dan", "Ray", "+15555550103")
		eventID := seedEvent(t, "Party", futureDate(), "launched")
		// One already-sent text, one pending.
		if _, err := testDB.Exec(
			`INSERT INTO texts (contact_id, event_id, status, content) VALUES ($1, $2, 'sent', 'old')`,
			contactID, eventID,
		); err != nil {
			t.Fatalf("seed sent text: %v", err)
		}
		pendingID := seedText(t, contactID, eventID, "new")

		fake := &fakeSender{}
		env := &Env{db: testDB, sender: fake}
		env.processPendingTexts(context.Background(), 0)

		if fake.callCount() != 1 {
			t.Fatalf("sender called %d times, want 1", fake.callCount())
		}
		if fake.calls[0].Body != "new" {
			t.Errorf("sent body = %q, want \"new\"", fake.calls[0].Body)
		}
		if getText(t, pendingID).Status != "sent" {
			t.Error("pending text should be sent")
		}
	})
}

func TestResendText(t *testing.T) {
	t.Run("requeues a failed text", func(t *testing.T) {
		cleanDB(t)
		r := newRouter()
		contactID := seedContact(t, "Eve", "Moss", "+15555550104")
		eventID := seedEvent(t, "Party", futureDate(), "launched")
		var textID int64
		if err := testDB.QueryRow(
			`INSERT INTO texts (contact_id, event_id, status, content, error)
			 VALUES ($1, $2, 'failed', 'msg', 'boom') RETURNING id`,
			contactID, eventID,
		).Scan(&textID); err != nil {
			t.Fatalf("seed failed text: %v", err)
		}

		w := do(t, r, "POST", "/admin/texts/"+strconv.FormatInt(textID, 10)+"/resend", nil)
		assertStatus(t, w, 200)

		row := getText(t, textID)
		if row.Status != "pending" {
			t.Errorf("status = %q, want pending", row.Status)
		}
		if row.Error != nil {
			t.Errorf("error = %v, want nil after resend", *row.Error)
		}
	})

	t.Run("rejects resend of a non-failed text", func(t *testing.T) {
		cleanDB(t)
		r := newRouter()
		contactID := seedContact(t, "Finn", "Park", "+15555550105")
		eventID := seedEvent(t, "Party", futureDate(), "launched")
		textID := seedText(t, contactID, eventID, "still pending")

		w := do(t, r, "POST", "/admin/texts/"+strconv.FormatInt(textID, 10)+"/resend", nil)
		assertStatus(t, w, 409)
	})
}
