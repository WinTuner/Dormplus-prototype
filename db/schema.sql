-- DormPlus — Postgres schema (snapshot ของ migrations ถึง 0003)
-- source of truth: backend/migrations/ (alembic) · ไฟล์นี้เป็นสำเนาสำหรับอ่าน ไม่ใช่ตัวที่รัน
-- อ้างอิง: docs/API.md

create table properties (
  id            text primary key,
  name          text not null,
  billing_mode  text not null default 'meter' check (billing_mode in ('meter','flat')),
  water_rate    int  not null default 25,
  elec_rate     int  not null default 7,
  due_days      int  not null default 5,
  line_channel_id   text,
  line_secret_enc   bytea,          -- เข้ารหัสด้วย KMS/pgcrypto
  line_token_enc    bytea,
  created_at    timestamptz not null default now()
);

create table rooms (
  id          text primary key,
  property_id text not null references properties(id) on delete cascade,
  room_no     text not null,
  rent        int  not null,
  mode        text not null default 'meter' check (mode in ('meter','flat')),
  status      text not null default 'occupied' check (status in ('vacant','occupied')),
  unique (property_id, room_no)
);

create table tenants (
  id            text primary key,
  room_id       text not null references rooms(id) on delete cascade,
  name          text,
  line_user_id  text,
  moved_in      date,
  moved_out     date,
  unique (room_id, line_user_id)
);
create index on tenants (line_user_id);

create table readings (
  id          text primary key,
  room_id     text not null references rooms(id) on delete cascade,
  period      text not null,               -- YYYY-MM
  water_prev  int, water_now int,
  elec_prev   int, elec_now  int,
  photo_key   text,
  recorded_by text,
  recorded_at timestamptz not null default now(),
  unique (room_id, period)
);

create table invoices (
  id         text primary key,
  room_id    text not null references rooms(id) on delete cascade,
  period     text not null,
  rent       int not null,
  total      int not null,
  due_date   date not null,
  status     text not null default 'unpaid' check (status in ('unpaid','pending','paid','void')),
  receipt_no text,
  created_at timestamptz not null default now(),
  paid_at    timestamptz,
  unique (room_id, period)                 -- บิลซ้ำไม่ได้
);
create index on invoices (status, due_date);

create table invoice_items (
  id         bigserial primary key,
  invoice_id text not null references invoices(id) on delete cascade,
  label      text not null,
  qty        int  not null,
  unit_price int  not null,
  amount     int  not null
);

create table payments (
  id          text primary key,
  invoice_id  text not null references invoices(id) on delete cascade,
  amount      int  not null,
  slip_key    text,
  verify_ok   boolean,                     -- null = ตรวจไม่ได้ ต้องให้คนดู
  verified_by text,
  verified_at timestamptz,
  created_at  timestamptz not null default now()
);

create table message_log (
  id         bigserial primary key,
  invoice_id text references invoices(id) on delete set null,
  kind       text not null,                -- invoice | reminder_1 | reminder_5 | reminder_10 | receipt
  to_user_id text,
  sent_at    timestamptz not null default now(),
  line_status text
);
create index on message_log (invoice_id, kind);

create table audit_log (
  id          bigserial primary key,
  property_id text not null,
  actor       text,
  action      text not null,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

-- RLS: เปิดใช้ + policy อยู่ในหัวข้อ 0004 ท้ายไฟล์ (เดิมเปิดไว้เฉย ๆ ไม่มี policy จึงไม่มีผล)

-- 0002: รหัสเชิญผูก LINE กับห้อง (เก็บเฉพาะ SHA-256 hash)
create table link_codes (
  id          text primary key,
  code_hash   text not null unique,
  property_id text not null references properties(id) on delete cascade,
  room_id     text not null references rooms(id) on delete cascade,
  tenant_id   text references tenants(id) on delete set null,
  created_by  text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     text,
  revoked_at  timestamptz
);
create index on link_codes (room_id);
alter table link_codes enable row level security;

-- 0003: จำนวนครั้งที่กรอกรหัสผิด ต่อบัญชี LINE ต่อชั่วโมง
create table auth_failures (
  id         bigserial primary key,
  scope      text not null,
  actor      text not null,
  created_at timestamptz not null default now()
);
create index on auth_failures (scope, actor, created_at);

-- 0004: RLS จริง — ทุก connection ถูกปักหมุดที่หอเดียวด้วย `app.property_id` (app/db.py)
-- `force` สำคัญ: app ต่อด้วย user ที่เป็นเจ้าของตาราง และเจ้าของข้าม policy ได้ถ้าไม่ force
-- ค่า setting ว่าง/NULL → predicate เป็น NULL → ไม่เห็นแถวใดเลย (fail closed)
-- auth_failures ไม่มี RLS เพราะผูกกับบัญชี LINE ไม่ใช่หอ

alter table properties   enable row level security;  alter table properties   force row level security;
alter table rooms        enable row level security;  alter table rooms        force row level security;
alter table tenants      enable row level security;  alter table tenants      force row level security;
alter table readings     enable row level security;  alter table readings     force row level security;
alter table invoices     enable row level security;  alter table invoices     force row level security;
alter table invoice_items enable row level security; alter table invoice_items force row level security;
alter table payments     enable row level security;  alter table payments     force row level security;
alter table message_log  enable row level security;  alter table message_log  force row level security;
alter table audit_log    enable row level security;  alter table audit_log    force row level security;
alter table link_codes   enable row level security;  alter table link_codes   force row level security;

create policy properties_property on properties for all
  using (id = current_setting('app.property_id', true))
  with check (id = current_setting('app.property_id', true));

create policy rooms_property on rooms for all
  using (property_id = current_setting('app.property_id', true))
  with check (property_id = current_setting('app.property_id', true));

-- ตารางลูกไม่มี property_id: policy เดินขึ้นไปที่ rooms ผ่าน FK
create policy tenants_property on tenants for all
  using (exists (select 1 from rooms r where r.id = tenants.room_id and r.property_id = current_setting('app.property_id', true)))
  with check (exists (select 1 from rooms r where r.id = tenants.room_id and r.property_id = current_setting('app.property_id', true)));

create policy readings_property on readings for all
  using (exists (select 1 from rooms r where r.id = readings.room_id and r.property_id = current_setting('app.property_id', true)))
  with check (exists (select 1 from rooms r where r.id = readings.room_id and r.property_id = current_setting('app.property_id', true)));

create policy invoices_property on invoices for all
  using (exists (select 1 from rooms r where r.id = invoices.room_id and r.property_id = current_setting('app.property_id', true)))
  with check (exists (select 1 from rooms r where r.id = invoices.room_id and r.property_id = current_setting('app.property_id', true)));

create policy invoice_items_property on invoice_items for all
  using (exists (select 1 from invoices i join rooms r on r.id = i.room_id where i.id = invoice_items.invoice_id and r.property_id = current_setting('app.property_id', true)))
  with check (exists (select 1 from invoices i join rooms r on r.id = i.room_id where i.id = invoice_items.invoice_id and r.property_id = current_setting('app.property_id', true)));

create policy payments_property on payments for all
  using (exists (select 1 from invoices i join rooms r on r.id = i.room_id where i.id = payments.invoice_id and r.property_id = current_setting('app.property_id', true)))
  with check (exists (select 1 from invoices i join rooms r on r.id = i.room_id where i.id = payments.invoice_id and r.property_id = current_setting('app.property_id', true)));

create policy message_log_property on message_log for all
  using (invoice_id is null or exists (select 1 from invoices i join rooms r on r.id = i.room_id where i.id = message_log.invoice_id and r.property_id = current_setting('app.property_id', true)))
  with check (invoice_id is null or exists (select 1 from invoices i join rooms r on r.id = i.room_id where i.id = message_log.invoice_id and r.property_id = current_setting('app.property_id', true)));

create policy audit_log_property on audit_log for all
  using (property_id = current_setting('app.property_id', true))
  with check (property_id = current_setting('app.property_id', true));

create policy link_codes_property on link_codes for all
  using (property_id = current_setting('app.property_id', true))
  with check (property_id = current_setting('app.property_id', true));
