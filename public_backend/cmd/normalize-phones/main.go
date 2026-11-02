// Command normalize-phones backfills contact phone numbers saved before the
// backend normalized them (to "+1 (512)350-0064"). It works through the admin
// API only — GET every contact, then PUT each one back unchanged so the
// backend's own normalization rewrites the number. No SQL, no migration.
//
// Dry run is the default: it only GETs, and lists what would change and which
// numbers won't parse. Pass -apply to PUT. Run it via ops/normalize-phones.sh.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"example/web-service-gin/phone"
)

type contact struct {
	ID          int    `json:"id"`
	FirstName   string `json:"first_name"`
	LastName    string `json:"last_name"`
	PhoneNumber string `json:"phone_number"`
	Notes       string `json:"notes"`
	MessageType string `json:"message_type"`
}

func (c contact) name() string { return strings.TrimSpace(c.FirstName + " " + c.LastName) }

// change is one contact whose stored number isn't normalized yet.
type change struct {
	contact
	normalized string
	// conflictWith names the other contact that already has, or would also get,
	// the same normalized number. The backend refuses those with a 409, so they
	// are reported for a hand fix instead of PUT.
	conflictWith string
}

type plan struct {
	unchanged int
	changes   []change
	invalid   []contact
}

// buildPlan works out what the backfill would do, using the same phone.Normalize
// the backend applies on PUT.
func buildPlan(contacts []contact) plan {
	var p plan
	owner := map[string]contact{} // normalized number -> first contact that has it
	for _, c := range contacts {
		if n, err := phone.Normalize(c.PhoneNumber); err == nil {
			if _, taken := owner[n]; !taken || n == c.PhoneNumber {
				owner[n] = c
			}
		}
	}
	for _, c := range contacts {
		n, err := phone.Normalize(c.PhoneNumber)
		switch {
		case err != nil:
			p.invalid = append(p.invalid, c)
		case n == c.PhoneNumber:
			p.unchanged++
		default:
			ch := change{contact: c, normalized: n}
			if o := owner[n]; o.ID != c.ID {
				ch.conflictWith = fmt.Sprintf("#%d %s (%s)", o.ID, o.name(), o.PhoneNumber)
			}
			p.changes = append(p.changes, ch)
		}
	}
	return p
}

type client struct {
	base string
	http *http.Client
}

func (cl client) do(method, path string, body any, out any) error {
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, cl.base+path, r)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := cl.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	if res.StatusCode/100 != 2 {
		var e struct{ Error string }
		if json.Unmarshal(data, &e) == nil && e.Error != "" {
			return fmt.Errorf("%s %s: %d %s", method, path, res.StatusCode, e.Error)
		}
		return fmt.Errorf("%s %s: %d %s", method, path, res.StatusCode, strings.TrimSpace(string(data)))
	}
	if out != nil {
		return json.Unmarshal(data, out)
	}
	return nil
}

func (cl client) contacts() ([]contact, error) {
	var cs []contact
	err := cl.do("GET", "/admin/contacts", nil, &cs)
	return cs, err
}

// resave PUTs the contact back exactly as it was read, phone number included —
// the backend does the normalizing. tags is left out on purpose: the backend
// keeps a contact's interest tags when the field is omitted.
func (cl client) resave(c contact) error {
	body := map[string]string{
		"first_name":   c.FirstName,
		"last_name":    c.LastName,
		"phone_number": c.PhoneNumber,
		"notes":        c.Notes,
		"message_type": c.MessageType,
	}
	return cl.do("PUT", fmt.Sprintf("/admin/contacts/%d", c.ID), body, nil)
}

// run returns the process exit code: 0 when every number is (or would be)
// normalized, 1 when anything needs a hand fix or a PUT failed.
func run(out io.Writer, cl client, apply bool) int {
	contacts, err := cl.contacts()
	if err != nil {
		fmt.Fprintln(out, "error:", err)
		return 1
	}
	p := buildPlan(contacts)
	mode := "DRY RUN (GET only, nothing written)"
	if apply {
		mode = "APPLY (PUT each contact below)"
	}
	fmt.Fprintf(out, "%s against %s\n", mode, cl.base)
	fmt.Fprintf(out, "%d contacts: %d already normalized, %d to normalize, %d won't parse\n\n",
		len(contacts), p.unchanged, len(p.changes), len(p.invalid))

	failed := 0
	if len(p.changes) > 0 {
		fmt.Fprintln(out, "Normalize:")
	}
	for _, ch := range p.changes {
		line := fmt.Sprintf("  #%-4d %-24s %-20q -> %s", ch.ID, ch.name(), ch.PhoneNumber, ch.normalized)
		switch {
		case ch.conflictWith != "":
			failed++
			fmt.Fprintf(out, "%s  SKIP: same number as %s — merge by hand\n", line, ch.conflictWith)
		case !apply:
			fmt.Fprintln(out, line)
		default:
			if err := cl.resave(ch.contact); err != nil {
				failed++
				fmt.Fprintf(out, "%s  FAILED: %v\n", line, err)
			} else {
				fmt.Fprintf(out, "%s  ok\n", line)
			}
		}
	}

	if len(p.invalid) > 0 {
		fmt.Fprintln(out, "\nWon't parse — fix these by hand in the admin UI:")
		for _, c := range p.invalid {
			fmt.Fprintf(out, "  #%-4d %-24s %q\n", c.ID, c.name(), c.PhoneNumber)
		}
	}

	if apply && len(p.changes) > 0 {
		after, err := cl.contacts()
		if err != nil {
			fmt.Fprintln(out, "\nerror re-reading contacts:", err)
			return 1
		}
		left := buildPlan(after)
		fmt.Fprintf(out, "\nAfter: %d already normalized, %d still to normalize, %d won't parse\n",
			left.unchanged, len(left.changes), len(left.invalid))
	}

	if failed > 0 || len(p.invalid) > 0 {
		return 1
	}
	return 0
}

func main() {
	base := flag.String("url", os.Getenv("PARTY_TIME_ADMIN_URL"), "admin base URL, e.g. http://partytime.home.arpa")
	apply := flag.Bool("apply", false, "PUT each contact back (default is a GET-only dry run)")
	flag.Parse()
	if *base == "" {
		fmt.Fprintln(os.Stderr, "usage: normalize-phones -url http://partytime.home.arpa [-apply]")
		os.Exit(2)
	}
	cl := client{base: strings.TrimRight(*base, "/"), http: &http.Client{Timeout: 15 * time.Second}}
	os.Exit(run(os.Stdout, cl, *apply))
}
