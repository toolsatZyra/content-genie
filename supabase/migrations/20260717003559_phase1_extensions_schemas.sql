-- Phase 1 / 0001: foundational extensions, schemas, types, and shared helpers.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
create schema if not exists audit;

revoke all on schema private from public, anon, authenticated;
revoke all on schema audit from public, anon, authenticated;

create type public.workspace_state as enum ('active', 'deactivated');
create type public.membership_role as enum ('member', 'reviewer', 'admin');
create type public.membership_state as enum ('pending', 'active', 'deactivated');
create type public.series_state as enum ('active', 'archived');
create type public.episode_workflow_state as enum (
  'draft',
  'world_setup',
  'ready_to_produce',
  'producing',
  'paused',
  'retrying',
  'delayed',
  'blocked',
  'pending_qualified_review',
  'awaiting_final_review',
  'approved',
  'delivered',
  'canceled',
  'abandoned',
  'release_blocked'
);
create type public.work_item_state as enum (
  'open',
  'claimed',
  'completed',
  'canceled',
  'superseded'
);
create type public.work_lease_state as enum ('active', 'released', 'expired', 'revoked');
create type public.notification_state as enum ('unread', 'read', 'dismissed', 'obsolete');
create type public.outbox_state as enum ('pending', 'leased', 'delivered', 'dead_letter');
create type public.command_outcome as enum ('accepted', 'rejected');

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

create or replace function private.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'immutable record cannot be updated or deleted'
    using errcode = '55000';
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;
