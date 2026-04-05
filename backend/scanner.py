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

POLL_TIMEOUT = 8  # seconds per device HTTP request
SCAN_CONCURRENCY = 30  # parallel HTTP probes during subnet scan


def parse_snapshot(mac: str, data: dict, session_id: Optional[int] = None) -> MetricSnapshot:
    """Extract typed fields from raw API response."""
    asic_temps = data.get("asicTemps")
    stratum = data.get("stratum", {})
    pools = stratum.get("pools", [])
    best_diff = data.get("bestDiff") or (stratum.get("totalBestDiff") if stratum else None)

    return MetricSnapshot(
        mac=mac,
        session_id=session_id,
        hashrate=data.get("hashRate"),
        hashrate_1m=data.get("hashRate_1m"),
        hashrate_10m=data.get("hashRate_10m"),
        hashrate_1h=data.get("hashRate_1h"),
        hashrate_1d=data.get("hashRate_1d"),
        expected_hashrate=data.get("expectedHashrate"),
        temp=data.get("temp"),
        vr_temp=data.get("vrTemp"),
        power=data.get("power"),
        voltage=data.get("voltage"),
        current=data.get("current"),
        core_voltage=data.get("coreVoltage"),
        core_voltage_actual=data.get("coreVoltageActual"),
        frequency=data.get("frequency"),
        fan_rpm=data.get("fanrpm"),
        fan2_rpm=data.get("fan2rpm"),
        fan_speed=data.get("fanspeed"),
        error_percentage=data.get("errorPercentage"),
        shares_accepted=data.get("sharesAccepted"),
        shares_rejected=data.get("sharesRejected"),
        best_diff=best_diff,
        best_session_diff=data.get("bestSessionDiff"),
        uptime_seconds=data.get("uptimeSeconds"),
        wifi_rssi=data.get("wifiRSSI"),
        asic_temps=json.dumps(asic_temps) if asic_temps else None,
        duplicate_hw_nonces=data.get("duplicateHWNonces"),
        last_ping_rtt=data.get("lastpingrtt"),
        recent_ping_loss=data.get("recentpingloss"),
        pool_difficulty=data.get("poolDifficulty"),
        max_power=data.get("maxPower"),
        min_power=data.get("minPower"),
        raw=json.dumps(data),
    )


async def fetch_device_info(ip: str, session: aiohttp.ClientSession) -> Optional[dict]:
    """Try to fetch /api/system/info from an IP. Returns None if not a miner."""
    try:
        async with session.get(
            f"http://{ip}/api/system/info",
            timeout=aiohttp.ClientTimeout(total=POLL_TIMEOUT),
            headers={"Host": ip},  # avoid CSRF rejection
        ) as resp:
            if resp.status == 200:
                data = await resp.json(content_type=None)
                if "macAddr" in data:
                    return data
    except Exception:
        pass
    return None


async def scan_subnet(subnet: str) -> list[dict]:
    """Scan all hosts in subnet, return list of API responses from miners found."""
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
    """Create or update device record. Returns (device, is_new)."""
    mac = data.get("macAddr", "").upper()
    existing = db.get(Device, mac)
    is_new = existing is None

    if is_new:
        device = Device(
            mac=mac,
            model=data.get("deviceModel") or data.get("boardVersion"),
            asic_model=data.get("ASICModel"),
            asic_count=data.get("asicCount"),
            board_version=data.get("boardVersion"),
            last_ip=data.get("ipv4") or data.get("hostip"),
            hostname=data.get("hostname"),
            firmware_version=data.get("version"),
            last_seen=datetime.utcnow(),
            is_manual=is_manual,
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
    """Check snapshot against applicable thresholds. Returns list of breaches."""
    thresh = get_thresholds(device.mac, device.model, db)
    breaches = []

    if snapshot.temp is not None and thresh.temp_max and snapshot.temp > thresh.temp_max:
        breaches.append({
            "type": "overheat",
            "message": f"Temperature {snapshot.temp:.1f}°C exceeds {thresh.temp_max}°C",
            "value": str(snapshot.temp),
            "threshold": str(thresh.temp_max),
        })

    if snapshot.vr_temp is not None and thresh.vr_temp_max and snapshot.vr_temp > thresh.vr_temp_max:
        breaches.append({
            "type": "overheat",
            "message": f"VR temperature {snapshot.vr_temp:.1f}°C exceeds {thresh.vr_temp_max}°C",
            "value": str(snapshot.vr_temp),
            "threshold": str(thresh.vr_temp_max),
        })

    # Per-ASIC temps
    if snapshot.asic_temps:
        try:
            temps = json.loads(snapshot.asic_temps)
            for i, t in enumerate(temps):
                if t and t > (thresh.temp_max or 75):
                    breaches.append({
                        "type": "overheat",
                        "message": f"ASIC {i+1} temperature {t:.1f}°C exceeds threshold",
                        "value": str(t),
                        "threshold": str(thresh.temp_max),
                    })
        except Exception:
            pass

    if snapshot.error_percentage is not None and thresh.error_pct_max is not None:
        if snapshot.error_percentage > thresh.error_pct_max:
            breaches.append({
                "type": "error_rate",
                "message": f"Error rate {snapshot.error_percentage:.2f}% exceeds {thresh.error_pct_max}%",
                "value": str(snapshot.error_percentage),
                "threshold": str(thresh.error_pct_max),
            })

    if snapshot.duplicate_hw_nonces is not None and thresh.duplicate_hw_nonces_max is not None:
        if snapshot.duplicate_hw_nonces > thresh.duplicate_hw_nonces_max:
            breaches.append({
                "type": "hw_nonce",
                "message": f"Duplicate HW nonces: {snapshot.duplicate_hw_nonces}",
                "value": str(snapshot.duplicate_hw_nonces),
                "threshold": "0",
            })

    if snapshot.power is not None and snapshot.max_power is not None and thresh.power_over_spec_pct:
        limit = snapshot.max_power * (thresh.power_over_spec_pct / 100)
        if snapshot.power > limit:
            breaches.append({
                "type": "power_over_spec",
                "message": f"Power {snapshot.power:.0f}W exceeds device max {snapshot.max_power:.0f}W",
                "value": str(snapshot.power),
                "threshold": str(snapshot.max_power),
            })

    if snapshot.fan_rpm is not None and thresh.fan_rpm_min and snapshot.fan_rpm < thresh.fan_rpm_min:
        if snapshot.fan_rpm > 0:  # 0 = fan not spinning / not present
            breaches.append({
                "type": "fan_failure",
                "message": f"Fan RPM {snapshot.fan_rpm} below minimum {thresh.fan_rpm_min}",
                "value": str(snapshot.fan_rpm),
                "threshold": str(thresh.fan_rpm_min),
            })

    if snapshot.wifi_rssi is not None and thresh.wifi_rssi_min and snapshot.wifi_rssi < thresh.wifi_rssi_min:
        breaches.append({
            "type": "weak_wifi",
            "message": f"WiFi RSSI {snapshot.wifi_rssi} dBm below {thresh.wifi_rssi_min} dBm",
            "value": str(snapshot.wifi_rssi),
            "threshold": str(thresh.wifi_rssi_min),
        })

    return breaches


# Track offline state across polls
_offline_counts: dict[str, int] = {}
_alerted_offline: set[str] = set()


async def poll_all_devices():
    """Poll every known device and record metrics."""
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
                    # Device offline
                    _offline_counts[device.mac] = _offline_counts.get(device.mac, 0) + 1
                    with Session(engine) as db:
                        thresh = get_thresholds(device.mac, device.model, db)
                        limit = thresh.offline_after_polls or 3
                        if _offline_counts[device.mac] >= limit and device.mac not in _alerted_offline:
                            _alerted_offline.add(device.mac)
                            alert = AlertLog(
                                mac=device.mac,
                                alert_type="offline",
                                message=f"{device.label or device.hostname or device.mac} went offline",
                            )
                            db.add(alert)
                            db.commit()
                            await send_discord_alert(alert, device)
                    continue

                # Device is back online
                if device.mac in _alerted_offline:
                    _alerted_offline.discard(device.mac)
                    with Session(engine) as db:
                        alert = AlertLog(
                            mac=device.mac,
                            alert_type="online",
                            message=f"{device.label or device.hostname or device.mac} is back online",
                        )
                        db.add(alert)
                        db.commit()
                        await send_discord_alert(alert, device)
                _offline_counts[device.mac] = 0

                with Session(engine) as db:
                    # Find active session for this device
                    active_session = db.exec(
                        select(DBSession).where(
                            DBSession.mac == device.mac,
                            DBSession.ended_at == None,
                        )
                    ).first()

                    snapshot = parse_snapshot(
                        mac=device.mac,
                        data=data,
                        session_id=active_session.id if active_session else None,
                    )
                    db.add(snapshot)

                    # Update device
                    dev = db.get(Device, device.mac)
                    if dev:
                        dev.last_seen = datetime.utcnow()
                        dev.last_ip = data.get("ipv4") or data.get("hostip") or dev.last_ip
                        dev.hostname = data.get("hostname") or dev.hostname
                        dev.firmware_version = data.get("version") or dev.firmware_version

                    # Check thresholds
                    breaches = check_thresholds(snapshot, device, db)
                    for breach in breaches:
                        alert = AlertLog(
                            mac=device.mac,
                            alert_type=breach["type"],
                            message=breach["message"],
                            value=breach.get("value"),
                            threshold=breach.get("threshold"),
                        )
                        db.add(alert)
                        db.commit()
                        await send_discord_alert(alert, device)

                    db.commit()

            except Exception as e:
                logger.error(f"Poll error for {device.mac} ({device.last_ip}): {e}")


async def scan_and_discover():
    """Scan all configured subnets for new miners."""
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
                    logger.info(f"New device discovered: {mac} ({data.get('deviceModel')} at {data.get('ipv4') or data.get('hostip')})")
                    alert = AlertLog(
                        mac=mac,
                        alert_type="new_device",
                        message=f"New device found: {data.get('deviceModel', 'Unknown')} at {data.get('ipv4') or data.get('hostip')}",
                    )
                    db.add(alert)
                    db.commit()
                    await send_discord_alert(alert, device)

                # Also record a metric snapshot on discovery
                snapshot = parse_snapshot(mac=mac, data=data)
                db.add(snapshot)
                db.commit()


async def send_discord_alert(alert: AlertLog, device: Device):
    webhook_url = os.getenv("DISCORD_WEBHOOK_URL", "")
    if not webhook_url:
        return

    colors = {
        "overheat": 0xFF4444,
        "error_rate": 0xFF8800,
        "power_over_spec": 0xFF8800,
        "hw_nonce": 0xFF4444,
        "offline": 0x888888,
        "online": 0x44BB44,
        "new_device": 0x4488FF,
        "fan_failure": 0xFF4444,
        "weak_wifi": 0xFFBB00,
    }

    label = device.label or device.hostname or device.mac
    payload = {
        "embeds": [{
            "title": f"BitScope Alert — {label}",
            "description": alert.message,
            "color": colors.get(alert.alert_type, 0x888888),
            "fields": [
                {"name": "Device", "value": label, "inline": True},
                {"name": "MAC", "value": device.mac, "inline": True},
                {"name": "Type", "value": alert.alert_type.replace("_", " ").title(), "inline": True},
            ],
            "timestamp": datetime.utcnow().isoformat(),
        }]
    }
    if alert.value and alert.threshold:
        payload["embeds"][0]["fields"].append(
            {"name": "Value → Threshold", "value": f"{alert.value} → {alert.threshold}", "inline": False}
        )

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
