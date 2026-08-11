package main

import (
	"fmt"
	"os"
	"time"
)

func getenv(key, fallback string) string {
	value := os.Getenv(key)
	if len(value) == 0 {
		return fallback
	}
	return value
}

// parseCentralTime parses a datetime-local string as America/Chicago time.
// Accepts both "YYYY-MM-DDTHH:MM" and "YYYY-MM-DDTHH:MM:SS" (some browsers include seconds).
func parseCentralTime(s string) (time.Time, error) {
	loc, err := time.LoadLocation("America/Chicago")
	if err != nil {
		return time.Time{}, err
	}
	if t, err := time.ParseInLocation("2006-01-02T15:04", s, loc); err == nil {
		return t, nil
	}
	return time.ParseInLocation("2006-01-02T15:04:05", s, loc)
}

// parseEventWindow parses an event's start and end datetime-local strings and
// checks that the event does not end before it starts. The returned errors are
// safe to hand straight to the client. Parse failures are logged as well as
// returned, because parseCentralTime also fails when the timezone database is
// unavailable, which is not a client error.
func parseEventWindow(dateStr, endStr string) (time.Time, time.Time, error) {
	date, err := parseCentralTime(dateStr)
	if err != nil {
		fmt.Println("parseCentralTime:", err)
		return time.Time{}, time.Time{}, fmt.Errorf("invalid date format, expected YYYY-MM-DDTHH:MM")
	}

	endTime, err := parseCentralTime(endStr)
	if err != nil {
		fmt.Println("parseCentralTime:", err)
		return time.Time{}, time.Time{}, fmt.Errorf("invalid end_time format, expected YYYY-MM-DDTHH:MM")
	}

	if !endTime.After(date) {
		return time.Time{}, time.Time{}, fmt.Errorf("end_time must be after date")
	}

	return date, endTime, nil
}

func loaddbconfig() string {
	user := getenv("DBUSER", "myuser")
	password := getenv("DBPASS", "mypassword")
	host := getenv("DBHOST", "127.0.0.1")
	port := getenv("DBPORT", "5432")
	dbname := "party_time"

	psqlInfo := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable search_path=party_time", host, port, user, password, dbname)
	fmt.Println(psqlInfo)
	return psqlInfo
}
