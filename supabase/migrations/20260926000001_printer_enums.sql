-- PrintFlow Phase 3 — enum additions.
--
-- Kept in their own migration: Postgres does not allow a newly added enum
-- value to be used in the same transaction that adds it.

-- Printer states reported by live telemetry.
alter type public.printer_status add value if not exists 'paused';
alter type public.printer_status add value if not exists 'unknown';

-- Dispatch states between "queued" and "printing":
--   sending — a start-print command is waiting for / being handled by the Printer Agent
--   sent    — the printer accepted the file and was told to print; it has not yet
--             reported that it is printing (e.g. heating, levelling)
alter type public.job_status add value if not exists 'sending' after 'queued';
alter type public.job_status add value if not exists 'sent' after 'sending';

-- Read-only team members (monitor printers and production, change nothing).
alter type public.member_role add value if not exists 'viewer';
