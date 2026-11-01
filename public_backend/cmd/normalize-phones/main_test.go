package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"example/web-service-gin/phone"
)

// fakeAdmin is a stand-in for the admin API: GET /admin/contacts and
// PUT /admin/contacts/:id, normalizing on PUT the way the backend does.
type fakeAdmin struct {
	mu       sync.Mutex
	contacts []contact
	puts     []map[string]string
}

func (f *fakeAdmin) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if r.Method == "GET" && r.URL.Path == "/admin/contacts" {
		json.NewEncoder(w).Encode(f.contacts)
		return
	}
	if r.Method == "PUT" && strings.HasPrefix(r.URL.Path, "/admin/contacts/") {
		var body map[string]string
		json.NewDecoder(r.Body).Decode(&body)
		f.puts = append(f.puts, body)
		n, err := phone.Normalize(body["phone_number"])
		if err != nil {
			w.WriteHeader(400)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		for i := range f.contacts {
			if "/admin/contacts/"+strconv.Itoa(f.contacts[i].ID) == r.URL.Path {
				f.contacts[i].PhoneNumber = n
			}
		}
		json.NewEncoder(w).Encode(map[string]bool{"ok": true})
		return
	}
	http.NotFound(w, r)
}

func seed() []contact {
	return []contact{
		{ID: 1, FirstName: "Ann", PhoneNumber: "(512)350-0064", MessageType: "imessage", Notes: "keep me"},
		{ID: 2, FirstName: "Ben", PhoneNumber: "+15123649131", MessageType: "sms"},
		{ID: 3, FirstName: "Cal", PhoneNumber: "call me", MessageType: "imessage"},
		{ID: 4, FirstName: "Dee", PhoneNumber: "+1 (512) 364-9131", MessageType: "imessage"}, // same as Ben
		{ID: 5, FirstName: "Eli", PhoneNumber: "7373145188", MessageType: "sms"},
	}
}

func TestBuildPlan(t *testing.T) {
	p := buildPlan(seed())
	if p.unchanged != 1 {
		t.Errorf("unchanged = %d, want 1", p.unchanged)
	}
	if len(p.invalid) != 1 || p.invalid[0].ID != 3 {
		t.Errorf("invalid = %+v, want just #3", p.invalid)
	}
	if len(p.changes) != 3 {
		t.Fatalf("changes = %+v, want #1, #4, #5", p.changes)
	}
	for _, ch := range p.changes {
		switch ch.ID {
		case 1:
			if ch.normalized != "+15123500064" || ch.conflictWith != "" {
				t.Errorf("#1 = %+v", ch)
			}
		case 4:
			if !strings.Contains(ch.conflictWith, "#2 Ben") {
				t.Errorf("#4 conflictWith = %q, want Ben", ch.conflictWith)
			}
		case 5:
			if ch.normalized != "+17373145188" {
				t.Errorf("#5 normalized = %q", ch.normalized)
			}
		}
	}
}

func TestDryRunOnlyReads(t *testing.T) {
	f := &fakeAdmin{contacts: seed()}
	srv := httptest.NewServer(f)
	defer srv.Close()

	var out strings.Builder
	code := run(&out, client{base: srv.URL, http: srv.Client()}, false)
	if code != 1 {
		t.Errorf("exit = %d, want 1 (one unparseable, one conflict)", code)
	}
	if len(f.puts) != 0 {
		t.Errorf("dry run sent %d PUTs, want none", len(f.puts))
	}
	for _, want := range []string{"DRY RUN", `"(512)350-0064"`, "+15123500064", "SKIP", "Won't parse", `"call me"`} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("output missing %q:\n%s", want, out.String())
		}
	}
}

func TestApplyResavesEachChangeUnmodified(t *testing.T) {
	f := &fakeAdmin{contacts: seed()}
	srv := httptest.NewServer(f)
	defer srv.Close()

	var out strings.Builder
	run(&out, client{base: srv.URL, http: srv.Client()}, true)

	// #1 and #5 are PUT; #2 is already E.164, #3 won't parse, #4 conflicts.
	if len(f.puts) != 2 {
		t.Fatalf("PUTs = %+v, want 2", f.puts)
	}
	// The PUT carries the stored number as-is so the backend normalizes it,
	// and every other field round-trips untouched.
	if f.puts[0]["phone_number"] != "(512)350-0064" || f.puts[0]["notes"] != "keep me" ||
		f.puts[0]["message_type"] != "imessage" || f.puts[0]["first_name"] != "Ann" {
		t.Errorf("first PUT = %+v", f.puts[0])
	}
	if f.contacts[0].PhoneNumber != "+15123500064" || f.contacts[4].PhoneNumber != "+17373145188" {
		t.Errorf("contacts after apply = %+v", f.contacts)
	}
	if !strings.Contains(out.String(), "After: 3 already E.164, 1 still to normalize, 1 won't parse") {
		t.Errorf("summary missing:\n%s", out.String())
	}
}
