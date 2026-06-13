package main

import (
	"fmt"

	twilio "github.com/twilio/twilio-go"
	twilioApi "github.com/twilio/twilio-go/rest/api/v2010"
)

// SMSSender sends a single text message and returns the provider's message
// identifier on success. It is an interface so the background worker can be
// tested with a fake implementation instead of hitting Twilio.
type SMSSender interface {
	Send(to, body string) (sid string, err error)
}

// twilioSender is the production SMSSender backed by the Twilio REST API.
type twilioSender struct {
	client *twilio.RestClient
	from   string
}

func (s *twilioSender) Send(to, body string) (string, error) {
	params := &twilioApi.CreateMessageParams{}
	params.SetTo(to)
	params.SetFrom(s.from)
	params.SetBody(body)

	resp, err := s.client.Api.CreateMessage(params)
	if err != nil {
		return "", err
	}
	if resp.Sid == nil {
		return "", fmt.Errorf("twilio returned no message sid")
	}
	return *resp.Sid, nil
}

// newTwilioSender builds an SMSSender from the TWILIO_* environment variables.
// It returns ok=false when any credential is missing so the caller can run
// without SMS delivery (texts simply stay pending).
func newTwilioSender() (SMSSender, bool) {
	accountSid := getenv("TWILIO_ACCOUNT_SID", "")
	authToken := getenv("TWILIO_AUTH_TOKEN", "")
	from := getenv("TWILIO_FROM_NUMBER", "")
	if accountSid == "" || authToken == "" || from == "" {
		return nil, false
	}

	client := twilio.NewRestClientWithParams(twilio.ClientParams{
		Username: accountSid,
		Password: authToken,
	})
	return &twilioSender{client: client, from: from}, true
}
