"""
Profile system — typed profiles stored as JSON files in /data/profiles/<type>/
Types: pool | system | hardware
Each type has its own subdirectory and default seeds.
"""
import json
import logging
from datetime import datetime
from pathlib import Path

logger = logging.getLogger("bitscope.profiles")

BASE_DIR = Path("/data/profiles")
DIRS = {
    "pool":     BASE_DIR / "pool",
    "system":   BASE_DIR / "system",
    "hardware": BASE_DIR / "hardware",
}

DEFAULTS = {
    "pool": {
        "_id": "hbm_default",
        "type": "pool",
        "name": "HomeBitcoinMiners Default",
        "description": "pool.homebitcoinminers.au primary, ausolo.ckpool.org fallback",
        "is_default": True,
        "stratumURL": "pool.homebitcoinminers.au",
        "stratumPort": 4333,
        "stratumUser": "bc1qd2gz9h8zwh2stga6lrfh95p8c5w3qc96w2g57c.hbm",
        "stratumPassword": "x",
        "stratumTLS": True,
        "fallbackStratumURL": "ausolo.ckpool.org",
        "fallbackStratumPort": 3333,
        "fallbackStratumUser": "bc1qd2gz9h8zwh2stga6lrfh95p8c5w3qc96w2g57c.hbm",
        "fallbackStratumPassword": "x",
        "fallbackStratumTLS": False,
        "created_at": "2026-04-05T00:00:00Z",
    },
    "system": {
        "_id": "hbm_system_default",
        "type": "system",
        "name": "HBM System Default",
        "description": "Default system settings — display always on, stats logging enabled",
        "is_default": True,
        "hostname_template": "{model}-{last4mac}",
        "wifi_ssid": "",
        "wifi_password": "",
        "displayTimeout": -1,
        "rotation": 0,
        "invertscreen": 0,
        "autoscreenoff": 0,
        "statsFrequency": 120,
        "created_at": "2026-04-05T00:00:00Z",
    },
    "hardware": {
        "_id": "nerdqaxe_default",
        "type": "hardware",
        "name": "NerdQAxe++ Default",
        "description": "Conservative settings for NerdQAxe++ — manual fan 100%, factory freq/voltage",
        "is_default": True,
        "model_lock": "NerdQAxe++",
        "autofanspeed": False,
        "fanspeed": 100,
        "temptarget": 60,
        "overheat_temp": 70,
        "frequency": None,
        "coreVoltage": None,
        "use_factory_defaults": True,
        "created_at": "2026-04-05T00:00:00Z",
    },
}


def _dir(profile_type: str) -> Path:
    d = DIRS.get(profile_type)
    if not d:
        raise ValueError(f"Unknown profile type: {profile_type}")
    return d


def ensure_dirs():
    for profile_type, d in DIRS.items():
        d.mkdir(parents=True, exist_ok=True)
        default = DEFAULTS.get(profile_type, {})
        default_id = default.get("_id", f"{profile_type}_default")
        path = d / f"{default_id}.json"
        if not path.exists():
            data = {k: v for k, v in default.items() if k != "_id"}
            with open(path, "w") as f:
                json.dump(data, f, indent=2)
            logger.info(f"Seeded default {profile_type} profile: {default_id}")


def list_profiles(profile_type: str | None = None) -> list[dict]:
    ensure_dirs()
    results = []
    types = [profile_type] if profile_type else list(DIRS.keys())
    for t in types:
        d = _dir(t)
        for f in sorted(d.glob("*.json")):
            try:
                with open(f) as fp:
                    data = json.load(fp)
                    data["_id"] = f.stem
                    data["type"] = t
                    results.append(data)
            except Exception as e:
                logger.error(f"Failed to load profile {f}: {e}")
    return results


def get_profile(profile_type: str, profile_id: str) -> dict | None:
    ensure_dirs()
    path = _dir(profile_type) / f"{profile_id}.json"
    if not path.exists():
        return None
    try:
        with open(path) as f:
            data = json.load(f)
            data["_id"] = profile_id
            data["type"] = profile_type
            return data
    except Exception as e:
        logger.error(f"Failed to load {profile_type}/{profile_id}: {e}")
        return None


def save_profile(profile_type: str, profile_id: str, data: dict) -> dict:
    d = _dir(profile_type)
    d.mkdir(parents=True, exist_ok=True)
    clean = {k: v for k, v in data.items() if k not in ("_id", "type")}
    clean["type"] = profile_type
    clean.setdefault("created_at", datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"))
    path = d / f"{profile_id}.json"
    with open(path, "w") as f:
        json.dump(clean, f, indent=2)
    clean["_id"] = profile_id
    logger.info(f"Saved {profile_type} profile: {profile_id}")
    return clean


def delete_profile(profile_type: str, profile_id: str) -> bool:
    path = _dir(profile_type) / f"{profile_id}.json"
    if not path.exists():
        return False
    path.unlink()
    logger.info(f"Deleted {profile_type}/{profile_id}")
    return True


def apply_hostname_template(template: str, device: dict) -> str:
    """Resolve hostname template tokens for a specific device."""
    import re
    mac = device.get("mac", "")
    last4 = mac.replace(":", "")[-4:].lower() if mac else "0000"
    hostname = device.get("hostname", "") or ""
    model = device.get("model", "") or ""

    # Sanitise model: remove ++, special chars, collapse multiple dashes
    # e.g. "NerdQAxe++" -> "NerdQAxeplus", "NerdOCTAxe-y" -> "NerdOCTAxe-y"
    model_clean = model.replace("++", "plus").replace("+", "plus")
    model_clean = re.sub(r"[^a-zA-Z0-9-]", "", model_clean)
    model_clean = re.sub(r"-+", "-", model_clean).strip("-")  # collapse/trim dashes

    result = template
    result = result.replace("{last4mac}", last4)
    result = result.replace("{hostname}", hostname or "device")
    result = result.replace("{model}", model_clean or "miner")
    result = result.replace("{mac}", mac.replace(":", "").lower())

    # Ensure valid hostname: lowercase, alphanumeric + hyphens, max 32 chars
    result = result.lower()
    result = re.sub(r"[^a-z0-9-]", "-", result)
    result = re.sub(r"-+", "-", result).strip("-")
    return result[:32] or "bitaxe"


def capture_from_snapshot(raw: dict, profile_type: str, name: str) -> dict:
    """Build a typed profile from a live device API response."""
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    hostname = raw.get("hostname", "unknown")
    model = raw.get("deviceModel", "")

    if profile_type == "pool":
        return {
            "type": "pool",
            "name": name,
            "description": f"Captured from {hostname} on {now[:10]}",
            "stratumURL": raw.get("stratumURL", ""),
            "stratumPort": raw.get("stratumPort", 3333),
            "stratumUser": raw.get("stratumUser", ""),
            "stratumPassword": "",  # never capture
            "stratumTLS": raw.get("stratumTLS", False),
            "fallbackStratumURL": raw.get("fallbackStratumURL", ""),
            "fallbackStratumPort": raw.get("fallbackStratumPort", 3333),
            "fallbackStratumUser": raw.get("fallbackStratumUser", ""),
            "fallbackStratumPassword": "",
            "fallbackStratumTLS": raw.get("fallbackStratumTLS", False),
            "source_mac": raw.get("macAddr", ""),
            "source_model": model,
            "created_at": now,
        }
    elif profile_type == "system":
        return {
            "type": "system",
            "name": name,
            "description": f"Captured from {hostname} on {now[:10]}",
            "hostname_template": "{model}-{last4mac}",
            "wifi_ssid": "",
            "wifi_password": "",
            "displayTimeout": raw.get("displayTimeout", -1),
            "rotation": raw.get("rotation", 0),
            "invertscreen": raw.get("invertscreen", 0),
            "autoscreenoff": raw.get("autoscreenoff", 0),
            "statsFrequency": raw.get("statsFrequency", 0),
            "source_mac": raw.get("macAddr", ""),
            "source_model": model,
            "created_at": now,
        }
    elif profile_type == "hardware":
        return {
            "type": "hardware",
            "name": name,
            "description": f"Captured from {hostname} ({model}) on {now[:10]}",
            "model_lock": model,
            "autofanspeed": bool(raw.get("autofanspeed", False)),
            "fanspeed": raw.get("fanspeed", 100),
            "temptarget": raw.get("temptarget", 60),
            "overheat_temp": raw.get("overheat_temp", 70),
            "frequency": raw.get("frequency"),
            "coreVoltage": raw.get("coreVoltage"),
            "use_factory_defaults": False,
            "source_mac": raw.get("macAddr", ""),
            "source_model": model,
            "created_at": now,
        }
    raise ValueError(f"Unknown profile type: {profile_type}")
