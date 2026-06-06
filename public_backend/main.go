package main

import (
	"fmt"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
)

type Env struct {
	db *sqlx.DB
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

	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:5173"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	// Public routes — available on both pods.
	router.GET("/invites", env.getInvites)
	router.GET("/invite/:id", env.getInviteByID)
	router.GET("/event/:id", env.getEventByID)

	if adminEnabled == "true" {
		fmt.Println("Admin Portal enabled for this runtime, exposing admin endpoints...")
		admin := router.Group("/admin")
		admin.GET("/contacts", env.adminGetContacts)
		admin.POST("/contacts", env.adminCreateContact)
		admin.PUT("/contacts/:id", env.adminUpdateContact)
		admin.GET("/events", env.adminGetEvents)
		admin.POST("/events", env.adminCreateEvent)
		admin.GET("/events/:id", env.adminGetEvent)
		admin.PUT("/events/:id", env.adminUpdateEvent)
		admin.POST("/events/:id/invites", env.adminAddInvitee)
		admin.POST("/events/:id/messages", env.adminSendMessage)
	}

	router.Run(":8080")
}

func (env *Env) getInvites(c *gin.Context) {
	invites := []Invite{}
	sql := "SELECT * FROM invites"
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
	err := env.db.Get(&invite, "SELECT * FROM invites WHERE id = $1", id)
	if err != nil {
		fmt.Println(err)
	}
	c.IndentedJSON(200, invite)
}

func (env *Env) getEventByID(c *gin.Context) {
	id := c.Param("id")
	event := Event{}
	err := env.db.Get(&event, "SELECT * FROM events WHERE id = $1", id)
	if err != nil {
		fmt.Println(err)
	}
	c.IndentedJSON(200, event)
}
