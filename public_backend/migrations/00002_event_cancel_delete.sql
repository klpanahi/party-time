-- +goose Up
-- Extends the event lifecycle from draft|launched to draft|launched|canceled|deleted.
-- 'deleted' is a soft delete: the row stays so historical texts sent for the event
-- remain traceable back to it, but the admin UI stops listing it and the public
-- invite/event endpoints stop serving it.
ALTER TABLE party_time.events ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ NULL;
ALTER TABLE party_time.events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

ALTER TABLE party_time.events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE party_time.events ADD CONSTRAINT events_status_check
    CHECK (status IN ('draft', 'launched', 'canceled', 'deleted'));

-- +goose Down
ALTER TABLE party_time.events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE party_time.events DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE party_time.events DROP COLUMN IF EXISTS canceled_at;
