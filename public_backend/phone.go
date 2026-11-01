package main

import (
	"errors"

	"github.com/lib/pq"
)

// errDuplicatePhone is the 409 body when a normalized number already belongs to
// another contact (contacts_unique). Two contacts typed as "(512) 350-0064" and
// "5123500064" used to be stored separately; once normalized they collide.
const errDuplicatePhone = "another contact already has this phone number"

// isUniqueViolation reports whether err is a Postgres unique-constraint error.
func isUniqueViolation(err error) bool {
	var pqErr *pq.Error
	return errors.As(err, &pqErr) && pqErr.Code == "23505"
}
