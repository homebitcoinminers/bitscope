import asyncio
import ipaddress
import json
import os
import logging
from datetime import datetime, timedelta
from typing import Optional

import aiohttp
from sqlmodel import Session, select

from database import engine, get_thresholds
from models import Device, MetricSnapshot, AlertLog, ScanConfig, Session as DBSession

logger = logging.getLogger("bitscope.scanner")

POLL_TIMEOUT = 8
SCAN_CONCURRENCY = 30

# Alert debounce state — fires on rising edge only, resolves on falling edge
_active_alerts: dict[str, bool] = {}
_offline_counts: dict[str, int] = {}
_alerted_offline: set[str] = set()

_discord_enabled: bool = True

def set_discord_enabled(enabled: bool):
    global _discord_enabled
    _discord_enabled = enabled

def get_discord_enabled() -> bool:
    return _discord_enabled

def _should_fire(mac: str, alert_type: str, breaching: bool) -> tuple[bool, bool]:
    key = f"{mac}:{alert_type}"
    was_breaching = _active_alerts.get(key, False)
    _active_alerts[key] = breaching
    if breaching and not was_breaching:
        return True, False
    if not breaching and was_breaching:
        return False, True
    return False, False


def parse_snapshot(mac: str, data: dict, session_id: Optional[int] = None) -> MetricSnapshot:
    asic_temps = data.get("asicTemps")
    stratum = data.get("stratum", {})
    best_diff = data.get("bestDiff") or (stratum.get("totalBestDiff") if stratum else None)
    return MetricSnapshot(
        mac=mac, session_id=session_id,
        hashrate=data.get("hashRate"), hashrate_1m=data.get("hashRate_1m"),
        hashrate_10m=data.get("hashRate_10m"), hashrate_1h=data.get("hashRate_1h"),
        hashrate_1d=data.get("hashRate_1d"), expected_hashrate=data.get("expectedHashrate"),
        temp=data.get("temp"), vr_temp=data.get("vrTemp"),
        power=data.get("power"), voltage=data.get("voltage"), current=data.get("current"),
        core_voltage=data.get("coreVoltage"), core_voltage_actual=data.get("coreVoltageActual"),
        frequency=data.get("frequency"), fan_rpm=data.get("fanrpm"), fan2_rpm=data.get("fan2rpm"),
        fan_speed=data.get("fanspeed"), error_percentage=data.get("errorPercentage"),
        shares_accepted=data.get("sharesAccepted"), shares_rejected=data.get("sharesRejected"),
        best_diff=best_diff, best_session_diff=data.get("bestSessionDiff"),
        uptime_seconds=data.get("uptimeSeconds"), wifi_rssi=data.get("wifiRSSI"),
        asic_temps=json.dumps(asic_temps) if asic_temps else None,
        duplicate_hw_nonces=data.get("duplicateHWNonces"),
        last_ping_rtt=data.get("lastpingrtt"), recent_ping_loss=data.get("recentpingloss"),
        pool_difficulty=data.get("poolDifficulty"),
        max_power=data.get("maxPower"), min_power=data.get("minPower"),
        raw=json.dumps(data),
    )


async def fetch_device_info(ip: str, session: aiohttp.ClientSession) -> Optional[dict]:
    try:
        async with session.get(
            f"http://{ip}/api/system/info",
            timeout=aiohttp.ClientTimeout(total=POLL_TIMEOUT),
            headers={"Host": ip},
        ) as resp:
            if resp.status == 200:
                data = await resp.json(content_type=None)
                if "macAddr" in data:
                    return data
    except Exception:
        pass
    return None


async def scan_subnet(subnet: str) -> list[dict]:
    try:
        network = ipaddress.IPv4Network(subnet, strict=False)
    except ValueError:
        logger.error(f"Invalid subnet: {subnet}")
        return []
    hosts = list(network.hosts())
    results = []
    sem = asyncio.Semaphore(SCAN_CONCURRENCY)
    async def probe(ip):
        async with sem:
            async with aiohttp.ClientSession() as http:
                data = await fetch_device_info(str(ip), http)
                if data:
                    results.append(data)
    await asyncio.gather(*[probe(ip) for ip in hosts])
    logger.info(f"Scan of {subnet}: found {len(results)} miners from {len(hosts)} hosts")
    return results


def upsert_device(data: dict, db: Session, is_manual: bool = False) -> tuple[Device, bool]:
    mac = data.get("macAddr", "").upper()
    existing = db.get(Device, mac)
    is_new = existing is None
    if is_new:
        device = Device(
            mac=mac,
            model=data.get("deviceModel") or data.get("boardVersion"),
            asic_model=data.get("ASICModel"), asic_count=data.get("asicCount"),
            board_version=data.get("boardVersion"),
            last_ip=data.get("ipv4") or data.get("hostip"),
            hostname=data.get("hostname"), firmware_version=data.get("version"),
            last_seen=datetime.utcnow(), is_manual=is_manual,
        )
        db.add(device)
    else:
        existing.last_seen = datetime.utcnow()
        existing.last_ip = data.get("ipv4") or data.get("hostip") or existing.last_ip
        existing.hostname = data.get("hostname") or existing.hostname
        existing.firmware_version = data.get("version") or existing.firmware_version
        if not existing.model:
            existing.model = data.get("deviceModel") or data.get("boardVersion")
        device = existing
    db.commit()
    db.refresh(device)
    return device, is_new


def check_thresholds(snapshot: MetricSnapshot, device: Device, db: Session) -> list[dict]:
    thresh = get_thresholds(device.mac, device.model, db)
    to_fire = []

    def check(alert_type, breaching, msg_fn, resolved_fn, value=None, threshold=None):
        """msg_fn and resolved_fn are callables to avoid eager f-string evaluation on None values."""
        fire, resolved = _should_fire(device.mac, alert_type, bool(breaching))
        if fire:
            try:
                message = msg_fn()
            except Exception:
                message = f"Alert: {alert_type}"
            to_fire.append({"type": alert_type, "message": message,
                "value": str(value) if value is not None else None,
                "threshold": str(threshold) if threshold is not None else None, "resolved": False})
        elif resolved:
            try:
                resolved_msg = resolved_fn()
            except Exception:
                resolved_msg = f"Resolved: {alert_type}"
            to_fire.append({"type": alert_type, "message": resolved_msg,
                "value": None, "threshold": None, "resolved": True})

    temp = snapshot.temp
    vr = snapshot.vr_temp
    err = snapshot.error_percentage
    fan = snapshot.fan_rpm
    rssi = snapshot.wifi_rssi
    pwr = snapshot.power
    nonces = snapshot.duplicate_hw_nonces

    check("overheat",
        temp is not None and thresh.temp_max and temp > thresh.temp_max,
        lambda: f"Temperature {temp:.1f}°C exceeds {thresh.temp_max}°C",
        lambda: f"Temperature back to normal ({temp:.1f}°C)",
        temp, thresh.temp_max)

    check("vr_overheat",
        vr is not None and thresh.vr_temp_max and vr > thresh.vr_temp_max,
        lambda: f"VR temperature {vr:.1f}°C exceeds {thresh.vr_temp_max}°C",
        lambda: f"VR temperature back to normal ({vr:.1f}°C)",
        vr, thresh.vr_temp_max)

    asic_over = []
    if snapshot.asic_temps:
        try:
            temps = json.loads(snapshot.asic_temps)
            asic_over = [(i, t) for i, t in enumerate(temps) if t and t > (thresh.temp_max or 75)]
        except Exception:
            pass
    check("asic_overheat", len(asic_over) > 0,
        lambda: f"ASIC chip(s) overtemp: {', '.join(f'ASIC{i+1}={t:.0f}C' for i,t in asic_over)}",
        lambda: "ASIC chip temperatures back to normal")

    check("error_rate",
        err is not None and thresh.error_pct_max is not None and err > thresh.error_pct_max,
        lambda: f"Error rate {err:.2f}% exceeds {thresh.error_pct_max}%",
        lambda: f"Error rate back to normal ({err:.2f}%)",
        err, thresh.error_pct_max)

    check("hw_nonce",
        nonces is not None and thresh.duplicate_hw_nonces_max is not None
            and nonces > thresh.duplicate_hw_nonces_max,
        lambda: f"Duplicate HW nonces: {nonces} — possible hardware fault",
        lambda: "Duplicate HW nonces cleared",
        nonces, 0)

    # Power alert uses configured threshold only — ignores device maxPower field
    # because factory-overclocked units legitimately exceed the API's maxPower value
    power_thresh = thresh.power_over_spec_pct  # treat as absolute watts if > 200, else ignore
    # Use a separate configured absolute watt limit instead
    power_max_w = getattr(thresh, 'power_max_w', None)
    power_over = (pwr is not None and power_max_w is not None and pwr > power_max_w)
    check("power_over_spec", power_over,
        lambda: f"Power {pwr:.0f}W exceeds configured max {power_max_w:.0f}W",
        lambda: f"Power back within limit ({pwr:.0f}W)",
        pwr, power_max_w)

    check("fan_failure",
        fan is not None and thresh.fan_rpm_min and fan > 0 and fan < thresh.fan_rpm_min,
        lambda: f"Fan RPM {fan} below minimum {thresh.fan_rpm_min}",
        lambda: f"Fan RPM back to normal ({fan})",
        fan, thresh.fan_rpm_min)

    check("weak_wifi",
        rssi is not None and thresh.wifi_rssi_min and rssi < thresh.wifi_rssi_min,
        lambda: f"WiFi RSSI {rssi} dBm below {thresh.wifi_rssi_min} dBm",
        lambda: f"WiFi signal recovered ({rssi} dBm)",
        rssi, thresh.wifi_rssi_min)

    return to_fire


async def poll_all_devices():
    with Session(engine) as db:
        devices = db.exec(select(Device)).all()
    if not devices:
        return

    async with aiohttp.ClientSession() as http:
        for device in devices:
            if not device.last_ip:
                continue
            try:
                data = await fetch_device_info(device.last_ip, http)

                if data is None:
                    _offline_counts[device.mac] = _offline_counts.get(device.mac, 0) + 1
                    with Session(engine) as db:
                        thresh = get_thresholds(device.mac, device.model, db)
                        limit = thresh.offline_after_polls or 3
                        if _offline_counts[device.mac] >= limit and device.mac not in _alerted_offline:
                            _alerted_offline.add(device.mac)
                            alert = AlertLog(mac=device.mac, alert_type="offline",
                                message=f"{device.label or device.hostname or device.mac} went offline")
                            db.add(alert)
                            db.commit()
                            await send_discord_alert(alert, device)
                    continue

                if device.mac in _alerted_offline:
                    _alerted_offline.discard(device.mac)
                    with Session(engine) as db:
                        alert = AlertLog(mac=device.mac, alert_type="online",
                            message=f"{device.label or device.hostname or device.mac} is back online")
                        db.add(alert)
                        db.commit()
                        await send_discord_alert(alert, device, resolved=True)
                _offline_counts[device.mac] = 0

                with Session(engine) as db:
                    active_session = db.exec(
                        select(DBSession).where(DBSession.mac == device.mac, DBSession.ended_at == None)
                    ).first()
                    snapshot = parse_snapshot(mac=device.mac, data=data,
                        session_id=active_session.id if active_session else None)
                    db.add(snapshot)
                    dev = db.get(Device, device.mac)
                    if dev:
                        dev.last_seen = datetime.utcnow()
                        dev.last_ip = data.get("ipv4") or data.get("hostip") or dev.last_ip
                        dev.hostname = data.get("hostname") or dev.hostname
                        dev.firmware_version = data.get("version") or dev.firmware_version
                    breaches = check_thresholds(snapshot, device, db)
                    for breach in breaches:
                        alert = AlertLog(mac=device.mac, alert_type=breach["type"],
                            message=breach["message"], value=breach.get("value"),
                            threshold=breach.get("threshold"))
                        db.add(alert)
                        db.commit()
                        await send_discord_alert(alert, device, resolved=breach.get("resolved", False))
                    db.commit()

            except Exception as e:
                logger.error(f"Poll error for {device.mac} ({device.last_ip}): {e}")


async def scan_and_discover():
    with Session(engine) as db:
        subnets = db.exec(select(ScanConfig).where(ScanConfig.enabled == True)).all()
    for subnet_cfg in subnets:
        results = await scan_subnet(subnet_cfg.subnet)
        for data in results:
            mac = data.get("macAddr", "").upper()
            if not mac:
                continue
            with Session(engine) as db:
                device, is_new = upsert_device(data, db)
                if is_new:
                    logger.info(f"New device: {mac} ({data.get('deviceModel')})")
                    alert = AlertLog(mac=mac, alert_type="new_device",
                        message=f"New device: {data.get('deviceModel','Unknown')} at {data.get('ipv4') or data.get('hostip')}")
                    db.add(alert)
                    db.commit()
                    await send_discord_alert(alert, device)
                snapshot = parse_snapshot(mac=mac, data=data)
                db.add(snapshot)
                db.commit()


async def send_discord_alert(alert: AlertLog, device: Device, resolved: bool = False):
    if not _discord_enabled:
        return
    webhook_url = os.getenv("DISCORD_WEBHOOK_URL", "")
    if not webhook_url:
        return

    colors = {
        "overheat": 0xFF4444, "vr_overheat": 0xFF4444, "asic_overheat": 0xFF4444,
        "error_rate": 0xFF8800, "power_over_spec": 0xFF8800, "hw_nonce": 0xFF4444,
        "offline": 0x888888, "online": 0x44BB44, "new_device": 0x4488FF,
        "fan_failure": 0xFF4444, "weak_wifi": 0xFFBB00,
    }
    label = device.label or device.hostname or device.mac
    color = 0x44BB44 if resolved else colors.get(alert.alert_type, 0x888888)
    title = f"✅ Resolved — {label}" if resolved else f"⚠️ Alert — {label}"
    model_str = device.model or "Unknown model"

    payload = {"embeds": [{"title": title, "description": alert.message, "color": color,
        "fields": [
            {"name": "Device", "value": label, "inline": True},
            {"name": "Model", "value": model_str, "inline": True},
            {"name": "MAC", "value": device.mac, "inline": True},
            {"name": "Type", "value": alert.alert_type.replace("_", " ").title(), "inline": True},
            {"name": "IP", "value": device.last_ip or "unknown", "inline": True},
        ],
        "timestamp": datetime.utcnow().isoformat(),
    }]}
    if alert.value and alert.threshold:
        payload["embeds"][0]["fields"].append(
            {"name": "Value → Threshold", "value": f"{alert.value} → {alert.threshold}", "inline": False})
    try:
        async with aiohttp.ClientSession() as http:
            await http.post(webhook_url, json=payload)
            with Session(engine) as db:
                a = db.get(AlertLog, alert.id)
                if a:
                    a.sent_discord = True
                    db.commit()
    except Exception as e:
        logger.error(f"Discord webhook failed: {e}")
