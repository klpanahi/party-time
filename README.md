# Party Time Repo

This app will consist of 3 code bases

- An invite portal (party_invite)
  - This is the frontend that will be sent to guests to view and modify party invites
- An Admin Portal (not yet made)
  - This is where parties will be configured by the host
- A go api backend
  - This will have an admin and public socket to be used for externally and internaly facing traffic

## API Backend to do

- Create Database

### Tables

- Events Table: Contains the list of events that are scheduled
- Contacts Table: Contains the contacts of people I can invite
- Invites Table: What joins a contact to an event. This is how you invite someone
  - Includes the +1 data with the invite
- Sent Messages Table: The message history sent via twillio. Should be tied to a given individual and event
- Messages Table: Where message templates for a given message should be stored. This is where you'll see all event messages. Individual messages will be in the Sent Messages Table, which will tie to a person
