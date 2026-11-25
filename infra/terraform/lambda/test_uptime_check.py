"""Unit tests for the pure parts of the uptime checker. Run: python -m pytest -q"""
import datetime as dt
import io
import json
from contextlib import redirect_stdout

import uptime_check as uc

NOW = dt.datetime(2026, 11, 25, 12, 0, tzinfo=dt.timezone.utc)


def day(offset, checks, oks, lat=None, fails=None):
    return {
        "date": (NOW - dt.timedelta(days=offset)).strftime("%Y-%m-%d"),
        "checks": checks, "oks": oks, "lat": lat or [], "fails": fails or [],
    }


def result(ok=True, ms=120):
    return {"state": "operational" if ok else "down", "ok": ok, "latencyMs": ms,
            "headersOk": True, "certDaysLeft": 195, "pages": []}


def test_error_budget_is_43_minutes_at_three_nines():
    s = uc.build_status([day(0, 288, 288)], result(), NOW, slo=0.999)
    assert s["slo"]["budgetMinutes"] == 43.2
    assert s["slo"]["budgetRemainingPct"] == 100.0
    assert s["slo"]["uptime"] == 1.0


def test_failed_checks_consume_budget():
    # 2 failed 5-minute checks = 10 of 43.2 minutes used
    s = uc.build_status([day(1, 288, 288), day(0, 100, 98)], result(), NOW, slo=0.999)
    assert s["slo"]["failed"] == 2
    assert s["slo"]["budgetUsedMinutes"] == 10
    assert s["slo"]["budgetRemainingPct"] == round((43.2 - 10) / 43.2 * 100, 1)


def test_budget_never_goes_negative():
    s = uc.build_status([day(0, 288, 200)], result(), NOW, slo=0.999)
    assert s["slo"]["budgetRemainingPct"] == 0.0


def test_daily_series_covers_30_days_with_gaps_as_null():
    s = uc.build_status([day(0, 10, 10), day(5, 288, 287)], result(), NOW)
    assert len(s["days"]) == 30
    assert s["days"][-1]["date"] == "2026-11-25"
    assert s["days"][-1]["uptime"] == 1.0
    assert s["days"][-6]["uptime"] == round(287 / 288, 5)
    assert s["days"][0]["uptime"] is None
    assert s["trackingSince"] == "2026-11-20"


def test_latency_window_is_last_24_hours_across_midnight():
    yesterday = list(range(300))      # more than a day of samples
    today = [1000, 1001, 1002]
    s = uc.build_status([day(1, 300, 300, lat=yesterday), day(0, 3, 3, lat=today)], result(), NOW)
    samples = s["latency24h"]["samples"]
    assert len(samples) == 288        # 24h at 5-minute intervals
    assert samples[-3:] == today
    assert s["latency24h"]["p95"] is not None


def test_percentile():
    assert uc.percentile([], 95) is None
    assert uc.percentile([5], 95) == 5
    assert uc.percentile(list(range(1, 101)), 50) in (50, 51)
    assert uc.percentile(list(range(1, 101)), 95) in (95, 96)


class FakeDdb:
    def __init__(self):
        self.calls = []

    def update_item(self, **kw):
        self.calls.append(kw)


def test_record_success_does_not_log_a_failure():
    ddb = FakeDdb()
    uc.record(ddb, result(ok=True, ms=150), NOW)
    kw = ddb.calls[0]
    assert kw["Key"]["sk"]["S"] == "2026-11-25"
    assert kw["ExpressionAttributeValues"][":ok"]["N"] == "1"
    assert kw["ExpressionAttributeValues"][":ms"]["L"] == [{"N": "150"}]
    assert "fails" not in kw["UpdateExpression"]


def test_record_failure_logs_time():
    ddb = FakeDdb()
    uc.record(ddb, result(ok=False), NOW)
    kw = ddb.calls[0]
    assert kw["ExpressionAttributeValues"][":ok"]["N"] == "0"
    assert kw["ExpressionAttributeValues"][":f"]["L"] == [{"S": "12:00"}]


def test_metrics_are_valid_embedded_metric_format():
    buf = io.StringIO()
    with redirect_stdout(buf):
        uc.emit_metrics(result(ms=210), NOW)
    doc = json.loads(buf.getvalue())
    names = [m["Name"] for m in doc["_aws"]["CloudWatchMetrics"][0]["Metrics"]]
    assert set(names) == {"Availability", "LatencyMs", "HeadersOK", "CertDaysLeft"}
    for n in names:
        assert n in doc
    assert doc["Availability"] == 1 and doc["LatencyMs"] == 210
    assert doc["Site"] == uc.DOMAIN


def test_metrics_skip_cert_when_handshake_failed():
    r = result()
    r["certDaysLeft"] = None
    buf = io.StringIO()
    with redirect_stdout(buf):
        uc.emit_metrics(r, NOW)
    doc = json.loads(buf.getvalue())
    assert "CertDaysLeft" not in doc
