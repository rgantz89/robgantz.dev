"""Uptime check for robgantz.dev.

Runs every 5 minutes from EventBridge. Each run:
  1. Requests each page and records status, latency, and whether the security headers are present.
  2. Reads the TLS certificate's expiry date.
  3. Emits CloudWatch metrics through Embedded Metric Format (structured log lines, no extra API calls).
  4. Adds the result to a per-day item in DynamoDB.
  5. Rebuilds status/status.json from the last 30 days and writes it to the site bucket.

Standard library plus boto3 only, both of which the Lambda runtime provides.
"""

import datetime as dt
import json
import os
import socket
import ssl
import time
import urllib.error
import urllib.request

DOMAIN = os.environ.get("SITE_DOMAIN", "robgantz.dev")
PATHS = [p for p in os.environ.get("CHECK_PATHS", "/").split(",") if p]
TABLE = os.environ.get("TABLE_NAME", "")
BUCKET = os.environ.get("STATUS_BUCKET", "")
KEY = os.environ.get("STATUS_KEY", "status/status.json")
SLO = float(os.environ.get("SLO_TARGET", "0.999"))
INTERVAL_MIN = int(os.environ.get("INTERVAL_MIN", "5"))
METRIC_NS = os.environ.get("METRIC_NS", "RobGantz/Uptime")

WINDOW_DAYS = 30
SLOW_MS = 2000
REQUIRED_HEADERS = ("content-security-policy", "strict-transport-security")
PK = f"site#{DOMAIN}"


# --- Checks -------------------------------------------------------------------

def check_page(path, timeout=10):
    """Fetch one page. Returns status code (0 if unreachable), latency in ms, and lowercased headers."""
    req = urllib.request.Request(
        f"https://{DOMAIN}{path}",
        headers={"User-Agent": "robgantz-uptime/1.0 (+https://robgantz.dev/status.html)"},
    )
    start = time.perf_counter()
    status, headers = 0, {}
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            resp.read()
            status = resp.status
            headers = {k.lower(): v for k, v in resp.headers.items()}
    except urllib.error.HTTPError as err:
        status = err.code
        headers = {k.lower(): v for k, v in err.headers.items()}
    except (urllib.error.URLError, socket.timeout, ConnectionError, ssl.SSLError):
        status = 0
    latency_ms = round((time.perf_counter() - start) * 1000)
    return status, latency_ms, headers


def cert_days_left(timeout=10):
    """Days until the TLS certificate served for DOMAIN expires, or None if the handshake fails."""
    ctx = ssl.create_default_context()
    try:
        with socket.create_connection((DOMAIN, 443), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=DOMAIN) as tls:
                not_after = tls.getpeercert()["notAfter"]
    except (OSError, ssl.SSLError, KeyError):
        return None
    expires = ssl.cert_time_to_seconds(not_after)
    return int((expires - time.time()) // 86400)


def run_checks():
    pages = []
    for path in PATHS:
        status, ms, headers = check_page(path)
        pages.append({
            "path": path,
            "status": status,
            "ms": ms,
            "headersOk": all(h in headers for h in REQUIRED_HEADERS),
        })
    home = pages[0]
    all_ok = all(p["status"] == 200 for p in pages)
    headers_ok = all(p["headersOk"] for p in pages if p["status"] == 200) and home["status"] == 200
    if home["status"] != 200:
        state = "down"
    elif not all_ok or not headers_ok or home["ms"] > SLOW_MS:
        state = "degraded"
    else:
        state = "operational"
    return {
        "state": state,
        "ok": all_ok,
        "latencyMs": home["ms"],
        "headersOk": headers_ok,
        "certDaysLeft": cert_days_left(),
        "pages": pages,
    }


# --- Metrics (CloudWatch Embedded Metric Format) -------------------------------

def emit_metrics(result, now):
    metrics = {
        "Availability": 1 if result["ok"] else 0,
        "LatencyMs": result["latencyMs"],
        "HeadersOK": 1 if result["headersOk"] else 0,
    }
    units = {"Availability": "None", "LatencyMs": "Milliseconds", "HeadersOK": "None", "CertDaysLeft": "Count"}
    if result["certDaysLeft"] is not None:
        metrics["CertDaysLeft"] = result["certDaysLeft"]
    print(json.dumps({
        "_aws": {
            "Timestamp": int(now.timestamp() * 1000),
            "CloudWatchMetrics": [{
                "Namespace": METRIC_NS,
                "Dimensions": [["Site"]],
                "Metrics": [{"Name": k, "Unit": units[k]} for k in metrics],
            }],
        },
        "Site": DOMAIN,
        "state": result["state"],
        **metrics,
    }))


# --- History ------------------------------------------------------------------

def record(ddb, result, now):
    """Add this check to today's item: counters, a latency sample, and a timestamp if it failed."""
    day = now.strftime("%Y-%m-%d")
    expires = int((now + dt.timedelta(days=40)).timestamp())
    expr = (
        "ADD checks :one, oks :ok "
        "SET lat = list_append(if_not_exists(lat, :empty), :ms), expires = :exp"
    )
    values = {
        ":one": {"N": "1"},
        ":ok": {"N": "1" if result["ok"] else "0"},
        ":empty": {"L": []},
        ":ms": {"L": [{"N": str(result["latencyMs"])}]},
        ":exp": {"N": str(expires)},
    }
    if not result["ok"]:
        expr += ", fails = list_append(if_not_exists(fails, :empty), :f)"
        values[":f"] = {"L": [{"S": now.strftime("%H:%M")}]}
    ddb.update_item(
        TableName=TABLE,
        Key={"pk": {"S": PK}, "sk": {"S": day}},
        UpdateExpression=expr,
        ExpressionAttributeValues=values,
    )


def load_days(ddb, now):
    start = (now - dt.timedelta(days=WINDOW_DAYS - 1)).strftime("%Y-%m-%d")
    resp = ddb.query(
        TableName=TABLE,
        KeyConditionExpression="pk = :pk AND sk >= :start",
        ExpressionAttributeValues={":pk": {"S": PK}, ":start": {"S": start}},
    )
    days = []
    for item in resp.get("Items", []):
        days.append({
            "date": item["sk"]["S"],
            "checks": int(item.get("checks", {}).get("N", "0")),
            "oks": int(item.get("oks", {}).get("N", "0")),
            "lat": [int(x["N"]) for x in item.get("lat", {}).get("L", [])],
            "fails": [x["S"] for x in item.get("fails", {}).get("L", [])],
        })
    return days


# --- Status document (pure, unit tested) ---------------------------------------

def percentile(values, pct):
    if not values:
        return None
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, round(pct / 100 * (len(ordered) - 1))))
    return ordered[idx]


def build_status(days, result, now, slo=SLO, interval_min=INTERVAL_MIN, window_days=WINDOW_DAYS):
    by_date = {d["date"]: d for d in days}
    checks = sum(d["checks"] for d in days)
    oks = sum(d["oks"] for d in days)
    failed = checks - oks

    # Error budget over a full rolling window: (1 - SLO) of 30 days is 43.2 minutes at 99.9%.
    budget_min = round((1 - slo) * window_days * 24 * 60, 1)
    used_min = failed * interval_min
    remaining_pct = max(0.0, round((budget_min - used_min) / budget_min * 100, 1)) if budget_min else 100.0

    # Last 24 hours of latency: samples are appended in order, so take the tail of yesterday + today.
    per_day = 24 * 60 // interval_min
    recent = []
    for offset in (1, 0):
        key = (now - dt.timedelta(days=offset)).strftime("%Y-%m-%d")
        recent.extend(by_date.get(key, {}).get("lat", []))
    recent = recent[-per_day:]

    daily = []
    for i in range(window_days - 1, -1, -1):
        key = (now - dt.timedelta(days=i)).strftime("%Y-%m-%d")
        d = by_date.get(key)
        daily.append({
            "date": key,
            "checks": d["checks"] if d else 0,
            "uptime": round(d["oks"] / d["checks"], 5) if d and d["checks"] else None,
            "fails": d["fails"] if d else [],
        })

    return {
        "site": DOMAIN,
        "generatedAt": now.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "intervalMinutes": interval_min,
        "current": result,
        "slo": {
            "target": slo,
            "windowDays": window_days,
            "uptime": round(oks / checks, 5) if checks else None,
            "checks": checks,
            "failed": failed,
            "budgetMinutes": budget_min,
            "budgetUsedMinutes": used_min,
            "budgetRemainingPct": remaining_pct,
        },
        "latency24h": {
            "p50": percentile(recent, 50),
            "p95": percentile(recent, 95),
            "samples": recent,
        },
        "trackingSince": min(by_date) if by_date else now.strftime("%Y-%m-%d"),
        "days": daily,
    }


# --- Entry point --------------------------------------------------------------

def handler(event=None, context=None):
    import boto3  # imported here so the pure functions above can be tested without it

    now = dt.datetime.now(dt.timezone.utc)
    result = run_checks()
    emit_metrics(result, now)

    ddb = boto3.client("dynamodb")
    record(ddb, result, now)
    status = build_status(load_days(ddb, now), result, now)

    boto3.client("s3").put_object(
        Bucket=BUCKET,
        Key=KEY,
        Body=json.dumps(status, separators=(",", ":")).encode(),
        ContentType="application/json; charset=utf-8",
        CacheControl="public,max-age=60",
    )
    return {"state": result["state"], "uptime30d": status["slo"]["uptime"]}
