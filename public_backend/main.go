package main

import (
	"database/sql"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
)

type Env struct {
	db *sql.DB
}

func main() {
	router := gin.Default()
	adminEnabled := getenv("ADMIN_ENABLED", "false")
	dbgcfg := loaddbconfig()
	db, err := sql.Open("postgres", dbgcfg)
	if err != nil {
		fmt.Println("Error!")
		print(err)
		panic(err)
	}
	defer db.Close()
	err = db.Ping()
	if err != nil {
		panic(err)
	}
	env := &Env{db: db}

	router.GET("/invites", env.getInvites)

	if adminEnabled == "true" {
		fmt.Println("Admin Portal enabled for this runtime, exposing admin endponts...")
		router.POST("/invites", postInvites)
		router.Run("localhost:8080")
	}
}

func (env *Env) getInvites(c *gin.Context) {
	sql := "select * from invites;"
	selectstatement(env.db, sql)
	c.IndentedJSON(http.StatusOK, invites)
}

type invite struct {
	Party_ID          string `json:"party_id"`
	Invitee           string `json:"invitee"`
	Plus_ones_allowed bool   `json:"plus_ones_allowed"`
	Party_date        string `json:"party_date"`
}

var invites = []invite{
	{Party_ID: "XYZ", Invitee: "Kevin", Plus_ones_allowed: true, Party_date: "March 7th"},
}

func postInvites(c *gin.Context) {
	var newInvite invite

	// Call BindJSON to bind the received JSON to
	// newInvite.
	if err := c.BindJSON(&newInvite); err != nil {
		return
	}

	// Add the new invite to the slice.
	invites = append(invites, newInvite)
	c.IndentedJSON(http.StatusCreated, newInvite)
}

// curl http://localhost:8080/invites \
// --include \
// --header "Content-Type: application/json" \
// --request "POST" \
// --data '{"party_id": "ABC", "invitee": "Kevin", "plus_ones_allowed": true, "party_date": "March 8th"}'
