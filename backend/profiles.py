"""
Profile system — stored as JSON files in /data/profiles/
Each profile is a dict of pool/system settings that can be applied to devices.
"""
import json
import os
import logging
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
        "autofanspeed": True,
        "temptarget": 60,
        "displayTimeout": -1,
        "statsFrequency": 120,
        "overheat_temp": 70,
    },
    "created_at": "2026-04-05T00:00:00Z",
    "is_default": True,
}


def ensure_dir():
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    # Seed default profile if no profiles exist
    if not list(PROFILES_DIR.glob("*.json")):
        save_profile("hbm_default", DEFAULT_PROFILE)
        logger.info("Seeded default profile")


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
    ensure_dir()
    # Clean id from data before saving
    data = {k: v for k, v in data.items() if k != "_id"}
    data.setdefault("created_at", datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"))
    path = PROFILES_DIR / f"{profile_id}.json"
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    data["_id"] = profile_id
    logger.info(f"Saved profile: {profile_id}")
    return data


def delete_profile(profile_id: str) -> bool:
    path = PROFILES_DIR / f"{profile_id}.json"
    if not path.exists():
        return False
    path.unlink()
    logger.info(f"Deleted profile: {profile_id}")
    return True


def profile_from_device_snapshot(raw: dict, name: str) -> dict:
    """Create a profile from a live device API snapshot."""
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
            "autofanspeed": raw.get("autofanspeed", True),
            "temptarget": raw.get("temptarget", 60),
            "displayTimeout": raw.get("displayTimeout", -1),
            "statsFrequency": raw.get("statsFrequency", 0),
            "overheat_temp": raw.get("overheat_temp", 70),
        },
        "source_mac": raw.get("macAddr", ""),
        "source_model": raw.get("deviceModel", ""),
        "created_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
