# -*- coding: utf-8 -*-
"""DomPlus v1 API — adapter over the prototype's SQLite data.

Implements the contract in docs/API.md so the web/ frontend can be built
against it. The real backend (FastAPI + Postgres) replaces this file.
"""
import json
import re
from datetime import date, timedelta

import server  # reuse db(), PERIOD, rates

PERIOD = server.PERIOD


def _money(n):
    return int(n or 0)


def rooms_payload(period=PERIOD):
    con = server.db()
    items = []
    for r in con.execute("SELECT * FROM rooms ORDER BY room_no").fetchall():
        rd = con.execute("SELECT * FROM readings WHERE room_id=? AND period=?", (r["id"], period)).fetchone()
        inv = con.execute("SELECT * FROM invoices WHERE room_id=? AND period=?", (r["id"], period)).fetchone()
        items.append({
            "id": r["id"],
            "room_no": r["room_no"],
            "rent": r["rent"],
            "mode": r["billing_mode"],
            "tenant": {"name": r["tenant_name"], "line_linked": False},
            "reading": None if not rd else {
                "water_prev": rd["water_prev"], "water_now": rd["water_now"],
                "elec_prev": rd["elec_prev"], "elec_now": rd["elec_now"],
            },
            "invoice": None if not inv else {
                "id": inv["id"], "total": inv["total"],
                "status": inv["status"], "due_date": inv["due_date"],
            },
        })
    con.close()
    return {"items": items, "period": period, "rates": {"water": server.WATER_RATE, "elec": server.ELEC_RATE}}


def save_reading(room_id, payload):
    con = server.db()
    prev = con.execute(
        "SELECT water_now, elec_now FROM readings WHERE room_id=? AND period='2026-10'", (room_id,)
    ).fetchone()
    wp = prev["water_now"] if prev else 0
    ep = prev["elec_now"] if prev else 0
    con.execute(
        """INSERT INTO readings (room_id, period, water_prev, water_now, elec_prev, elec_now)
           VALUES (?,?,?,?,?,?)
           ON CONFLICT(room_id, period) DO UPDATE SET
             water_now=excluded.water_now, elec_now=excluded.elec_now""",
        (room_id, payload.get("period", PERIOD), wp, payload["water_now"], ep, payload["elec_now"]),
    )
    con.commit()
    con.close()
    wu = max(0, payload["water_now"] - wp)
    eu = max(0, payload["elec_now"] - ep)
    warn = "METER_DECREASED" if (payload["water_now"] < wp or payload["elec_now"] < ep) else None
    return {"water_units": wu, "elec_units": eu, "warning": warn}


def invoices_payload(status=None, period=PERIOD):
    con = server.db()
    sql = "SELECT i.*, r.room_no FROM invoices i JOIN rooms r ON r.id=i.room_id WHERE i.period=?"
    args = [period]
    if status:
        sql += " AND i.status=?"
        args.append(status)
    items = []
    for row in con.execute(sql + " ORDER BY r.room_no", args).fetchall():
        overdue = 0
        if row["status"] == "unpaid":
            due = date.fromisoformat(row["due_date"])
            overdue = max(0, (date.today() - due).days)
        items.append({
            "id": row["id"], "room_no": row["room_no"], "total": row["total"],
            "status": row["status"], "due_date": row["due_date"], "days_overdue": overdue,
        })
    con.close()
    return {"items": items}


def summary(period=PERIOD):
    con = server.db()
    rows = con.execute("SELECT status, total FROM invoices WHERE period=?", (period,)).fetchall()
    con.close()
    total = sum(r["total"] for r in rows)
    by = {"paid": 0, "pending": 0, "unpaid": 0}
    for r in rows:
        by[r["status"]] = by.get(r["status"], 0) + r["total"]
    return {"billed": total, "paid": by["paid"], "pending": by["pending"],
            "unpaid": by["unpaid"], "invoices": len(rows)}


def slip(invoice_id, payload):
    con = server.db()
    inv = con.execute("SELECT * FROM invoices WHERE id=?", (invoice_id,)).fetchone()
    if not inv:
        con.close()
        return 404, {"error": {"code": "NOT_FOUND", "message": "ไม่พบบิล"}}
    con.execute("UPDATE invoices SET status='pending' WHERE id=?", (invoice_id,))
    con.execute("INSERT INTO payments (invoice_id, amount) VALUES (?,?)", (invoice_id, inv["total"]))
    con.commit()
    con.close()
    return 200, {"status": "pending", "verify": {"ok": None, "amount": inv["total"], "provider": "manual"}}


def confirm(invoice_id):
    con = server.db()
    inv = con.execute("SELECT * FROM invoices WHERE id=?", (invoice_id,)).fetchone()
    if not inv:
        con.close()
        return 404, {"error": {"code": "NOT_FOUND", "message": "ไม่พบบิล"}}
    con.execute("UPDATE invoices SET status='paid' WHERE id=?", (invoice_id,))
    con.execute("UPDATE payments SET confirmed_at=datetime('now') WHERE invoice_id=? AND confirmed_at IS NULL", (invoice_id,))
    con.commit()
    con.close()
    return 200, {"status": "paid", "receipt_no": f"REC-{PERIOD}-{invoice_id:04d}"}


ROOM_READING = re.compile(r"^/v1/rooms/(\d+)/reading$")
INV_SLIP = re.compile(r"^/v1/invoices/(\d+)/slip$")
INV_CONFIRM = re.compile(r"^/v1/invoices/(\d+)/confirm$")


def handle(method, path, query, payload):
    """Returns (status, body_dict)."""
    if method == "GET" and path == "/v1/rooms":
        return 200, rooms_payload(query.get("period", [PERIOD])[0])
    if method == "PUT" and ROOM_READING.match(path):
        room_id = int(ROOM_READING.match(path).group(1))
        return 200, save_reading(room_id, payload)
    if method == "POST" and path == "/v1/billing/run":
        return 200, server.make_bills()
    if method == "GET" and path == "/v1/invoices":
        return 200, invoices_payload(query.get("status", [None])[0])
    if method == "POST" and INV_SLIP.match(path):
        return slip(int(INV_SLIP.match(path).group(1)), payload)
    if method == "POST" and INV_CONFIRM.match(path):
        return confirm(int(INV_CONFIRM.match(path).group(1)))
    if method == "GET" and path == "/v1/reports/summary":
        return 200, summary()
    return 404, {"error": {"code": "NOT_FOUND", "message": path}}
