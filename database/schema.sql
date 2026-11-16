-- Sudsy schema for Supabase (PostgreSQL).
-- Run this whole file in Supabase > SQL Editor. It is safe to re-run on a fresh project.

create extension if not exists "pgcrypto";

-- ============================================================
-- 1. TABLES
-- ============================================================

create table if not exists public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text not null default '',
  role        text not null default 'customer' check (role in ('admin', 'staff', 'customer')),
  phone       text,
  created_at  timestamptz not null default now()
);

create table if not exists public.branches (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  address         text,
  contact_number  text,
  created_at      timestamptz not null default now()
);

create table if not exists public.services (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  unit_price    numeric(10, 2) not null check (unit_price >= 0),
  pricing_type  text not null check (pricing_type in ('per_kg', 'per_piece')),
  image_url     text,
  created_at    timestamptz not null default now()
);

create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.users(id) on delete cascade,
  branch_id       uuid not null references public.branches(id) on delete restrict,
  total_amount    numeric(10, 2) not null default 0 check (total_amount >= 0),
  payment_status  text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  order_status    text not null default 'received'
                  check (order_status in ('received', 'washing', 'drying', 'ready', 'completed')),
  pickup_date     timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists public.order_items (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders(id) on delete cascade,
  service_id          uuid not null references public.services(id) on delete restrict,
  quantity_or_weight  numeric(10, 2) not null check (quantity_or_weight > 0),
  subtotal            numeric(10, 2) not null check (subtotal >= 0),
  created_at          timestamptz not null default now()
);

create table if not exists public.inventory (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references public.branches(id) on delete cascade,
  item_name       text not null,
  stock_quantity  numeric(10, 2) not null default 0 check (stock_quantity >= 0),
  unit            text not null default 'pcs',
  reorder_level   numeric(10, 2) not null default 0 check (reorder_level >= 0),
  updated_at      timestamptz not null default now()
);

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  message     text not null,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- 2. INDEXES
-- ============================================================

create index if not exists idx_users_role                on public.users (role);
create index if not exists idx_orders_customer           on public.orders (customer_id, created_at desc);
create index if not exists idx_orders_branch             on public.orders (branch_id);
create index if not exists idx_orders_status             on public.orders (order_status);
create index if not exists idx_orders_payment            on public.orders (payment_status);
create index if not exists idx_order_items_order         on public.order_items (order_id);
create index if not exists idx_order_items_service       on public.order_items (service_id);
create index if not exists idx_inventory_branch          on public.inventory (branch_id);
create index if not exists idx_notifications_user_unread on public.notifications (user_id, is_read, created_at desc);

-- ============================================================
-- 3. HELPER FUNCTIONS AND TRIGGERS
-- ============================================================

-- SECURITY DEFINER lets policies check the caller's role without recursing into users' own RLS.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('admin', 'staff'), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false);
$$;

-- Every new sign-up gets a profile row. Role is always 'customer' here, so a user
-- cannot make themselves admin through sign-up metadata. Promote people in the admin panel.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, phone, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone',
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_inventory_updated on public.inventory;
create trigger trg_inventory_updated
  before update on public.inventory
  for each row execute function public.touch_updated_at();

-- ============================================================
-- 4. ROW LEVEL SECURITY
-- The Flask API uses the service-role key (bypasses RLS) and enforces roles itself.
-- These policies protect direct browser access with the public anon key
-- (profile reads, realtime updates, and any client-side queries).
-- ============================================================

alter table public.users          enable row level security;
alter table public.branches       enable row level security;
alter table public.services       enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;
alter table public.inventory      enable row level security;
alter table public.notifications  enable row level security;

-- users
drop policy if exists users_select on public.users;
create policy users_select on public.users for select to authenticated
  using (id = auth.uid() or public.is_staff());

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.current_user_role());

drop policy if exists users_admin_all on public.users;
create policy users_admin_all on public.users for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- branches: everyone signed in can read, admins manage
drop policy if exists branches_select on public.branches;
create policy branches_select on public.branches for select to authenticated using (true);

drop policy if exists branches_admin_write on public.branches;
create policy branches_admin_write on public.branches for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- services: price list is public, staff manage
drop policy if exists services_select on public.services;
create policy services_select on public.services for select to anon, authenticated using (true);

drop policy if exists services_staff_write on public.services;
create policy services_staff_write on public.services for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- orders: customers see their own, staff see everything
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated
  using (customer_id = auth.uid() or public.is_staff());

drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders for insert to authenticated
  with check (
    public.is_staff()
    or (customer_id = auth.uid() and order_status = 'received' and payment_status = 'unpaid')
  );

drop policy if exists orders_staff_update on public.orders;
create policy orders_staff_update on public.orders for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists orders_staff_delete on public.orders;
create policy orders_staff_delete on public.orders for delete to authenticated
  using (public.is_staff());

-- order_items: visible through the parent order
drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items for select to authenticated
  using (
    public.is_staff()
    or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid())
  );

drop policy if exists order_items_staff_write on public.order_items;
create policy order_items_staff_write on public.order_items for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- inventory: staff only
drop policy if exists inventory_staff_all on public.inventory;
create policy inventory_staff_all on public.inventory for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- notifications: owner reads and updates, staff can send
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists notifications_staff_insert on public.notifications;
create policy notifications_staff_insert on public.notifications for insert to authenticated
  with check (public.is_staff());

-- ============================================================
-- 5. REALTIME (live order tracker and notification bell)
-- ============================================================

do $$
begin
  begin
    alter publication supabase_realtime add table public.orders;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then null;
  end;
end $$;
