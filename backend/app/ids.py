"""Readable string ids, as in docs/API.md (r_203, inv_..., rd_...)."""


def reading_id(room_id: str, period: str) -> str:
    """One reading per room per period, so the id is derived from both: r_201 + 2026-11 -> rd_201_2026-11."""
    return f"rd_{room_id.removeprefix('r_')}_{period}"
