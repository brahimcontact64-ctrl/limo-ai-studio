-- Rollback of 20261016140000_limo_rate_limits_v1. Requires 20261016150000_down.sql first
-- (submit_payment uses hit_rate_limit). Removes rate-limit counters only.
drop function if exists public.hit_rate_limit(text, integer, integer);
drop table if exists public.rate_limit_hits;
