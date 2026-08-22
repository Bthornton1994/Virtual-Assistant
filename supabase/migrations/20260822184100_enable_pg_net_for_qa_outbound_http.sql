-- QA gate infrastructure only.
-- Enabled pg_net briefly so the QA database could invoke the self-contained
-- authenticated Step 2A golden-path harness. It is removed again by the
-- corresponding 20260822184456 cleanup migration.
create extension if not exists pg_net;
