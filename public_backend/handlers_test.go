package main

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

func TestContacts(t *testing.T) {
	cleanDB(t)
	r := newRouter()

	t.Run("empty list initially", func(t *testing.T) {
		w := do(t, r, "GET", "/admin/contacts", nil)
		assertStatus(t, w, 200)
		var list []Contact
		mustDecode(t, w, &list)
		if len(list) != 0 {
			t.Errorf("expected empty list, got %d", len(list))
		}
	})

	t.Run("create contact returns 201 with id", func(t *testing.T) {
		w := do(t, r, "POST", "/admin/contacts", map[string]any{
			"first_name":   "Alice",
			"last_name":    "Smith",
			"phone_number": "5550001111",
		})
		assertStatus(t, w, 201)
		var resp map[string]any
		mustDecode(t, w, &resp)
		if resp["id"] == nil {
			t.Error("expected id in response")
		}
	})

	t.Run("GET returns created contact", func(t *testing.T) {
		w := do(t, r, "GET", "/admin/contacts", nil)
		assertStatus(t, w, 200)
		var list []Contact
		mustDecode(t, w, &list)
		if len(list) != 1 {
			t.Fatalf("expected 1 contact, got %d", len(list))
		}
		if list[0].FirstName != "Alice" || list[0].PhoneNumber != "5550001111" {
			t.Errorf("unexpected contact: %+v", list[0])
		}
	})

	t.Run("update contact", func(t *testing.T) {
		contactID := seedContact(t, "Bob", "Jones", "5550002222")
		w := do(t, r, "PUT", fmt.Sprintf("/admin/contacts/%d", contactID), map[string]any{
			"first_name":   "Robert",
			"last_name":    "Jones",
			"phone_number": "5550002222",
		})
		assertStatus(t, w, 200)

		w = do(t, r, "GET", "/admin/contacts", nil)
		var list []Contact
		mustDecode(t, w, &list)
		var found bool
		for _, c := range list {
			if c.ID == contactID && c.FirstName == "Robert" {
				found = true
			}
		}
		if !found {
			t.Error("updated contact not found or name not changed")
		}
	})

	t.Run("missing phone returns 400", func(t *testing.T) {
		w := do(t, r, "POST", "/admin/contacts", map[string]any{
			"first_name": "NoPhone",
		})
		assertStatus(t, w, 400)
	})
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

func TestEvents(t *testing.T) {
	cleanDB(t)
	r := newRouter()

	t.Run("create event defaults to draft status", func(t *testing.T) {
		w := do(t, r, "POST", "/admin/events", map[string]any{
			"name":             "Summer Party",
			"date":             "2099-07-04T18:00",
			"description":      "Big summer bash",
			"location":         "The Backyard",
			"plus_ones_allowed": true,
		})
		assertStatus(t, w, 201)
		var resp map[string]any
		mustDecode(t, w, &resp)
		if resp["id"] == nil {
			t.Fatal("no id in response")
		}
		eventID := int(resp["id"].(float64))

		// GET the event and verify status is draft.
		w = do(t, r, "GET", fmt.Sprintf("/admin/events/%d", eventID), nil)
		assertStatus(t, w, 200)
		var detail EventDetail
		mustDecode(t, w, &detail)
		if detail.Event.Status != "draft" {
			t.Errorf("status = %q, want %q", detail.Event.Status, "draft")
		}
	})

	t.Run("list events includes status and RSVP counts", func(t *testing.T) {
		contactID := seedContact(t, "Carol", "White", "5550003333")
		eventID := seedEvent(t, "Test Gala", futureDate(), "launched")
		inviteID := seedInvite(t, eventID, contactID)
		_, _ = testDB.Exec(`UPDATE invites SET attending = 'Accepted' WHERE id = $1`, inviteID)

		w := do(t, r, "GET", "/admin/events", nil)
		assertStatus(t, w, 200)
		var list []EventSummary
		mustDecode(t, w, &list)

		var found *EventSummary
		for i := range list {
			if list[i].ID == eventID {
				found = &list[i]
			}
		}
		if found == nil {
			t.Fatal("event not in list")
		}
		if found.Status != "launched" {
			t.Errorf("status = %q, want launched", found.Status)
		}
		if found.Accepted != 1 {
			t.Errorf("accepted = %d, want 1", found.Accepted)
		}
	})

	t.Run("update event fields", func(t *testing.T) {
		eventID := seedEvent(t, "Old Name", futureDate(), "draft")
		w := do(t, r, "PUT", fmt.Sprintf("/admin/events/%d", eventID), map[string]any{
			"name":             "New Name",
			"date":             "2099-08-01T19:00",
			"description":      "Updated",
			"location":         "New Venue",
			"plus_ones_allowed": false,
		})
		assertStatus(t, w, 200)

		w = do(t, r, "GET", fmt.Sprintf("/admin/events/%d", eventID), nil)
		var detail EventDetail
		mustDecode(t, w, &detail)
		if detail.Event.Event_Name != "New Name" {
			t.Errorf("name = %q, want %q", detail.Event.Event_Name, "New Name")
		}
		if detail.Event.Plus_Ones_Allowed {
			t.Error("plus_ones_allowed should be false after update")
		}
	})

	t.Run("create event with date including seconds returns 201", func(t *testing.T) {
		w := do(t, r, "POST", "/admin/events", map[string]any{
			"name":        "Seconds Party",
			"date":        "2099-07-04T18:00:30",
			"description": "Test",
			"location":    "Venue",
		})
		assertStatus(t, w, 201)
	})

	t.Run("update event with date including seconds returns 200", func(t *testing.T) {
		eventID := seedEvent(t, "Seconds Update", futureDate(), "draft")
		w := do(t, r, "PUT", fmt.Sprintf("/admin/events/%d", eventID), map[string]any{
			"name":        "Seconds Update",
			"date":        "2099-09-01T09:30:00",
			"description": "Updated",
			"location":    "New Venue",
		})
		assertStatus(t, w, 200)
	})

	t.Run("invalid date returns 400", func(t *testing.T) {
		w := do(t, r, "POST", "/admin/events", map[string]any{
			"name":        "Bad Date",
			"date":        "not-a-date",
			"description": "x",
			"location":    "y",
		})
		assertStatus(t, w, 400)
	})
}

// ---------------------------------------------------------------------------
// Add Invitee
// ---------------------------------------------------------------------------

func TestAddInvitee(t *testing.T) {
	cleanDB(t)
	r := newRouter()

	t.Run("add existing contact", func(t *testing.T) {
		contactID := seedContact(t, "Dave", "Brown", "5550004444")
		eventID := seedEvent(t, "Draft Party", futureDate(), "draft")

		w := do(t, r, "POST", fmt.Sprintf("/admin/events/%d/invites", eventID),
			map[string]any{"contact_id": contactID})
		assertStatus(t, w, 201)

		w = do(t, r, "GET", fmt.Sprintf("/admin/events/%d", eventID), nil)
		var detail EventDetail
		mustDecode(t, w, &detail)
		if len(detail.Invitees) != 1 {
			t.Fatalf("want 1 invitee, got %d", len(detail.Invitees))
		}
		if detail.Invitees[0].FirstName != "Dave" {
			t.Errorf("invitee name = %q, want Dave", detail.Invitees[0].FirstName)
		}
	})

	t.Run("add new contact creates contact and invite", func(t *testing.T) {
		eventID := seedEvent(t, "New Contact Party", futureDate(), "draft")

		w := do(t, r, "POST", fmt.Sprintf("/admin/events/%d/invites", eventID), map[string]any{
			"first_name":   "Eve",
			"last_name":    "Green",
			"phone_number": "5550005555",
		})
		assertStatus(t, w, 201)

		// Contact should now exist.
		w = do(t, r, "GET", "/admin/contacts", nil)
		var contacts []Contact
		mustDecode(t, w, &contacts)
		var found bool
		for _, c := range contacts {
			if c.PhoneNumber == "5550005555" && c.FirstName == "Eve" {
				found = true
			}
		}
		if !found {
			t.Error("new contact not found after adding invitee")
		}
	})

	t.Run("missing required fields returns 400", func(t *testing.T) {
		eventID := seedEvent(t, "Bad Invite Party", futureDate(), "draft")
		w := do(t, r, "POST", fmt.Sprintf("/admin/events/%d/invites", eventID),
			map[string]any{"last_name": "Orphan"})
		assertStatus(t, w, 400)
	})

	t.Run("adding to launched event auto-queues invite text", func(t *testing.T) {
		contactID := seedContact(t, "Frank", "Black", "5550006666")
		eventID := seedEvent(t, "Live Party", futureDate(), "launched")

		w := do(t, r, "POST", fmt.Sprintf("/admin/events/%d/invites", eventID),
			map[string]any{"contact_id": contactID})
		assertStatus(t, w, 201)

		w = do(t, r, "GET", fmt.Sprintf("/admin/events/%d/texts", eventID), nil)
		assertStatus(t, w, 200)
		var texts []TextWithContact
		mustDecode(t, w, &texts)
		if len(texts) != 1 {
			t.Fatalf("want 1 text queued, got %d", len(texts))
		}
		if texts[0].Status != "pending" {
			t.Errorf("text status = %q, want pending", texts[0].Status)
		}
		if !strings.Contains(texts[0].Content, "Frank") {
			t.Errorf("message content missing first name; got: %s", texts[0].Content)
		}
	})
}

// ---------------------------------------------------------------------------
// Launch Event
// ---------------------------------------------------------------------------

func TestLaunchEvent(t *testing.T) {
	cleanDB(t)
	r := newRouter()

	t.Run("launch creates pending texts for all invitees", func(t *testing.T) {
		c1 := seedContact(t, "Grace", "Hill", "5550007777")
		c2 := seedContact(t, "Hank", "Vance", "5550008888")
		eventID := seedEvent(t, "Launch Test", futureDate(), "draft")
		seedInvite(t, eventID, c1)
		seedInvite(t, eventID, c2)

		w := do(t, r, "POST", fmt.Sprintf("/admin/events/%d/launch", eventID), nil)
		assertStatus(t, w, 200)

		var resp map[string]any
		w = do(t, r, "POST", fmt.Sprintf("/admin/events/%d/launch", eventID), nil)
		_ = resp // just checking the conflict below

		// Event status should now be launched.
		w = do(t, r, "GET", fmt.Sprintf("/admin/events/%d", eventID), nil)
		var detail EventDetail
		mustDecode(t, w, &detail)
		if detail.Event.Status != "launched" {
			t.Errorf("event status = %q after launch, want launched", detail.Event.Status)
		}

		// Two texts should be queued.
		w = do(t, r, "GET", fmt.Sprintf("/admin/events/%d/texts", eventID), nil)
		var texts []TextWithContact
		mustDecode(t, w, &texts)
		if len(texts) != 2 {
			t.Fatalf("want 2 texts, got %d", len(texts))
		}
		for _, tx := range texts {
			if tx.Status != "pending" {
				t.Errorf("text %d status = %q, want pending", tx.ID, tx.Status)
			}
		}
	})

	t.Run("invite message contains all required content", func(t *testing.T) {
		contactID := seedContact(t, "Ivy", "Lane", "5550009999")
		eventID := seedEvent(t, "Content Check Party", futureDate(), "draft")
		seedInvite(t, eventID, contactID)

		w := do(t, r, "POST", fmt.Sprintf("/admin/events/%d/launch", eventID), nil)
		assertStatus(t, w, 200)

		w = do(t, r, "GET", fmt.Sprintf("/admin/events/%d/texts", eventID), nil)
		var texts []TextWithContact
		mustDecode(t, w, &texts)
		if len(texts) != 1 {
			t.Fatalf("want 1 text, got %d", len(texts))
		}
		msg := texts[0].Content
		for _, want := range []string{
			"Hey Ivy!",
			"Content Check Party",
			"Test venue",
			"Test description",
			"Manage your RSVP here:",
			"http://test.local/invite/",
		} {
			if !strings.Contains(msg, want) {
				t.Errorf("message missing %q\nfull message:\n%s", want, msg)
			}
		}
	})

	t.Run("re-launching an already launched event returns 409", func(t *testing.T) {
		contactID := seedContact(t, "Jack", "Pine", "5551110000")
		eventID := seedEvent(t, "Already Live", futureDate(), "launched")
		seedInvite(t, eventID, contactID)

		w := do(t, r, "POST", fmt.Sprintf("/admin/events/%d/launch", eventID), nil)
		assertStatus(t, w, 409)
	})

	t.Run("launching event with no invitees returns 400", func(t *testing.T) {
		eventID := seedEvent(t, "Empty Event", futureDate(), "draft")
		w := do(t, r, "POST", fmt.Sprintf("/admin/events/%d/launch", eventID), nil)
		assertStatus(t, w, 400)
	})

	t.Run("launching nonexistent event returns 404", func(t *testing.T) {
		w := do(t, r, "POST", "/admin/events/99999/launch", nil)
		assertStatus(t, w, 404)
	})
}

// ---------------------------------------------------------------------------
// Invitee ordering in event detail
// ---------------------------------------------------------------------------

func TestInviteeOrdering(t *testing.T) {
	cleanDB(t)
	r := newRouter()

	c1 := seedContact(t, "Accepted", "A", "5551111001")
	c2 := seedContact(t, "Declined", "D", "5551111002")
	c3 := seedContact(t, "NoResp", "N", "5551111003")
	c4 := seedContact(t, "Tentative", "T", "5551111004")
	eventID := seedEvent(t, "Ordering Test", futureDate(), "draft")

	i1 := seedInvite(t, eventID, c1)
	i2 := seedInvite(t, eventID, c2)
	i3 := seedInvite(t, eventID, c3)
	i4 := seedInvite(t, eventID, c4)
	_, _ = testDB.Exec(`UPDATE invites SET attending = 'Accepted'  WHERE id = $1`, i1)
	_, _ = testDB.Exec(`UPDATE invites SET attending = 'Declined'  WHERE id = $1`, i2)
	_, _ = testDB.Exec(`UPDATE invites SET attending = 'No Response' WHERE id = $1`, i3)
	_, _ = testDB.Exec(`UPDATE invites SET attending = 'Tentative' WHERE id = $1`, i4)

	w := do(t, r, "GET", fmt.Sprintf("/admin/events/%d", eventID), nil)
	assertStatus(t, w, 200)
	var detail EventDetail
	mustDecode(t, w, &detail)

	want := []string{"Accepted", "Tentative", "NoResp", "Declined"}
	for i, inv := range detail.Invitees {
		if inv.FirstName != want[i] {
			t.Errorf("invitee[%d] = %q, want %q", i, inv.FirstName, want[i])
		}
	}
}

// ---------------------------------------------------------------------------
// Send Message
// ---------------------------------------------------------------------------

func TestSendMessage(t *testing.T) {
	cleanDB(t)
	r := newRouter()

	t.Run("creates texts for non-declined invitees only", func(t *testing.T) {
		c1 := seedContact(t, "Accept", "One", "5552220001")
		c2 := seedContact(t, "Declined", "Two", "5552220002")
		c3 := seedContact(t, "Maybe", "Three", "5552220003")
		eventID := seedEvent(t, "Msg Test Event", futureDate(), "launched")

		i1 := seedInvite(t, eventID, c1)
		i2 := seedInvite(t, eventID, c2)
		i3 := seedInvite(t, eventID, c3)
		_, _ = testDB.Exec(`UPDATE invites SET attending = 'Accepted'  WHERE id = $1`, i1)
		_, _ = testDB.Exec(`UPDATE invites SET attending = 'Declined'  WHERE id = $1`, i2)
		_, _ = testDB.Exec(`UPDATE invites SET attending = 'Tentative' WHERE id = $1`, i3)

		w := do(t, r, "POST", fmt.Sprintf("/admin/events/%d/messages", eventID),
			map[string]any{"content": "Party reminder!"})
		assertStatus(t, w, 201)
		var resp map[string]any
		mustDecode(t, w, &resp)
		if int(resp["texts_queued"].(float64)) != 2 {
			t.Errorf("texts_queued = %v, want 2", resp["texts_queued"])
		}
	})

	t.Run("text content includes message body and per-invitee RSVP link", func(t *testing.T) {
		contactID := seedContact(t, "Rosa", "Blue", "5552220004")
		eventID := seedEvent(t, "Link Check Event", futureDate(), "launched")
		inviteID := seedInvite(t, eventID, contactID)

		w := do(t, r, "POST", fmt.Sprintf("/admin/events/%d/messages", eventID),
			map[string]any{"content": "Come celebrate!"})
		assertStatus(t, w, 201)

		w = do(t, r, "GET", fmt.Sprintf("/admin/events/%d/texts", eventID), nil)
		var texts []TextWithContact
		mustDecode(t, w, &texts)
		if len(texts) != 1 {
			t.Fatalf("want 1 text, got %d", len(texts))
		}
		msg := texts[0].Content
		for _, want := range []string{
			"Come celebrate!",
			"Manage your RSVP here:",
			"http://test.local/invite/" + inviteID,
		} {
			if !strings.Contains(msg, want) {
				t.Errorf("message missing %q\nfull message:\n%s", want, msg)
			}
		}
	})

	t.Run("missing content returns 400", func(t *testing.T) {
		eventID := seedEvent(t, "Bad Msg Event", futureDate(), "launched")
		w := do(t, r, "POST", fmt.Sprintf("/admin/events/%d/messages", eventID),
			map[string]any{})
		assertStatus(t, w, 400)
	})
}

// ---------------------------------------------------------------------------
// Get Texts
// ---------------------------------------------------------------------------

func TestGetTexts(t *testing.T) {
	cleanDB(t)
	r := newRouter()

	t.Run("returns empty list before launch", func(t *testing.T) {
		eventID := seedEvent(t, "No Texts Yet", futureDate(), "draft")
		w := do(t, r, "GET", fmt.Sprintf("/admin/events/%d/texts", eventID), nil)
		assertStatus(t, w, 200)
		var texts []TextWithContact
		mustDecode(t, w, &texts)
		if len(texts) != 0 {
			t.Errorf("want empty, got %d texts", len(texts))
		}
	})

	t.Run("includes contact name and created_at after launch", func(t *testing.T) {
		contactID := seedContact(t, "Karen", "Reed", "5553330001")
		eventID := seedEvent(t, "Texts Event", futureDate(), "draft")
		seedInvite(t, eventID, contactID)

		do(t, r, "POST", fmt.Sprintf("/admin/events/%d/launch", eventID), nil)

		w := do(t, r, "GET", fmt.Sprintf("/admin/events/%d/texts", eventID), nil)
		var texts []TextWithContact
		mustDecode(t, w, &texts)
		if len(texts) != 1 {
			t.Fatalf("want 1 text, got %d", len(texts))
		}
		tx := texts[0]
		if tx.FirstName != "Karen" {
			t.Errorf("first_name = %q, want Karen", tx.FirstName)
		}
		if tx.Status != "pending" {
			t.Errorf("status = %q, want pending", tx.Status)
		}
		if tx.CreatedAt.IsZero() {
			t.Error("created_at is zero")
		}
		if tx.Content == "" {
			t.Error("content is empty")
		}
	})
}

// ---------------------------------------------------------------------------
// Public: Get Invite
// ---------------------------------------------------------------------------

func TestGetInvite(t *testing.T) {
	cleanDB(t)
	r := newRouter()

	t.Run("returns invite data with event and contact info", func(t *testing.T) {
		contactID := seedContact(t, "Leo", "Fox", "5554440001")
		eventID := seedEvent(t, "Leo's Party", futureDate(), "launched")
		inviteID := seedInvite(t, eventID, contactID)

		w := do(t, r, "GET", "/invite/"+inviteID, nil)
		assertStatus(t, w, 200)
		var resp InvitePageResponse
		mustDecode(t, w, &resp)
		if resp.FirstName != "Leo" {
			t.Errorf("first_name = %q, want Leo", resp.FirstName)
		}
		if resp.EventName != "Leo's Party" {
			t.Errorf("event_name = %q, want Leo's Party", resp.EventName)
		}
	})

	t.Run("stamps opened_at on first GET", func(t *testing.T) {
		contactID := seedContact(t, "Mia", "Stone", "5554440002")
		eventID := seedEvent(t, "Mia's Party", futureDate(), "launched")
		inviteID := seedInvite(t, eventID, contactID)

		// Confirm opened_at is null before any GET.
		var openedAt *time.Time
		testDB.QueryRow(`SELECT opened_at FROM invites WHERE id = $1`, inviteID).Scan(&openedAt)
		if openedAt != nil {
			t.Fatal("opened_at should be null before first GET")
		}

		do(t, r, "GET", "/invite/"+inviteID, nil)

		testDB.QueryRow(`SELECT opened_at FROM invites WHERE id = $1`, inviteID).Scan(&openedAt)
		if openedAt == nil {
			t.Error("opened_at should be set after first GET")
		}
	})

	t.Run("does not overwrite opened_at on subsequent GETs", func(t *testing.T) {
		contactID := seedContact(t, "Ned", "Park", "5554440003")
		eventID := seedEvent(t, "Ned's Party", futureDate(), "launched")
		inviteID := seedInvite(t, eventID, contactID)

		do(t, r, "GET", "/invite/"+inviteID, nil)

		var firstOpen time.Time
		testDB.QueryRow(`SELECT opened_at FROM invites WHERE id = $1`, inviteID).Scan(&firstOpen)

		// Small sleep to ensure clock would differ if re-stamped.
		time.Sleep(10 * time.Millisecond)
		do(t, r, "GET", "/invite/"+inviteID, nil)

		var secondOpen time.Time
		testDB.QueryRow(`SELECT opened_at FROM invites WHERE id = $1`, inviteID).Scan(&secondOpen)

		if !firstOpen.Equal(secondOpen) {
			t.Error("opened_at was overwritten on second GET")
		}
	})

	t.Run("co-invitees exclude the requesting invitee", func(t *testing.T) {
		c1 := seedContact(t, "Olivia", "May", "5554440004")
		c2 := seedContact(t, "Peter", "Kay", "5554440005")
		eventID := seedEvent(t, "Group Party", futureDate(), "launched")
		i1 := seedInvite(t, eventID, c1)
		seedInvite(t, eventID, c2)

		w := do(t, r, "GET", "/invite/"+i1, nil)
		var resp InvitePageResponse
		mustDecode(t, w, &resp)

		if len(resp.CoInvitees) != 1 {
			t.Fatalf("want 1 co-invitee, got %d", len(resp.CoInvitees))
		}
		if resp.CoInvitees[0].FirstName != "Peter" {
			t.Errorf("co-invitee = %q, want Peter", resp.CoInvitees[0].FirstName)
		}
	})

	t.Run("unknown invite ID returns 404", func(t *testing.T) {
		w := do(t, r, "GET", "/invite/00000000-0000-0000-0000-000000000000", nil)
		assertStatus(t, w, 404)
	})
}

// ---------------------------------------------------------------------------
// Public: Get All Invites
// ---------------------------------------------------------------------------

func TestGetInvites(t *testing.T) {
	cleanDB(t)
	r := newRouter()

	t.Run("returns empty list when no invites exist", func(t *testing.T) {
		w := do(t, r, "GET", "/invites", nil)
		assertStatus(t, w, 200)
		var list []Invite
		mustDecode(t, w, &list)
		if len(list) != 0 {
			t.Errorf("want 0 invites, got %d", len(list))
		}
	})

	t.Run("returns all invites after seeding", func(t *testing.T) {
		contactID := seedContact(t, "Tom", "Baker", "5559990001")
		eventID := seedEvent(t, "Tom's Event", futureDate(), "launched")
		seedInvite(t, eventID, contactID)

		w := do(t, r, "GET", "/invites", nil)
		assertStatus(t, w, 200)
		var list []Invite
		mustDecode(t, w, &list)
		if len(list) != 1 {
			t.Errorf("want 1 invite, got %d", len(list))
		}
	})
}

// ---------------------------------------------------------------------------
// Public: Get Event By ID
// ---------------------------------------------------------------------------

func TestGetEventByID(t *testing.T) {
	cleanDB(t)
	r := newRouter()

	t.Run("returns event details", func(t *testing.T) {
		eventID := seedEvent(t, "Public Bash", futureDate(), "launched")

		w := do(t, r, "GET", fmt.Sprintf("/event/%d", eventID), nil)
		assertStatus(t, w, 200)
		var event Event
		mustDecode(t, w, &event)
		if event.Event_Name != "Public Bash" {
			t.Errorf("name = %q, want Public Bash", event.Event_Name)
		}
		if event.Status != "launched" {
			t.Errorf("status = %q, want launched", event.Status)
		}
	})
}

// ---------------------------------------------------------------------------
// Admin handler edge cases
// ---------------------------------------------------------------------------

func TestAdminEdgeCases(t *testing.T) {
	cleanDB(t)
	r := newRouter()

	t.Run("update contact missing required fields returns 400", func(t *testing.T) {
		contactID := seedContact(t, "Edge", "Case", "5559990002")
		w := do(t, r, "PUT", fmt.Sprintf("/admin/contacts/%d", contactID),
			map[string]any{"last_name": "OnlyLastName"})
		assertStatus(t, w, 400)
	})

	t.Run("update event with invalid date returns 400", func(t *testing.T) {
		eventID := seedEvent(t, "Date Edge", futureDate(), "draft")
		w := do(t, r, "PUT", fmt.Sprintf("/admin/events/%d", eventID), map[string]any{
			"name":        "Updated",
			"date":        "not-a-date",
			"description": "x",
			"location":    "y",
		})
		assertStatus(t, w, 400)
	})

	t.Run("get nonexistent admin event returns 404", func(t *testing.T) {
		w := do(t, r, "GET", "/admin/events/99999", nil)
		assertStatus(t, w, 404)
	})

	t.Run("update invite with no body returns 400", func(t *testing.T) {
		contactID := seedContact(t, "Upd", "Test", "5559990003")
		eventID := seedEvent(t, "Upd Event", futureDate(), "launched")
		inviteID := seedInvite(t, eventID, contactID)
		w := do(t, r, "PUT", "/invite/"+inviteID, nil)
		assertStatus(t, w, 400)
	})
}

// ---------------------------------------------------------------------------
// Public: Update Invite
// ---------------------------------------------------------------------------

func TestUpdateInvite(t *testing.T) {
	cleanDB(t)
	r := newRouter()

	t.Run("updates RSVP status and guest count", func(t *testing.T) {
		contactID := seedContact(t, "Quinn", "Rose", "5555550001")
		eventID := seedEvent(t, "RSVP Party", futureDate(), "launched")
		inviteID := seedInvite(t, eventID, contactID)

		w := do(t, r, "PUT", "/invite/"+inviteID, map[string]any{
			"rsvp_status":       "Accepted",
			"additional_guests": 2,
		})
		assertStatus(t, w, 200)

		// Verify in DB.
		var attending string
		var guests int
		testDB.QueryRow(`SELECT attending, additional_guests FROM invites WHERE id = $1`, inviteID).
			Scan(&attending, &guests)
		if attending != "Accepted" {
			t.Errorf("attending = %q, want Accepted", attending)
		}
		if guests != 2 {
			t.Errorf("additional_guests = %d, want 2", guests)
		}
	})

	t.Run("co-invitees reflect updated RSVP", func(t *testing.T) {
		c1 := seedContact(t, "Rachel", "Kim", "5555550002")
		c2 := seedContact(t, "Sam", "Lee", "5555550003")
		eventID := seedEvent(t, "RSVP Check Party", futureDate(), "launched")
		i1 := seedInvite(t, eventID, c1)
		i2 := seedInvite(t, eventID, c2)

		do(t, r, "PUT", "/invite/"+i2, map[string]any{
			"rsvp_status":       "Accepted",
			"additional_guests": 1,
		})

		w := do(t, r, "GET", "/invite/"+i1, nil)
		var resp InvitePageResponse
		mustDecode(t, w, &resp)

		if len(resp.CoInvitees) != 1 {
			t.Fatalf("want 1 co-invitee, got %d", len(resp.CoInvitees))
		}
		co := resp.CoInvitees[0]
		if co.RSVPStatus != "Accepted" {
			t.Errorf("co-invitee rsvp = %q, want Accepted", co.RSVPStatus)
		}
		if co.AdditionalGuests != 1 {
			t.Errorf("co-invitee guests = %d, want 1", co.AdditionalGuests)
		}
	})
}
