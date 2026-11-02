-- +goose Up
-- Free-text interest tags on contacts ("hiking", "board games"), so an admin
-- can filter the contact book and invite a whole group at once.
--
-- There is no separate tags table: a tag exists for as long as some contact
-- carries it, and suggestions are the distinct values here. Tags are stored
-- normalized (trimmed, lowercased, inner whitespace collapsed) by the API, so
-- the primary key also stops a contact carrying the same tag twice.
CREATE TABLE IF NOT EXISTS party_time.contact_tags (
    contact_id bigint NOT NULL REFERENCES party_time.contacts(id) ON DELETE CASCADE,
    tag text NOT NULL,
    CONSTRAINT contact_tags_pk PRIMARY KEY (contact_id, tag)
);

CREATE INDEX IF NOT EXISTS contact_tags_tag_idx ON party_time.contact_tags (tag);

-- +goose Down
DROP TABLE IF EXISTS party_time.contact_tags;
