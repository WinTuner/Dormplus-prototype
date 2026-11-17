"""Verify a LIFF idToken with LINE.

LIFF runs in the user's phone, so the idToken it sends cannot be trusted on its own:
it has to be checked against LINE's verify endpoint. The `sub` in the answer is the LINE
userId we store in `tenants.line_user_id`.
"""
from app import line_push
from app.errors import ApiError

VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify"


def verify_id_token(id_token: str, channel_id: str) -> dict:
    # Imported here so app start-up does not pay for httpx; the shared client reuses
    # one keep-alive connection instead of a fresh TLS handshake per login.
    import httpx

    try:
        response = line_push.client().post(VERIFY_URL, data={"id_token": id_token, "client_id": channel_id})
        if response.status_code >= 400:
            raise ApiError(401, "UNAUTHORIZED", "idToken ไม่ถูกต้องหรือหมดอายุ")
        payload = response.json()
    except (httpx.HTTPError, OSError, ValueError):
        raise ApiError(502, "UPSTREAM", "ต่อ LINE ไม่ได้")

    if not isinstance(payload, dict):
        raise ApiError(502, "UPSTREAM", "ต่อ LINE ไม่ได้")
    if payload.get("aud") != channel_id:
        raise ApiError(401, "UNAUTHORIZED", "idToken ไม่ได้ออกให้ OA นี้")
    if not payload.get("sub"):
        raise ApiError(401, "UNAUTHORIZED", "idToken ไม่มี userId")
    return payload
