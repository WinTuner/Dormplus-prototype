"""Verify a LIFF idToken with LINE.

LIFF runs in the user's phone, so the idToken it sends cannot be trusted on its own:
it has to be checked against LINE's verify endpoint. The `sub` in the answer is the LINE
userId we store in `tenants.line_user_id`.
"""
import json
import urllib.error
import urllib.parse
import urllib.request

from app.errors import ApiError

VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify"


def verify_id_token(id_token: str, channel_id: str) -> dict:
    data = urllib.parse.urlencode({"id_token": id_token, "client_id": channel_id}).encode()
    request = urllib.request.Request(VERIFY_URL, data=data, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            payload = json.loads(response.read())
    except urllib.error.HTTPError:
        raise ApiError(401, "UNAUTHORIZED", "idToken ไม่ถูกต้องหรือหมดอายุ")
    except (urllib.error.URLError, OSError, ValueError):
        raise ApiError(502, "UPSTREAM", "ต่อ LINE ไม่ได้")

    if payload.get("aud") != channel_id:
        raise ApiError(401, "UNAUTHORIZED", "idToken ไม่ได้ออกให้ OA นี้")
    if not payload.get("sub"):
        raise ApiError(401, "UNAUTHORIZED", "idToken ไม่มี userId")
    return payload
