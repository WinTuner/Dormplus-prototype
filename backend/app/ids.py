"""Ids and kinds that show up in logs, so they read the same everywhere."""
from typing import Literal

ReminderKind = Literal["reminder_1", "reminder_5", "reminder_10"]

_REMINDER_KINDS: dict[int, ReminderKind] = {1: "reminder_1", 5: "reminder_5", 10: "reminder_10"}


def reading_id(room_id: str, period: str) -> str:
    """One reading per room per period, so the id is derived from both: r_201 + 2026-11 -> rd_201_2026-11."""
    return f"rd_{room_id.removeprefix('r_')}_{period}"


def invoice_id(room_id: str, period: str) -> str:
    """One invoice per room per period: r_201 + 2026-11 -> inv_201_2026-11."""
    return f"inv_{room_id.removeprefix('r_')}_{period}"


def payment_id(invoice_id: str) -> str:
    """One slip per invoice: inv_201_2026-11 -> pay_201_2026-11."""
    return f"pay_{invoice_id.removeprefix('inv_')}"


def reminder_kind(days_late: int) -> ReminderKind:
    """The message_log kind for dunning: reminder_1 / _5 / _10."""
    return _REMINDER_KINDS[days_late]
