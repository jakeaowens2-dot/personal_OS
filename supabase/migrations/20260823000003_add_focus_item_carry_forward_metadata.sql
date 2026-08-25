-- Add carry-forward metadata to daily_focus_items.
--   status_reason: why the item moved (deferred, dropped, done, etc.)
--   carried_from_focus_item_id: lineage link to yesterday's item (nullable)

alter table public.daily_focus_items
  add column if not exists status_reason text;

alter table public.daily_focus_items
  add column if not exists carried_from_focus_item_id uuid
  references public.daily_focus_items (id) on delete set null;