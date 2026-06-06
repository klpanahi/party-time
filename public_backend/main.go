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
	db          *sqlx.DB
	inviteeBase string
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
	env := &Env{
		db:          db,
		inviteeBase: getenv("INVITEE_BASE_URL", "http://localhost:5174"),
	}

	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:5173", "http://localhost:5174"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	// Public routes — available on both pods.
	router.GET("/invites", env.getInvites)
	router.GET("/invite/:id", env.getInviteByID)
	router.PUT("/invite/:id", env.updateInvite)
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
	data := InvitePageData{}
	sql := `
		SELECT
			i.id, i.attending, i.additional_guests, i.event_id, i.contact_id,
			c.first_name, c.last_name,
			e.name        AS event_name,
			e.date        AS event_date,
			e.description AS event_description,
			e.location    AS event_location,
			e.plus_ones_allowed
		FROM invites i
		JOIN contacts c ON c.id = i.contact_id
		JOIN events   e ON e.id = i.event_id
		WHERE i.id = $1`
	if err := env.db.Get(&data, sql, id); err != nil {
		fmt.Println(err)
		c.JSON(404, gin.H{"error": "invite not found"})
		return
	}
	c.JSON(200, data)
}

func (env *Env) updateInvite(c *gin.Context) {
	id := c.Param("id")
	var req UpdateInviteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	_, err := env.db.Exec(
		"UPDATE invites SET attending=$1, additional_guests=$2 WHERE id=$3",
		req.RSVPStatus, req.AdditionalGuests, id,
	)
	if err != nil {
		fmt.Println(err)
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"ok": true})
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
