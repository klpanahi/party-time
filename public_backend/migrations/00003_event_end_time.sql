-- +goose Up
-- Events carried only a start timestamp, which is not enough to build a calendar
-- entry for the invite page's "Add to calendar" control. Added nullable, backfilled
-- to a three hour default, then constrained, so this applies cleanly to a database
-- that already has events.
ALTER TABLE party_time.events ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ NULL;

UPDATE party_time.events SET end_time = date + INTERVAL '3 hours' WHERE end_time IS NULL;

ALTER TABLE party_time.events ALTER COLUMN end_time SET NOT NULL;

-- +goose Down
ALTER TABLE party_time.events DROP COLUMN IF EXISTS end_time;
