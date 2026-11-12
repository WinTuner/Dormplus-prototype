<!-- generated-by: gsd-doc-writer -->
# DormPlus — Getting Started

DormPlus bills dorm rooms from meter readings and chases the arrears. This repo is the runnable
prototype: a Python standard-library HTTP server, a real SQLite database, and two web screens
(owner / tenant). Five minutes from clone to a full billing round.

Everything below was run against this repository. Commands are Windows-first because the project
ships `start-prototype.bat`; the bash equivalent is noted where it differs.

## Prerequisites

| Need | Version | Why |
|---|---|---|
| Python | 3.8 or newer | `server.py` uses only the standard library (`http.server`, `sqlite3`, `json`). Verified on 3.13.17. |
| SQLite | 3.24 or newer | Bundled with Python. 3.24 is the floor because `save_reading()` uses `ON CONFLICT ... DO UPDATE` (`server.py:201`). |
| A modern browser | any current version | The pages call the API with `fetch`, so they must be served over `http://` — opening the HTML from disk (`file://`) is blocked by the browser. |
| Free TCP port | 8777 | Hardcoded in `server.py:361`. |

You do **not** need Node.js, Docker, Postgres, or a separate database server. There is no
`requirements.txt`, no `pip install`, and no `.env` file.

## Install

There is nothing to install — only the source to fetch.

```bash
git clone https://github.com/WinTuner/domplus-prototype.git
cd domplus-prototype
```

## Run

```bash
python server.py
```

The console prints exactly one line and then stays quiet:

```
PAKDEE demo on http://127.0.0.1:8777  (db: C:\...\pakdee-prototype\domplus.db )
```

Request logging is intentionally disabled (`Handler.log_message` is a no-op at `server.py:353`), so
an idle console is normal, not a hang.

On Windows you can double-click `start-prototype.bat` instead. It opens a console window running
`python server.py`, waits 2 seconds, then opens `http://127.0.0.1:8777` in your browser.

### What to open

| URL | Screen | Who it is for |
|---|---|---|
| http://127.0.0.1:8777/owner | Owner — record meters, run billing, see revenue | Dorm owner |
| http://127.0.0.1:8777/tenant | Tenant — view the invoice, attach a payment slip | Tenant |
| http://127.0.0.1:8777/ | The original LINE-style prototype, whole flow on one page | Demoing the flow end to end |

`/` serves `prototype.html` (the LINE-style demo, which talks to `/api/*`). The real web app is
`/owner` and `/tenant`, which talk to `/v1/*`. Both read and write the same SQLite file, so a change
made on one screen shows up on the other after a refresh.

### What the database looks like on first run

`domplus.db` does not exist in a fresh clone (it is gitignored, `.gitignore:1`). The first
`python server.py` creates it from the schema embedded in `server.py` and seeds:

- **42 rooms** — floor 2 ×12, floor 3 ×12, floor 4 ×10, floor 5 ×8 (`201`–`212`, `301`–`312`,
  `401`–`410`, `501`–`508`), all `meter` mode, rent 3,220.
- **Previous-period readings** for every room at period `2026-10`, so the "ครั้งก่อน" numbers on the
  owner screen are real.
- **12 rooms already read** for the current period `2026-11` (the first 12 by id, i.e. `201`–`212`),
  so the progress bar does not start at zero.
- **5 rooms with mock arrears** (`203`, `305`, `312`, `407`, `502`) as unpaid invoices from earlier
  periods, for the notify/overdue screens.

No invoices exist for `2026-11` until you run billing.

## The 6-step walkthrough

This is the whole billing round. It matches the sequence in `README.md` and every button label below
is copied from `web/owner.html` and `web/tenant.html`.

**1. Start from an unread room** — open `/owner` and press the button under the progress card. On a
fresh database it reads **"เริ่มจากห้อง 213 (ยังไม่จด)"**. The entry card opens for that room and
shows the previous reading and the rent.

**2. Type the meter numbers** — fill **"ค่าน้ำครั้งนี้"** and **"ค่าไฟครั้งนี้"**. The line items
recalculate as you type: water units × 25, electricity units × 7, added to rent 3,220. If a number is
lower than the previous reading, the warning **"ค่าน้อยกว่าครั้งก่อน — ตรวจสอบก่อนบันทึก"** appears
(it warns, it does not block).

**3. Save and move on** — press **"บันทึก แล้วไปห้องถัดไป"**. The reading is written through
`PUT /v1/rooms/:id/reading`, the list refreshes, and the entry card reopens on the next unread room
automatically.

**4. Bill the whole property** — press **"ออกบิลทั้งหอ"**. This calls `POST /v1/billing/run` and
creates one invoice per room that has a reading for `2026-11`. The alert reports how many rooms were
processed. Due date is 5 days after the demo "today" (`2026-11-04` + 5 = `2026-11-09`). Bills cannot
duplicate: `UNIQUE(room_id, period)` plus `ON CONFLICT DO NOTHING` means pressing the button again
changes nothing.

**5. Attach a slip as the tenant** — open `/tenant` and press **"แนบสลิป & แจ้งชำระ"**. The invoice
status goes `unpaid` → `pending` and the card switches to **"รอตรวจสอบ"** with the note
**"แนบสลิปแล้ว — รอเจ้าของหอยืนยัน"**. The button hides, so a second tap is impossible.

**6. Check the revenue** — go back to `/owner`. The bottom card shows **ยอดออกบิล**, **ชำระแล้ว**,
**รอตรวจสลิป**, and **ยังไม่ชำระ**, read from `GET /v1/reports/summary`. The money you just marked as
paid-in-pending appears under "รอตรวจสลิป".

### Finishing the round: confirm the payment

The owner screen has no confirm button — `web/owner.html` only renders the reading form, the bill
button, and the summary. To take an invoice from `pending` to `paid`, use either:

- the LINE-style prototype at `/` → the **"ยืนยันการชำระ"** screen (it posts `/api/confirm`), or
- the v1 endpoint directly:

```powershell
$id = (Invoke-RestMethod "http://127.0.0.1:8777/v1/invoices?status=pending").items[0].id
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8777/v1/invoices/$id/confirm"
```

Both write to the same SQLite tables, so `/owner` and `/tenant` reflect the result after a refresh.

## Reset the demo data

`seed()` only runs when the `rooms` table is empty (`server.py:81-84`), so deleting the file is the
only way back to a clean demo. Stop the server first, then delete and restart.

```powershell
# 1. stop the server (close the "PAKDEE server" window, or Ctrl+C)
# 2. delete the database
Remove-Item domplus.db
# 3. start again — seed() recreates and fills it
python server.py
```

In bash / WSL / Git Bash use `rm domplus.db` instead of `Remove-Item`.

After a reset, every reading, invoice, slip, and confirmation is gone, and the 5 mock-arrears rooms
are re-inserted as `unpaid`. You are back to: 42 rooms, 12 already read, 0 invoices for `2026-11`.

## When something does not work

### Where to look, in order

1. **The console window running `server.py`.** Only the startup line and Python tracebacks appear
   here — no request log. A traceback means the process died and every page will fail to load.
2. **The page itself.** Both screens catch load errors and print them in place of content: the owner
   page writes `ต่อ API ไม่ได้: <message>` into the room list card (`web/owner.html:150-152`), the
   tenant page writes the same text into the bill card (`web/tenant.html:82-84`).
3. **Browser DevTools → Network.** Filter on `/v1/`. Error responses follow the contract in
   `docs/API.md`: `{ "error": { "code": "...", "message": "..." } }`. An unknown path returns
   `404 {"error": "not found"}`.
4. **The database.** `domplus.db` is a plain SQLite file next to `server.py`; open it with any SQLite
   browser to see what the server actually stored.

### Known issues

| Symptom | Cause | Fix |
|---|---|---|
| `OSError: [WinError 10048]` / `Address already in use` | Port 8777 is taken — usually a previous server still running in another window | Close the old window, or `Get-NetTCPConnection -LocalPort 8777` to find the PID, or change the port in `server.py:361` (the URLs above change with it) |
| `'python' is not recognized` (Windows) | Python is not on `PATH`; `start-prototype.bat` calls `python` directly | Try `py server.py`, or reinstall Python with "Add python.exe to PATH" checked |
| `/owner` or `/tenant` loads but shows no data | The HTML was opened from disk (`file://`), so `fetch` is blocked | Always use `http://127.0.0.1:8777/owner` and `/tenant` |
| `/` looks nothing like the web app | `/` serves `prototype.html`, the LINE-style demo, not the app | The app is at `/owner` and `/tenant` |
| Changes you make seem to disappear after a restart | You expected a reset but `domplus.db` still exists, so `seed()` skipped | Delete `domplus.db` (see above) |
| A file named `pakdee.db` sits in the folder | Leftover from an older version of the prototype; `server.py` never opens it | Delete it, it is gitignored and unused |
| Reset "did not work" on Windows | The server was still running and holding the file | Stop the server before `Remove-Item domplus.db` |

### Prototype gotchas worth knowing

- **The tenant page is not logged in.** It picks the first non-paid invoice for the period, ordered by
  room number (`web/tenant.html:42`), so after billing it shows room `201`'s invoice, not "yours".
  There is no auth anywhere in the prototype.
- **"ข้ามห้องนี้ (ห้องว่าง)" does not mark the room.** It skips the write and opens the next unread
  room, which can be the same room again if it was the first one unread.
- **Editing a reading after billing does not change the invoice.** Bills are insert-only
  (`ON CONFLICT DO NOTHING`); the reading updates, the invoice does not.
- **`days_overdue` uses the real clock** (`api_v1.py:79`) while due dates come from the fixed demo
  date `2026-11-04`, so overdue counts drift with the calendar. See
  [CONFIGURATION.md](CONFIGURATION.md) for every hardcoded value.

## Next steps

- [ARCHITECTURE.md](ARCHITECTURE.md) — how the server, the `/v1` adapter, and the two screens fit
  together; what the production topology is meant to be.
- [CONFIGURATION.md](CONFIGURATION.md) — every hardcoded constant, its file and line, and how to
  change the port, the billing period, or the rates.
- [API.md](API.md) — the v1 contract the frontend is written against, error codes, and the invoice
  state machine (`unpaid → pending → paid`).
- [HANDOFF.md](HANDOFF.md) — what is still unbuilt (real FastAPI + Postgres backend, LINE OA/LIFF,
  auth, automatic slip verification) and the criteria for calling it done.
- `db/schema.sql` — the Postgres DDL the prototype's SQLite schema stands in for.
