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

-- RLS: เปิดใช้แล้วกรองด้วย property_id จาก session
alter table rooms        enable row level security;
alter table readings     enable row level security;
alter table invoices     enable row level security;
alter table invoice_items enable row level security;
alter table payments     enable row level security;

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
