"""Seed one demo dorm with 42 rooms, ported from seed() and seed_overdue() in ../server.py.

Safe to run again: every insert is ON CONFLICT DO NOTHING, and invoice items are only added
for invoices this run actually created.

    python -m app.seed
"""
from sqlalchemy import Connection, text

from app.db import get_engine
from app.ids import invoice_id, reading_id

PROPERTY_ID = "p_1"
PROPERTY_NAME = "หอพักบ้านสวน"
PERIOD = "2026-11"
PREV_PERIOD = "2026-10"
RENT_METER = 3220
WATER_RATE, ELEC_RATE = 25, 7
FLOORS = ((2, 12), (3, 12), (4, 10), (5, 8))  # floor -> rooms on it = 42 rooms
ROOMS_READ_THIS_PERIOD = 12  # the first 12 rooms already have this period's meter reading

# Past periods left unpaid, for the overdue / dunning screens. room_no -> periods.
MOCK_ARREARS = {
    "203": ["2026-10"],
    "305": ["2026-08", "2026-09", "2026-10"],
    "312": ["2026-09", "2026-10"],
    "407": ["2026-10"],
    "502": ["2026-09", "2026-10"],
}
MOCK_UNITS = {"2026-08": (5, 28), "2026-09": (6, 33), "2026-10": (4, 30)}  # (water, elec)


def room_numbers() -> list[str]:
    return [f"{floor}{i:02d}" for floor, count in FLOORS for i in range(1, count + 1)]


def seed(conn: Connection) -> None:
    conn.execute(
        text("""insert into properties (id, name, billing_mode, water_rate, elec_rate, due_days)
                values (:id, :name, 'meter', :w, :e, 5) on conflict do nothing"""),
        {"id": PROPERTY_ID, "name": PROPERTY_NAME, "w": WATER_RATE, "e": ELEC_RATE},
    )

    for idx, room_no in enumerate(room_numbers(), start=1):
        room_id = f"r_{room_no}"
        conn.execute(
            text("""insert into rooms (id, property_id, room_no, rent, mode)
                    values (:id, :pid, :no, :rent, 'meter') on conflict do nothing"""),
            {"id": room_id, "pid": PROPERTY_ID, "no": room_no, "rent": RENT_METER},
        )
        conn.execute(
            text("""insert into tenants (id, room_id, name)
                    values (:id, :room, :name) on conflict do nothing"""),
            {"id": f"t_{room_no}", "room": room_id, "name": f"ผู้เช่า {room_no}"},
        )

        # Same numbers as the prototype, so "ครั้งก่อน" matches what the web app shows today.
        water = 110 + (idx % 7) * 3
        elec = 520 + (idx % 9) * 21
        add_reading(conn, room_id, PREV_PERIOD, water - 4, water, elec - 30, elec)
        if idx <= ROOMS_READ_THIS_PERIOD:
            add_reading(conn, room_id, PERIOD, water, water + 5, elec, elec + 31)

    for room_no, periods in MOCK_ARREARS.items():
        for period in periods:
            add_unpaid_invoice(conn, room_no, period)


def add_reading(conn: Connection, room_id: str, period: str,
                water_prev: int, water_now: int, elec_prev: int, elec_now: int) -> None:
    conn.execute(
        text("""insert into readings (id, room_id, period, water_prev, water_now, elec_prev, elec_now)
                values (:id, :room, :period, :wp, :wn, :ep, :en) on conflict do nothing"""),
        {"id": reading_id(room_id, period), "room": room_id, "period": period,
         "wp": water_prev, "wn": water_now, "ep": elec_prev, "en": elec_now},
    )


def add_unpaid_invoice(conn: Connection, room_no: str, period: str) -> None:
    water_units, elec_units = MOCK_UNITS[period]
    items = [
        ("ค่าเช่า", 1, RENT_METER),
        ("ค่าน้ำ", water_units, WATER_RATE),
        ("ค่าไฟ", elec_units, ELEC_RATE),
    ]
    total = sum(qty * price for _, qty, price in items)
    created = conn.execute(
        text("""insert into invoices (id, room_id, period, rent, total, due_date, status)
                values (:id, :room, :period, :rent, :total, cast(:due as date), 'unpaid')
                on conflict do nothing returning id"""),
        {"id": invoice_id(f"r_{room_no}", period), "room": f"r_{room_no}", "period": period,
         "rent": RENT_METER, "total": total, "due": f"{period}-09"},
    ).first()
    if created is None:
        return  # already seeded: adding items again would double them
    for label, qty, price in items:
        conn.execute(
            text("""insert into invoice_items (invoice_id, label, qty, unit_price, amount)
                    values (:inv, :label, :qty, :price, :amount)"""),
            {"inv": created.id, "label": label, "qty": qty, "price": price, "amount": qty * price},
        )


def main() -> None:
    with get_engine().begin() as conn:
        seed(conn)
    print(f"seeded {PROPERTY_ID}: {len(room_numbers())} rooms")


if __name__ == "__main__":
    main()
