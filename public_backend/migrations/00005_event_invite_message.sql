-- +goose Up
-- The invite text an admin wrote when launching an event, kept so that anyone
-- added after launch is offered the same message as a starting draft.
--
-- invite_message is the template as written, with {name} still unexpanded and
-- no RSVP link appended. NULL means the event was launched with the built-in
-- default (or before this column existed).
--
-- invite_include_link records whether the launch invites carried each
-- invitee's RSVP link, so the late-add draft starts with the same choice.
ALTER TABLE party_time.events ADD COLUMN IF NOT EXISTS invite_message text;
ALTER TABLE party_time.events ADD COLUMN IF NOT EXISTS invite_include_link boolean NOT NULL DEFAULT true;

-- +goose Down
ALTER TABLE party_time.events DROP COLUMN IF EXISTS invite_include_link;
ALTER TABLE party_time.events DROP COLUMN IF EXISTS invite_message;
