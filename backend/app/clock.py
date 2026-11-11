"""Today's date in Thailand. Routes take it through Depends(today) so tests can fix the date."""
from datetime import date, datetime, timedelta, timezone

BANGKOK = timezone(timedelta(hours=7))  # Thailand has no daylight saving
PERIOD_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"


def today() -> date:
    return datetime.now(BANGKOK).date()


def period_of(day: date) -> str:
    return day.strftime("%Y-%m")
