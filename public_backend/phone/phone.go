// Package phone holds the one rule for how a contact's phone number is stored.
// The backend applies it on every write; cmd/normalize-phones uses it to
// preview the backfill of numbers saved before it existed.
package phone

import (
	"errors"
	"strings"
	"unicode"

	"github.com/nyaruka/phonenumbers"
)

// DefaultRegion is assumed for numbers typed without a country code.
const DefaultRegion = "US"

// ErrInvalid is returned for input that isn't a real phone number. The
// handlers turn it into a 400 so nothing unparseable reaches the contacts table.
var ErrInvalid = errors.New("phone_number could not be parsed as a phone number; please re-enter it")

// Normalize parses a phone number typed in any format ("(512) 350-0064",
// "512.350.0064", "+1 512 350 0064", ...) and returns its E.164 form
// ("+15123500064"), the one format stored for every contact. Numbers without a
// country code are read as US numbers.
//
// Invisible formatting characters are dropped first: a number copied out of
// macOS Contacts arrives wrapped in U+202D/U+202C direction marks, which the
// parser would otherwise reject.
func Normalize(raw string) (string, error) {
	raw = strings.TrimSpace(stripFormatChars(raw))
	if raw == "" {
		return "", ErrInvalid
	}
	num, err := phonenumbers.Parse(raw, DefaultRegion)
	if err != nil || !phonenumbers.IsValidNumber(num) {
		return "", ErrInvalid
	}
	return phonenumbers.Format(num, phonenumbers.E164), nil
}

// stripFormatChars removes Unicode format characters (category Cf): direction
// marks, zero-width spaces and the like.
func stripFormatChars(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, s)
}
