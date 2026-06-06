package main

import (
	"fmt"
	"net/http"

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

func (env *Env) adminGetEvents(c *gin.Context) {
	events := []EventSummary{}
	sql := `
		SELECT
			e.id, e.name, e.date,
			COUNT(i.id)                                                         AS total_invites,
			SUM(CASE WHEN i.attending = 'Accepted'    THEN 1 ELSE 0 END)       AS accepted,
			SUM(CASE WHEN i.attending = 'Tentative'   THEN 1 ELSE 0 END)       AS tentative,
			SUM(CASE WHEN i.attending = 'Declined'    THEN 1 ELSE 0 END)       AS declined,
			SUM(CASE WHEN i.attending = 'No Response' THEN 1 ELSE 0 END)       AS no_response
		FROM events e
		LEFT JOIN invites i ON i.event_id = e.id
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

	event := Event{}
	if err := env.db.Get(&event, "SELECT * FROM events WHERE id = $1", id); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusNotFound, gin.H{"error": "event not found"})
		return
	}

	invitees := []InviteWithContact{}
	sql := `
		SELECT
			i.id, i.attending, i.additional_guests, i.event_id, i.contact_id,
			c.first_name, c.last_name, c.phone_number
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

	var req UpdateEventRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	date, err := parseCentralTime(req.Date)
	if err != nil {
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

	c.JSON(http.StatusCreated, gin.H{"invite_id": inviteID, "contact_id": contactID})
}

func (env *Env) adminSendMessage(c *gin.Context) {
	eventID := c.Param("id")

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

	// Create pending texts for all non-declined invitees.
	insertTexts := `
		INSERT INTO texts (contact_id, message_id, status)
		SELECT i.contact_id, $1, 'pending'
		FROM invites i
		WHERE i.event_id = $2 AND i.attending != 'Declined'`
	result, err := env.db.Exec(insertTexts, messageID, eventID)
	if err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	count, _ := result.RowsAffected()
	c.JSON(http.StatusCreated, gin.H{"message_id": messageID, "texts_queued": count})
}
