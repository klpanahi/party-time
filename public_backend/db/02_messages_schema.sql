CREATE TABLE public.messages (
	id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	content varchar NOT NULL,
	event_id integer REFERENCES events (id),
	CONSTRAINT messages_pk PRIMARY KEY (id)
);

CREATE TABLE public.texts (
	id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	contact_id integer REFERENCES contacts (id),
	message_id integer REFERENCES messages (id),
	event_id integer REFERENCES events (id),
	status varchar NOT NULL DEFAULT 'pending',
	content TEXT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	CONSTRAINT texts_pk PRIMARY KEY (id)
);
