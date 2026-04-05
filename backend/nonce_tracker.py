"""
HW Nonce Tracking Engine
========================
Tracks duplicate hardware nonces across reboots, calculates rolling rates,
fires Discord alerts at configurable thresholds, and sends a daily digest.

Key concepts:
  - delta: nonces that occurred in THIS 30s poll window
  - cumulative: all-time total per device (survives reboots)
  - rate: rolling nonces/hour over last 60 minutes of poll data
  - event: a logged occurrence with timestamp, temp, freq context
"""

import json
import logging
import os
from collections import deque
from datetime import datetime, timedelta
from typing import Optional

import aiohttp
from sqlmodel import Session, select

from database import engine, get_thresholds
from models import Device, MetricSnapshot, HWNonceEvent, AlertLog, DigestConfig

logger = logging.getLogger("bitscope.nonces")

# In-memory state per device
# last_counter[mac] = last known raw counter value (to detect resets and deltas)
_last_counter: dict[str, int] = {}

# Rolling window of (timestamp, delta) tuples for rate calculation
# Keep 2 hours of data to calculate 1h rate
_rate_window: dict[str, deque] = {}
RATE_WINDOW_SECONDS = 7200  # 2 hours kept, 1 hour used for rate

# Consecutive breach tracking for alert debounce
_breach_counts: dict[str, int] = {}  # mac -> consecutive polls breaching threshold
_current_alert_level: dict[str, str] = {}  # mac -> 'warn'|'alert'|'critical'|None


def _rolling_rate(mac: str, window_seconds: int = 3600) -> float:
    """Calculate nonces per hour over the last window_seconds."""
    if mac not in _rate_window:
        return 0.0
    now = datetime.utcnow()
    cutoff = now - timedelta(seconds=window_seconds)
    total = sum(delta for ts, delta in _rate_window[mac] if ts >= cutoff)
    # Convert to per-hour rate
    elapsed = min(window_seconds, (now - min((ts for ts, _ in _rate_window[mac]), default=now)).total_seconds() + 30)
    if elapsed <= 0:
        return 0.0
    return round((total / elapsed) * 3600, 2)


def _rolling_rate_24h(mac: str) -> float:
    """Calculate nonces per day over the last 24h from DB."""
    # This is called for the daily digest — reads from DB
    since = datetime.utcnow() - timedelta(hours=24)
    with Session(engine) as db:
        events = db.exec(
            select(HWNonceEvent).where(
                HWNonceEvent.mac == mac,
                HWNonceEvent.ts >= since,
            )
        ).all()
    total = sum(e.delta for e in events)
    return total  # total count in 24h (not a rate, just a count for the digest)


def process_poll(
    mac: str,
    snapshot: MetricSnapshot,
    device: Device,
    db: Session,
) -> list[dict]:
    """
    Process a fresh poll snapshot for nonce tracking.
    Returns list of alerts to fire (may be empty).
    Updates device.hw_nonce_total and device.hw_nonce_rate_1h in place.
    """
    raw = snapshot.duplicate_hw_nonces
    if raw is None:
        return []

    alerts = []
    now = datetime.utcnow()

    # ── Calculate delta ───────────────────────────────────────────────────────
    last = _last_counter.get(mac)
    if last is None:
        # First poll for this device — initialise, no delta yet
        _last_counter[mac] = raw
        _rate_window[mac] = deque()
        return []

    if raw < last:
        # Counter reset (reboot) — the new value IS the delta since reboot
        delta = raw
        logger.info(f"[nonce] {mac} reboot detected, counter reset {last}→{raw}, delta={delta}")
    else:
        delta = raw - last

    _last_counter[mac] = raw

    # ── Log event if delta > 0 ────────────────────────────────────────────────
    if delta > 0:
        event = HWNonceEvent(
            mac=mac,
            ts=now,
            delta=delta,
            raw_counter=raw,
            uptime_seconds=snapshot.uptime_seconds,
            temp=snapshot.temp,
            frequency=snapshot.frequency,
            core_voltage=snapshot.core_voltage,
            session_id=snapshot.session_id,
        )
        db.add(event)

        # Update cumulative total on device
        dev = db.get(Device, mac)
        if dev:
            dev.hw_nonce_total = (dev.hw_nonce_total or 0) + delta

        # Set delta on snapshot so it's queryable
        snapshot.hw_nonce_delta = delta

        logger.info(f"[nonce] {mac} +{delta} nonces (raw={raw}, temp={snapshot.temp}°C, freq={snapshot.frequency}MHz)")

    # ── Update rolling rate window ────────────────────────────────────────────
    if mac not in _rate_window:
        _rate_window[mac] = deque()
    if delta > 0:
        _rate_window[mac].append((now, delta))
    # Prune old entries
    cutoff = now - timedelta(seconds=RATE_WINDOW_SECONDS)
    while _rate_window[mac] and _rate_window[mac][0][0] < cutoff:
        _rate_window[mac].popleft()

    # Calculate 1h rate
    rate_1h = _rolling_rate(mac, 3600)

    # Update device rate field
    dev = db.get(Device, mac)
    if dev:
        dev.hw_nonce_rate_1h = rate_1h

    # ── Threshold checks ──────────────────────────────────────────────────────
    thresh = get_thresholds(mac, device.model, db)
    warn_thresh  = thresh.hw_nonce_rate_warn     or 1.0
    alert_thresh = thresh.hw_nonce_rate_alert    or 5.0
    crit_thresh  = thresh.hw_nonce_rate_critical or 20.0
    consec_req   = thresh.hw_nonce_consecutive_polls or 3

    # Determine current level
    if rate_1h >= crit_thresh:
        current_level = 'critical'
    elif rate_1h >= alert_thresh:
        current_level = 'alert'
    elif rate_1h >= warn_thresh:
        current_level = 'warn'
    else:
        current_level = None

    prev_level = _current_alert_level.get(mac)

    if current_level:
        _breach_counts[mac] = _breach_counts.get(mac, 0) + 1
    else:
        _breach_counts[mac] = 0

    consec = _breach_counts.get(mac, 0)

    # Fire alert if:
    # 1. Level has escalated (warn→alert→critical)
    # 2. New breach that has persisted for consec_req polls
    # 3. Level has resolved
    if current_level != prev_level:
        if current_level is None and prev_level is not None:
            # Resolved
            _current_alert_level[mac] = None
            alerts.append({
                'type': 'hw_nonce_rate',
                'level': 'resolved',
                'rate_1h': rate_1h,
                'message': f"HW nonce rate back to normal ({rate_1h:.1f}/hr)",
                'resolved': True,
            })
        elif current_level is not None and consec >= consec_req:
            # New or escalated breach
            _current_alert_level[mac] = current_level
            level_icons = {'warn': '⚠️', 'alert': '🔴', 'critical': '🚨'}
            alerts.append({
                'type': 'hw_nonce_rate',
                'level': current_level,
                'rate_1h': rate_1h,
                'message': f"{level_icons.get(current_level,'⚠️')} HW nonce rate: {rate_1h:.1f}/hr ({current_level})",
                'resolved': False,
                'delta_this_poll': delta,
                'cumulative': dev.hw_nonce_total if dev else 0,
                'temp': snapshot.temp,
                'frequency': snapshot.frequency,
            })
    elif current_level is not None and consec == consec_req:
        # First time hitting the consecutive requirement
        _current_alert_level[mac] = current_level
        level_icons = {'warn': '⚠️', 'alert': '🔴', 'critical': '🚨'}
        alerts.append({
            'type': 'hw_nonce_rate',
            'level': current_level,
            'rate_1h': rate_1h,
            'message': f"{level_icons.get(current_level,'⚠️')} HW nonce rate: {rate_1h:.1f}/hr ({current_level})",
            'resolved': False,
            'delta_this_poll': delta,
            'cumulative': dev.hw_nonce_total if dev else 0,
            'temp': snapshot.temp,
            'frequency': snapshot.frequency,
        })

    return alerts


async def send_nonce_alert(alert_data: dict, device: Device):
    """Send a nonce rate Discord alert."""
    from scanner import _discord_enabled, send_discord_alert
    if not _discord_enabled:
        return

    # Check alert type enabled
    try:
        from main import _alert_types_enabled
        if not _alert_types_enabled.get('hw_nonce_rate', True):
            return
    except ImportError:
        pass

    webhook_url = os.getenv("DISCORD_WEBHOOK_URL", "")
    if not webhook_url:
        return

    level = alert_data.get('level', 'warn')
    resolved = alert_data.get('resolved', False)
    rate = alert_data.get('rate_1h', 0)
    label = device.label or device.hostname or device.mac
    model = device.model or "Unknown"

    level_colors = {
        'warn':     0xFFBB00,
        'alert':    0xFF6600,
        'critical': 0xFF0000,
        'resolved': 0x44BB44,
    }

    fields = [
        {"name": "Device",   "value": label,       "inline": True},
        {"name": "Model",    "value": model,        "inline": True},
        {"name": "MAC",      "value": device.mac,   "inline": True},
        {"name": "Rate",     "value": f"{rate:.1f} nonces/hour", "inline": True},
    ]

    if not resolved:
        fields += [
            {"name": "This poll",  "value": str(alert_data.get('delta_this_poll', 0)), "inline": True},
            {"name": "All-time",   "value": str(alert_data.get('cumulative', 0)),       "inline": True},
        ]
        if alert_data.get('temp'):
            fields.append({"name": "Temp", "value": f"{alert_data['temp']:.1f}°C", "inline": True})
        if alert_data.get('frequency'):
            fields.append({"name": "Freq", "value": f"{alert_data['frequency']} MHz", "inline": True})

        level_advice = {
            'warn':     "Monitor — possible fault developing. Check temp and frequency.",
            'alert':    "ASIC core degrading. Consider reducing frequency/voltage.",
            'critical': "Dead ASIC core likely. Pull from stock before selling.",
        }
        fields.append({"name": "Recommendation", "value": level_advice.get(level, ""), "inline": False})

    payload = {
        "embeds": [{
            "title": f"{'✅ Resolved' if resolved else '🔧 HW Nonce Alert'} — {label}",
            "description": alert_data['message'],
            "color": level_colors.get(level, 0xFFBB00),
            "fields": fields,
            "timestamp": datetime.utcnow().isoformat(),
        }]
    }

    try:
        async with aiohttp.ClientSession() as http:
            await http.post(webhook_url, json=payload)
        logger.info(f"[nonce] Discord alert sent for {device.mac}: {level}")
    except Exception as e:
        logger.error(f"[nonce] Discord failed: {e}")


async def send_daily_digest():
    """Send a daily summary of HW nonce activity across all devices."""
    webhook_url = os.getenv("DISCORD_WEBHOOK_URL", "")
    if not webhook_url:
        return

    try:
        from main import _alert_types_enabled
        if not _alert_types_enabled.get('hw_nonce_digest', True):
            return
    except ImportError:
        pass

    since = datetime.utcnow() - timedelta(hours=24)

    with Session(engine) as db:
        devices = db.exec(select(Device)).all()

        active_devices = []
        clean_devices = []

        for d in devices:
            events = db.exec(
                select(HWNonceEvent).where(
                    HWNonceEvent.mac == d.mac,
                    HWNonceEvent.ts >= since,
                ).order_by(HWNonceEvent.ts.asc())
            ).all()

            total_24h = sum(e.delta for e in events)
            dev = db.get(Device, d.mac)
            all_time = dev.hw_nonce_total if dev else 0
            rate = _rolling_rate(d.mac, 3600)

            if total_24h > 0:
                active_devices.append({
                    'label': d.label or d.hostname or d.mac,
                    'model': d.model or '?',
                    'mac': d.mac,
                    'total_24h': total_24h,
                    'all_time': all_time,
                    'rate_1h': rate,
                    'events': len(events),
                    'first_event': events[0].ts if events else None,
                    'last_event': events[-1].ts if events else None,
                    'max_temp': max((e.temp for e in events if e.temp), default=None),
                })
            else:
                clean_devices.append(d.label or d.hostname or d.mac)

        # Update last_sent
        digest_cfg = db.exec(select(DigestConfig)).first()
        if digest_cfg:
            digest_cfg.last_sent = datetime.utcnow()
            db.commit()

    if not active_devices and not clean_devices:
        return

    # Build embed
    if not active_devices:
        description = "✅ All devices clean — no HW nonces in the last 24 hours."
        color = 0x44BB44
    else:
        description = f"⚠️ {len(active_devices)} device{'s' if len(active_devices) != 1 else ''} reported HW nonces in the last 24 hours."
        color = 0xFF6600

    fields = []

    for d in sorted(active_devices, key=lambda x: x['total_24h'], reverse=True):
        rate_str = f"{d['rate_1h']:.1f}/hr" if d['rate_1h'] > 0 else "< 0.1/hr"
        verdict = "🚨 Critical" if d['rate_1h'] >= 20 else "🔴 Alert" if d['rate_1h'] >= 5 else "⚠️ Warning" if d['rate_1h'] >= 1 else "👀 Monitor"
        temp_str = f" | max {d['max_temp']:.0f}°C" if d['max_temp'] else ""
        fields.append({
            "name": f"{verdict} {d['label']} ({d['model']})",
            "value": (
                f"24h count: **{d['total_24h']}** | All-time: {d['all_time']}"
                f"\nRate: {rate_str} | Events: {d['events']}{temp_str}"
                f"\nMAC: `{d['mac']}`"
            ),
            "inline": False,
        })

    if clean_devices:
        fields.append({
            "name": f"✅ Clean ({len(clean_devices)} devices)",
            "value": ", ".join(clean_devices[:10]) + ("…" for _ in [1] if len(clean_devices) > 10).__next__() if len(clean_devices) > 10 else ", ".join(clean_devices),
            "inline": False,
        })

    payload = {
        "embeds": [{
            "title": f"BitScope — Daily HW Nonce Digest ({datetime.utcnow().strftime('%Y-%m-%d')})",
            "description": description,
            "color": color,
            "fields": fields[:25],  # Discord limit
            "footer": {"text": "BitScope · homebitcoinminers.au"},
            "timestamp": datetime.utcnow().isoformat(),
        }]
    }

    try:
        async with aiohttp.ClientSession() as http:
            resp = await http.post(webhook_url, json=payload)
            logger.info(f"[nonce] Daily digest sent, status={resp.status}")
    except Exception as e:
        logger.error(f"[nonce] Daily digest failed: {e}")


def get_nonce_stats(mac: str, db: Session) -> dict:
    """Get nonce stats for a device — used by API endpoints."""
    since_1h  = datetime.utcnow() - timedelta(hours=1)
    since_24h = datetime.utcnow() - timedelta(hours=24)
    since_7d  = datetime.utcnow() - timedelta(days=7)

    events_1h  = db.exec(select(HWNonceEvent).where(HWNonceEvent.mac == mac, HWNonceEvent.ts >= since_1h)).all()
    events_24h = db.exec(select(HWNonceEvent).where(HWNonceEvent.mac == mac, HWNonceEvent.ts >= since_24h)).all()
    events_7d  = db.exec(select(HWNonceEvent).where(HWNonceEvent.mac == mac, HWNonceEvent.ts >= since_7d)).all()
    all_events = db.exec(select(HWNonceEvent).where(HWNonceEvent.mac == mac).order_by(HWNonceEvent.ts.asc())).all()

    dev = db.get(Device, mac)

    return {
        "count_1h":    sum(e.delta for e in events_1h),
        "count_24h":   sum(e.delta for e in events_24h),
        "count_7d":    sum(e.delta for e in events_7d),
        "count_total": dev.hw_nonce_total if dev else 0,
        "rate_1h":     _rolling_rate(mac, 3600),
        "rate_24h":    round(sum(e.delta for e in events_24h) / 24, 2) if events_24h else 0,
        "first_event": all_events[0].ts.isoformat() + "Z" if all_events else None,
        "last_event":  all_events[-1].ts.isoformat() + "Z" if all_events else None,
        "event_count": len(all_events),
        "current_level": _current_alert_level.get(mac),
        "consecutive_polls_breaching": _breach_counts.get(mac, 0),
    }


def get_nonce_history(mac: str, hours: int, db: Session) -> list[dict]:
    """Get nonce event history for graphing."""
    since = datetime.utcnow() - timedelta(hours=hours)
    events = db.exec(
        select(HWNonceEvent).where(
            HWNonceEvent.mac == mac,
            HWNonceEvent.ts >= since,
        ).order_by(HWNonceEvent.ts.asc())
    ).all()

    return [{
        "ts":           e.ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "delta":        e.delta,
        "raw_counter":  e.raw_counter,
        "temp":         e.temp,
        "frequency":    e.frequency,
        "core_voltage": e.core_voltage,
        "uptime_s":     e.uptime_seconds,
    } for e in events]
