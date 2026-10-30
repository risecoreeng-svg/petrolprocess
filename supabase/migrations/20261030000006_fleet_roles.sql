-- PetroTrack: new roles and truck status for the Truck Business module.
-- Kept in its own migration: Postgres can't use a newly added enum value in the same
-- transaction that adds it.

alter type public.user_role add value if not exists 'fleet_manager';
alter type public.user_role add value if not exists 'driver';
alter type public.truck_status add value if not exists 'inactive';
