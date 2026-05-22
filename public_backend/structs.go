package main

type Invite struct {
	ID                string `db:"id"`
	RSVP_Status       string `db:"attending"`
	Additional_Guests int    `db:"additional_guests"`
	Event_ID          string `db:"event_id"`
	Contact_ID        string `db:"contact_id"`
}

type Event struct {
	ID                string `db:"id"`
	Event_Name        string `db:"name"`
	Date              string `db:"date"`
	Description       string `db:"description"`
	Location          string `db:"location"`
	Plus_Ones_Allowed bool   `db:"plus_ones_allowed"`
}

type IdRequest struct {
	ID string `json:"id"`
}
