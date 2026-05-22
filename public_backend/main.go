package main

import (
	"fmt"

	"github.com/jmoiron/sqlx"

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
)

type Env struct {
	db *sqlx.DB // Change this to sqlx.DB
}

func main() {
	router := gin.Default()
	adminEnabled := getenv("ADMIN_ENABLED", "false")
	dbgcfg := loaddbconfig()
	db, err := sqlx.Connect("postgres", dbgcfg)
	if err != nil {
		fmt.Println("Error!")
		panic(err)
	}
	env := &Env{db: db}
	router.GET("/invites", env.getInvites)
	router.GET("/invite/:id", env.getInviteByID)
	router.GET("/event/:id", env.getEventByID)

	if adminEnabled == "true" {
		fmt.Println("Admin Portal enabled for this runtime, exposing admin endponts...")
		// router.POST("/invites", postInvites)
		router.Run("localhost:8080")
	}
}

func (env *Env) getInvites(c *gin.Context) {
	invites := []Invite{}
	sql := "select * from invites;"
	err := env.db.Select(&invites, sql)
	if err != nil {
		fmt.Println(err)
	}
	fmt.Printf("Found %d invites\n", len(invites))
	c.IndentedJSON(200, invites)
}

func (env *Env) getInviteByID(c *gin.Context) {
	id := c.Param("id")

	invite := Invite{}
	sql := fmt.Sprintf("select * from invites where id='%s'", id)
	err := env.db.Get(&invite, sql)
	if err != nil {
		fmt.Println(err)
	}

	c.IndentedJSON(200, invite)
}

func (env *Env) getEventByID(c *gin.Context) {
	id := c.Param("id")

	event := Event{}
	sql := fmt.Sprintf("select * from events where id='%s'", id)
	err := env.db.Get(&event, sql)
	if err != nil {
		fmt.Println(err)
	}

	c.IndentedJSON(200, event)
}
