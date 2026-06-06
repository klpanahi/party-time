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
	status varchar NOT NULL DEFAULT 'pending',
	CONSTRAINT texts_pk PRIMARY KEY (id)
);
