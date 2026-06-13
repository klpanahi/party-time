CREATE TABLE public.contacts (
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    first_name varchar NULL,
    last_name varchar NULL,
    phone_number varchar NOT NULL,
    CONSTRAINT contacts_pk PRIMARY KEY (id),
    CONSTRAINT contacts_unique UNIQUE (phone_number)
);

CREATE TABLE public.events (
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    name varchar NOT NULL,
    date TIMESTAMPTZ NOT NULL,
    description varchar NOT NULL,
    location varchar NOT NULL,
    plus_ones_allowed bool NOT NULL,
    status varchar NOT NULL DEFAULT 'draft',
    CONSTRAINT events_pk PRIMARY KEY (id)
);

CREATE TABLE public.invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    attending varchar DEFAULT 'No Response' NULL,
    additional_guests int DEFAULT 0 NULL,
    event_id integer REFERENCES events(id),
    contact_id integer REFERENCES contacts(id),
    opened_at TIMESTAMPTZ NULL,
    CONSTRAINT invites_pk PRIMARY KEY (id)
);

CREATE TABLE public.messages (
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    content varchar NOT NULL,
    event_id integer REFERENCES events(id),
    CONSTRAINT messages_pk PRIMARY KEY (id)
);

CREATE TABLE public.texts (
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    contact_id integer REFERENCES contacts(id),
    message_id integer REFERENCES messages(id),
    event_id integer REFERENCES events(id),
    status varchar NOT NULL DEFAULT 'pending',
    content TEXT NULL,
    provider_sid varchar NULL,
    error varchar NULL,
    sent_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT texts_pk PRIMARY KEY (id)
);

CREATE INDEX texts_status_idx ON public.texts (status, created_at);

-- Seed data for local development lives in test_data.sql (loaded by run_local.sh).
-- This file stays purely structural so it can also build the test database.
