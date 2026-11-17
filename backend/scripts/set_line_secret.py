"""Store this dorm's Messaging API channel secret, encrypted, in `properties.line_secret_enc`.

    cd backend && python scripts/set_line_secret.py            # then paste the secret + Enter
    cd backend && python scripts/set_line_secret.py --clear    # go back to LINE_CHANNEL_SECRET

The secret is read from stdin so it never lands in shell history or the process list. It is encrypted
with `SECRET_ENC_KEY`; the API must hold the same key, otherwise the webhook answers
503 LINE_SECRET_UNREADABLE (a wrong key is fixable, a wrong secret is not).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, text  # noqa: E402

from app import secrets  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import attach_property  # noqa: E402

SET_SQL = text("update properties set line_secret_enc = :blob where id = :id returning id")


def main() -> int:
    settings = get_settings()
    clear = "--clear" in sys.argv[1:]
    blob = None if clear else (sys.stdin.readline().strip() or None)
    if not clear and not blob:
        print("ไม่มีค่าให้บันทึก: วาง secret ทาง stdin หรือใส่ --clear", file=sys.stderr)
        return 2

    engine = attach_property(create_engine(settings.database_url), settings.property_id)
    try:
        with engine.begin() as conn:
            row = conn.execute(
                SET_SQL, {"blob": secrets.encrypt(blob) if blob else None, "id": settings.property_id}
            ).first()
    finally:
        engine.dispose()

    if row is None:
        print(f"ไม่พบหอ {settings.property_id} ในฐานข้อมูล", file=sys.stderr)
        return 1
    print("ล้าง line_secret_enc แล้ว (กลับไปใช้ LINE_CHANNEL_SECRET)" if clear
          else f"บันทึก secret ของหอ {settings.property_id} แล้ว ({len(blob)} ตัวอักษร, เข้ารหัสแล้ว)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
