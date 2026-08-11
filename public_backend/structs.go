package main

import "time"

type Invite struct {
	ID               string `db:"id"`
	RSVP_Status      string `db:"attending"`
	Additional_Guests int   `db:"additional_guests"`
	Event_ID         string `db:"event_id"`
	Contact_ID       string `db:"contact_id"`
}

type Event struct {
	ID                string    `db:"id"               json:"id"`
	Event_Name        string    `db:"name"             json:"name"`
	Date              time.Time `db:"date"             json:"date"`
	EndTime           time.Time `db:"end_time"         json:"end_time"`
	Description       string    `db:"description"      json:"description"`
	Location          string    `db:"location"         json:"location"`
	Plus_Ones_Allowed bool      `db:"plus_ones_allowed" json:"plus_ones_allowed"`
	Status            string    `db:"status"           json:"status"`
	// Mapped because several handlers load events with SELECT * — sqlx errors
	// on a column with no destination field.
	CanceledAt *time.Time `db:"canceled_at" json:"canceled_at"`
	DeletedAt  *time.Time `db:"deleted_at"  json:"deleted_at"`
}

type Contact struct {
	ID          int    `db:"id"           json:"id"`
	FirstName   string `db:"first_name"   json:"first_name"`
	LastName    string `db:"last_name"    json:"last_name"`
	PhoneNumber string `db:"phone_number" json:"phone_number"`
}

type InviteWithContact struct {
	ID               string     `db:"id"               json:"id"`
	RSVPStatus       string     `db:"attending"        json:"rsvp_status"`
	AdditionalGuests int        `db:"additional_guests" json:"additional_guests"`
	EventID          int        `db:"event_id"         json:"event_id"`
	ContactID        int        `db:"contact_id"       json:"contact_id"`
	FirstName        string     `db:"first_name"       json:"first_name"`
	LastName         string     `db:"last_name"        json:"last_name"`
	PhoneNumber      string     `db:"phone_number"     json:"phone_number"`
	OpenedAt         *time.Time `db:"opened_at"        json:"opened_at"`
	InviteURL        string     `db:"-"                json:"invite_url"`
}

type EventSummary struct {
	ID           int       `db:"id"            json:"id"`
	Name         string    `db:"name"          json:"name"`
	Date         time.Time `db:"date"          json:"date"`
	Status       string    `db:"status"        json:"status"`
	TotalInvites int       `db:"total_invites" json:"total_invites"`
	Accepted     int       `db:"accepted"      json:"accepted"`
	Tentative    int       `db:"tentative"     json:"tentative"`
	Declined     int       `db:"declined"      json:"declined"`
	NoResponse   int       `db:"no_response"   json:"no_response"`
}

type EventDetail struct {
	Event    Event               `json:"event"`
	Invitees []InviteWithContact `json:"invitees"`
}

type CreateEventRequest struct {
	Name            string `json:"name"             binding:"required"`
	Date            string `json:"date"             binding:"required"`
	EndTime         string `json:"end_time"         binding:"required"`
	Description     string `json:"description"      binding:"required"`
	Location        string `json:"location"         binding:"required"`
	PlusOnesAllowed bool   `json:"plus_ones_allowed"`
}

type UpdateEventRequest struct {
	Name            string `json:"name"`
	Date            string `json:"date"`
	EndTime         string `json:"end_time"`
	Description     string `json:"description"`
	Location        string `json:"location"`
	PlusOnesAllowed bool   `json:"plus_ones_allowed"`
}

type AddInviteeRequest struct {
	// Supply either an existing ContactID or the fields for a new contact.
	ContactID   *int   `json:"contact_id"`
	FirstName   string `json:"first_name"`
	LastName    string `json:"last_name"`
	PhoneNumber string `json:"phone_number"`
}

type SendMessageRequest struct {
	Content string `json:"content" binding:"required"`
}

// CancelEventRequest carries the cancellation notice the admin reviewed and
// edited in the UI. It is required rather than server-generated so nothing is
// ever queued to invitees that the admin has not seen.
type CancelEventRequest struct {
	Content string `json:"content" binding:"required"`
}

type InvitePageData struct {
	InviteID         string `db:"id"                json:"invite_id"`
	RSVPStatus       string `db:"attending"         json:"rsvp_status"`
	AdditionalGuests int    `db:"additional_guests" json:"additional_guests"`
	EventID          int    `db:"event_id"          json:"event_id"`
	ContactID        int    `db:"contact_id"        json:"contact_id"`
	FirstName        string `db:"first_name"        json:"first_name"`
	LastName         string `db:"last_name"         json:"last_name"`
	EventName        string `db:"event_name"        json:"event_name"`
	EventDate        time.Time `db:"event_date"      json:"event_date"`
	EventEndTime     time.Time `db:"event_end_time"  json:"event_end_time"`
	EventDescription string `db:"event_description" json:"event_description"`
	EventLocation    string `db:"event_location"    json:"event_location"`
	PlusOnesAllowed  bool   `db:"plus_ones_allowed" json:"plus_ones_allowed"`
	EventStatus      string `db:"event_status"      json:"event_status"`
}

type CoInvitee struct {
	FirstName        string `db:"first_name"        json:"first_name"`
	LastInitial      string `db:"last_initial"      json:"last_initial"`
	RSVPStatus       string `db:"attending"         json:"rsvp_status"`
	AdditionalGuests int    `db:"additional_guests" json:"additional_guests"`
}

type InvitePageResponse struct {
	InvitePageData
	CoInvitees []CoInvitee `json:"co_invitees"`
}

type UpdateInviteRequest struct {
	RSVPStatus       string `json:"rsvp_status"`
	AdditionalGuests int    `json:"additional_guests"`
}

type Message struct {
	ID      int    `db:"id"       json:"id"`
	Content string `db:"content"  json:"content"`
	EventID int    `db:"event_id" json:"event_id"`
}

type TextWithContact struct {
	ID          int        `db:"id"           json:"id"`
	Status      string     `db:"status"       json:"status"`
	CreatedAt   time.Time  `db:"created_at"   json:"created_at"`
	Content     string     `db:"content"      json:"content"`
	Error       *string    `db:"error"        json:"error"`
	ProviderSid *string    `db:"provider_sid" json:"provider_sid"`
	SentAt      *time.Time `db:"sent_at"      json:"sent_at"`
	FirstName   string     `db:"first_name"   json:"first_name"`
	LastName    string     `db:"last_name"    json:"last_name"`
	PhoneNumber string     `db:"phone_number" json:"phone_number"`
}

// PendingText is a queued text handed to an external sender (the iMessage
// companion script). It carries everything needed to deliver the message
// without a second round trip: the body, the recipient's phone, and their name
// for display in the sender's log.
type PendingText struct {
	ID          int    `db:"id"           json:"id"`
	Content     string `db:"content"      json:"content"`
	PhoneNumber string `db:"phone_number" json:"phone_number"`
	FirstName   string `db:"first_name"   json:"first_name"`
	LastName    string `db:"last_name"    json:"last_name"`
}

// TextStatusRequest is an external sender reporting the outcome of a text it
// claimed. Status must be "sent" or "failed"; the other fields are optional
// context recorded on the row.
type TextStatusRequest struct {
	Status      string `json:"status" binding:"required"`
	Error       string `json:"error"`
	ProviderSid string `json:"provider_sid"`
}

type IdRequest struct {
	ID string `json:"id"`
}
