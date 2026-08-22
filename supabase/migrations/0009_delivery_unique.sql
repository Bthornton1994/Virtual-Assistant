-- One delivery package per request. Application code also returns the existing
-- row on repeat submit; this index is the last-line race guard.
create unique index if not exists deliveries_request_id_uidx on public.deliveries (request_id);
