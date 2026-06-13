package main

import (
	"context"
	"log"
	"strconv"
	"time"
)

// textBatchSize is how many pending texts the worker claims per poll.
const textBatchSize = 10

// claimedText is a row claimed by the worker, joined with its recipient's phone.
type claimedText struct {
	ID      int64  `db:"id"`
	Content string `db:"content"`
	Phone   string `db:"phone_number"`
}

// runTextWorker drains pending rows from the texts table and sends them via the
// configured SMSSender, running until ctx is cancelled. The texts table acts as
// a durable queue: admin handlers insert rows with status 'pending' and return
// immediately, and this worker transitions them pending -> sending -> sent/failed.
func (env *Env) runTextWorker(ctx context.Context) {
	interval := parseDurationEnv("TEXT_WORKER_INTERVAL", 3*time.Second)
	rateDelay := parseMillisEnv("TEXT_WORKER_RATE_MS", 1100*time.Millisecond)

	// Startup sweep: any row left in 'sending' belongs to a previous process that
	// exited mid-send. We can't tell whether Twilio accepted those messages, so we
	// mark them failed (at-most-once) for manual resend rather than risk a double.
	if res, err := env.db.Exec(
		`UPDATE texts SET status = 'failed', error = 'interrupted (process restart)' WHERE status = 'sending'`,
	); err != nil {
		log.Printf("text worker: startup sweep failed: %v", err)
	} else if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("text worker: marked %d interrupted text(s) as failed on startup", n)
	}

	log.Printf("text worker: started (poll=%s, rate=%s)", interval, rateDelay)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("text worker: shutting down")
			return
		case <-ticker.C:
			env.processPendingTexts(ctx, rateDelay)
		}
	}
}

// processPendingTexts claims a batch of pending texts and sends each one. It is
// separated from the poll loop so tests can drive it directly with a fake sender.
func (env *Env) processPendingTexts(ctx context.Context, rateDelay time.Duration) {
	// Atomically claim a batch: FOR UPDATE SKIP LOCKED lets the worker move rows
	// to 'sending' without two workers (or restarts) grabbing the same row.
	claimSQL := `
		WITH claimed AS (
			SELECT id, contact_id FROM texts
			WHERE status = 'pending'
			ORDER BY created_at
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		UPDATE texts t
		SET status = 'sending'
		FROM claimed cl
		JOIN contacts c ON c.id = cl.contact_id
		WHERE t.id = cl.id
		RETURNING t.id, COALESCE(t.content, '') AS content, c.phone_number`

	claimed := []claimedText{}
	if err := env.db.Select(&claimed, claimSQL, textBatchSize); err != nil {
		log.Printf("text worker: claim failed: %v", err)
		return
	}

	for i, ct := range claimed {
		select {
		case <-ctx.Done():
			return
		default:
		}

		sid, err := env.sender.Send(ct.Phone, ct.Content)
		if err != nil {
			// Fail fast: one attempt, surface the error for manual resend.
			if _, uerr := env.db.Exec(
				`UPDATE texts SET status = 'failed', error = $1 WHERE id = $2`,
				truncate(err.Error(), 500), ct.ID,
			); uerr != nil {
				log.Printf("text worker: could not mark text %d failed: %v", ct.ID, uerr)
			}
			continue
		}

		if _, uerr := env.db.Exec(
			`UPDATE texts SET status = 'sent', provider_sid = $1, sent_at = NOW() WHERE id = $2`,
			sid, ct.ID,
		); uerr != nil {
			log.Printf("text worker: could not mark text %d sent: %v", ct.ID, uerr)
		}

		// Respect the sender's MPS limit; skip the wait after the final send.
		if rateDelay > 0 && i < len(claimed)-1 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(rateDelay):
			}
		}
	}
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}

func parseDurationEnv(key string, fallback time.Duration) time.Duration {
	v := getenv(key, "")
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		log.Printf("text worker: invalid %s=%q, using %s", key, v, fallback)
		return fallback
	}
	return d
}

func parseMillisEnv(key string, fallback time.Duration) time.Duration {
	v := getenv(key, "")
	if v == "" {
		return fallback
	}
	ms, err := strconv.Atoi(v)
	if err != nil {
		log.Printf("text worker: invalid %s=%q, using %s", key, v, fallback)
		return fallback
	}
	return time.Duration(ms) * time.Millisecond
}
