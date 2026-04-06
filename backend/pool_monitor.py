"""
Pool Monitor — two features:

1. Pool Uptime Monitor
   - TCP connect + Stratum handshake (mining.subscribe + mining.authorize)
   - Measures RTT, checks pool responds correctly
   - Polls every 5 minutes per pool
   - Discord alerts on up/down state change

2. Pool Checker (pool_checkr concept)
   - Full Stratum session: subscribe, authorize, wait for mining.notify + mining.set_difficulty
   - Reads coinbase transaction prefix to identify pool payout type
   - Returns: difficulty, job info, pool identity clues, auth result
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path

import aiohttp

logger = logging.getLogger("bitscope.pools")

# In-memory state: pool_key -> {status, last_checked, last_rtt, error}
_pool_states: dict[str, dict] = {}
POOLS_FILE = Path("/data/pool_monitors.json")


def load_pools() -> list[dict]:
    if not POOLS_FILE.exists():
        return []
    try:
        return json.loads(POOLS_FILE.read_text())
    except Exception as e:
        logger.error(f"Failed to load pool monitors: {e}")
        return []


def save_pools(pools: list[dict]):
    POOLS_FILE.parent.mkdir(parents=True, exist_ok=True)
    POOLS_FILE.write_text(json.dumps(pools, indent=2))


def get_pool_key(host: str, port: int) -> str:
    return f"{host}:{port}"


async def stratum_check(host: str, port: int, worker: str = "bc1qcheck.bitscope", 
                         password: str = "x", tls: bool = False, timeout: float = 10.0) -> dict:
    """
    Connect to a stratum pool and do a full handshake.
    Returns timing, difficulty, and pool response info.
    """
    start = time.time()
    result = {
        "ok": False,
        "host": host,
        "port": port,
        "rtt_ms": None,
        "error": None,
        "difficulty": None,
        "pool_name": None,
        "authorized": None,
        "job_received": False,
        "extranonce": None,
        "ts": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    try:
        # Open TCP connection
        if tls:
            import ssl as _ssl
            ctx = _ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = _ssl.CERT_NONE
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port, ssl=ctx), timeout=timeout
            )
        else:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), timeout=timeout
            )

        connect_time = time.time()

        async def send(msg: dict):
            line = json.dumps(msg) + "\n"
            writer.write(line.encode())
            await writer.drain()

        async def recv() -> dict | None:
            try:
                line = await asyncio.wait_for(reader.readline(), timeout=timeout)
                if not line:
                    return None
                return json.loads(line.decode().strip())
            except (asyncio.TimeoutError, json.JSONDecodeError, Exception):
                return None

        # Step 1: mining.subscribe
        await send({
            "id": 1,
            "method": "mining.subscribe",
            "params": ["BitScope/1.0"]
        })

        sub_resp = await recv()
        if not sub_resp:
            result["error"] = "No response to subscribe"
            writer.close()
            return result

        # Parse extranonce from subscribe response
        if isinstance(sub_resp.get("result"), list) and len(sub_resp["result"]) >= 2:
            result["extranonce"] = sub_resp["result"][1]  # extranonce1

        # Step 2: mining.authorize
        await send({
            "id": 2,
            "method": "mining.authorize",
            "params": [worker, password]
        })

        # Read messages until we get authorize response + difficulty + job (or timeout)
        msgs_received = []
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = await recv()
            if msg is None:
                break
            msgs_received.append(msg)

            # Check authorize result
            if msg.get("id") == 2:
                result["authorized"] = msg.get("result") is True

            # Check set_difficulty
            if msg.get("method") == "mining.set_difficulty":
                params = msg.get("params", [])
                if params:
                    result["difficulty"] = params[0]

            # Check notify (job)
            if msg.get("method") == "mining.notify":
                result["job_received"] = True
                # Extract pool identity from coinbase if possible
                params = msg.get("params", [])
                if len(params) >= 3:
                    try:
                        coinbase_hex = params[2]  # coinbase1
                        # Decode ASCII-printable parts of coinbase
                        cb_bytes = bytes.fromhex(coinbase_hex)
                        cb_text = ''.join(chr(b) if 32 <= b < 127 else '.' for b in cb_bytes)
                        # Common pool identifiers in coinbase
                        for pool_tag in ['ckpool', 'public-pool', 'ocean', 'foundry', 
                                          'antpool', 'f2pool', 'viabtc', 'binance', 'mara']:
                            if pool_tag.lower() in cb_text.lower():
                                result["pool_name"] = pool_tag
                                break
                        result["coinbase_text"] = cb_text[:80]
                    except Exception:
                        pass

            # If we have all key info, we can stop early
            if result["authorized"] is not None and result["difficulty"] is not None and result["job_received"]:
                break

        rtt = round((time.time() - connect_time) * 1000, 1)
        result["rtt_ms"] = rtt
        result["ok"] = True  # Connection + subscribe succeeded = pool is up

        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass

    except asyncio.TimeoutError:
        result["error"] = f"Connection timed out after {timeout}s"
    except ConnectionRefusedError:
        result["error"] = "Connection refused"
    except OSError as e:
        result["error"] = str(e)
    except Exception as e:
        result["error"] = str(e)

    return result


async def check_all_pools(discord_enabled: bool = True):
    """Check all monitored pools and fire Discord alerts on state changes."""
    pools = load_pools()
    if not pools:
        return

    for pool in pools:
        if not pool.get("enabled", True):
            continue

        host = pool["host"]
        port = pool["port"]
        tls = pool.get("tls", False)
        worker = pool.get("worker", "bc1qcheck.bitscope")
        key = get_pool_key(host, port)

        result = await stratum_check(host, port, worker=worker, tls=tls)

        prev_state = _pool_states.get(key, {})
        prev_ok = prev_state.get("ok")
        now_ok = result["ok"]

        _pool_states[key] = {
            **result,
            "label": pool.get("label", f"{host}:{port}"),
        }

        # Alert on state change
        if prev_ok is not None and prev_ok != now_ok:
            if discord_enabled:
                await _send_pool_alert(pool, result, was_up=prev_ok)

        logger.info(f"[pool-monitor] {host}:{port} ok={now_ok} rtt={result.get('rtt_ms')}ms err={result.get('error')}")


async def _send_pool_alert(pool: dict, result: dict, was_up: bool):
    """Send Discord alert for pool state change."""
    webhook_url = os.getenv("DISCORD_WEBHOOK_URL", "")
    if not webhook_url:
        return

    label = pool.get("label") or f"{pool['host']}:{pool['port']}"
    now_up = result["ok"]

    if now_up:
        color = 0x44BB44
        title = f"✅ Pool back online — {label}"
        desc = f"Pool is responding again. RTT: {result.get('rtt_ms')}ms"
    else:
        color = 0xFF4444
        title = f"🔴 Pool offline — {label}"
        desc = f"Pool is not responding. Error: {result.get('error', 'unknown')}"

    fields = [
        {"name": "Host", "value": f"{pool['host']}:{pool['port']}", "inline": True},
        {"name": "TLS", "value": "Yes" if pool.get("tls") else "No", "inline": True},
    ]
    if result.get("rtt_ms"):
        fields.append({"name": "RTT", "value": f"{result['rtt_ms']}ms", "inline": True})

    payload = {
        "embeds": [{
            "title": title,
            "description": desc,
            "color": color,
            "fields": fields,
            "timestamp": datetime.utcnow().isoformat(),
            "footer": {"text": "BitScope Pool Monitor"},
        }]
    }
    try:
        async with aiohttp.ClientSession() as http:
            await http.post(webhook_url, json=payload)
    except Exception as e:
        logger.error(f"[pool-monitor] Discord failed: {e}")


def get_all_states() -> dict:
    return dict(_pool_states)
