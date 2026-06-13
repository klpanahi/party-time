package main

import (
	"os"
	"testing"
	"time"
)

func TestGetenv(t *testing.T) {
	const key = "PARTY_TIME_TEST_GETENV_KEY"

	t.Run("returns env value when set", func(t *testing.T) {
		os.Setenv(key, "hello")
		defer os.Unsetenv(key)
		if got := getenv(key, "fallback"); got != "hello" {
			t.Errorf("getenv = %q, want hello", got)
		}
	})

	t.Run("returns fallback when unset", func(t *testing.T) {
		os.Unsetenv(key)
		if got := getenv(key, "fallback"); got != "fallback" {
			t.Errorf("getenv = %q, want fallback", got)
		}
	})
}

func TestParseCentralTime(t *testing.T) {
	t.Run("parses valid datetime-local string in Chicago time", func(t *testing.T) {
		got, err := parseCentralTime("2099-07-04T18:00")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		loc, _ := time.LoadLocation("America/Chicago")
		want := time.Date(2099, 7, 4, 18, 0, 0, 0, loc)
		if !got.Equal(want) {
			t.Errorf("parseCentralTime = %v, want %v", got, want)
		}
	})

	t.Run("returns error for invalid format", func(t *testing.T) {
		if _, err := parseCentralTime("not-a-date"); err == nil {
			t.Error("expected error for invalid datetime format, got nil")
		}
	})
}
