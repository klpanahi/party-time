package phone

import "testing"

func TestNormalize(t *testing.T) {
	valid := []struct{ in, want string }{
		// The formats already in the contacts table.
		{"(512)350-0064", "+15123500064"},
		{"+1 (512) 364-9131", "+15123649131"},
		{"7373145188", "+17373145188"},
		{"(205) 335-5501", "+12053355501"},
		// Other ways people type a US number.
		{"512.350.0064", "+15123500064"},
		{"1-512-350-0064", "+15123500064"},
		{"  512 350 0064  ", "+15123500064"},
		{"+15123500064", "+15123500064"},
		// Pasted from macOS Contacts: wrapped in invisible direction marks.
		{"\u202d+1 (512) 900-0626\u202c", "+15129000626"},
		{"512\u200b350\u200b0064", "+15123500064"},
		// An explicit country code is kept.
		{"+44 20 7946 0958", "+442079460958"},
	}
	for _, tc := range valid {
		got, err := Normalize(tc.in)
		if err != nil {
			t.Errorf("Normalize(%q) error = %v, want %q", tc.in, err, tc.want)
			continue
		}
		if got != tc.want {
			t.Errorf("Normalize(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}

	invalid := []string{
		"",
		"   ",
		"call me maybe",
		"12345",             // too short
		"512350006412345",   // too long
		"(555) 000-1111",    // 555 is not a real area code
		"+1 (012) 350-0064", // area codes never start with 0
	}
	for _, in := range invalid {
		if got, err := Normalize(in); err == nil {
			t.Errorf("Normalize(%q) = %q, want an error", in, got)
		}
	}
}
