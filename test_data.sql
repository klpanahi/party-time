-- test_data.sql — local development seed data.
-- Loaded fresh on every `run_local.sh` startup (after migrations run via goose). NOT used by tests.
-- Goal: exercise most states an event, message, contact, invite, or text can be in.
--
-- All data is FAKE. Every seeded text is in a terminal state (sent/failed) — there are
-- deliberately NO 'pending' or 'sending' rows, so the background worker never sends
-- anything on startup. To exercise live Twilio delivery, queue a message from the UI.
--
-- IDs are GENERATED ALWAYS, so foreign keys are resolved via natural keys
-- (contacts.phone_number is UNIQUE; events by name) rather than hardcoded ids.

-- ---------------------------------------------------------------------------
-- Contacts — includes a single-name contact (empty last name) edge case.
-- ---------------------------------------------------------------------------
INSERT INTO contacts (first_name, last_name, phone_number) VALUES
  ('Alice',   'Anderson', '+15125550101'),
  ('Bob',     'Brown',    '+15125550102'),
  ('Carol',   'Clark',    '+15125550103'),
  ('Dan',     'Davis',    '+15125550104'),
  ('Erin',    'Evans',    '+15125550105'),
  ('Madonna', '',         '+15125550106');

-- ---------------------------------------------------------------------------
-- Events — one of each meaningful state.
--   Summer BBQ Bash   : launched, upcoming  (fully populated below)
--   New Year's Gala   : draft,    upcoming  (has invitees, not launched yet)
--   Spring Fling      : launched, past      (historical event, mixed RSVPs)
--   Empty Draft Mixer : draft,    upcoming  (no invitees — cannot be launched)
-- ---------------------------------------------------------------------------
INSERT INTO events (name, date, description, location, plus_ones_allowed, status) VALUES
  ('Summer BBQ Bash',   NOW() + INTERVAL '21 days', 'Burgers, lawn games, and live music in the backyard.', '742 Evergreen Terrace', true,  'launched'),
  ('New Year''s Gala',  NOW() + INTERVAL '180 days', 'Black-tie countdown party with champagne toast.',      'The Grand Ballroom',    true,  'draft'),
  ('Spring Fling',      NOW() - INTERVAL '30 days', 'Last season''s garden party.',                          'Riverside Park',        false, 'launched'),
  ('Empty Draft Mixer', NOW() + INTERVAL '45 days', 'Casual networking mixer — still drafting the list.',    'Downtown Loft',         true,  'draft');

-- ---------------------------------------------------------------------------
-- Invites — cover every RSVP state, opened/unopened, and additional guests.
-- ---------------------------------------------------------------------------

-- Summer BBQ Bash (launched, upcoming): the full spread.
INSERT INTO invites (event_id, contact_id, attending, additional_guests, opened_at) VALUES
  ((SELECT id FROM events WHERE name = 'Summer BBQ Bash'), (SELECT id FROM contacts WHERE phone_number = '+15125550101'), 'Accepted',    2, NOW() - INTERVAL '2 days'),  -- opened, bringing guests
  ((SELECT id FROM events WHERE name = 'Summer BBQ Bash'), (SELECT id FROM contacts WHERE phone_number = '+15125550102'), 'Tentative',   0, NOW() - INTERVAL '5 days'),  -- opened, maybe
  ((SELECT id FROM events WHERE name = 'Summer BBQ Bash'), (SELECT id FROM contacts WHERE phone_number = '+15125550103'), 'Declined',    0, NOW() - INTERVAL '1 day'),   -- opened, can't make it
  ((SELECT id FROM events WHERE name = 'Summer BBQ Bash'), (SELECT id FROM contacts WHERE phone_number = '+15125550104'), 'No Response', 0, NULL),                       -- never opened the link
  ((SELECT id FROM events WHERE name = 'Summer BBQ Bash'), (SELECT id FROM contacts WHERE phone_number = '+15125550106'), 'Accepted',    1, NOW() - INTERVAL '3 hours'); -- single-name contact

-- New Year's Gala (draft): invitees added but event not launched, so all No Response.
INSERT INTO invites (event_id, contact_id, attending, additional_guests, opened_at) VALUES
  ((SELECT id FROM events WHERE name = 'New Year''s Gala'), (SELECT id FROM contacts WHERE phone_number = '+15125550101'), 'No Response', 0, NULL),
  ((SELECT id FROM events WHERE name = 'New Year''s Gala'), (SELECT id FROM contacts WHERE phone_number = '+15125550105'), 'No Response', 0, NULL);

-- Spring Fling (past, launched): historical mixed responses.
INSERT INTO invites (event_id, contact_id, attending, additional_guests, opened_at) VALUES
  ((SELECT id FROM events WHERE name = 'Spring Fling'), (SELECT id FROM contacts WHERE phone_number = '+15125550101'), 'Accepted', 0, NOW() - INTERVAL '40 days'),
  ((SELECT id FROM events WHERE name = 'Spring Fling'), (SELECT id FROM contacts WHERE phone_number = '+15125550105'), 'Declined', 0, NOW() - INTERVAL '38 days');

-- ---------------------------------------------------------------------------
-- Messages — a broadcast follow-up sent to the Summer BBQ Bash list.
-- ---------------------------------------------------------------------------
INSERT INTO messages (content, event_id) VALUES
  ('Reminder: the BBQ is this Saturday! Bring a swimsuit if you want to use the pool.',
   (SELECT id FROM events WHERE name = 'Summer BBQ Bash'));

-- ---------------------------------------------------------------------------
-- Texts — the SMS outbox, all in terminal states (sent/failed). No pending or
-- sending rows, so the worker stays idle at startup. 'failed' rows exercise the
-- error display and the Resend button in the Messages tab.
-- ---------------------------------------------------------------------------

-- Invite texts for Summer BBQ Bash (message_id NULL, per-recipient content).
INSERT INTO texts (contact_id, message_id, event_id, status, content, provider_sid, error, sent_at) VALUES
  ((SELECT id FROM contacts WHERE phone_number = '+15125550101'), NULL,
   (SELECT id FROM events WHERE name = 'Summer BBQ Bash'),
   'sent',
   'Hey Alice! You''re invited to Summer BBQ Bash. Manage your RSVP here: http://localhost:5174/invite/...',
   'SM00000000000000000000000000000001', NULL, NOW() - INTERVAL '6 days'),

  ((SELECT id FROM contacts WHERE phone_number = '+15125550102'), NULL,
   (SELECT id FROM events WHERE name = 'Summer BBQ Bash'),
   'sent',
   'Hey Bob! You''re invited to Summer BBQ Bash. Manage your RSVP here: http://localhost:5174/invite/...',
   'SM00000000000000000000000000000002', NULL, NOW() - INTERVAL '6 days'),

  -- Failed example: demonstrates the error display and the Resend button.
  ((SELECT id FROM contacts WHERE phone_number = '+15125550103'), NULL,
   (SELECT id FROM events WHERE name = 'Summer BBQ Bash'),
   'failed',
   'Hey Carol! You''re invited to Summer BBQ Bash. Manage your RSVP here: http://localhost:5174/invite/...',
   NULL, 'Twilio error 21610: recipient has opted out (STOP)', NULL),

  ((SELECT id FROM contacts WHERE phone_number = '+15125550104'), NULL,
   (SELECT id FROM events WHERE name = 'Summer BBQ Bash'),
   'sent',
   'Hey Dan! You''re invited to Summer BBQ Bash. Manage your RSVP here: http://localhost:5174/invite/...',
   'SM00000000000000000000000000000003', NULL, NOW() - INTERVAL '6 days'),

  ((SELECT id FROM contacts WHERE phone_number = '+15125550106'), NULL,
   (SELECT id FROM events WHERE name = 'Summer BBQ Bash'),
   'sent',
   'Hey Madonna! You''re invited to Summer BBQ Bash. Manage your RSVP here: http://localhost:5174/invite/...',
   'SM00000000000000000000000000000004', NULL, NOW() - INTERVAL '6 days');

-- Broadcast texts for the reminder message (message_id set, content mirrors the message).
INSERT INTO texts (contact_id, message_id, event_id, status, content, provider_sid, error, sent_at) VALUES
  ((SELECT id FROM contacts WHERE phone_number = '+15125550101'),
   (SELECT id FROM messages WHERE content LIKE 'Reminder: the BBQ%'),
   (SELECT id FROM events WHERE name = 'Summer BBQ Bash'),
   'sent',
   'Reminder: the BBQ is this Saturday! Bring a swimsuit if you want to use the pool.',
   'SM00000000000000000000000000000010', NULL, NOW() - INTERVAL '1 day'),

  ((SELECT id FROM contacts WHERE phone_number = '+15125550102'),
   (SELECT id FROM messages WHERE content LIKE 'Reminder: the BBQ%'),
   (SELECT id FROM events WHERE name = 'Summer BBQ Bash'),
   'failed',
   'Reminder: the BBQ is this Saturday! Bring a swimsuit if you want to use the pool.',
   NULL, 'Twilio error 30007: message filtered by carrier', NULL);
