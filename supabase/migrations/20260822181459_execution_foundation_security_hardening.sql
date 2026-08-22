-- Harden pre-existing persistent-lifecycle helpers used by the Step 2 execution foundation.
alter view public.delivery_packages set (security_invoker = true);
alter function public.enforce_sensitive_approval() set search_path = public;
alter function public.enforce_external_delivery() set search_path = public;
alter function public.set_updated_at() set search_path = public;
