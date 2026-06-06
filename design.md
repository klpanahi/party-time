# Text Message Functionality

## Text Message Database Structure

### The `messages` table

In the database, there should be a `messages` table that has the messages the event coordinator would like to send to all invitees.

- The `messages` table should have a unique id for each record
- It should have an entry for the message content
- It should have the event_id of the event the message was ment for

### The `texts` table

Messages to be sent to an invitee, a record is inserted in a tabel called `texts`

- A text record will have the contact the message is ment to be sent too, the message ID that was sent to the contact, and the message status.
- The message status communicates if a text message was successfuly sent or not
- When a message is set to be sent, it should be insterted into the text table with the status of `pending`.
- When the message is confirmed to be sent by twilio, the status should be set to `sent`.
- If the message isn't successfully sent, the status should be set to `failed`
- Messages will not be sent to those who have declined to attend the invite.

## How Text Messages are sent

A cron job will run every minute on the api pod and query the database for a `texts` record that is in pending status. How this cron will run is still undetermined. If it is pending status, it will send a text messsage via the twilio API. It will only pull 1 record at a time and only send 1 text message at a time. A new cron will not run until the first cron is completed. This is not super performant, but it doesn't need to be as this isn't set to send many messages in a given time period.

## Other Notes about Text Messages

- All text messages should start with "Hello <Invitee_Name>!", followed by a new line
- All text messages should end with "See your event details here: <Invite_Link>"

# UI for an invitee

The Invitees will interact with the application via a publicly hosted, unauthenticated ui

- An invitee will be texted an invite with their invite_id in the url. That url will load the invite page in their UI with the event details. They can mark themselves as attending, not attending, or tentative.
- If the event allows for plus ones, they will also get the ability to add however many plus ones they desire too
- The invitee can come back to that link at any time and modify their invitation
- The UI will only be able to interact with the backend pod that isn't running in `Admin` mode.
- The invite page will also have 2 sections that link

# Admin UI for Event Coordinator

The event Coordinator will have their own front end where they can schedule events, add invitees, and see RSVP Responses. This frontend will be internally hosted - not available to the internet. This is a different stand-alone ui from the one sent to the invitee mentioned earlier

## Views on the Admin UI

### The Event Summary Page

- A page where all events, past and present, are listed for them to scroll through. The top-most section will show upcoming events, with the soonest occuring event on the top. Each event row should contain
- The second section should show past events. A past event is defined as an event that happend prior to the current day.
- Every event Row should contain the Event Name, Event Date and Time, Total Invites Sent, Acceptend invites, Tentative Invites, Declined invites.
- Clicking on an event row should result in opening the Event Details Page
- This Page should also have a "Create Event" Button on the top right corner

### The Event Details Page

The event Details Page is where the admin will manage the upcoming event.

#### Page contents

There should be block for the following display blocks

##### Event Details Block

Should show the following

- Event Name
- Event Description
- Event Date and Time

#### List of Invitees

This should have the list of invitees ordered by RSVP Status. The ordering should be as followed

- Accepted
- Tentative
- No Response
- Declined

#### Send a message section

There should be a section for the event coordinator to send messages about the event. The coordinator should have a text box where they can put in a message and then a `Send` button to send to all invitees that haven't declined the event.

#### Exepected Behavior when modifying fields

Modifiable fields should be saved to the database when updated via the backend api and the changes should be saved without having to click a "save" button

# Backend Notes

- Everything is operating in Central Time
- The database of choice is postgress
- The backend will be written in golang
- There will be 2 versions of the backend running simultaniously. These version will be the exact same pod, but the requests they can handle are based off of the `ADMIN_ENABLED` env var. The Admin version will not be publically available, this will stop people from messing with the system. The only write operation that can be done with the public backend is modifying an invite. All other write operations should be blocked.
