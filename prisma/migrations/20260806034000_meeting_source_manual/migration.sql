-- Allow meetings to be scheduled manually from the Lead detail page,
-- not just via Calendly/Google Calendar webhooks.
ALTER TYPE "MeetingSource" ADD VALUE 'MANUAL';
