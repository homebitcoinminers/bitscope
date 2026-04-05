"""
Profile system — stored as JSON files in /data/profiles/
"""
import json
import logging
import re
from datetime import datetime
from pathlib import Path

logger = logging.getLogger("bitscope.profiles")

PROFILES_DIR = Path("/data/profiles")

DEFAULT_PROFILE = {
    "name": "HomeBitcoinMiners Default",
    "description": "Default pool config — pool.homebitcoinminers.au with ausolo.ckpool.org fallback",
    "pool": {
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
    },
    "system": {
        "autofanspeed": False,
        "fanspeed": 100,
        "temptarget": 60,
        "displayTimeout": -1,
        "statsFrequency": 120,
        "overheat_temp": 70,
    },
    "created_at": "2026-04-05T00:00:00Z",
    "is_default": True,
}


def ensure_dir():
    """Create profiles directory if it doesn't exist. Seed default profile if empty."""
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    default_path = PROFILES_DIR / "hbm_default.json"
    # Only seed if the default file doesn't exist — avoids any recursion
    if not default_path.exists():
        data = {k: v for k, v in DEFAULT_PROFILE.items() if k != "_id"}
        with open(default_path, "w") as f:
            json.dump(data, f, indent=2)
        logger.info("Seeded default profile: hbm_default")


def list_profiles() -> list[dict]:
    ensure_dir()
    profiles = []
    for f in sorted(PROFILES_DIR.glob("*.json")):
        try:
            with open(f) as fp:
                data = json.load(fp)
                data["_id"] = f.stem
                profiles.append(data)
        except Exception as e:
            logger.error(f"Failed to load profile {f}: {e}")
    return profiles


def get_profile(profile_id: str) -> dict | None:
    ensure_dir()
    path = PROFILES_DIR / f"{profile_id}.json"
    if not path.exists():
        return None
    try:
        with open(path) as f:
            data = json.load(f)
            data["_id"] = profile_id
            return data
    except Exception as e:
        logger.error(f"Failed to load profile {profile_id}: {e}")
        return None


def save_profile(profile_id: str, data: dict) -> dict:
    # Ensure directory exists directly — no recursion
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    # Remove internal _id before saving to file
    clean = {k: v for k, v in data.items() if k != "_id"}
    clean.setdefault("created_at", datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"))
    path = PROFILES_DIR / f"{profile_id}.json"
    with open(path, "w") as f:
        json.dump(clean, f, indent=2)
    clean["_id"] = profile_id
    logger.info(f"Saved profile: {profile_id}")
    return clean


def delete_profile(profile_id: str) -> bool:
    path = PROFILES_DIR / f"{profile_id}.json"
    if not path.exists():
        return False
    path.unlink()
    logger.info(f"Deleted profile: {profile_id}")
    return True


def profile_from_device_snapshot(raw: dict, name: str) -> dict:
    return {
        "name": name,
        "description": f"Captured from {raw.get('hostname', 'unknown')} on {datetime.utcnow().strftime('%Y-%m-%d')}",
        "pool": {
            "stratumURL": raw.get("stratumURL", ""),
            "stratumPort": raw.get("stratumPort", 3333),
            "stratumUser": raw.get("stratumUser", ""),
            "stratumPassword": "",  # never capture passwords
            "stratumTLS": raw.get("stratumTLS", False),
            "fallbackStratumURL": raw.get("fallbackStratumURL", ""),
            "fallbackStratumPort": raw.get("fallbackStratumPort", 3333),
            "fallbackStratumUser": raw.get("fallbackStratumUser", ""),
            "fallbackStratumPassword": "",
            "fallbackStratumTLS": raw.get("fallbackStratumTLS", False),
        },
        "system": {
            "autofanspeed": bool(raw.get("autofanspeed", True)),
            "fanspeed": raw.get("fanspeed", 100),
            "temptarget": raw.get("temptarget", 60),
            "displayTimeout": raw.get("displayTimeout", -1),
            "statsFrequency": raw.get("statsFrequency", 0),
            "overheat_temp": raw.get("overheat_temp", 70),
        },
        "source_mac": raw.get("macAddr", ""),
        "source_model": raw.get("deviceModel", ""),
        "created_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
