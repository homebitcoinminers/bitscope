"""
Pool Monitor — stratum V1 uptime checker + full coinbase decoder / payout analyser.

Two features:
1. Pool Uptime Monitor — periodic stratum checks with Discord alerts
2. Pool Checker — full stratum handshake + coinbase decode + payout analysis
"""

import asyncio
import json
import logging
import os
import struct
import time
from datetime import datetime
from pathlib import Path

import aiohttp

logger = logging.getLogger("bitscope.pools")

POOLS_FILE = Path("/data/pool_monitors.json")
_pool_states: dict[str, dict] = {}


# ── Persistence ───────────────────────────────────────────────────────────────

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


# ── Bech32 address encoder ────────────────────────────────────────────────────

_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

def _polymod(values):
    GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
    chk = 1
    for v in values:
        b = chk >> 25
        chk = (chk & 0x1ffffff) << 5 ^ v
        for i in range(5):
            chk ^= GEN[i] if ((b >> i) & 1) else 0
    return chk

def _hrp_expand(hrp):
    return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]

def _convertbits(data, frombits, tobits, pad=True):
    acc = 0; bits = 0; ret = []
    maxv = (1 << tobits) - 1
    max_acc = (1 << (frombits + tobits - 1)) - 1
    for value in data:
        acc = ((acc << frombits) | value) & max_acc
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad and bits:
        ret.append((acc << (tobits - bits)) & maxv)
    return ret

def _bech32_encode(hrp: str, witver: int, prog: bytes, m: bool = False) -> str:
    data = [witver] + _convertbits(prog, 8, 5)
    const = 0x2bc830a3 if m else 1
    values = _hrp_expand(hrp) + data
    polymod = _polymod(values + [0]*6) ^ const
    checksum = [(polymod >> 5*(5-i)) & 31 for i in range(6)]
    return hrp + '1' + ''.join(_CHARSET[d] for d in data + checksum)

def script_to_address(script: bytes, hrp: str = 'bc') -> str | None:
    """Convert scriptPubKey bytes to a Bitcoin address string."""
    # P2WPKH: OP_0 <20 bytes>
    if len(script) == 22 and script[0] == 0x00 and script[1] == 0x14:
        return _bech32_encode(hrp, 0, script[2:], False)
    # P2WSH: OP_0 <32 bytes>
    if len(script) == 34 and script[0] == 0x00 and script[1] == 0x20:
        return _bech32_encode(hrp, 0, script[2:], False)
    # P2TR: OP_1 <32 bytes>
    if len(script) == 34 and script[0] == 0x51 and script[1] == 0x20:
        return _bech32_encode(hrp, 1, script[2:], True)
    # P2PKH: OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
    if len(script) == 25 and script[0] == 0x76 and script[1] == 0xa9:
        import hashlib, base58
        try:
            h = script[3:23]
            payload = bytes([0x00]) + h
            checksum = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
            return base58.b58encode(payload + checksum).decode()
        except Exception:
            return None
    # P2SH
    if len(script) == 23 and script[0] == 0xa9 and script[1] == 0x14:
        import hashlib, base58
        try:
            h = script[2:22]
            payload = bytes([0x05]) + h
            checksum = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
            return base58.b58encode(payload + checksum).decode()
        except Exception:
            return None
    return None


# ── Coinbase transaction decoder ──────────────────────────────────────────────

def _varint(data: bytes, offset: int) -> tuple[int, int]:
    b = data[offset]
    if b < 0xfd: return b, offset + 1
    elif b == 0xfd: return struct.unpack_from('<H', data, offset+1)[0], offset + 3
    elif b == 0xfe: return struct.unpack_from('<I', data, offset+1)[0], offset + 5
    else: return struct.unpack_from('<Q', data, offset+1)[0], offset + 9

def decode_script_info(script: bytes) -> dict:
    """Full script classification with address derivation."""
    if len(script) == 22 and script[0] == 0x00 and script[1] == 0x14:
        addr = script_to_address(script)
        return {"type": "P2WPKH", "desc": "Native segwit (bc1q…)", "address": addr, "hash": script[2:].hex()}
    if len(script) == 34 and script[0] == 0x00 and script[1] == 0x20:
        addr = script_to_address(script)
        return {"type": "P2WSH", "desc": "Segwit script hash (bc1q…)", "address": addr, "hash": script[2:].hex()}
    if len(script) == 34 and script[0] == 0x51 and script[1] == 0x20:
        addr = script_to_address(script)
        return {"type": "P2TR", "desc": "Taproot (bc1p…)", "address": addr, "hash": script[2:].hex()}
    if len(script) == 25 and script[0] == 0x76 and script[1] == 0xa9:
        addr = script_to_address(script)
        return {"type": "P2PKH", "desc": "Legacy (1…)", "address": addr, "hash": script[3:23].hex()}
    if len(script) == 23 and script[0] == 0xa9 and script[1] == 0x14:
        addr = script_to_address(script)
        return {"type": "P2SH", "desc": "Script hash (3…)", "address": addr, "hash": script[2:22].hex()}
    if script and script[0] == 0x6a:
        # OP_RETURN — extract data text
        data_part = script[2:] if len(script) > 2 else b''
        text = ''.join(chr(b) if 32 <= b < 127 else f'\\x{b:02x}' for b in data_part)
        return {"type": "OP_RETURN", "desc": f"Null data", "data_text": text, "address": None}
    return {"type": "unknown", "desc": "Unknown script", "address": None, "raw": script.hex()[:40]}

def decode_coinbase_tx(coinbase1: str, extranonce1: str, en2_size: int, coinbase2: str) -> dict:
    """
    Reconstruct and fully decode a stratum coinbase transaction.
    Returns parsed header, coinbase script text, and all outputs with addresses.
    """
    en2 = '00' * en2_size
    full_hex = coinbase1 + extranonce1 + en2 + coinbase2

    try:
        raw = bytes.fromhex(full_hex)
    except Exception as e:
        return {"error": f"Hex decode failed: {e}"}

    result = {
        "raw_hex": full_hex[:80] + "…",
        "version": None,
        "coinbase_script_text": "",
        "block_height": None,
        "outputs": [],
    }

    try:
        offset = 0
        result["version"] = struct.unpack_from('<I', raw, offset)[0]
        offset += 4

        # Segwit marker
        segwit = False
        if len(raw) > offset + 1 and raw[offset] == 0x00 and raw[offset+1] == 0x01:
            segwit = True
            offset += 2

        # Input count (always 1 for coinbase)
        in_count, offset = _varint(raw, offset)

        for _ in range(in_count):
            offset += 32  # prev hash (all zeros for coinbase)
            offset += 4   # prev index (0xffffffff for coinbase)
            script_len, offset = _varint(raw, offset)
            cb_script = raw[offset:offset+script_len]
            offset += script_len
            offset += 4   # sequence

            # Decode coinbase script text
            text = ''.join(chr(b) if 32 <= b < 127 else '.' for b in cb_script)
            result["coinbase_script_text"] = text

            # Try to extract block height (BIP34: first push is height)
            if len(cb_script) >= 4 and cb_script[0] == 0x03:
                try:
                    height_bytes = cb_script[1:4]
                    result["block_height"] = int.from_bytes(height_bytes, 'little')
                except Exception:
                    pass

        # Outputs
        out_count, offset = _varint(raw, offset)
        for i in range(out_count):
            value_sat = struct.unpack_from('<Q', raw, offset)[0]
            offset += 8
            script_len, offset = _varint(raw, offset)
            script = raw[offset:offset+script_len]
            offset += script_len

            info = decode_script_info(script)
            result["outputs"].append({
                "index": i,
                "value_sat": value_sat,
                "value_btc": round(value_sat / 1e8, 8),
                **info,
            })

    except Exception as e:
        result["parse_error"] = str(e)

    return result


def nbits_to_difficulty(nbits_hex: str) -> float | None:
    """Convert nBits (compact difficulty target) to difficulty number."""
    try:
        nbits = int(nbits_hex, 16)
        exp = nbits >> 24
        mant = nbits & 0xffffff
        target = mant * (2 ** (8 * (exp - 3)))
        max_target = 0x00000000FFFF0000000000000000000000000000000000000000000000000000
        return round(max_target / target, 2) if target > 0 else None
    except Exception:
        return None


# ── Stratum check ─────────────────────────────────────────────────────────────

async def stratum_check(host: str, port: int, worker: str = "bc1qcheck.bitscope",
                        password: str = "x", tls: bool = False,
                        timeout: float = 20.0, decode_coinbase: bool = False) -> dict:
    """
    Connect to a stratum pool, do full handshake, optionally decode coinbase.
    """
    start = time.time()
    result = {
        "ok": False, "host": host, "port": port, "rtt_ms": None, "error": None,
        "difficulty": None, "nbits": None, "pool_name": None,
        "authorized": None, "job_received": False, "extranonce1": None,
        "extranonce2_size": 4, "coinbase1": None, "coinbase2": None,
        "block_height": None, "prev_hash": None, "ntime": None,
        "coinbase_script_text": None,
        "ts": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    try:
        if tls:
            import ssl as _ssl
            ctx = _ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = _ssl.CERT_NONE
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port, ssl=ctx), timeout=timeout)
        else:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), timeout=timeout)

        connect_time = time.time()

        async def send(msg: dict):
            writer.write((json.dumps(msg) + "\n").encode())
            await writer.drain()

        async def recv() -> dict | None:
            try:
                line = await asyncio.wait_for(reader.readline(), timeout=timeout)
                if not line:
                    return None
                return json.loads(line.decode().strip())
            except Exception:
                return None

        # 1. Subscribe
        await send({"id": 1, "method": "mining.subscribe", "params": ["BitScope/1.0"]})
        sub = await recv()
        if not sub:
            result["error"] = "No response to mining.subscribe"
            writer.close()
            return result

        # Parse subscribe response: [subscriptions, extranonce1, extranonce2_size]
        sr = sub.get("result", [])
        if isinstance(sr, list) and len(sr) >= 3:
            result["extranonce1"] = sr[1]
            result["extranonce2_size"] = sr[2]
        elif isinstance(sr, list) and len(sr) >= 2:
            result["extranonce1"] = sr[1]

        # 2. Authorize
        await send({"id": 2, "method": "mining.authorize", "params": [worker, password]})

        # 3. Read messages until we have difficulty + job (or timeout)
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = await recv()
            if msg is None:
                break

            method = msg.get("method")
            mid = msg.get("id")

            if mid == 2:
                result["authorized"] = msg.get("result") is True

            if method == "mining.set_difficulty":
                params = msg.get("params", [])
                if params:
                    result["difficulty"] = params[0]

            if method == "mining.notify":
                params = msg.get("params", [])
                result["job_received"] = True
                if len(params) >= 9:
                    result["prev_hash"]  = params[1]
                    result["coinbase1"]  = params[2]
                    result["coinbase2"]  = params[3]
                    result["nbits"]      = params[6]
                    result["ntime"]      = params[7]

                    # Decode coinbase script text immediately for pool ID
                    try:
                        cb1_bytes = bytes.fromhex(params[2])
                        result["coinbase_script_text"] = ''.join(
                            chr(b) if 32 <= b < 127 else '.' for b in cb1_bytes)
                        # Pool identity from coinbase
                        cb_lower = result["coinbase_script_text"].lower()
                        for tag in ['ckpool','public-pool','public_pool','ocean',
                                    'foundry','antpool','f2pool','viabtc','braiins',
                                    'binance','mara','bitfury','slush','poolin']:
                            if tag in cb_lower:
                                result["pool_name"] = tag
                                break
                    except Exception:
                        pass

            # Stop once we have everything needed
            if (result["authorized"] is not None and
                    result["difficulty"] is not None and
                    result["job_received"]):
                break

        result["rtt_ms"] = round((time.time() - connect_time) * 1000, 1)
        result["ok"] = True

        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass

    except asyncio.TimeoutError:
        result["error"] = f"Timed out after {timeout}s"
    except ConnectionRefusedError:
        result["error"] = "Connection refused"
    except OSError as e:
        result["error"] = str(e)
    except Exception as e:
        result["error"] = str(e)

    return result


async def stratum_check_full(host: str, port: int, worker: str = "bc1qcheck.bitscope",
                              password: str = "x", tls: bool = False,
                              timeout: float = 20.0) -> dict:
    """Full stratum check with coinbase decode and payout analysis."""
    result = await stratum_check(host, port, worker=worker, password=password,
                                  tls=tls, timeout=timeout)

    if result.get("ok") and result.get("coinbase1") and result.get("coinbase2"):
        # Decode the coinbase transaction
        cb = decode_coinbase_tx(
            result["coinbase1"],
            result.get("extranonce1") or "",
            result.get("extranonce2_size") or 4,
            result["coinbase2"],
        )
        result["coinbase_decoded"] = cb
        if cb.get("block_height"):
            result["block_height"] = cb["block_height"]
        if cb.get("coinbase_script_text"):
            result["coinbase_script_text"] = cb["coinbase_script_text"]

        # Derive difficulty from nbits if set_difficulty wasn't received
        if result.get("nbits") and not result.get("difficulty"):
            result["difficulty_from_nbits"] = nbits_to_difficulty(result["nbits"])

        # Payout analysis
        result["payout_analysis"] = _analyse_payout(result, worker)

    return result


def _analyse_payout(result: dict, worker: str) -> dict:
    """Infer pool payout type and non-custodial status from decoded stratum data."""
    analysis = {"notes": [], "payout_type": "Unknown", "is_solo": False,
                "is_custodial": True, "verdict": ""}
    notes = analysis["notes"]

    diff = result.get("difficulty")
    if diff is not None:
        if diff > 1_000_000_000_000:
            analysis["is_solo"] = True
            analysis["payout_type"] = "SOLO"
            notes.append(f"Difficulty {diff:,.0f} ≈ full network difficulty → SOLO pool. "
                          "You only earn if your miner finds a block.")
        elif diff > 1_000_000:
            analysis["payout_type"] = "SOLO"
            analysis["is_solo"] = True
            notes.append(f"Difficulty {diff:,.0f} — high, likely SOLO pool.")
        else:
            analysis["payout_type"] = "PPLNS/FPPS"
            notes.append(f"Difficulty {diff:,.0f} — typical pooled mining. "
                          "You earn proportional to shares submitted.")

    outputs = (result.get("coinbase_decoded") or {}).get("outputs", [])
    real_outputs = [o for o in outputs if o.get("type") != "OP_RETURN"]
    op_returns = [o for o in outputs if o.get("type") == "OP_RETURN"]

    for o in outputs:
        addr = o.get("address")
        if o["type"] == "OP_RETURN":
            notes.append(f"Output {o['index']}: OP_RETURN — {o.get('data_text','')[:60]}")
        elif addr:
            notes.append(f"Output {o['index']}: {o['value_btc']} BTC → {o['type']} → {addr}")
        else:
            notes.append(f"Output {o['index']}: {o['value_btc']} BTC → {o['type']}")

    # Non-custodial check for SOLO pools
    if analysis["is_solo"]:
        worker_addr = worker.split('.')[0].lower() if worker else ""
        
        if len(real_outputs) == 1:
            addr = real_outputs[0].get("address", "")
            analysis["is_custodial"] = False
            if addr.lower() == worker_addr:
                notes.append(f"✅ Single coinbase output → your address ({addr}) — "
                              "non-custodial SOLO. Block reward goes directly to you.")
            else:
                notes.append(f"✅ Single coinbase output → {addr} — "
                              "non-custodial. Verify this is your wallet address.")
        
        elif len(real_outputs) == 2:
            # Check if one output matches the miner — classic pool-operator fee split
            addrs = [o.get("address","").lower() for o in real_outputs]
            if worker_addr and worker_addr in addrs:
                miner_out = next(o for o in real_outputs if o.get("address","").lower() == worker_addr)
                fee_out   = next(o for o in real_outputs if o.get("address","").lower() != worker_addr)
                analysis["is_custodial"] = False
                analysis["payout_type"] = "SOLO (with pool fee)"
                notes.append(f"✅ Non-custodial SOLO with pool operator fee split:")
                notes.append(f"   • Your address ({miner_out.get('address')}) receives the block reward")
                notes.append(f"   • Pool fee address ({fee_out.get('address')}) receives the operator fee")
                notes.append(f"   Tip: if you run this pool yourself and both addresses are yours, "
                              f"you keep 100% across both outputs.")
            else:
                analysis["is_custodial"] = True
                notes.append(f"⚠️ 2 coinbase outputs, neither matches your worker address → "
                              "pool takes full custody. Check pool fee structure.")
        
        elif len(real_outputs) > 2:
            analysis["is_custodial"] = True
            notes.append(f"⚠️ {len(real_outputs)} coinbase outputs — complex fee structure. "
                          "Likely custodial with multiple fee recipients.")

    if result.get("authorized") is True:
        notes.append("✅ Pool accepted your wallet address as a stratum username.")
    elif result.get("authorized") is False:
        notes.append("❌ Pool rejected authorization — may require account registration.")

    if analysis["payout_type"] == "SOLO" and not analysis["is_custodial"]:
        analysis["verdict"] = "Non-custodial SOLO — block reward paid directly to your address. No pool custody."
    elif analysis["payout_type"] == "SOLO":
        analysis["verdict"] = "Custodial SOLO — pool holds rewards then pays out. Check fee structure."
    elif analysis["payout_type"] == "PPLNS/FPPS":
        analysis["verdict"] = "Shared pool — frequent proportional payouts based on shares."
    else:
        analysis["verdict"] = "Could not determine — check pool website."

    return analysis


# ── Scheduled uptime checks ───────────────────────────────────────────────────

async def check_all_pools(discord_enabled: bool = True):
    pools = load_pools()
    for pool in pools:
        if not pool.get("enabled", True):
            continue
        key = get_pool_key(pool["host"], pool["port"])
        result = await stratum_check(pool["host"], pool["port"],
                                      worker=pool.get("worker","bc1qcheck.bitscope"),
                                      tls=pool.get("tls", False), timeout=12.0)
        prev_ok = _pool_states.get(key, {}).get("ok")
        _pool_states[key] = {**result, "label": pool.get("label","")}
        if prev_ok is not None and prev_ok != result["ok"] and discord_enabled:
            await _discord_pool_alert(pool, result)
        logger.info(f"[pool] {pool['host']}:{pool['port']} ok={result['ok']} "
                    f"rtt={result.get('rtt_ms')}ms diff={result.get('difficulty')}")

async def _discord_pool_alert(pool: dict, result: dict):
    url = os.getenv("DISCORD_WEBHOOK_URL", "")
    if not url:
        return
    label = pool.get("label") or f"{pool['host']}:{pool['port']}"
    up = result["ok"]
    payload = {"embeds": [{"title": f"{'✅' if up else '🔴'} Pool {'back online' if up else 'offline'} — {label}",
        "description": f"RTT: {result.get('rtt_ms')}ms" if up else f"Error: {result.get('error')}",
        "color": 0x44BB44 if up else 0xFF4444,
        "timestamp": datetime.utcnow().isoformat(),
        "footer": {"text": "BitScope Pool Monitor"}}]}
    try:
        async with aiohttp.ClientSession() as http:
            await http.post(url, json=payload)
    except Exception as e:
        logger.error(f"[pool] Discord alert failed: {e}")

def get_all_states() -> dict:
    return dict(_pool_states)
