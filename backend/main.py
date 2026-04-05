import json
import os
import csv
import io
from datetime import datetime, timedelta
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
    ThresholdConfig, AlertLog, ScanConfig
)
from scanner import scan_and_discover, poll_all_devices, upsert_device, fetch_device_info
import aiohttp

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    poll_interval = int(os.getenv("POLL_INTERVAL", "30"))
    scan_interval = int(os.getenv("SCAN_INTERVAL", "300"))

    scheduler.add_job(poll_all_devices, "interval", seconds=poll_interval, id="poll")
    scheduler.add_job(scan_and_discover, "interval", seconds=scan_interval, id="scan")
    scheduler.start()

    # Initial scan on startup
    import asyncio
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
            "first_seen": d.first_seen,
            "last_seen": d.last_seen,
            "last_ip": d.last_ip,
            "hostname": d.hostname,
            "is_manual": d.is_manual,
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
        "first_seen": device.first_seen,
        "last_seen": device.last_seen,
        "last_ip": device.last_ip,
        "hostname": device.hostname,
        "is_manual": device.is_manual,
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
                  "hashrate_below_expected_pct", "wifi_rssi_min", "offline_after_polls"]:
        if field in body:
            setattr(t, field, body[field])
    db.commit()
    db.refresh(t)
    return t


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
    import asyncio
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
    cutoff = datetime.utcnow() - timedelta(minutes=2)

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


# ── Helpers ───────────────────────────────────────────────────────────────────

def _snapshot_dict(s: MetricSnapshot) -> dict:
    if not s:
        return None
    return {
        "id": s.id,
        "mac": s.mac,
        "ts": s.ts,
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
        "started_at": s.started_at,
        "ended_at": s.ended_at,
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
