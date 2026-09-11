-- +goose Up
-- Contacts now carry two admin-facing properties.
--
-- notes is private: information the administrator keeps about a person that is
-- never shown to invitees and never handed to the sender script.
--
-- message_type is how this person gets texted. It exists so the external
-- iMessage sender knows the channel up front instead of trying iMessage,
-- watching for a failure, and falling back to SMS. Everyone starts on
-- 'imessage'; an admin flips a contact to 'sms' when iMessage doesn't reach
-- them.
--
-- Both are NOT NULL with a default, so existing rows need no backfill.
ALTER TABLE party_time.contacts ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
ALTER TABLE party_time.contacts ADD COLUMN IF NOT EXISTS message_type varchar NOT NULL DEFAULT 'imessage';

ALTER TABLE party_time.contacts DROP CONSTRAINT IF EXISTS contacts_message_type_check;
ALTER TABLE party_time.contacts ADD CONSTRAINT contacts_message_type_check
    CHECK (message_type IN ('imessage', 'sms'));

-- +goose Down
ALTER TABLE party_time.contacts DROP CONSTRAINT IF EXISTS contacts_message_type_check;
ALTER TABLE party_time.contacts DROP COLUMN IF EXISTS message_type;
ALTER TABLE party_time.contacts DROP COLUMN IF EXISTS notes;
