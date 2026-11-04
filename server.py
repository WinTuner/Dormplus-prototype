# -*- coding: utf-8 -*-
"""PAKDEE demo server: SQLite + tiny JSON API + serves the prototype.

Run:  python server.py     then open http://127.0.0.1:8777
"""
import json
import os
import sqlite3
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "pakdee.db")
PERIOD = "2026-11"
TODAY = date(2026, 11, 4)  # demo "today": bills are issued and arrears counted from here
RENT_METER, RENT_FLAT = 3220, 3500
WATER_RATE, ELEC_RATE = 25, 7

# Mock arrears for the owner's notify screen: room_no -> past periods left unpaid.
MOCK_ARREARS = {
    "203": ["2026-10"],
    "305": ["2026-08", "2026-09", "2026-10"],
    "312": ["2026-09", "2026-10"],
    "407": ["2026-10"],
    "502": ["2026-09", "2026-10"],
}
MOCK_UNITS = {"2026-08": (5, 28), "2026-09": (6, 33), "2026-10": (4, 30)}  # (water, elec)

SCHEMA = """
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY,
  property_id TEXT NOT NULL DEFAULT 'pro1',
  room_no TEXT NOT NULL,
  rent INTEGER NOT NULL,
  billing_mode TEXT NOT NULL DEFAULT 'meter',
  tenant_name TEXT,
  status TEXT NOT NULL DEFAULT 'occupied'
);
CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  water_prev INTEGER, water_now INTEGER,
  elec_prev INTEGER, elec_now INTEGER,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(room_id, period)
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  rent INTEGER NOT NULL,
  water_units INTEGER DEFAULT 0, water_rate INTEGER DEFAULT 25,
  elec_units INTEGER DEFAULT 0, elec_rate INTEGER DEFAULT 7,
  total INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid',
  UNIQUE(room_id, period)
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def db():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def seed():
    con = db()
    con.executescript(SCHEMA)
    n = con.execute("SELECT COUNT(*) c FROM rooms").fetchone()["c"]
    if n:
        con.close()
        return
    rooms = []
    for floor, count in ((2, 12), (3, 12), (4, 10), (5, 8)):
        for i in range(1, count + 1):
            rooms.append((f"{floor}{i:02d}", RENT_METER, "meter", f"ผู้เช่า {floor}{i:02d}"))
    for r in rooms:
        con.execute(
            "INSERT INTO rooms (property_id, room_no, rent, billing_mode, tenant_name) VALUES (?,?,?,?,?)",
            ("pro1", r[0], r[1], r[2], r[3]),
        )
    # previous-period readings so "ครั้งก่อน" is real
    for row in con.execute("SELECT id, room_no FROM rooms").fetchall():
        base_w = 110 + (row["id"] % 7) * 3
        base_e = 520 + (row["id"] % 9) * 21
        con.execute(
            "INSERT INTO readings (room_id, period, water_prev, water_now, elec_prev, elec_now) VALUES (?,?,?,?,?,?)",
            (row["id"], "2026-10", base_w - 4, base_w, base_e - 30, base_e),
        )
    # a few rooms already read this period
    for row in con.execute("SELECT id FROM rooms ORDER BY id LIMIT 12").fetchall():
        prev = con.execute(
            "SELECT water_now, elec_now FROM readings WHERE room_id=? AND period='2026-10'", (row["id"],)
        ).fetchone()
        con.execute(
            "INSERT OR IGNORE INTO readings (room_id, period, water_prev, water_now, elec_prev, elec_now) VALUES (?,?,?,?,?,?)",
            (row["id"], PERIOD, prev["water_now"], prev["water_now"] + 5, prev["elec_now"], prev["elec_now"] + 31),
        )
    con.commit()
    con.close()


def seed_overdue():
    """Insert the mock past-period unpaid invoices. UNIQUE(room_id, period) makes reruns no-ops."""
    con = db()
    for room_no, periods in MOCK_ARREARS.items():
        room = con.execute("SELECT id, rent FROM rooms WHERE room_no=?", (room_no,)).fetchone()
        if not room:
            continue
        for period in periods:
            wu, eu = MOCK_UNITS[period]
            total = room["rent"] + wu * WATER_RATE + eu * ELEC_RATE
            con.execute(
                """INSERT OR IGNORE INTO invoices (room_id, period, rent, water_units, water_rate,
                                                   elec_units, elec_rate, total, due_date, status)
                   VALUES (?,?,?,?,?,?,?,?,?, 'unpaid')""",
                (room["id"], period, room["rent"], wu, WATER_RATE, eu, ELEC_RATE, total, f"{period}-09"),
            )
    con.commit()
    con.close()


def past_invoices():
    """Earlier periods' invoices that are not settled yet (unpaid, or slip waiting for review).

    The page groups these into the overdue lists and the owner's confirm queue.
    """
    con = db()
    rows = con.execute(
        """SELECT i.id, i.room_id, r.room_no, r.tenant_name AS tenant,
                  i.period, i.total, i.due_date, i.status
           FROM invoices i JOIN rooms r ON r.id = i.room_id
           WHERE i.period <> ? AND i.status <> 'paid'
           ORDER BY r.room_no, i.period""",
        (PERIOD,),
    ).fetchall()
    con.close()
    return [dict(x) for x in rows]


def state():
    con = db()
    rooms = []
    for r in con.execute("SELECT * FROM rooms ORDER BY room_no").fetchall():
        rd = con.execute(
            "SELECT * FROM readings WHERE room_id=? AND period=?", (r["id"], PERIOD)
        ).fetchone()
        inv = con.execute(
            "SELECT * FROM invoices WHERE room_id=? AND period=?", (r["id"], PERIOD)
        ).fetchone()
        pay = None
        if inv:
            pay = con.execute(
                "SELECT * FROM payments WHERE invoice_id=? ORDER BY id DESC LIMIT 1", (inv["id"],)
            ).fetchone()
        rooms.append({
            "id": r["id"], "room_no": r["room_no"], "rent": r["rent"],
            "mode": r["billing_mode"], "tenant": r["tenant_name"],
            "reading": None if not rd else {
                "water_prev": rd["water_prev"], "water_now": rd["water_now"],
                "elec_prev": rd["elec_prev"], "elec_now": rd["elec_now"],
            },
            "invoice": None if not inv else {
                "id": inv["id"], "rent": inv["rent"], "water_units": inv["water_units"],
                "water_rate": inv["water_rate"], "elec_units": inv["elec_units"],
                "elec_rate": inv["elec_rate"], "total": inv["total"],
                "due_date": inv["due_date"], "status": inv["status"],
            },
            "payment": None if not pay else {"id": pay["id"], "amount": pay["amount"], "confirmed_at": pay["confirmed_at"]},
        })
    rates = {"water": WATER_RATE, "elec": ELEC_RATE, "period": PERIOD, "today": TODAY.isoformat()}
    con.close()
    return {"rates": rates, "rooms": rooms, "past": past_invoices()}


def save_reading(payload):
    con = db()
    room = con.execute("SELECT * FROM rooms WHERE id=?", (payload["room_id"],)).fetchone()
    prev = con.execute(
        "SELECT water_now, elec_now FROM readings WHERE room_id=? AND period='2026-10'", (payload["room_id"],)
    ).fetchone()
    w_prev = prev["water_now"] if prev else 0
    e_prev = prev["elec_now"] if prev else 0
    con.execute(
        """INSERT INTO readings (room_id, period, water_prev, water_now, elec_prev, elec_now)
           VALUES (?,?,?,?,?,?)
           ON CONFLICT(room_id, period) DO UPDATE SET
             water_now=excluded.water_now, elec_now=excluded.elec_now""",
        (payload["room_id"], PERIOD, w_prev, payload["water_now"], e_prev, payload["elec_now"]),
    )
    con.commit()
    con.close()
    return {"ok": True, "water_prev": w_prev, "elec_prev": e_prev}


def make_bills():
    con = db()
    due = (TODAY + timedelta(days=5)).isoformat()
    made = 0
    for r in con.execute("SELECT * FROM rooms").fetchall():
        rd = con.execute(
            "SELECT * FROM readings WHERE room_id=? AND period=?", (r["id"], PERIOD)
        ).fetchone()
        if not rd:
            continue
        if r["billing_mode"] == "flat":
            wu = eu = 0
            total = r["rent"]
        else:
            wu = max(0, (rd["water_now"] or 0) - (rd["water_prev"] or 0))
            eu = max(0, (rd["elec_now"] or 0) - (rd["elec_prev"] or 0))
            total = r["rent"] + wu * WATER_RATE + eu * ELEC_RATE
        con.execute(
            """INSERT INTO invoices (room_id, period, rent, water_units, water_rate,
                                     elec_units, elec_rate, total, due_date, status)
               VALUES (?,?,?,?,?,?,?,?,?, 'unpaid')
               ON CONFLICT(room_id, period) DO NOTHING""",
            (r["id"], PERIOD, r["rent"], wu, WATER_RATE, eu, ELEC_RATE, total, due),
        )
        made += 1
    con.commit()
    con.close()
    return {"ok": True, "billed": made}


def pay(payload):
    """Tenant sends one slip for one or more invoices: unpaid -> pending.

    Invoices that are already pending or paid are skipped, so a repeat tap adds nothing.
    """
    con = db()
    n = 0
    for inv_id in payload["invoice_ids"]:
        inv = con.execute("SELECT * FROM invoices WHERE id=? AND status='unpaid'", (inv_id,)).fetchone()
        if not inv:
            continue
        con.execute("UPDATE invoices SET status='pending' WHERE id=?", (inv["id"],))
        con.execute("INSERT INTO payments (invoice_id, amount) VALUES (?,?)", (inv["id"], inv["total"]))
        n += 1
    con.commit()
    con.close()
    return {"ok": True, "pending": n}


def confirm(payload):
    """Owner accepts the slip: pending -> paid, for every invoice it covered."""
    con = db()
    n = 0
    for inv_id in payload["invoice_ids"]:
        cur = con.execute("UPDATE invoices SET status='paid' WHERE id=? AND status='pending'", (inv_id,))
        if not cur.rowcount:
            continue
        con.execute(
            "UPDATE payments SET confirmed_at=datetime('now') WHERE invoice_id=? AND confirmed_at IS NULL",
            (inv_id,),
        )
        n += 1
    con.commit()
    con.close()
    return {"ok": True, "paid": n}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/prototype.html"):
            with open(os.path.join(BASE, "prototype.html"), "rb") as f:
                self._send(200, f.read(), "text/html; charset=utf-8")
        elif path == "/api/state":
            self._send(200, state())
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        payload = json.loads(self.rfile.read(length) or b"{}")
        path = urlparse(self.path).path
        routes = {"/api/reading": save_reading, "/api/bill": lambda p: make_bills(),
                  "/api/pay": pay, "/api/confirm": confirm}
        fn = routes.get(path)
        if not fn:
            self._send(404, {"error": "not found"})
            return
        try:
            self._send(200, fn(payload))
        except Exception as exc:  # noqa: BLE001 - demo server
            self._send(500, {"error": str(exc)})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    seed()
    seed_overdue()
    print("PAKDEE demo on http://127.0.0.1:8777  (db:", DB, ")")
    ThreadingHTTPServer(("127.0.0.1", 8777), Handler).serve_forever()
