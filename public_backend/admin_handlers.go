package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

func (env *Env) adminGetContacts(c *gin.Context) {
	contacts := []Contact{}
	if err := env.db.Select(&contacts, "SELECT * FROM contacts ORDER BY first_name, last_name"); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, contacts)
}

func (env *Env) adminCreateContact(c *gin.Context) {
	var req struct {
		FirstName   string `json:"first_name"   binding:"required"`
		LastName    string `json:"last_name"`
		PhoneNumber string `json:"phone_number" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var id int
	sql := `INSERT INTO contacts (first_name, last_name, phone_number) VALUES ($1, $2, $3) RETURNING id`
	if err := env.db.QueryRow(sql, req.FirstName, req.LastName, req.PhoneNumber).Scan(&id); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (env *Env) adminUpdateContact(c *gin.Context) {
	id := c.Param("id")

	var req struct {
		FirstName   string `json:"first_name"   binding:"required"`
		LastName    string `json:"last_name"`
		PhoneNumber string `json:"phone_number" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	sql := `UPDATE contacts SET first_name=$1, last_name=$2, phone_number=$3 WHERE id=$4`
	if _, err := env.db.Exec(sql, req.FirstName, req.LastName, req.PhoneNumber, id); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// requireActiveEvent guards the handlers that mutate an event or its audience.
// A canceled or deleted event is a historical record: its details, invitee
// list, and outgoing messages are frozen. Writes the response and reports false
// when the event is missing or no longer active, so callers just return.
func (env *Env) requireActiveEvent(c *gin.Context, eventID string) bool {
	var status string
	if err := env.db.QueryRow("SELECT status FROM events WHERE id = $1", eventID).Scan(&status); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "event not found"})
		return false
	}
	if status == "canceled" || status == "deleted" {
		c.JSON(http.StatusConflict, gin.H{"error": "event is " + status + " and can no longer be modified"})
		return false
	}
	return true
}

func (env *Env) adminGetEvents(c *gin.Context) {
	events := []EventSummary{}
	sql := `
		SELECT
			e.id, e.name, e.date, e.status,
			COUNT(i.id)                                                         AS total_invites,
			SUM(CASE WHEN i.attending = 'Accepted'    THEN 1 ELSE 0 END)       AS accepted,
			SUM(CASE WHEN i.attending = 'Tentative'   THEN 1 ELSE 0 END)       AS tentative,
			SUM(CASE WHEN i.attending = 'Declined'    THEN 1 ELSE 0 END)       AS declined,
			SUM(CASE WHEN i.attending = 'No Response' THEN 1 ELSE 0 END)       AS no_response
		FROM events e
		LEFT JOIN invites i ON i.event_id = e.id
		WHERE e.status != 'deleted'
		GROUP BY e.id
		ORDER BY e.date`
	if err := env.db.Select(&events, sql); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, events)
}

func (env *Env) adminGetEvent(c *gin.Context) {
	id := c.Param("id")

	// Deleted events are hidden here too, not just in the list — a bookmarked
	// /event/:id URL must not resurrect one.
	event := Event{}
	if err := env.db.Get(&event, "SELECT * FROM events WHERE id = $1 AND status != 'deleted'", id); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusNotFound, gin.H{"error": "event not found"})
		return
	}

	invitees := []InviteWithContact{}
	sql := `
		SELECT
			i.id, i.attending, i.additional_guests, i.event_id, i.contact_id,
			c.first_name, c.last_name, c.phone_number, i.opened_at
		FROM invites i
		JOIN contacts c ON c.id = i.contact_id
		WHERE i.event_id = $1
		ORDER BY
			CASE i.attending
				WHEN 'Accepted'    THEN 1
				WHEN 'Tentative'   THEN 2
				WHEN 'No Response' THEN 3
				WHEN 'Declined'    THEN 4
				ELSE 5
			END`
	if err := env.db.Select(&invitees, sql, id); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	for i := range invitees {
		invitees[i].InviteURL = fmt.Sprintf("%s/invite/%s", env.inviteeBase, invitees[i].ID)
	}

	c.JSON(http.StatusOK, EventDetail{Event: event, Invitees: invitees})
}

func (env *Env) adminCreateEvent(c *gin.Context) {
	var req CreateEventRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	date, err := parseCentralTime(req.Date)
	if err != nil {
		// Logged because this also fires when the timezone database is
		// unavailable, which is not a client error.
		fmt.Println("parseCentralTime:", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid date format, expected YYYY-MM-DDTHH:MM"})
		return
	}

	var id int
	sql := `INSERT INTO events (name, date, description, location, plus_ones_allowed)
	        VALUES ($1, $2, $3, $4, $5) RETURNING id`
	if err := env.db.QueryRow(sql, req.Name, date, req.Description, req.Location, req.PlusOnesAllowed).Scan(&id); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (env *Env) adminUpdateEvent(c *gin.Context) {
	id := c.Param("id")
	if !env.requireActiveEvent(c, id) {
		return
	}

	var req UpdateEventRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	date, err := parseCentralTime(req.Date)
	if err != nil {
		// Logged because this also fires when the timezone database is
		// unavailable, which is not a client error.
		fmt.Println("parseCentralTime:", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid date format, expected YYYY-MM-DDTHH:MM"})
		return
	}

	sql := `UPDATE events SET name=$1, date=$2, description=$3, location=$4, plus_ones_allowed=$5 WHERE id=$6`
	if _, err := env.db.Exec(sql, req.Name, date, req.Description, req.Location, req.PlusOnesAllowed, id); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (env *Env) adminAddInvitee(c *gin.Context) {
	eventID := c.Param("id")
	if !env.requireActiveEvent(c, eventID) {
		return
	}

	var req AddInviteeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var contactID int
	if req.ContactID != nil {
		// Use an existing contact directly.
		contactID = *req.ContactID
	} else {
		if req.PhoneNumber == "" || req.FirstName == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "first_name and phone_number are required for new contacts"})
			return
		}
		upsertContact := `
			INSERT INTO contacts (first_name, last_name, phone_number)
			VALUES ($1, $2, $3)
			ON CONFLICT (phone_number) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name
			RETURNING id`
		if err := env.db.QueryRow(upsertContact, req.FirstName, req.LastName, req.PhoneNumber).Scan(&contactID); err != nil {
			fmt.Println(err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	var inviteID string
	insertInvite := `INSERT INTO invites (event_id, contact_id) VALUES ($1, $2) RETURNING id`
	if err := env.db.QueryRow(insertInvite, eventID, contactID).Scan(&inviteID); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// If the event is already launched, immediately queue an invite text for the new invitee.
	var eventStatus string
	if err := env.db.QueryRow("SELECT status FROM events WHERE id = $1", eventID).Scan(&eventStatus); err == nil && eventStatus == "launched" {
		event := Event{}
		if err := env.db.Get(&event, "SELECT * FROM events WHERE id = $1", eventID); err == nil {
			var firstName string
			_ = env.db.QueryRow("SELECT first_name FROM contacts WHERE id = $1", contactID).Scan(&firstName)
			inviteURL := fmt.Sprintf("%s/invite/%s", env.inviteeBase, inviteID)
			loc, _ := time.LoadLocation("America/Chicago")
			formattedDate := event.Date.In(loc).Format("Monday, January 2, 2006 at 3:04 PM")
			content := buildInviteMessage(firstName, event.Event_Name, formattedDate, event.Location, event.Description, inviteURL)
			_, _ = env.db.Exec(
				`INSERT INTO texts (contact_id, content, event_id, status) VALUES ($1, $2, $3, 'pending')`,
				contactID, content, eventID,
			)
		}
	}

	c.JSON(http.StatusCreated, gin.H{"invite_id": inviteID, "contact_id": contactID})
}

func (env *Env) adminSendMessage(c *gin.Context) {
	eventID := c.Param("id")
	if !env.requireActiveEvent(c, eventID) {
		return
	}

	var req SendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Insert the message record.
	var messageID int
	insertMsg := `INSERT INTO messages (content, event_id) VALUES ($1, $2) RETURNING id`
	if err := env.db.QueryRow(insertMsg, req.Content, eventID).Scan(&messageID); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Pre-build per-invitee content so each text includes the recipient's personal RSVP link.
	insertTexts := `
		INSERT INTO texts (contact_id, message_id, event_id, status, content)
		SELECT i.contact_id, $1, $2, 'pending',
		       $3 || E'\n\nManage your RSVP here: ' || $4 || '/invite/' || i.id
		FROM invites i
		WHERE i.event_id = $2 AND i.attending != 'Declined'`
	result, err := env.db.Exec(insertTexts, messageID, eventID, req.Content, env.inviteeBase)
	if err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	count, _ := result.RowsAffected()
	c.JSON(http.StatusCreated, gin.H{"message_id": messageID, "texts_queued": count})
}

func (env *Env) adminLaunchEvent(c *gin.Context) {
	eventID := c.Param("id")

	event := Event{}
	if err := env.db.Get(&event, "SELECT * FROM events WHERE id = $1", eventID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "event not found"})
		return
	}

	if event.Status != "draft" {
		c.JSON(http.StatusConflict, gin.H{"error": "event has already been launched"})
		return
	}

	type launchInvitee struct {
		InviteID  string `db:"invite_id"`
		ContactID int    `db:"contact_id"`
		FirstName string `db:"first_name"`
	}
	rows := []launchInvitee{}
	sel := `
		SELECT i.id AS invite_id, i.contact_id, c.first_name
		FROM invites i JOIN contacts c ON c.id = i.contact_id
		WHERE i.event_id = $1`
	if err := env.db.Select(&rows, sel, eventID); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if len(rows) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot launch an event with no invitees"})
		return
	}

	loc, _ := time.LoadLocation("America/Chicago")
	formattedDate := event.Date.In(loc).Format("Monday, January 2, 2006 at 3:04 PM")

	for _, row := range rows {
		inviteURL := fmt.Sprintf("%s/invite/%s", env.inviteeBase, row.InviteID)
		content := buildInviteMessage(row.FirstName, event.Event_Name, formattedDate, event.Location, event.Description, inviteURL)
		if _, err := env.db.Exec(
			`INSERT INTO texts (contact_id, content, event_id, status) VALUES ($1, $2, $3, 'pending')`,
			row.ContactID, content, eventID,
		); err != nil {
			fmt.Println(err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	if _, err := env.db.Exec("UPDATE events SET status = 'launched' WHERE id = $1", eventID); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "texts_queued": len(rows)})
}

// adminCancelEvent calls off a launched event and notifies its invitees.
//
// The notice body arrives in the request rather than being generated here: the
// admin UI prefills a draft, the admin edits it, and only the approved text is
// ever queued. Everything happens in one transaction so a failure part-way
// cannot leave an event marked canceled with no texts queued, or texts queued
// for an event that is still live.
func (env *Env) adminCancelEvent(c *gin.Context) {
	eventID := c.Param("id")

	var req CancelEventRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	tx, err := env.db.Beginx()
	if err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer tx.Rollback()

	// Lock the row so two concurrent cancels can't both queue a notice.
	var status string
	if err := tx.QueryRow("SELECT status FROM events WHERE id = $1 FOR UPDATE", eventID).Scan(&status); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "event not found"})
		return
	}
	if status != "launched" {
		c.JSON(http.StatusConflict, gin.H{"error": "only a launched event can be canceled"})
		return
	}

	var messageID int
	if err := tx.QueryRow(
		`INSERT INTO messages (content, event_id) VALUES ($1, $2) RETURNING id`,
		req.Content, eventID,
	).Scan(&messageID); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Same audience as adminSendMessage — everyone who hasn't declined. The RSVP
	// link is deliberately omitted: there is nothing left to respond to.
	result, err := tx.Exec(
		`INSERT INTO texts (contact_id, message_id, event_id, status, content)
		 SELECT i.contact_id, $1, $2, 'pending', $3
		 FROM invites i
		 WHERE i.event_id = $2 AND i.attending != 'Declined'`,
		messageID, eventID, req.Content,
	)
	if err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if _, err := tx.Exec(
		"UPDATE events SET status = 'canceled', canceled_at = now() WHERE id = $1", eventID,
	); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if err := tx.Commit(); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	count, _ := result.RowsAffected()
	c.JSON(http.StatusOK, gin.H{"ok": true, "message_id": messageID, "texts_queued": count})
}

// adminDeleteEvent soft-deletes an event. The row and all of its invites,
// messages, and texts stay in the database so a text sent months ago can still
// be traced back to the event and invite it belonged to; the 'deleted' status
// is what hides it from the admin lists and the public invite endpoints.
//
// Only draft and canceled events can be deleted — deleting a launched event
// would strand invitees holding a live link with no notice.
func (env *Env) adminDeleteEvent(c *gin.Context) {
	eventID := c.Param("id")

	var status string
	if err := env.db.QueryRow("SELECT status FROM events WHERE id = $1", eventID).Scan(&status); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "event not found"})
		return
	}
	if status != "draft" && status != "canceled" {
		c.JSON(http.StatusConflict, gin.H{"error": "only draft or canceled events can be deleted"})
		return
	}

	if _, err := env.db.Exec(
		"UPDATE events SET status = 'deleted', deleted_at = now() WHERE id = $1", eventID,
	); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (env *Env) adminGetTexts(c *gin.Context) {
	eventID := c.Param("id")

	texts := []TextWithContact{}
	sql := `
		SELECT
			t.id, t.status, t.created_at,
			COALESCE(t.content, m.content, '') AS content,
			t.error, t.provider_sid, t.sent_at,
			c.first_name, c.last_name, c.phone_number
		FROM texts t
		JOIN contacts c ON c.id = t.contact_id
		LEFT JOIN messages m ON m.id = t.message_id
		WHERE t.event_id = $1
		ORDER BY t.created_at DESC`
	if err := env.db.Select(&texts, sql, eventID); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, texts)
}

// adminResendText requeues a failed text so the background worker retries it.
func (env *Env) adminResendText(c *gin.Context) {
	id := c.Param("id")

	result, err := env.db.Exec(
		`UPDATE texts SET status = 'pending', error = NULL WHERE id = $1 AND status = 'failed'`,
		id,
	)
	if err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if n, _ := result.RowsAffected(); n == 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "text not found or not in a failed state"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// defaultClaimLimit and maxClaimLimit bound how many texts an external sender
// (e.g. the iMessage companion script) can pull per request.
const (
	defaultClaimLimit = 25
	maxClaimLimit     = 100
)

// adminClaimPendingTexts hands a batch of pending texts to an external sender
// running outside this process (currently: a Mac-side script that delivers via
// iMessage instead of Twilio). It reuses the same atomic claim used by the
// background text worker (see processPendingTexts in worker.go) so the two
// senders can never grab the same row: FOR UPDATE SKIP LOCKED flips claimed
// rows from 'pending' to 'sending', and the caller is responsible for
// reporting the outcome back via adminReportTextStatus. Rows left in
// 'sending' by a caller that crashes or never reports are recovered the same
// way as a crashed worker process: adminResendText requeues them, and the
// worker's own startup sweep marks stranded 'sending' rows as failed.
//
// ?peek=true skips the UPDATE and only selects, so a caller can preview the
// queue without claiming anything (used for dry runs).
func (env *Env) adminClaimPendingTexts(c *gin.Context) {
	limit := defaultClaimLimit
	if v := c.Query("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be a positive integer"})
			return
		}
		limit = n
	}
	if limit > maxClaimLimit {
		limit = maxClaimLimit
	}

	texts := []PendingText{}
	if c.Query("peek") == "true" {
		sql := `
			SELECT t.id, COALESCE(t.content, m.content, '') AS content,
				c.phone_number, c.first_name, c.last_name
			FROM texts t
			JOIN contacts c ON c.id = t.contact_id
			LEFT JOIN messages m ON m.id = t.message_id
			WHERE t.status = 'pending'
			ORDER BY t.created_at
			LIMIT $1`
		if err := env.db.Select(&texts, sql, limit); err != nil {
			fmt.Println(err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, texts)
		return
	}

	claimSQL := `
		WITH claimed AS (
			SELECT id, contact_id, message_id FROM texts
			WHERE status = 'pending'
			ORDER BY created_at
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		UPDATE texts t
		SET status = 'sending'
		FROM claimed cl
		JOIN contacts c ON c.id = cl.contact_id
		LEFT JOIN messages m ON m.id = cl.message_id
		WHERE t.id = cl.id
		RETURNING t.id, COALESCE(t.content, m.content, '') AS content,
			c.phone_number, c.first_name, c.last_name`
	if err := env.db.Select(&texts, claimSQL, limit); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, texts)
}

// adminReportTextStatus records the outcome of a text claimed via
// adminClaimPendingTexts. Only rows currently in 'sending' can be reported on
// (mirrors adminResendText's guard against acting on the wrong state).
func (env *Env) adminReportTextStatus(c *gin.Context) {
	id := c.Param("id")

	var req TextStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var result interface {
		RowsAffected() (int64, error)
	}
	var err error

	switch req.Status {
	case "sent":
		result, err = env.db.Exec(
			`UPDATE texts SET status = 'sent', sent_at = now(), provider_sid = $2, error = NULL
			 WHERE id = $1 AND status = 'sending'`,
			id, nullIfEmpty(req.ProviderSid),
		)
	case "failed":
		result, err = env.db.Exec(
			`UPDATE texts SET status = 'failed', error = $2
			 WHERE id = $1 AND status = 'sending'`,
			id, nullIfEmpty(req.Error),
		)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "status must be 'sent' or 'failed'"})
		return
	}

	if err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if n, _ := result.RowsAffected(); n == 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "text not found or not in a sending state"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// validTextStatuses is every state a texts row may sit in. The normal lifecycle
// is pending -> sending -> sent | failed; an admin override can jump to any of
// them (see adminOverrideTextStatus).
var validTextStatuses = map[string]bool{
	"pending": true,
	"sending": true,
	"sent":    true,
	"failed":  true,
}

// adminOverrideTextStatus lets an admin force a text into any status, from any
// status. It exists because the iMessage sender can only observe delivery
// failures it is told about, so a text that silently never arrived still lands
// in 'sent' and adminResendText's failed-only guard leaves it stuck. Setting a
// row back to 'pending' is the per-recipient resend path: the worker and the
// external sender both pick pending rows up on their next claim.
//
// This deliberately has no current-status guard, unlike adminReportTextStatus
// (which is the sender callback and must only act on rows it claimed). Forcing
// a row that a sender currently holds in 'sending' can produce a duplicate
// send; the admin UI confirms before doing that.
func (env *Env) adminOverrideTextStatus(c *gin.Context) {
	id := c.Param("id")

	var req TextStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !validTextStatuses[req.Status] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "status must be 'pending', 'sending', 'sent' or 'failed'"})
		return
	}

	// Each target status also resets the columns that would otherwise describe a
	// delivery attempt that no longer applies, so the row stays self-consistent.
	var result sql.Result
	var err error
	switch req.Status {
	case "pending":
		result, err = env.db.Exec(
			`UPDATE texts SET status = 'pending', error = NULL, sent_at = NULL, provider_sid = NULL
			 WHERE id = $1`, id,
		)
	case "sending":
		result, err = env.db.Exec(
			`UPDATE texts SET status = 'sending', error = NULL WHERE id = $1`, id,
		)
	case "sent":
		result, err = env.db.Exec(
			`UPDATE texts SET status = 'sent', sent_at = now(), error = NULL WHERE id = $1`, id,
		)
	case "failed":
		result, err = env.db.Exec(
			`UPDATE texts SET status = 'failed', error = $2 WHERE id = $1`,
			id, nullIfEmpty(req.Error),
		)
	}

	if err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if n, _ := result.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "text not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// nullIfEmpty lets an empty string bind as SQL NULL instead of "".
func nullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func buildInviteMessage(firstName, eventName, formattedDate, location, description, inviteURL string) string {
	return fmt.Sprintf(
		"Hey %s!\n\nYou're invited to %s on %s at %s.\n\n%s\n\nManage your RSVP here: %s",
		firstName, eventName, formattedDate, location, description, inviteURL,
	)
}
