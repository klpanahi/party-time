CREATE TABLE public.contacts (
	id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	first_name varchar NULL,
	last_name varchar NULL,
	phone_number varchar NOT NULL,
	CONSTRAINT contacts_pk PRIMARY KEY (id),
	CONSTRAINT contacts_unique UNIQUE (phone_number)
);

CREATE TABLE public.events (
	id int8 GENERATED ALWAYS AS IDENTITY NOT NULL,
	"name" varchar NOT NULL,
	"date" varchar NOT NULL,
	"description" varchar NOT NULL,
	"location" varchar NOT NULL,
	"plus_ones_allowed" bool NOT NULL,
	CONSTRAINT events_pk PRIMARY KEY (id)
);


CREATE TABLE public.invites (
	id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	attending varchar DEFAULT 'No Response' NULL,
	additional_guests int DEFAULT 0 NULL,
	event_id integer REFERENCES events (id),
	contact_id integer REFERENCES contacts (id),
	CONSTRAINT invites_pk PRIMARY KEY (id)
);

---create test data
insert into contacts (first_name, last_name, phone_number )
VALUES ('Mark', 'Jones', '1234567890');


insert into events (name, date, description, location, plus_ones_allowed)
values ('Test Event', 'March 7th', 'A Test Event made for party time', 'My House!', true);

insert into invites (event_id, contact_id) values (1,1);