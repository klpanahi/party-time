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

// parseCentralTime parses a datetime-local string ("2006-01-02T15:04") as
// America/Chicago time and returns a time.Time suitable for TIMESTAMPTZ storage.
func parseCentralTime(s string) (time.Time, error) {
	loc, err := time.LoadLocation("America/Chicago")
	if err != nil {
		return time.Time{}, err
	}
	return time.ParseInLocation("2006-01-02T15:04", s, loc)
}

func loaddbconfig() string {
	user := getenv("DBUSER", "myuser")
	password := getenv("DBPASS", "mypassword")
	host := getenv("DBHOST", "127.0.0.1")
	port := getenv("DBPORT", "5432")
	dbname := "party_time"

	psqlInfo := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable", host, port, user, password, dbname)
	fmt.Println(psqlInfo)
	return psqlInfo
}
