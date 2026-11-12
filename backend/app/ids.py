"""Readable string ids, as in docs/API.md (r_203, inv_..., rd_...)."""


def reading_id(room_id: str, period: str) -> str:
    """One reading per room per period, so the id is derived from both: r_201 + 2026-11 -> rd_201_2026-11."""
    return f"rd_{room_id.removeprefix('r_')}_{period}"


def invoice_id(room_id: str, period: str) -> str:
    """One invoice per room per period: r_201 + 2026-11 -> inv_201_2026-11."""
    return f"inv_{room_id.removeprefix('r_')}_{period}"


def payment_id(invoice_id: str) -> str:
    """One slip per invoice: inv_201_2026-11 -> pay_201_2026-11."""
    return f"pay_{invoice_id.removeprefix('inv_')}"
