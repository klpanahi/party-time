package main

import (
	"fmt"
	"os"
)

func getenv(key, fallback string) string {
	value := os.Getenv(key)
	if len(value) == 0 {
		return fallback
	}
	return value
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
