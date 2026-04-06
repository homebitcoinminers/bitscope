import asyncio
import collections
import csv
import io
import json
import logging
import os
from version import VERSION, BUILD_DATE
from datetime import datetime, timedelta, timezone

# In-memory log ring buffer — last 500 lines shown in UI
_log_buffer = collections.deque(maxlen=500)

class BufferHandler(logging.Handler):
    def emit(self, record):
        try:
            _log_buffer.append({
                "ts": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
                "level": record.levelname,
                "name": record.name,
                "msg": self.format(record),
            })
        except Exception:
            pass  # never let logging crash the app

_buf_handler = BufferHandler()
_buf_handler.setFormatter(logging.Formatter("%(message)s"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
    handlers=[logging.StreamHandler(), _buf_handler],
)
logger = logging.getLogger("bitscope")

from typing import Optional, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select, func
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from database import init_db, get_session, engine
from models import (
    Device, MetricSnapshot, Session as DBSession,
    ThresholdConfig, AlertLog, ScanConfig,
    HWNonceEvent, DigestConfig,
)
from scanner import scan_and_discover, poll_all_devices, upsert_device, fetch_device_info, get_discord_enabled, set_discord_enabled
import nonce_tracker
from nonce_tracker import get_nonce_stats, get_nonce_history, send_daily_digest
import profiles as profile_store
import aiohttp

def isoZ(dt):
    """Serialize datetime as UTC ISO string with Z suffix so browsers parse it correctly."""
    if dt is None:
        return None
    return dt.strftime('%Y-%m-%dT%H:%M:%SZ')


scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    poll_interval = int(os.getenv("POLL_INTERVAL", "30"))
    scan_interval = int(os.getenv("SCAN_INTERVAL", "300"))

    scheduler.add_job(poll_all_devices, "interval", seconds=poll_interval, id="poll")
    scheduler.add_job(scan_and_discover, "interval", seconds=scan_interval, id="scan")
    scheduler.add_job(_check_daily_digest, "interval", minutes=5, id="digest_check")
    scheduler.start()

    # Initial scan on startup
    asyncio.create_task(scan_and_discover())

    yield
    scheduler.shutdown()


app = FastAPI(title="BitScope", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Devices ──────────────────────────────────────────────────────────────────

@app.get("/api/devices")
def list_devices(db: Session = Depends(get_session)):
    devices = db.exec(select(Device)).all()
    result = []
    for d in devices:
        # Get latest snapshot
        latest = db.exec(
            select(MetricSnapshot)
            .where(MetricSnapshot.mac == d.mac)
            .order_by(MetricSnapshot.ts.desc())
        ).first()

        # Active session
        active_session = db.exec(
            select(DBSession).where(
                DBSession.mac == d.mac,
                DBSession.ended_at == None,
            )
        ).first()

        result.append({
            "mac": d.mac,
            "label": d.label,
            "notes": d.notes,
            "model": d.model,
            "asic_model": d.asic_model,
            "asic_count": d.asic_count,
            "firmware_version": d.firmware_version,
            "first_seen": isoZ(d.first_seen),
            "last_seen": isoZ(d.last_seen),
            "last_ip": d.last_ip,
            "hostname": d.hostname,
            "is_manual": d.is_manual,
            "archived": d.archived,
            "hw_nonce_total": d.hw_nonce_total,
            "hw_nonce_rate_1h": d.hw_nonce_rate_1h,
            "pinned_fields": json.loads(d.pinned_fields) if d.pinned_fields else [],
            "active_session_id": active_session.id if active_session else None,
            "latest": _snapshot_dict(latest) if latest else None,
        })
    return result


@app.get("/api/devices/{mac}")
def get_device(mac: str, db: Session = Depends(get_session)):
    mac = mac.upper()
    device = db.get(Device, mac)
    if not device:
        raise HTTPException(404, "Device not found")
    latest = db.exec(
        select(MetricSnapshot).where(MetricSnapshot.mac == mac).order_by(MetricSnapshot.ts.desc())
    ).first()
    active_session = db.exec(
        select(DBSession).where(DBSession.mac == mac, DBSession.ended_at == None)
    ).first()
    sessions = db.exec(select(DBSession).where(DBSession.mac == mac).order_by(DBSession.started_at.desc())).all()
    return {
        "mac": device.mac,
        "label": device.label,
        "notes": device.notes,
        "model": device.model,
        "asic_model": device.asic_model,
        "asic_count": device.asic_count,
        "board_version": device.board_version,
        "firmware_version": device.firmware_version,
        "first_seen": isoZ(device.first_seen),
        "last_seen": isoZ(device.last_seen),
        "last_ip": device.last_ip,
        "hostname": device.hostname,
        "is_manual": device.is_manual,
        "archived": device.archived,
        "hw_nonce_total": device.hw_nonce_total,
        "hw_nonce_rate_1h": device.hw_nonce_rate_1h,
        "pinned_fields": json.loads(device.pinned_fields) if device.pinned_fields else [],
        "active_session_id": active_session.id if active_session else None,
        "latest": _snapshot_dict(latest) if latest else None,
        "sessions": [_session_dict(s) for s in sessions],
    }


@app.patch("/api/devices/{mac}")
def update_device(mac: str, body: dict, db: Session = Depends(get_session)):
    mac = mac.upper()
    device = db.get(Device, mac)
    if not device:
        raise HTTPException(404, "Device not found")
    if "label" in body:
        device.label = body["label"]
    if "notes" in body:
        device.notes = body["notes"]
    if "pinned_fields" in body:
        device.pinned_fields = json.dumps(body["pinned_fields"])
    db.commit()
    db.refresh(device)
    return {"ok": True}


@app.post("/api/devices/add")
async def add_device_manually(body: dict, db: Session = Depends(get_session)):
    """Manually add a device by IP or hostname."""
    ip = body.get("ip")
    if not ip:
        raise HTTPException(400, "ip is required")
    async with aiohttp.ClientSession() as http:
        data = await fetch_device_info(ip, http)
    if not data:
        raise HTTPException(400, f"Could not reach a miner at {ip}")
    device, is_new = upsert_device(data, db, is_manual=True)
    return {"mac": device.mac, "is_new": is_new, "model": device.model}


@app.post("/api/devices/{mac}/identify")
async def identify_device(mac: str, db: Session = Depends(get_session)):
    mac = mac.upper()
    device = db.get(Device, mac)
    if not device or not device.last_ip:
        raise HTTPException(404, "Device not found or no IP known")
    async with aiohttp.ClientSession() as http:
        try:
            async with http.post(f"http://{device.last_ip}/api/system/identify") as r:
                return {"ok": r.status == 200}
        except Exception as e:
            raise HTTPException(500, str(e))


@app.delete("/api/devices/{mac}")
def delete_device(mac: str, db: Session = Depends(get_session)):
    mac = mac.upper()
    device = db.get(Device, mac)
    if not device:
        raise HTTPException(404)
    db.delete(device)
    db.commit()
    return {"ok": True}


@app.post("/api/devices/{mac}/archive")
def archive_device(mac: str, db: Session = Depends(get_session)):
    mac = mac.upper()
    device = db.get(Device, mac)
    if not device:
        raise HTTPException(404)
    device.archived = True
    db.commit()
    return {"ok": True, "archived": True}


@app.post("/api/devices/{mac}/unarchive")
def unarchive_device(mac: str, db: Session = Depends(get_session)):
    mac = mac.upper()
    device = db.get(Device, mac)
    if not device:
        raise HTTPException(404)
    device.archived = False
    db.commit()
    return {"ok": True, "archived": False}


# ── Metrics ───────────────────────────────────────────────────────────────────

@app.get("/api/devices/{mac}/metrics")
def get_metrics(
    mac: str,
    hours: Optional[int] = Query(None),
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    session_id: Optional[int] = Query(None),
    db: Session = Depends(get_session),
):
    mac = mac.upper()
    q = select(MetricSnapshot).where(MetricSnapshot.mac == mac)

    if session_id is not None:
        q = q.where(MetricSnapshot.session_id == session_id)
    elif since:
        q = q.where(MetricSnapshot.ts >= since)
    elif hours:
        q = q.where(MetricSnapshot.ts >= datetime.utcnow() - timedelta(hours=hours))

    if until:
        q = q.where(MetricSnapshot.ts <= until)

    q = q.order_by(MetricSnapshot.ts.asc())
    snapshots = db.exec(q).all()
    return [_snapshot_dict(s) for s in snapshots]


@app.get("/api/devices/{mac}/raw/{snapshot_id}")
def get_raw_snapshot(mac: str, snapshot_id: int, db: Session = Depends(get_session)):
    snap = db.get(MetricSnapshot, snapshot_id)
    if not snap or snap.mac != mac.upper():
        raise HTTPException(404)
    return json.loads(snap.raw) if snap.raw else {}


# ── Sessions ──────────────────────────────────────────────────────────────────

@app.get("/api/sessions")
def list_sessions(db: Session = Depends(get_session)):
    sessions = db.exec(select(DBSession).order_by(DBSession.started_at.desc())).all()
    result = []
    for s in sessions:
        device = db.get(Device, s.mac)
        result.append({**_session_dict(s), "device_label": device.label if device else None, "device_model": device.model if device else None})
    return result


@app.post("/api/devices/{mac}/sessions")
def start_session(mac: str, body: dict = {}, db: Session = Depends(get_session)):
    mac = mac.upper()
    device = db.get(Device, mac)
    if not device:
        raise HTTPException(404, "Device not found")
    # End any existing active session first
    existing = db.exec(select(DBSession).where(DBSession.mac == mac, DBSession.ended_at == None)).first()
    if existing:
        existing.ended_at = datetime.utcnow()
        db.commit()
    session = DBSession(mac=mac, label=body.get("label"), notes=body.get("notes"))
    db.add(session)
    db.commit()
    db.refresh(session)
    return _session_dict(session)


@app.post("/api/sessions/{session_id}/end")
def end_session(session_id: int, body: dict = {}, db: Session = Depends(get_session)):
    session = db.get(DBSession, session_id)
    if not session:
        raise HTTPException(404)
    session.ended_at = datetime.utcnow()

    # Auto-generate verdict
    device = db.get(Device, session.mac)
    verdict, reasons = _generate_verdict(session, device, db)
    session.verdict = verdict
    session.verdict_reasons = json.dumps(reasons)
    if body.get("notes"):
        session.notes = body["notes"]
    db.commit()
    db.refresh(session)
    return _session_dict(session)


@app.get("/api/sessions/{session_id}/export/csv")
def export_session_csv(session_id: int, db: Session = Depends(get_session)):
    session = db.get(DBSession, session_id)
    if not session:
        raise HTTPException(404)
    device = db.get(Device, session.mac)
    snapshots = db.exec(
        select(MetricSnapshot).where(MetricSnapshot.session_id == session_id).order_by(MetricSnapshot.ts.asc())
    ).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["BitScope QA Report"])
    writer.writerow(["MAC", session.mac])
    writer.writerow(["Device", device.label or device.hostname or session.mac if device else session.mac])
    writer.writerow(["Model", device.model if device else ""])
    writer.writerow(["Session", session.label or f"Session #{session.id}"])
    writer.writerow(["Started", session.started_at])
    writer.writerow(["Ended", session.ended_at or "In progress"])
    writer.writerow(["Verdict", session.verdict or "Pending"])
    writer.writerow([])
    writer.writerow(["Timestamp", "Hashrate GH/s", "Hashrate 1m", "Temp °C", "VR Temp °C",
                     "Power W", "Voltage mV", "Frequency MHz", "Fan RPM", "Error %",
                     "Shares Accepted", "Shares Rejected", "Best Diff", "Uptime s"])
    for s in snapshots:
        writer.writerow([
            s.ts, s.hashrate, s.hashrate_1m, s.temp, s.vr_temp,
            s.power, s.voltage, s.frequency, s.fan_rpm, s.error_percentage,
            s.shares_accepted, s.shares_rejected, s.best_diff, s.uptime_seconds,
        ])
    output.seek(0)
    filename = f"bitscope_{session.mac.replace(':','')}_session{session_id}.csv"
    return StreamingResponse(output, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ── Thresholds ────────────────────────────────────────────────────────────────

@app.get("/api/thresholds")
def list_thresholds(db: Session = Depends(get_session)):
    return db.exec(select(ThresholdConfig)).all()


@app.get("/api/thresholds/{scope:path}")
def get_threshold(scope: str, db: Session = Depends(get_session)):
    t = db.exec(select(ThresholdConfig).where(ThresholdConfig.scope == scope)).first()
    if not t:
        raise HTTPException(404)
    return t


@app.put("/api/thresholds/{scope:path}")
def upsert_threshold(scope: str, body: dict, db: Session = Depends(get_session)):
    t = db.exec(select(ThresholdConfig).where(ThresholdConfig.scope == scope)).first()
    if not t:
        t = ThresholdConfig(scope=scope)
        db.add(t)
    for field in ["temp_max", "vr_temp_max", "power_over_spec_pct", "error_pct_max",
                  "duplicate_hw_nonces_max", "ping_loss_max", "fan_rpm_min",
                  "hashrate_below_expected_pct", "wifi_rssi_min", "offline_after_polls",
                  "power_max_w"]:
        if field in body:
            setattr(t, field, body[field])
    db.commit()
    db.refresh(t)
    return t


@app.delete("/api/thresholds/{scope:path}")
def delete_threshold(scope: str, db: Session = Depends(get_session)):
    if scope == "global":
        raise HTTPException(400, "Cannot delete global defaults")
    t = db.exec(select(ThresholdConfig).where(ThresholdConfig.scope == scope)).first()
    if not t:
        raise HTTPException(404)
    db.delete(t)
    db.commit()
    return {"ok": True}


# ── Alert settings ─────────────────────────────────────────────────────────────

# In-memory alert type enable/disable (persists via settings endpoint)
# Defaults: all enabled
_alert_types_enabled: dict = {
    "overheat": True,
    "vr_overheat": True,
    "asic_overheat": True,
    "error_rate": True,
    "hw_nonce": True,
    "power_over_spec": True,
    "fan_failure": True,
    "weak_wifi": True,
    "offline": True,
    "online": True,
    "new_device": True,
    "new_best_diff": True,
    "hw_nonce_rate": True,
    "hw_nonce_digest": True,
}


@app.get("/api/settings/alerts")
def get_alert_settings():
    return _alert_types_enabled

@app.post("/api/settings/alerts")
def set_alert_settings(body: dict):
    for k, v in body.items():
        if k in _alert_types_enabled:
            _alert_types_enabled[k] = bool(v)
    return _alert_types_enabled


# ── Alerts ────────────────────────────────────────────────────────────────────

@app.get("/api/alerts")
def list_alerts(limit: int = 100, db: Session = Depends(get_session)):
    alerts = db.exec(select(AlertLog).order_by(AlertLog.ts.desc()).limit(limit)).all()
    return alerts


# ── Scanner ───────────────────────────────────────────────────────────────────

@app.get("/api/scanner/subnets")
def list_subnets(db: Session = Depends(get_session)):
    return db.exec(select(ScanConfig)).all()


@app.post("/api/scanner/subnets")
def add_subnet(body: dict, db: Session = Depends(get_session)):
    sc = ScanConfig(subnet=body["subnet"], label=body.get("label"), enabled=body.get("enabled", True))
    db.add(sc)
    db.commit()
    db.refresh(sc)
    return sc


@app.delete("/api/scanner/subnets/{subnet_id}")
def delete_subnet(subnet_id: int, db: Session = Depends(get_session)):
    sc = db.get(ScanConfig, subnet_id)
    if not sc:
        raise HTTPException(404)
    db.delete(sc)
    db.commit()
    return {"ok": True}


@app.post("/api/scanner/scan")
async def trigger_scan():
    asyncio.create_task(scan_and_discover())
    return {"ok": True, "message": "Scan started"}


# ── Stats ─────────────────────────────────────────────────────────────────────

@app.get("/api/stats/fleet")
def fleet_stats(db: Session = Depends(get_session)):
    devices = db.exec(select(Device)).all()
    online = 0
    total_hashrate = 0.0
    total_power = 0.0
    active_sessions = 0
    cutoff = datetime.utcnow() - timedelta(minutes=3)

    for d in devices:
        latest = db.exec(
            select(MetricSnapshot).where(MetricSnapshot.mac == d.mac).order_by(MetricSnapshot.ts.desc())
        ).first()
        if latest and latest.ts > cutoff:
            online += 1
            total_hashrate += latest.hashrate or 0
            total_power += latest.power or 0
        sess = db.exec(select(DBSession).where(DBSession.mac == d.mac, DBSession.ended_at == None)).first()
        if sess:
            active_sessions += 1

    efficiency = (total_power / (total_hashrate / 1000)) if total_hashrate > 0 else 0
    return {
        "total_devices": len(devices),
        "online": online,
        "offline": len(devices) - online,
        "total_hashrate_gh": round(total_hashrate, 2),
        "total_power_w": round(total_power, 2),
        "efficiency_w_per_th": round(efficiency, 2),
        "active_sessions": active_sessions,
    }


@app.get("/api/stats/fleet/history")
def fleet_history(hours: int = 24, db: Session = Depends(get_session)):
    """Aggregated fleet hashrate/power/efficiency over time for graphing."""
    since = datetime.utcnow() - timedelta(hours=hours)
    snapshots = db.exec(
        select(MetricSnapshot).where(MetricSnapshot.ts >= since).order_by(MetricSnapshot.ts.asc())
    ).all()

    # Bucket into 10-minute intervals
    from collections import defaultdict
    buckets = defaultdict(lambda: {"hashrate": [], "power": []})
    for s in snapshots:
        bucket = s.ts.replace(second=0, microsecond=0)
        bucket = bucket.replace(minute=(s.ts.minute // 10) * 10)
        key = bucket.strftime("%Y-%m-%dT%H:%M:%SZ")
        if s.hashrate: buckets[key]["hashrate"].append(s.hashrate)
        if s.power: buckets[key]["power"].append(s.power)

    result = []
    for ts_key in sorted(buckets.keys()):
        b = buckets[ts_key]
        hr = sum(b["hashrate"]) if b["hashrate"] else 0
        pw = sum(b["power"]) if b["power"] else 0
        eff = (pw / (hr / 1000)) if hr > 0 else 0
        result.append({
            "ts": ts_key,
            "hashrate_gh": round(hr, 2),
            "power_w": round(pw, 2),
            "efficiency": round(eff, 2),
        })
    return result


# 24hr max temp per device for table column
@app.get("/api/stats/devices/maxtemp")
def devices_max_temp(db: Session = Depends(get_session)):
    since = datetime.utcnow() - timedelta(hours=24)
    devices = db.exec(select(Device)).all()
    result = {}
    for d in devices:
        snaps = db.exec(
            select(MetricSnapshot.temp).where(
                MetricSnapshot.mac == d.mac,
                MetricSnapshot.ts >= since,
                MetricSnapshot.temp != None,
            )
        ).all()
        if snaps:
            result[d.mac] = round(max(snaps), 1)
    return result


@app.get("/api/export/csv")
def export_metrics_csv(
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    mac: Optional[str] = Query(None),
    db: Session = Depends(get_session),
):
    """Export all metric data for a date range, optionally filtered by device."""
    q = select(MetricSnapshot)
    if mac and mac != 'all':
        q = q.where(MetricSnapshot.mac == mac.upper())
    if since:
        q = q.where(MetricSnapshot.ts >= since)
    if until:
        q = q.where(MetricSnapshot.ts <= until)
    q = q.order_by(MetricSnapshot.ts.asc())
    snapshots = db.exec(q).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["BitScope — Metric Export"])
    writer.writerow(["Generated", datetime.utcnow().isoformat() + "Z"])
    writer.writerow(["Device", mac or "all"])
    writer.writerow(["From", since or "beginning"])
    writer.writerow(["To", until or "now"])
    writer.writerow(["Total rows", len(snapshots)])
    writer.writerow([])
    writer.writerow([
        "Timestamp", "MAC", "Session ID",
        "Hashrate GH/s", "Hashrate 1m", "Hashrate 10m", "Hashrate 1h",
        "Expected Hashrate", "Temp °C", "VR Temp °C",
        "Power W", "Voltage mV", "Frequency MHz",
        "Core Voltage mV", "Core Voltage Actual mV",
        "Fan RPM", "Fan2 RPM", "Fan Speed %",
        "Error %", "Shares Accepted", "Shares Rejected",
        "Best Diff", "Best Session Diff",
        "Uptime s", "WiFi RSSI dBm",
        "ASIC Temps", "Duplicate HW Nonces",
        "Ping RTT ms", "Ping Loss %", "Pool Difficulty",
        "Max Power W", "Min Power W",
    ])
    for s in snapshots:
        writer.writerow([
            s.ts.strftime('%Y-%m-%dT%H:%M:%SZ'), s.mac, s.session_id,
            s.hashrate, s.hashrate_1m, s.hashrate_10m, s.hashrate_1h,
            s.expected_hashrate, s.temp, s.vr_temp,
            s.power, s.voltage, s.frequency,
            s.core_voltage, s.core_voltage_actual,
            s.fan_rpm, s.fan2_rpm, s.fan_speed,
            s.error_percentage, s.shares_accepted, s.shares_rejected,
            s.best_diff, s.best_session_diff,
            s.uptime_seconds, s.wifi_rssi,
            s.asic_temps, s.duplicate_hw_nonces,
            s.last_ping_rtt, s.recent_ping_loss, s.pool_difficulty,
            s.max_power, s.min_power,
        ])
    output.seek(0)
    tag = mac.replace(':', '') if mac and mac != 'all' else 'all'
    filename = f"bitscope_export_{tag}_{datetime.utcnow().strftime('%Y%m%d')}.csv"
    return StreamingResponse(output, media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ── HW Nonce API ─────────────────────────────────────────────────────────────

@app.get("/api/devices/{mac}/nonces")
def get_device_nonces(mac: str, db: Session = Depends(get_session)):
    mac = mac.upper()
    device = db.get(Device, mac)
    if not device:
        raise HTTPException(404)
    return get_nonce_stats(mac, db)


@app.get("/api/devices/{mac}/nonces/history")
def get_nonce_history_endpoint(mac: str, hours: int = 24, db: Session = Depends(get_session)):
    mac = mac.upper()
    return get_nonce_history(mac, hours, db)


@app.get("/api/nonces/fleet")
def fleet_nonce_summary(db: Session = Depends(get_session)):
    """Summary of nonce activity across all devices."""
    devices = db.exec(select(Device)).all()
    results = []
    for d in devices:
        stats = get_nonce_stats(d.mac, db)
        if stats["count_total"] > 0 or stats["rate_1h"] > 0:
            results.append({
                "mac": d.mac,
                "label": d.label or d.hostname or d.mac,
                "model": d.model,
                **stats,
            })
    return sorted(results, key=lambda x: x["rate_1h"], reverse=True)


@app.get("/api/settings/digest")
def get_digest_config(db: Session = Depends(get_session)):
    cfg = db.exec(select(DigestConfig)).first()
    if not cfg:
        cfg = DigestConfig()
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


@app.patch("/api/settings/digest")
def update_digest_config(body: dict, db: Session = Depends(get_session)):
    cfg = db.exec(select(DigestConfig)).first()
    if not cfg:
        cfg = DigestConfig()
        db.add(cfg)
    for field in ["enabled", "hour_utc", "minute_utc"]:
        if field in body:
            setattr(cfg, field, body[field])
    db.commit()
    db.refresh(cfg)
    return cfg


@app.post("/api/settings/digest/send-now")
async def send_digest_now():
    """Trigger an immediate digest send."""
    asyncio.create_task(send_daily_digest())
    return {"ok": True}


async def _check_daily_digest():
    """Check if it's time to send the daily digest."""
    with Session(engine) as db:
        cfg = db.exec(select(DigestConfig)).first()
        if not cfg or not cfg.enabled:
            return
        now = datetime.utcnow()
        if cfg.last_sent:
            hours_since = (now - cfg.last_sent).total_seconds() / 3600
            if hours_since < 23:
                return
        if now.hour == cfg.hour_utc and now.minute < 10:
            await send_daily_digest()
            cfg.last_sent = now
            db.commit()



# ── Device configuration (PATCH proxy to AxeOS) ──────────────────────────────

async def _patch_device(ip: str, payload: dict) -> dict:
    """Send a PATCH request to a device's AxeOS API."""
    try:
        async with aiohttp.ClientSession() as http:
            async with http.patch(
                f"http://{ip}/api/system",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=10),
                headers={"Host": ip, "Content-Type": "application/json"},
            ) as resp:
                status = resp.status
                try:
                    body = await resp.json(content_type=None)
                except Exception:
                    body = {}
                return {"ok": status in (200, 204), "status": status, "body": body}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def _restart_device(ip: str) -> dict:
    """POST restart to a device."""
    try:
        async with aiohttp.ClientSession() as http:
            async with http.post(
                f"http://{ip}/api/system/restart",
                timeout=aiohttp.ClientTimeout(total=8),
                headers={"Host": ip},
            ) as resp:
                return {"ok": resp.status in (200, 204)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/api/devices/{mac}/asic-info")
async def get_asic_info(mac: str, db: Session = Depends(get_session)):
    """Fetch /api/system/asic from the device for frequency/voltage options."""
    mac = mac.upper()
    device = db.get(Device, mac)
    if not device or not device.last_ip:
        raise HTTPException(404, "Device not found or no IP")
    async with aiohttp.ClientSession() as http:
        try:
            async with http.get(
                f"http://{device.last_ip}/api/system/asic",
                timeout=aiohttp.ClientTimeout(total=8),
                headers={"Host": device.last_ip},
            ) as resp:
                if resp.status == 200:
                    return await resp.json(content_type=None)
                raise HTTPException(502, f"Device returned {resp.status}")
        except Exception as e:
            raise HTTPException(502, str(e))


@app.post("/api/devices/{mac}/configure/pool")
async def configure_pool(mac: str, body: dict, db: Session = Depends(get_session)):
    """Push pool config to a single device."""
    mac = mac.upper()
    device = db.get(Device, mac)
    if not device or not device.last_ip:
        raise HTTPException(404, "Device not found or no IP")

    payload = {}
    for field in [
        "stratumURL", "stratumPort", "stratumUser", "stratumPassword",
        "stratumTLS", "stratumEnonceSubscribe",
        "fallbackStratumURL", "fallbackStratumPort", "fallbackStratumUser",
        "fallbackStratumPassword", "fallbackStratumTLS",
    ]:
        if field in body:
            payload[field] = body[field]

    result = await _patch_device(device.last_ip, payload)
    if body.get("restart") and result["ok"]:
        await asyncio.sleep(0.5)
        await _restart_device(device.last_ip)
    return result


@app.post("/api/devices/{mac}/configure/system")
async def configure_system(mac: str, body: dict, db: Session = Depends(get_session)):
    """Push system/fan/display config to a single device."""
    mac = mac.upper()
    device = db.get(Device, mac)
    if not device or not device.last_ip:
        raise HTTPException(404, "Device not found or no IP")

    payload = {}
    for field in [
        "hostname", "autofanspeed", "fanspeed", "temptarget", "minFanSpeed",
        "displayTimeout", "rotation", "invertscreen", "autoscreenoff",
        "statsFrequency", "overheat_temp",
    ]:
        if field in body:
            payload[field] = body[field]

    result = await _patch_device(device.last_ip, payload)
    if body.get("restart") and result["ok"]:
        await asyncio.sleep(0.5)
        await _restart_device(device.last_ip)
    return result


@app.post("/api/devices/{mac}/configure/tuning")
async def configure_tuning(mac: str, body: dict, db: Session = Depends(get_session)):
    """Push frequency/voltage to a single device. Requires explicit confirmation flag."""
    mac = mac.upper()
    if not body.get("confirmed"):
        raise HTTPException(400, "Must include confirmed=true to change frequency/voltage")
    device = db.get(Device, mac)
    if not device or not device.last_ip:
        raise HTTPException(404, "Device not found or no IP")

    # Always enable overclocking first, then set values
    payload = {"overclockEnabled": 1}
    if "frequency" in body:
        payload["frequency"] = int(body["frequency"])
    if "coreVoltage" in body:
        payload["coreVoltage"] = int(body["coreVoltage"])

    result = await _patch_device(device.last_ip, payload)

    # Log tuning change for audit trail
    if result["ok"]:
        alert = AlertLog(
            mac=mac,
            alert_type="tuning_change",
            message=f"Tuning updated: freq={body.get('frequency')}MHz, voltage={body.get('coreVoltage')}mV",
            value=f"freq={body.get('frequency')}, volt={body.get('coreVoltage')}",
        )
        with Session(engine) as log_db:
            log_db.add(alert)
            log_db.commit()

    if body.get("restart") and result["ok"]:
        await asyncio.sleep(0.5)
        await _restart_device(device.last_ip)
    return result


@app.post("/api/devices/{mac}/restart")
async def restart_device_endpoint(mac: str, db: Session = Depends(get_session)):
    """Restart a single device."""
    mac = mac.upper()
    device = db.get(Device, mac)
    if not device or not device.last_ip:
        raise HTTPException(404)
    return await _restart_device(device.last_ip)


@app.post("/api/fleet/configure/pool")
async def fleet_configure_pool(body: dict, db: Session = Depends(get_session)):
    """Push pool config to multiple devices simultaneously."""
    macs = [m.upper() for m in body.get("macs", [])]
    if not macs:
        raise HTTPException(400, "macs list required")

    pool_payload = {}
    for field in [
        "stratumURL", "stratumPort", "stratumUser", "stratumPassword",
        "stratumTLS", "fallbackStratumURL", "fallbackStratumPort",
        "fallbackStratumUser", "fallbackStratumPassword", "fallbackStratumTLS",
    ]:
        if field in body:
            pool_payload[field] = body[field]

    results = {}
    tasks = []

    async def push_one(mac: str, ip: str):
        r = await _patch_device(ip, pool_payload)
        if body.get("restart") and r["ok"]:
            await asyncio.sleep(0.3)
            await _restart_device(ip)
        results[mac] = r

    for mac in macs:
        device = db.get(Device, mac)
        if device and device.last_ip:
            tasks.append(push_one(mac, device.last_ip))
        else:
            results[mac] = {"ok": False, "error": "No IP known"}

    await asyncio.gather(*tasks)

    success = sum(1 for r in results.values() if r.get("ok"))
    return {
        "total": len(macs),
        "success": success,
        "failed": len(macs) - success,
        "results": results,
    }


@app.get("/api/logs")
def get_logs(limit: int = 200, level: str = "ALL"):
    """Return recent in-memory log lines."""
    logs = list(_log_buffer)
    if level != "ALL":
        logs = [l for l in logs if l["level"] == level]
    return list(reversed(logs[-limit:]))


# ── Profiles ─────────────────────────────────────────────────────────────────

import re as _re

def _clean_id(s: str) -> str:
    return _re.sub(r'[^a-zA-Z0-9_-]', '_', s.lower().replace(' ', '_'))[:48]


@app.get("/api/profiles")
def list_profiles(type: str | None = None):
    return profile_store.list_profiles(type)


@app.get("/api/profiles/{profile_type}/{profile_id}")
def get_profile(profile_type: str, profile_id: str):
    p = profile_store.get_profile(profile_type, profile_id)
    if not p:
        raise HTTPException(404, "Profile not found")
    return p


@app.post("/api/profiles/{profile_type}/{profile_id}")
def save_profile_endpoint(profile_type: str, profile_id: str, body: dict):
    if profile_type not in ("pool", "system", "hardware"):
        raise HTTPException(400, "Invalid profile type")
    clean_id = _clean_id(profile_id)
    return profile_store.save_profile(profile_type, clean_id, body)


@app.delete("/api/profiles/{profile_type}/{profile_id}")
def delete_profile_endpoint(profile_type: str, profile_id: str):
    if profile_id in ("hbm_default", "hbm_system_default", "nerdqaxe_default"):
        raise HTTPException(400, "Cannot delete built-in default profiles")
    ok = profile_store.delete_profile(profile_type, profile_id)
    if not ok:
        raise HTTPException(404)
    return {"ok": True}


@app.post("/api/devices/{mac}/profiles/capture")
async def capture_profile_from_device(mac: str, body: dict, db: Session = Depends(get_session)):
    """Capture current device settings as a typed profile."""
    mac = mac.upper()
    profile_type = body.get("type", "pool")
    if profile_type not in ("pool", "system", "hardware"):
        raise HTTPException(400, "Invalid profile type")
    device = db.get(Device, mac)
    if not device or not device.last_ip:
        raise HTTPException(404, "Device not found or no IP")
    async with aiohttp.ClientSession() as http:
        try:
            async with http.get(
                f"http://{device.last_ip}/api/system/info",
                timeout=aiohttp.ClientTimeout(total=8),
                headers={"Host": device.last_ip},
            ) as resp:
                if resp.status != 200:
                    raise HTTPException(502, "Could not reach device")
                raw = await resp.json(content_type=None)
        except Exception as e:
            raise HTTPException(502, str(e))

    name = body.get("name") or f"{device.label or device.hostname or mac} {profile_type}"
    profile_id = _clean_id(name)
    p = profile_store.capture_from_snapshot(raw, profile_type, name)
    return profile_store.save_profile(profile_type, profile_id, p)


@app.get("/api/devices/{mac}/profiles/preview-hostname")
def preview_hostname(mac: str, template: str, db: Session = Depends(get_session)):
    """Preview what a hostname template resolves to for a specific device."""
    mac = mac.upper()
    device = db.get(Device, mac)
    if not device:
        raise HTTPException(404)
    result = profile_store.apply_hostname_template(template, {
        "mac": device.mac, "hostname": device.hostname, "model": device.model,
    })
    return {"preview": result}


@app.post("/api/configure/pool")
async def configure_pool_fleet(body: dict, db: Session = Depends(get_session)):
    """Apply pool profile to one or more devices."""
    macs = [m.upper() for m in body.get("macs", [])]
    if not macs:
        raise HTTPException(400, "macs required")

    payload = {}
    for f in ["stratumURL","stratumPort","stratumUser","stratumPassword","stratumTLS",
              "fallbackStratumURL","fallbackStratumPort","fallbackStratumUser",
              "fallbackStratumPassword","fallbackStratumTLS"]:
        if f in body:
            payload[f] = body[f]
    if "stratumPort" in payload:
        payload["stratumPort"] = int(payload["stratumPort"])
    if "fallbackStratumPort" in payload:
        payload["fallbackStratumPort"] = int(payload["fallbackStratumPort"])

    results = {}
    async def push(mac, ip):
        r = await _patch_device(ip, payload)
        if body.get("restart") and r["ok"]:
            await asyncio.sleep(0.3)
            await _restart_device(ip)
        results[mac] = r
        if r["ok"]:
            al = AlertLog(mac=mac, alert_type="configure_apply",
                message=f"Pool profile applied: {body.get('_profile_name','custom')}")
            with Session(engine) as ldb:
                ldb.add(al); ldb.commit()

    tasks = []
    for mac in macs:
        device = db.get(Device, mac)
        if device and device.last_ip:
            tasks.append(push(mac, device.last_ip))
        else:
            results[mac] = {"ok": False, "error": "No IP known"}
    await asyncio.gather(*tasks)
    success = sum(1 for r in results.values() if r.get("ok"))
    return {"total": len(macs), "success": success, "failed": len(macs)-success, "results": results}


@app.post("/api/configure/system")
async def configure_system_fleet(body: dict, db: Session = Depends(get_session)):
    """Apply system profile to one or more devices."""
    macs = [m.upper() for m in body.get("macs", [])]
    if not macs:
        raise HTTPException(400, "macs required")

    results = {}
    async def push(mac, ip, device):
        payload = {}
        # Hostname template
        template = body.get("hostname_template", "")
        if template:
            hostname = profile_store.apply_hostname_template(template, {
                "mac": device.mac, "hostname": device.hostname, "model": device.model,
            })
            payload["hostname"] = hostname
        # WiFi — only if both fields provided
        if body.get("wifi_ssid") and body.get("wifi_password"):
            payload["ssid"] = body["wifi_ssid"]
            payload["wifiPass"] = body["wifi_password"]
        for f in ["displayTimeout","rotation","invertscreen","autoscreenoff","statsFrequency"]:
            if f in body:
                payload[f] = body[f]
        # Fan settings in system profile (if included)
        if "autofanspeed" in body:
            if body["autofanspeed"]:
                payload["autofanspeed"] = "Auto Fan Control (PID)"
            else:
                payload["autofanspeed"] = ""
        if "fanspeed" in body:
            payload["fanspeed"] = int(body["fanspeed"])
        if "temptarget" in body:
            payload["temptarget"] = int(body["temptarget"])
        if not payload:
            results[mac] = {"ok": True, "skipped": True, "msg": "Nothing to apply"}
            return
        r = await _patch_device(ip, payload)
        if body.get("restart") and r["ok"]:
            await asyncio.sleep(0.3)
            await _restart_device(ip)
        results[mac] = r
        if r["ok"]:
            al = AlertLog(mac=mac, alert_type="configure_apply",
                message=f"System profile applied: {body.get('_profile_name','custom')}")
            with Session(engine) as ldb:
                ldb.add(al); ldb.commit()

    tasks = []
    for mac in macs:
        device = db.get(Device, mac)
        if device and device.last_ip:
            tasks.append(push(mac, device.last_ip, device))
        else:
            results[mac] = {"ok": False, "error": "No IP known"}
    await asyncio.gather(*tasks)
    success = sum(1 for r in results.values() if r.get("ok"))
    return {"total": len(macs), "success": success, "failed": len(macs)-success, "results": results}


@app.post("/api/configure/hardware")
async def configure_hardware(body: dict, db: Session = Depends(get_session)):
    """Apply hardware profile — per device only OR fleet if confirmed and same model."""
    if not body.get("confirmed"):
        raise HTTPException(400, "confirmed=true required for hardware changes")

    macs = [m.upper() for m in body.get("macs", [])]
    if not macs:
        raise HTTPException(400, "macs required")

    model_lock = body.get("model_lock")

    # Validate all devices are same model if model_lock set
    if model_lock:
        mismatched = []
        for mac in macs:
            device = db.get(Device, mac)
            if device and device.model != model_lock:
                mismatched.append({"mac": mac, "model": device.model})
        if mismatched:
            raise HTTPException(400, {
                "error": "Model mismatch — hardware profiles can only be applied to matching device types",
                "model_lock": model_lock,
                "mismatched": mismatched,
            })

    results = {}
    async def push(mac, ip):
        payload = {"overclockEnabled": 1}
        if body.get("use_factory_defaults"):
            payload = {"overclockEnabled": 0}
        else:
            if body.get("frequency"):
                payload["frequency"] = int(body["frequency"])
            if body.get("coreVoltage"):
                payload["coreVoltage"] = int(body["coreVoltage"])
        # Fan settings always apply
        # Fan control — AxeOS variants differ:
        # Standard Bitaxe: autofanspeed=0/1 (integer)
        # NerdQAxe++/NerdOCTAxe: autofanspeed="" (manual) or "Auto Fan Control (PID)" (auto)
        # We send both the string and integer forms; the device will use whichever it understands
        if "autofanspeed" in body:
            if body["autofanspeed"]:
                payload["autofanspeed"] = "Auto Fan Control (PID)"
            else:
                payload["autofanspeed"] = ""
        if "fanspeed" in body:
            payload["fanspeed"] = int(body["fanspeed"])
        if "temptarget" in body:
            payload["temptarget"] = int(body["temptarget"])
        if "overheat_temp" in body:
            payload["overheat_temp"] = int(body["overheat_temp"])

        r = await _patch_device(ip, payload)
        if body.get("restart") and r["ok"]:
            await asyncio.sleep(0.5)
            await _restart_device(ip)
        results[mac] = r
        # Always log hardware changes
        device = db.get(Device, mac)
        al = AlertLog(mac=mac, alert_type="configure_apply",
            message=f"Hardware profile applied: {body.get('_profile_name','custom')} — freq={body.get('frequency')} volt={body.get('coreVoltage')}")
        with Session(engine) as ldb:
            ldb.add(al); ldb.commit()

    tasks = []
    for mac in macs:
        device = db.get(Device, mac)
        if device and device.last_ip:
            tasks.append(push(mac, device.last_ip))
        else:
            results[mac] = {"ok": False, "error": "No IP known"}
    await asyncio.gather(*tasks)
    success = sum(1 for r in results.values() if r.get("ok"))
    return {"total": len(macs), "success": success, "failed": len(macs)-success, "results": results}


@app.get("/api/configure/history")
def configure_history(limit: int = 100, db: Session = Depends(get_session)):
    logs = db.exec(
        select(AlertLog).where(AlertLog.alert_type == "configure_apply")
        .order_by(AlertLog.ts.desc()).limit(limit)
    ).all()
    return logs


# ── Settings ──────────────────────────────────────────────────────────────────

@app.get("/api/settings")
def get_settings():
    return {
        "discord_enabled": get_discord_enabled(),
        "poll_interval": int(os.getenv("POLL_INTERVAL", "30")),
        "scan_interval": int(os.getenv("SCAN_INTERVAL", "300")),
        "alert_types": _alert_types_enabled,
        "version": VERSION,
        "build_date": BUILD_DATE,
    }

@app.post("/api/settings/discord/toggle")
def toggle_discord():
    new_state = not get_discord_enabled()
    set_discord_enabled(new_state)
    return {"discord_enabled": new_state}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _snapshot_dict(s: MetricSnapshot) -> dict:
    if not s:
        return None
    return {
        "id": s.id,
        "mac": s.mac,
        "ts": isoZ(s.ts),
        "session_id": s.session_id,
        "hashrate": s.hashrate,
        "hashrate_1m": s.hashrate_1m,
        "hashrate_10m": s.hashrate_10m,
        "hashrate_1h": s.hashrate_1h,
        "hashrate_1d": s.hashrate_1d,
        "expected_hashrate": s.expected_hashrate,
        "temp": s.temp,
        "vr_temp": s.vr_temp,
        "power": s.power,
        "voltage": s.voltage,
        "frequency": s.frequency,
        "core_voltage": s.core_voltage,
        "core_voltage_actual": s.core_voltage_actual,
        "fan_rpm": s.fan_rpm,
        "fan2_rpm": s.fan2_rpm,
        "fan_speed": s.fan_speed,
        "error_percentage": s.error_percentage,
        "shares_accepted": s.shares_accepted,
        "shares_rejected": s.shares_rejected,
        "best_diff": s.best_diff,
        "best_session_diff": s.best_session_diff,
        "uptime_seconds": s.uptime_seconds,
        "wifi_rssi": s.wifi_rssi,
        "asic_temps": json.loads(s.asic_temps) if s.asic_temps else None,
        "duplicate_hw_nonces": s.duplicate_hw_nonces,
        "last_ping_rtt": s.last_ping_rtt,
        "recent_ping_loss": s.recent_ping_loss,
        "pool_difficulty": s.pool_difficulty,
        "max_power": s.max_power,
        "min_power": s.min_power,
    }


def _session_dict(s: DBSession) -> dict:
    return {
        "id": s.id,
        "mac": s.mac,
        "label": s.label,
        "notes": s.notes,
        "started_at": isoZ(s.started_at),
        "ended_at": isoZ(s.ended_at),
        "verdict": s.verdict,
        "verdict_reasons": json.loads(s.verdict_reasons) if s.verdict_reasons else [],
        "duration_minutes": int((s.ended_at - s.started_at).total_seconds() / 60) if s.ended_at else None,
    }


def _generate_verdict(session: DBSession, device: Device, db: Session) -> tuple[str, list]:
    snapshots = db.exec(
        select(MetricSnapshot).where(MetricSnapshot.session_id == session.id)
    ).all()
    if not snapshots:
        return "WARN", ["No metrics recorded during session"]

    reasons = []
    verdict = "PASS"

    from database import get_thresholds
    thresh = get_thresholds(session.mac, device.model if device else None, db)

    temps = [s.temp for s in snapshots if s.temp]
    if temps and thresh.temp_max:
        over = [t for t in temps if t > thresh.temp_max]
        if len(over) > len(temps) * 0.1:
            verdict = "FAIL"
            reasons.append(f"Temperature exceeded {thresh.temp_max}°C in {len(over)}/{len(temps)} polls (max {max(temps):.1f}°C)")

    errors = [s.error_percentage for s in snapshots if s.error_percentage is not None]
    if errors and thresh.error_pct_max:
        avg_err = sum(errors) / len(errors)
        if avg_err > thresh.error_pct_max:
            verdict = "FAIL"
            reasons.append(f"Average error rate {avg_err:.2f}% exceeds {thresh.error_pct_max}%")

    nonces = [s.duplicate_hw_nonces for s in snapshots if s.duplicate_hw_nonces is not None]
    if nonces and any(n > 0 for n in nonces):
        verdict = "FAIL"
        reasons.append(f"Duplicate HW nonces detected: {max(nonces)}")

    powers = [s.power for s in snapshots if s.power and s.max_power]
    over_power = [s for s in snapshots if s.power and s.max_power and s.power > s.max_power * 1.1]
    if over_power:
        if verdict != "FAIL":
            verdict = "WARN"
        reasons.append(f"Power exceeded device spec in {len(over_power)}/{len(snapshots)} polls")

    if not reasons:
        reasons.append("All metrics within thresholds for full session duration")

    return verdict, reasons
