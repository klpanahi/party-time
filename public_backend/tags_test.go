package main

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// Contact interest tags
// ---------------------------------------------------------------------------

func TestNormalizeTags(t *testing.T) {
	got, err := normalizeTags([]string{"  Board   Games ", "hiking", "board games", "", "   ", "HIKING"})
	if err != nil {
		t.Fatalf("normalizeTags: %v", err)
	}
	want := []string{"board games", "hiking"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("normalizeTags = %q, want %q", got, want)
	}

	if _, err := normalizeTags([]string{strings.Repeat("x", maxTagLength+1)}); err == nil {
		t.Error("expected an error for an over-long tag")
	}
	if _, err := normalizeTags([]string{strings.Repeat("é", maxTagLength)}); err != nil {
		t.Errorf("a tag of exactly %d characters should be allowed: %v", maxTagLength, err)
	}
}

// contactByID fetches the contact list and returns the one with id.
func contactByID(t *testing.T, id int) Contact {
	t.Helper()
	w := do(t, newRouter(), "GET", "/admin/contacts", nil)
	assertStatus(t, w, 200)
	var list []Contact
	mustDecode(t, w, &list)
	for _, c := range list {
		if c.ID == id {
			return c
		}
	}
	t.Fatalf("contact %d not in list", id)
	return Contact{}
}

func TestContactTags(t *testing.T) {
	cleanDB(t)
	r := newRouter()

	t.Run("contacts without tags serve an empty array", func(t *testing.T) {
		id := seedContact(t, "Nora", "None", "5553330001")
		w := do(t, r, "GET", "/admin/contacts", nil)
		assertStatus(t, w, 200)
		if !strings.Contains(w.Body.String(), `"tags":[]`) {
			t.Errorf("expected tags:[] in body, got %s", w.Body.String())
		}
		if got := contactByID(t, id).Tags; len(got) != 0 {
			t.Errorf("tags = %q, want none", got)
		}
	})

	t.Run("create stores normalized, sorted tags", func(t *testing.T) {
		w := do(t, r, "POST", "/admin/contacts", map[string]any{
			"first_name":   "Tess",
			"phone_number": "5123330002",
			"tags":         []string{"Hiking", " board  games", "hiking"},
		})
		assertStatus(t, w, 201)
		var resp struct{ ID int }
		mustDecode(t, w, &resp)

		got := []string(contactByID(t, resp.ID).Tags)
		want := []string{"board games", "hiking"}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("tags = %q, want %q", got, want)
		}
	})

	t.Run("update replaces tags, omitted tags are left alone", func(t *testing.T) {
		id := seedContact(t, "Uma", "Up", "+1 (512)333-0003")
		body := map[string]any{
			"first_name": "Uma", "last_name": "Up", "phone_number": "5123330003",
			"tags": []string{"climbing", "wine"},
		}
		assertStatus(t, do(t, r, "PUT", fmt.Sprintf("/admin/contacts/%d", id), body), 200)
		if got := []string(contactByID(t, id).Tags); !reflect.DeepEqual(got, []string{"climbing", "wine"}) {
			t.Fatalf("after set, tags = %q", got)
		}

		delete(body, "tags")
		body["notes"] = "no tags field in this body"
		assertStatus(t, do(t, r, "PUT", fmt.Sprintf("/admin/contacts/%d", id), body), 200)
		if got := []string(contactByID(t, id).Tags); !reflect.DeepEqual(got, []string{"climbing", "wine"}) {
			t.Errorf("omitting tags changed them to %q", got)
		}

		body["tags"] = []string{}
		assertStatus(t, do(t, r, "PUT", fmt.Sprintf("/admin/contacts/%d", id), body), 200)
		if got := contactByID(t, id).Tags; len(got) != 0 {
			t.Errorf("tags:[] should clear them, got %q", got)
		}
	})

	t.Run("an over-long tag is a 400 and nothing is written", func(t *testing.T) {
		w := do(t, r, "POST", "/admin/contacts", map[string]any{
			"first_name":   "Long",
			"phone_number": "5123330004",
			"tags":         []string{strings.Repeat("a", maxTagLength+1)},
		})
		assertStatus(t, w, 400)
		if !strings.Contains(w.Body.String(), "tag") {
			t.Errorf("400 is not about the tag: %s", w.Body.String())
		}

		var n int
		testDB.QueryRow("SELECT count(*) FROM contacts WHERE phone_number = '+1 (512)333-0004'").Scan(&n)
		if n != 0 {
			t.Errorf("contact was created despite the 400")
		}
	})

	t.Run("a failed create does not leave tags behind", func(t *testing.T) {
		seedContact(t, "Dup", "Phone", "+1 (512)333-0005")
		w := do(t, r, "POST", "/admin/contacts", map[string]any{
			"first_name":   "Dup2",
			"phone_number": "512-333-0005",
			"tags":         []string{"orphan"},
		})
		assertStatus(t, w, 409)
		var n int
		testDB.QueryRow("SELECT count(*) FROM contact_tags WHERE tag = 'orphan'").Scan(&n)
		if n != 0 {
			t.Errorf("found %d orphaned tag rows", n)
		}
	})
}

// ---------------------------------------------------------------------------
// Bulk add invitees
// ---------------------------------------------------------------------------

func TestBulkAddInvitees(t *testing.T) {
	cleanDB(t)
	r := newRouter()

	bulkURL := func(eventID int) string { return fmt.Sprintf("/admin/events/%d/invites/bulk", eventID) }

	inviteeIDs := func(t *testing.T, eventID int) []int {
		t.Helper()
		var ids []int
		if err := testDB.Select(&ids,
			"SELECT contact_id FROM invites WHERE event_id = $1 ORDER BY contact_id", eventID); err != nil {
			t.Fatalf("select invites: %v", err)
		}
		return ids
	}

	t.Run("adds every contact to a draft event without queuing texts", func(t *testing.T) {
		a := seedContact(t, "Ann", "A", "5554440001")
		b := seedContact(t, "Ben", "B", "5554440002")
		eventID := seedEvent(t, "Bulk Draft", futureDate(), "draft")

		w := do(t, r, "POST", bulkURL(eventID), map[string]any{"contact_ids": []int{a, b}})
		assertStatus(t, w, 201)
		var resp struct {
			Added []struct {
				InviteID  string `json:"invite_id"`
				ContactID int    `json:"contact_id"`
			} `json:"added"`
			Skipped int `json:"skipped"`
		}
		mustDecode(t, w, &resp)
		if len(resp.Added) != 2 || resp.Skipped != 0 {
			t.Fatalf("added %d skipped %d, want 2 and 0", len(resp.Added), resp.Skipped)
		}
		for _, a := range resp.Added {
			if a.InviteID == "" {
				t.Error("added entry missing invite_id")
			}
		}
		if got := inviteeIDs(t, eventID); !reflect.DeepEqual(got, []int{a, b}) {
			t.Errorf("invitees = %v, want %v", got, []int{a, b})
		}

		var n int
		testDB.QueryRow("SELECT count(*) FROM texts WHERE event_id = $1", eventID).Scan(&n)
		if n != 0 {
			t.Errorf("draft event queued %d texts, want 0", n)
		}
	})

	t.Run("already-invited and repeated ids are skipped", func(t *testing.T) {
		a := seedContact(t, "Cal", "C", "5554440003")
		b := seedContact(t, "Dee", "D", "5554440004")
		eventID := seedEvent(t, "Bulk Skip", futureDate(), "draft")
		seedInvite(t, eventID, a)

		w := do(t, r, "POST", bulkURL(eventID), map[string]any{"contact_ids": []int{a, b, b}})
		assertStatus(t, w, 201)
		var resp struct {
			Added   []map[string]any `json:"added"`
			Skipped int              `json:"skipped"`
		}
		mustDecode(t, w, &resp)
		if len(resp.Added) != 1 || resp.Skipped != 1 {
			t.Errorf("added %d skipped %d, want 1 and 1", len(resp.Added), resp.Skipped)
		}
		if got := inviteeIDs(t, eventID); !reflect.DeepEqual(got, []int{a, b}) {
			t.Errorf("invitees = %v, want each contact once", got)
		}
	})

	t.Run("launched event queues one invite per new invitee with the given message", func(t *testing.T) {
		a := seedContact(t, "Eve", "E", "5554440005")
		b := seedContact(t, "Fay", "F", "5554440006")
		already := seedContact(t, "Gus", "G", "5554440007")
		eventID := seedEvent(t, "Bulk Live", futureDate(), "launched")
		seedInvite(t, eventID, already)

		w := do(t, r, "POST", bulkURL(eventID), map[string]any{
			"contact_ids":  []int{a, b, already},
			"message":      "Hi {name}, join us",
			"include_link": false,
		})
		assertStatus(t, w, 201)

		var contents []string
		testDB.Select(&contents, "SELECT content FROM texts WHERE event_id = $1 AND status = 'pending' ORDER BY content", eventID)
		want := []string{"Hi Eve, join us", "Hi Fay, join us"}
		if !reflect.DeepEqual(contents, want) {
			t.Errorf("texts = %q, want %q", contents, want)
		}
	})

	t.Run("launched event defaults to the built-in invite with the link", func(t *testing.T) {
		a := seedContact(t, "Hugo", "H", "5554440008")
		eventID := seedEvent(t, "Bulk Default", futureDate(), "launched")

		assertStatus(t, do(t, r, "POST", bulkURL(eventID), map[string]any{"contact_ids": []int{a}}), 201)

		var content, inviteID string
		testDB.QueryRow("SELECT content FROM texts WHERE event_id = $1", eventID).Scan(&content)
		testDB.QueryRow("SELECT id FROM invites WHERE event_id = $1", eventID).Scan(&inviteID)
		if !strings.HasPrefix(content, "Hey Hugo!") || !strings.Contains(content, "Bulk Default") {
			t.Errorf("content = %q, want the default invite", content)
		}
		if !strings.HasSuffix(content, "/invite/"+inviteID) {
			t.Errorf("content = %q, want it to end with the invite link", content)
		}
	})

	t.Run("an unknown contact id is a 400 and adds nobody", func(t *testing.T) {
		a := seedContact(t, "Ida", "I", "5554440009")
		eventID := seedEvent(t, "Bulk Bad", futureDate(), "draft")

		w := do(t, r, "POST", bulkURL(eventID), map[string]any{"contact_ids": []int{a, 999999}})
		assertStatus(t, w, 400)
		if got := inviteeIDs(t, eventID); len(got) != 0 {
			t.Errorf("invitees = %v, want none", got)
		}
	})

	t.Run("empty or missing contact_ids is a 400", func(t *testing.T) {
		eventID := seedEvent(t, "Bulk Empty", futureDate(), "draft")
		assertStatus(t, do(t, r, "POST", bulkURL(eventID), map[string]any{"contact_ids": []int{}}), 400)
		assertStatus(t, do(t, r, "POST", bulkURL(eventID), map[string]any{}), 400)
	})

	t.Run("canceled event is a 409 and missing event a 404", func(t *testing.T) {
		a := seedContact(t, "Jo", "J", "5554440010")
		eventID := seedEvent(t, "Bulk Canceled", futureDate(), "canceled")
		assertStatus(t, do(t, r, "POST", bulkURL(eventID), map[string]any{"contact_ids": []int{a}}), 409)
		assertStatus(t, do(t, r, "POST", bulkURL(99999), map[string]any{"contact_ids": []int{a}}), 404)
	})
}
