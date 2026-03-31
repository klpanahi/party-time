package main

import (
	"database/sql"
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
	port := 5432
	dbname := "party_time"

	psqlInfo := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=disable", host, port, user, password, dbname)
	fmt.Println(psqlInfo)
	return psqlInfo
}

func selectstatement(db *sql.DB, sqlstatement string) (string, error) {

	fmt.Println("Running select statement")
	rows, err := db.Query(sqlstatement)
	if err != nil {
		fmt.Println(err)
		return "", err
	}
	defer rows.Close()
	fmt.Println(rows)
	return "rows", nil
}
