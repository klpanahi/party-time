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
	Description       string    `db:"description"      json:"description"`
	Location          string    `db:"location"         json:"location"`
	Plus_Ones_Allowed bool      `db:"plus_ones_allowed" json:"plus_ones_allowed"`
}

type Contact struct {
	ID          int    `db:"id"           json:"id"`
	FirstName   string `db:"first_name"   json:"first_name"`
	LastName    string `db:"last_name"    json:"last_name"`
	PhoneNumber string `db:"phone_number" json:"phone_number"`
}

type InviteWithContact struct {
	ID               string `db:"id"               json:"id"`
	RSVPStatus       string `db:"attending"        json:"rsvp_status"`
	AdditionalGuests int    `db:"additional_guests" json:"additional_guests"`
	EventID          int    `db:"event_id"         json:"event_id"`
	ContactID        int    `db:"contact_id"       json:"contact_id"`
	FirstName        string `db:"first_name"       json:"first_name"`
	LastName         string `db:"last_name"        json:"last_name"`
	PhoneNumber      string `db:"phone_number"     json:"phone_number"`
	InviteURL        string `db:"-"                json:"invite_url"`
}

type EventSummary struct {
	ID           int       `db:"id"            json:"id"`
	Name         string    `db:"name"          json:"name"`
	Date         time.Time `db:"date"          json:"date"`
	TotalInvites int    `db:"total_invites" json:"total_invites"`
	Accepted     int    `db:"accepted"      json:"accepted"`
	Tentative    int    `db:"tentative"     json:"tentative"`
	Declined     int    `db:"declined"      json:"declined"`
	NoResponse   int    `db:"no_response"   json:"no_response"`
}

type EventDetail struct {
	Event    Event               `json:"event"`
	Invitees []InviteWithContact `json:"invitees"`
}

type CreateEventRequest struct {
	Name            string `json:"name"             binding:"required"`
	Date            string `json:"date"             binding:"required"`
	Description     string `json:"description"      binding:"required"`
	Location        string `json:"location"         binding:"required"`
	PlusOnesAllowed bool   `json:"plus_ones_allowed"`
}

type UpdateEventRequest struct {
	Name            string `json:"name"`
	Date            string `json:"date"`
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
	EventDescription string `db:"event_description" json:"event_description"`
	EventLocation    string `db:"event_location"    json:"event_location"`
	PlusOnesAllowed  bool   `db:"plus_ones_allowed" json:"plus_ones_allowed"`
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

type IdRequest struct {
	ID string `json:"id"`
}
