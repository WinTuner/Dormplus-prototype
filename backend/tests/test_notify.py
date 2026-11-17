"""notify_invoices — one queued LINE message per bill that has a tenant to send it to."""
from datetime import date

from app import notify


class Recorder:
    """Stands in for the Procrastinate app so no test writes a job into a real queue."""

    def __init__(self):
        self.calls = []
        self.batches = 0
        self._ids = 0

    def open(self):
        calls = self.calls

        class Ctx:
            def __enter__(self_inner):
                return None

            def __exit__(self_inner, *exc):
                return False

        return Ctx()

    def configure_task(self, name):
        assert name == "line.push_text"
        outer = self

        class Push:
            def batch_defer(self, *kwargs_list):
                outer.batches += 1
                ids = []
                for kwargs in kwargs_list:
                    outer.calls.append(kwargs)
                    outer._ids += 1
                    ids.append(outer._ids)
                return ids

        return Push()


class Unopened:
    def open(self):
        raise AssertionError("the queue must not be opened when there is nothing to send")


def row(invoice_id="inv_201_2026-11", line_user_id="U_201", room_no="201"):
    return {"id": invoice_id, "period": "2026-11", "total": 3562, "due_date": date(2026, 11, 9),
            "room_no": room_no, "line_user_id": line_user_id}


def test_one_job_per_invoice(monkeypatch):
    recorder = Recorder()
    monkeypatch.setattr(notify, "app", recorder)

    count, first = notify.notify_invoices([
        row(),
        row(invoice_id="inv_202_2026-11", line_user_id="U_202", room_no="202"),
    ])

    assert (count, first) == (2, "1")
    assert recorder.batches == 1  # one insert for both rows
    assert [c["kind"] for c in recorder.calls] == ["invoice", "invoice"]
    assert [c["to_user_id"] for c in recorder.calls] == ["U_201", "U_202"]
    assert [c["invoice_id"] for c in recorder.calls] == ["inv_201_2026-11", "inv_202_2026-11"]
    assert "201" in recorder.calls[0]["body"] and "3,562" in recorder.calls[0]["body"]


def test_a_room_without_a_tenant_is_skipped(monkeypatch):
    recorder = Recorder()
    monkeypatch.setattr(notify, "app", recorder)

    assert notify.notify_invoices([row(line_user_id=None)]) == (0, None)
    assert recorder.calls == []


def test_nothing_to_send_does_not_open_the_queue(monkeypatch):
    monkeypatch.setattr(notify, "app", Unopened())
    assert notify.notify_invoices([]) == (0, None)
