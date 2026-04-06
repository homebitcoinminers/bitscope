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
        # Result format: [[["mining.set_difficulty",id],["mining.notify",id]], extranonce1, extranonce2_size]
        if isinstance(sub_resp.get("result"), list):
            sr = sub_resp["result"]
            if len(sr) >= 2:
                result["extranonce"] = sr[1]  # extranonce1 hex
            if len(sr) >= 3:
                result["_en2_size"] = sr[2]   # extranonce2 byte size

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
                params = msg.get("params", [])
                # params: [job_id, prev_hash, coinbase1, coinbase2, merkle_branches,
                #          version, nbits, ntime, clean_jobs]
                if len(params) >= 4:
                    coinbase1 = params[2]
                    coinbase2 = params[3]
                    result["_coinbase1"] = coinbase1
                    result["_coinbase2"] = coinbase2
                    try:
                        cb_bytes = bytes.fromhex(coinbase1)
                        cb_text = ''.join(chr(b) if 32 <= b < 127 else '.' for b in cb_bytes)
                        for pool_tag in ['ckpool', 'public-pool', 'ocean', 'foundry',
                                          'antpool', 'f2pool', 'viabtc', 'binance', 'mara',
                                          'slush', 'braiins', 'bitfury', 'btc.com', 'poolin']:
                            if pool_tag.lower() in cb_text.lower():
                                result["pool_name"] = pool_tag
                                break
                        result["coinbase_text"] = cb_text[:120]
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


# ── Coinbase decoder ──────────────────────────────────────────────────────────

import struct as _struct

def _varint(data: bytes, offset: int) -> tuple[int, int]:
    b = data[offset]
    if b < 0xfd: return b, offset + 1
    elif b == 0xfd: return _struct.unpack_from('<H', data, offset+1)[0], offset + 3
    elif b == 0xfe: return _struct.unpack_from('<I', data, offset+1)[0], offset + 5
    else: return _struct.unpack_from('<Q', data, offset+1)[0], offset + 9


def _decode_script(script: bytes) -> dict:
    """Classify a scriptPubKey and extract its key material."""
    if len(script) == 25 and script[0]==0x76 and script[1]==0xa9 and script[2]==0x14:
        return {"type": "P2PKH", "desc": "Legacy (1…)", "hash160": script[3:23].hex()}
    if len(script) == 22 and script[0]==0x00 and script[1]==0x14:
        return {"type": "P2WPKH", "desc": "Native segwit (bc1q…)", "hash": script[2:].hex()}
    if len(script) == 34 and script[0]==0x00 and script[1]==0x20:
        return {"type": "P2WSH", "desc": "Segwit script hash (bc1q…)", "hash": script[2:].hex()}
    if len(script) == 34 and script[0]==0x51 and script[1]==0x20:
        return {"type": "P2TR", "desc": "Taproot (bc1p…)", "hash": script[2:].hex()}
    if len(script) == 23 and script[0]==0xa9 and script[1]==0x14:
        return {"type": "P2SH", "desc": "Script hash (3…)", "hash": script[2:22].hex()}
    if script and script[0] == 0x6a:
        try: text = script[2:].decode('utf-8', 'replace').replace('\x00','')
        except: text = script.hex()
        return {"type": "OP_RETURN", "desc": f"Data: {text[:80]}"}
    return {"type": "unknown", "raw": script.hex()[:40]}


def decode_coinbase_outputs(coinbase1: str, extranonce1: str, coinbase2: str,
                             extranonce2_size: int = 4) -> list[dict]:
    """
    Reconstruct coinbase transaction from stratum params and decode output addresses.
    
    Args:
        coinbase1: hex string (stratum notify params[2])
        extranonce1: hex string assigned by pool on subscribe
        coinbase2: hex string (stratum notify params[3])
        extranonce2_size: bytes of extranonce2 (from subscribe response)
    """
    # Build extranonce2 placeholder (all zeros)
    en2 = '00' * extranonce2_size
    full_hex = coinbase1 + extranonce1 + en2 + coinbase2
    try:
        raw = bytes.fromhex(full_hex)
    except Exception as e:
        return [{"error": f"Invalid hex: {e}"}]

    outputs = []
    try:
        offset = 0
        offset += 4  # version
        # Check for segwit marker/flag
        if len(raw) > offset + 1 and raw[offset] == 0x00 and raw[offset+1] == 0x01:
            offset += 2
        in_count, offset = _varint(raw, offset)
        for _ in range(in_count):
            offset += 32  # prev hash
            offset += 4   # prev index
            script_len, offset = _varint(raw, offset)
            offset += script_len
            offset += 4   # sequence
        out_count, offset = _varint(raw, offset)
        for i in range(out_count):
            value = _struct.unpack_from('<Q', raw, offset)[0]
            offset += 8
            script_len, offset = _varint(raw, offset)
            script = raw[offset:offset+script_len]
            offset += script_len
            decoded = _decode_script(script)
            outputs.append({
                "index": i,
                "value_sat": value,
                "value_btc": round(value / 1e8, 8) if value > 0 else 0,
                **decoded,
            })
    except Exception as e:
        outputs.append({"error": str(e), "partial": True})
    return outputs


def infer_payout_type(difficulty: float | None, outputs: list[dict], 
                       worker_address: str | None, authorized: bool | None) -> dict:
    """
    Infer pool payout type from stratum data.
    Returns human-readable analysis.
    """
    result = {
        "payout_type": "Unknown",
        "is_solo": False,
        "is_custodial": True,
        "worker_in_coinbase": False,
        "analysis": [],
        "verdict": "",
    }

    notes = result["analysis"]

    # Check difficulty
    if difficulty is not None:
        if difficulty > 1_000_000_000_000:
            result["is_solo"] = True
            result["payout_type"] = "SOLO"
            notes.append(f"Difficulty {difficulty:,.0f} ≈ full network difficulty → SOLO pool. "
                          "You only earn if your miner finds a full block.")
        elif difficulty > 1_000_000:
            notes.append(f"Difficulty {difficulty:,.0f} — high share difficulty, possibly SOLO or high-diff PPLNS.")
        elif difficulty > 1_000:
            result["payout_type"] = "PPLNS/FPPS"
            notes.append(f"Difficulty {difficulty:,.0f} — typical pooled mining (PPLNS/FPPS). "
                          "You earn proportional shares.")
        else:
            result["payout_type"] = "PPLNS/FPPS"
            notes.append(f"Difficulty {difficulty:.1f} — low share difficulty, shared pool with frequent payouts.")

    # Check coinbase outputs
    if outputs and not any('error' in o for o in outputs):
        for o in outputs:
            otype = o.get("type", "")
            odesc = o.get("desc", "")

            # Check if worker address appears in the output hash (non-custodial solo)
            if worker_address and o.get("hash"):
                # For P2WPKH: the hash is the 20-byte pubkey hash
                # A bc1q address encodes a pubkey hash — we can't easily reverse
                # but we CAN note if there's only 1 output going to a non-pool address
                pass

            if otype == "OP_RETURN":
                notes.append(f"Output {o['index']}: OP_RETURN data — {o.get('desc','')}")
            elif value_btc := o.get("value_btc", 0):
                notes.append(f"Output {o['index']}: {o['value_btc']} BTC → {otype} ({odesc})")
            else:
                notes.append(f"Output {o['index']}: (template value=0, will be set at solve time) → {otype} ({odesc})")

        # Solo non-custodial: single output going directly to miner
        non_op_return = [o for o in outputs if o.get("type") != "OP_RETURN"]
        if len(non_op_return) == 1 and result["is_solo"]:
            result["is_custodial"] = False
            notes.append("✅ Single coinbase output — consistent with non-custodial solo pool "
                          "(reward goes directly to your address if you find a block).")
        elif len(non_op_return) > 1 and result["is_solo"]:
            result["is_custodial"] = True
            notes.append(f"⚠️ {len(non_op_return)} coinbase outputs — pool takes a fee cut. "
                          "Not fully non-custodial.")

    # Auth result
    if authorized is True:
        notes.append("✅ Authorization accepted — this pool accepts your wallet address as a worker name.")
    elif authorized is False:
        notes.append("❌ Authorization rejected — this pool may require account registration, "
                      "or your address format is not supported.")
    elif authorized is None:
        notes.append("⚠️ No auth response received — pool may not require auth (some solo pools skip it).")

    # Build verdict
    if result["payout_type"] == "SOLO" and not result["is_custodial"]:
        result["verdict"] = "Non-custodial SOLO pool — you keep 100% of any block you find, paid directly to your address."
    elif result["payout_type"] == "SOLO" and result["is_custodial"]:
        result["verdict"] = "Custodial SOLO pool — pool holds rewards and pays out. Verify fee structure on pool website."
    elif result["payout_type"] == "PPLNS/FPPS":
        result["verdict"] = "Shared pooled mining — frequent proportional payouts based on shares submitted."
    else:
        result["verdict"] = "Could not determine payout type — check pool website for details."

    return result


async def stratum_check_full(host: str, port: int, worker: str = "bc1qcheck.bitscope",
                              password: str = "x", tls: bool = False, timeout: float = 20.0) -> dict:
    """
    Extended stratum check that also decodes coinbase outputs and infers payout type.
    """
    result = await stratum_check(host, port, worker=worker, password=password, tls=tls, timeout=timeout)
    
    if result.get("ok") and result.get("_coinbase1") and result.get("_coinbase2"):
        outputs = decode_coinbase_outputs(
            result["_coinbase1"],
            result.get("extranonce", ""),
            result["_coinbase2"],
            result.get("_en2_size", 4),
        )
        result["coinbase_outputs"] = outputs
        payout = infer_payout_type(
            result.get("difficulty"),
            outputs,
            worker,
            result.get("authorized"),
        )
        result["payout_analysis"] = payout
        # Clean up internal fields
        del result["_coinbase1"]
        del result["_coinbase2"]
        if "_en2_size" in result: del result["_en2_size"]
    
    return result
