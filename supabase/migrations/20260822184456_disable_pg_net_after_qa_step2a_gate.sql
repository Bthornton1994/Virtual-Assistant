-- Remove the temporary QA outbound-HTTP capability immediately after the
-- authenticated Step 2A golden-path gate completed.
drop extension if exists pg_net;
drop schema if exists net cascade;
