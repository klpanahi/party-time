// Package phone holds the one rule for how a contact's phone number is stored.
// The backend applies it on every write; cmd/normalize-phones uses it to
// preview the backfill of numbers saved before it existed.
package phone

import (
	"errors"
	"fmt"
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
// "512.350.0064", "+15123500064", ...) and returns the one form stored and
// shown for every contact: "+1 (512)350-0064" for a +1 (North American)
// number, the library's international format ("+44 20 7946 0958") for any
// other country. Numbers without a country code are read as US numbers.
//
// The stored form is for people. Anything that sends a text gets E164 instead.
func Normalize(raw string) (string, error) {
	num, err := parse(raw)
	if err != nil {
		return "", err
	}
	if num.GetCountryCode() == 1 {
		n := phonenumbers.GetNationalSignificantNumber(num)
		if len(n) == 10 {
			return fmt.Sprintf("+1 (%s)%s-%s", n[:3], n[3:6], n[6:]), nil
		}
	}
	return phonenumbers.Format(num, phonenumbers.INTERNATIONAL), nil
}

// E164 converts a stored number to E.164 ("+15123500064") for the senders:
// Twilio requires it, and the iMessage companion script gets the same. A value
// that won't parse (only possible for rows saved before normalization) is
// returned unchanged so the sender reports it, as it always has.
func E164(stored string) string {
	num, err := parse(stored)
	if err != nil {
		return stored
	}
	return phonenumbers.Format(num, phonenumbers.E164)
}

// parse is the shared validity rule. Invisible formatting characters are
// dropped first: a number copied out of macOS Contacts arrives wrapped in
// U+202D/U+202C direction marks, which the parser would otherwise reject.
func parse(raw string) (*phonenumbers.PhoneNumber, error) {
	raw = strings.TrimSpace(stripFormatChars(raw))
	if raw == "" {
		return nil, ErrInvalid
	}
	num, err := phonenumbers.Parse(raw, DefaultRegion)
	if err != nil || !phonenumbers.IsValidNumber(num) {
		return nil, ErrInvalid
	}
	return num, nil
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
