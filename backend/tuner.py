"""
BitScope auto-tuner.

Two phases per device:

  autotune  Starts at the device's current settings (the baseline), then climbs in
            frequency steps. At each step it waits out a warmup, measures a settle
            window, and scores it. On a stability failure it adds voltage and retries
            the same frequency. It stops at the first frequency it cannot stabilise
            under the voltage cap, or the moment any temp/power limit is hit.

  governor  Rides a "ladder" of validated points below the proven max. Steps down
            as soon as chip/VR temp or power gets near a limit, steps back up only
            after a long, comfortably-cool hold. Pauses itself if someone changes
            frequency/voltage outside the tuner.

Stability is judged relative to the baseline: hashrate per MHz must hold (a chip that
is clocked past its limit stops scaling and drops nonces), no reboots, and HW nonce /
error counts stay inside configurable allowances.

The tuner never touches fan settings. It reads the snapshots the normal poll loop
writes, so it adds no extra traffic to the miners beyond the PATCH when it changes
something.
"""
import json
import logging
from datetime import datetime, timedelta
from typing import Optional

import aiohttp
from fastapi import APIRouter, HTTPException
from sqlmodel import Session, select, func
from sqlalchemy import or_

from database import engine, get_thresholds
from models import TunerConfig, TuneStep, MetricSnapshot, Device, AlertLog, HardwareSnapshot

logger = logging.getLogger("bitscope.tuner")
router = APIRouter()

REQUIRED_LIMITS = ("temp_max", "vr_temp_max", "power_max_w", "freq_max_mhz", "voltage_max_mv")
LIMIT_LABELS = {
    "temp_max": "Chip temp limit",
    "vr_temp_max": "VR temp limit",
    "power_max_w": "Power limit",
    "freq_max_mhz": "Max frequency",
    "voltage_max_mv": "Max core voltage",
}
EDITABLE = REQUIRED_LIMITS + ("voltage_min_mv", "soak_minutes", "headroom_c",
    "freq_min_mhz", "margin_pct", "voltage_margin_mv", "step_mhz", "voltage_step_mv",
    "warmup_minutes", "settle_minutes", "hysteresis_c", "up_hold_minutes",
    "min_hashrate_ratio", "max_hw_nonces_per_step", "max_error_pct",
)
MAX_STEPS_PER_RUN = 40
FRESH_SECONDS = 90          # a snapshot older than this means "no current reading"
OFFLINE_FAIL_MINUTES = 3    # device unreachable this long during a test = crash


# ── Small helpers ────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.utcnow()


def _i(v) -> Optional[int]:
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


def missing_limits(cfg: TunerConfig) -> list[str]:
    return [k for k in REQUIRED_LIMITS if not getattr(cfg, k)]


def get_ladder(cfg: TunerConfig) -> list[dict]:
    try:
        return json.loads(cfg.ladder) if cfg.ladder else []
    except Exception:
        return []


def _latest(db: Session, mac: str) -> Optional[MetricSnapshot]:
    return db.exec(
        select(MetricSnapshot).where(MetricSnapshot.mac == mac)
        .order_by(MetricSnapshot.ts.desc()).limit(1)
    ).first()


def _fresh(snap: Optional[MetricSnapshot]) -> bool:
    return bool(snap and (_now() - snap.ts).total_seconds() <= FRESH_SECONDS)


def _since(db: Session, mac: str, since: datetime) -> list[MetricSnapshot]:
    return db.exec(
        select(MetricSnapshot).where(MetricSnapshot.mac == mac, MetricSnapshot.ts >= since)
        .order_by(MetricSnapshot.ts.asc())
    ).all()


def _log(db: Session, mac: str, msg: str, value=None, threshold=None, kind="tuning_change") -> AlertLog:
    # alert_type "tuning_change" also makes the HW nonce tracker ignore the
    # settling period after each change (see nonce_tracker.process_snapshot).
    a = AlertLog(mac=mac, alert_type=kind, message=msg, value=value, threshold=threshold)
    db.add(a)
    db.commit()
    db.refresh(a)
    logger.info(f"[tuner] {mac} {msg}")
    return a


async def _discord(alert: AlertLog, mac: str):
    try:
        from scanner import send_discord_alert
        with Session(engine) as db:
            dev = db.get(Device, mac)
        if dev:
            await send_discord_alert(alert, dev)
    except Exception as e:
        logger.warning(f"[tuner] discord send failed: {e}")


def _over_limits(cfg: TunerConfig, s: MetricSnapshot, slack: float = 0.0) -> Optional[tuple[str, str]]:
    """Return (kind, reason) if the snapshot is at/over a limit (minus slack)."""
    if s.temp is not None and cfg.temp_max and s.temp >= cfg.temp_max - slack:
        return "thermal", f"chip {s.temp:.1f}°C reached limit {cfg.temp_max:g}°C"
    if s.vr_temp is not None and cfg.vr_temp_max and s.vr_temp >= cfg.vr_temp_max - slack:
        return "thermal", f"VR {s.vr_temp:.1f}°C reached limit {cfg.vr_temp_max:g}°C"
    if s.power is not None and cfg.power_max_w and s.power >= cfg.power_max_w - slack:
        return "power", f"power {s.power:.0f} W reached limit {cfg.power_max_w:g} W"
    return None


async def patch_device(ip: str, freq: int, voltage: int) -> tuple[bool, Optional[str]]:
    payload = {"frequency": int(freq), "coreVoltage": int(voltage)}
    try:
        async with aiohttp.ClientSession() as http:
            async with http.patch(f"http://{ip}/api/system", json=payload,
                                  timeout=aiohttp.ClientTimeout(total=10)) as r:
                if r.status in (200, 204):
                    return True, None
                return False, f"HTTP {r.status}"
    except Exception as e:
        return False, str(e) or type(e).__name__


async def _request(db: Session, cfg: TunerConfig, dev: Device, freq: int, voltage: int, reason: str) -> bool:
    """Set the target point and try to push it now. If the device is unreachable,
    leave pending_apply set so the next tick retries."""
    freq = int(freq)
    voltage = int(voltage)
    # Hard caps are absolute — nothing in the tuner may exceed them.
    if cfg.freq_max_mhz and freq > cfg.freq_max_mhz:
        freq = cfg.freq_max_mhz
    if cfg.voltage_max_mv and voltage > cfg.voltage_max_mv:
        voltage = cfg.voltage_max_mv
    cfg.expect_freq, cfg.expect_voltage = freq, voltage
    cfg.mismatch_polls = 0
    cfg.last_change_at = _now()
    ok, err = (False, "no IP") if not dev.last_ip else await patch_device(dev.last_ip, freq, voltage)
    cfg.pending_apply = not ok
    if ok:
        _log(db, cfg.mac, f"Tuner: {reason} → {freq} MHz @ {voltage} mV")
    else:
        cfg.status_msg = f"Couldn't reach device to apply {freq} MHz @ {voltage} mV ({err}) — will retry"
    db.add(cfg)
    db.commit()
    return ok


async def _device_limits(dev: Device) -> dict:
    """absMaxFrequency / absMaxVoltage / defaults from the device's /api/system/asic.
    Best effort: an empty dict if it doesn't answer."""
    if not dev.last_ip:
        return {}
    try:
        async with aiohttp.ClientSession() as http:
            async with http.get(f"http://{dev.last_ip}/api/system/asic",
                                timeout=aiohttp.ClientTimeout(total=5)) as r:
                if r.status == 200:
                    d = await r.json(content_type=None)
                    return d if isinstance(d, dict) else {}
    except Exception:
        pass
    return {}


# ── Measurement ──────────────────────────────────────────────────────────────

def evaluate(cfg: TunerConfig, snaps: list[MetricSnapshot], freq: int) -> dict:
    """Score a measured window."""
    hr = [s.hashrate for s in snaps if s.hashrate]
    pw = [s.power for s in snaps if s.power]
    temps = [s.temp for s in snaps if s.temp is not None]
    vrs = [s.vr_temp for s in snaps if s.vr_temp is not None]
    errs = [s.error_percentage for s in snaps if s.error_percentage is not None]
    exp = [s.expected_hashrate for s in snaps if s.expected_hashrate]

    counters = [s.duplicate_hw_nonces for s in snaps if s.duplicate_hw_nonces is not None]
    uptimes = [s.uptime_seconds for s in snaps if s.uptime_seconds is not None]
    rebooted = any(b < a for a, b in zip(uptimes, uptimes[1:])) or \
        any(b < a for a, b in zip(counters, counters[1:]))
    hw = (counters[-1] - counters[0]) if len(counters) >= 2 and not rebooted else 0

    avg_hr = sum(hr) / len(hr) if hr else None
    avg_pw = sum(pw) / len(pw) if pw else None
    ratio = None
    if avg_hr and cfg.baseline_hr_per_mhz:
        ratio = (avg_hr / freq) / cfg.baseline_hr_per_mhz
    return {
        "samples": len(snaps),
        "avg_hashrate": avg_hr,
        "expected_hashrate": (sum(exp) / len(exp)) if exp else None,
        "hashrate_ratio": ratio,
        "max_temp": max(temps) if temps else None,
        "max_vr_temp": max(vrs) if vrs else None,
        "avg_power": avg_pw,
        "efficiency_w_th": (avg_pw / (avg_hr / 1000)) if avg_hr and avg_pw else None,
        "hw_nonces": hw,
        "error_pct": (sum(errs) / len(errs)) if errs else None,
        "rebooted": rebooted,
    }


def judge(cfg: TunerConfig, ev: dict, is_baseline: bool, nonce_allowance: Optional[int] = None) -> tuple[bool, Optional[str]]:
    allowed = cfg.max_hw_nonces_per_step if nonce_allowance is None else nonce_allowance
    if ev["rebooted"]:
        return False, "device rebooted during the test"
    if not ev["avg_hashrate"]:
        return False, "no hashrate reported"
    if ev["hw_nonces"] > allowed:
        return False, f"{ev['hw_nonces']} HW nonces (allowed {allowed})"
    if ev["error_pct"] is not None and ev["error_pct"] > cfg.max_error_pct:
        return False, f"error rate {ev['error_pct']:.2f}% (allowed {cfg.max_error_pct:g}%)"
    if not is_baseline and ev["hashrate_ratio"] is not None and ev["hashrate_ratio"] < cfg.min_hashrate_ratio:
        return False, (f"hashrate only {ev['hashrate_ratio'] * 100:.1f}% of expected for this clock "
                       f"(needs {cfg.min_hashrate_ratio * 100:.0f}%)")
    return True, None


# ── Ladder ───────────────────────────────────────────────────────────────────

# Margin below the top clock only makes sense when the run actually found the
# chip's stability edge. Temperature, power and your own cap end the run before that.
EDGE_FOUND = ("stability", "voltage_cap", "step_limit", "error")


def _passing(steps: list[TuneStep]) -> dict[int, TuneStep]:
    """Per clock, the lowest-voltage search step that passed (soak steps excluded)."""
    best: dict[int, TuneStep] = {}
    for s in steps:
        if s.result == "pass" and s.stage != "soak":
            cur = best.get(s.frequency)
            if cur is None or s.core_voltage < cur.core_voltage:
                best[s.frequency] = s
    return best


def build_ladder(cfg: TunerConfig, steps: list[TuneStep], limited_by: Optional[str] = None) -> tuple[list[dict], int]:
    """Validated rungs up to the operating point, plus untested lower fallbacks.
    Returns (ladder low→high, op_index).

    Each tested rung runs at the lowest voltage that passed at that clock, plus
    voltage_margin_mv. The operating point is the fastest rung that:
      - sits margin_pct under the top clock, if the run found the chip's stability edge
      - ran at least headroom_c under both temp limits, and under 95% of the power
        limit, during its test, so a normal warm day doesn't trip the governor at once.
    """
    best = _passing(steps)
    freqs = sorted(best)
    top = freqs[-1]
    if limited_by in EDGE_FOUND:
        target = top * (1 - cfg.margin_pct / 100.0)
        allowed = [f for f in freqs if f <= target] or [freqs[0]]
    else:
        allowed = freqs

    hc = cfg.headroom_c or 0.0

    def fits(f: int) -> bool:
        s = best[f]
        return ((s.max_temp is None or s.max_temp <= cfg.temp_max - hc)
                and (s.max_vr_temp is None or s.max_vr_temp <= cfg.vr_temp_max - hc)
                and (s.avg_power is None or s.avg_power <= cfg.power_max_w * 0.95))

    cool = [f for f in allowed if fits(f)]
    op_freq = max(cool) if cool else min(allowed)

    vmax = cfg.voltage_max_mv or 10_000
    ladder = [{"freq": f, "voltage": min(best[f].core_voltage + cfg.voltage_margin_mv, vmax), "tested": True}
              for f in freqs if f <= op_freq]

    # Fallback rungs below the lowest tested point: same voltage, lower clock. Always
    # at least as stable, and cooler. Lets the governor ride out heatwaves.
    lowest = ladder[0]
    floor = cfg.freq_min_mhz or (lowest["freq"] - 4 * cfg.step_mhz)
    f = lowest["freq"] - cfg.step_mhz
    below = []
    while f >= floor and f > 0:
        below.append({"freq": f, "voltage": lowest["voltage"], "tested": False})
        f -= cfg.step_mhz
    ladder = list(reversed(below)) + ladder
    return ladder, len(ladder) - 1


# ── Autotune ─────────────────────────────────────────────────────────────────
#
#   baseline  measure the current settings (this sets "expected hashrate per MHz")
#   floor     binary-search the lowest voltage that holds at the baseline clock
#   climb     +step MHz at a time, starting each clock at the previous clock's minimum
#             voltage and adding voltage_step_mv only when a step fails
#   soak      run the chosen operating point for soak_minutes to confirm it
#
STAGE_LABEL = {
    "baseline": "Measuring baseline",
    "floor": "Finding voltage floor",
    "climb": "Raising clock",
    "soak": "Soak test",
}


def _step_minutes(cfg: TunerConfig, stage: Optional[str]) -> int:
    return cfg.warmup_minutes + (cfg.soak_minutes if stage == "soak" else cfg.settle_minutes)


def _safe_point(cfg: TunerConfig) -> tuple[Optional[int], Optional[int]]:
    """Where to put the device if the run is aborted or interrupted."""
    lad = get_ladder(cfg)
    if cfg.stage == "soak" and lad and cfg.op_index is not None:
        r = lad[cfg.op_index]
        return r["freq"], r["voltage"]
    if cfg.stage == "climb" and cfg.pass_freq and cfg.pass_voltage:
        return cfg.pass_freq, min(cfg.pass_voltage + cfg.voltage_margin_mv, cfg.voltage_max_mv or 10_000)
    # baseline / floor: the settings the user started with
    return cfg.baseline_freq, cfg.baseline_voltage


def _open_step(db: Session, cfg: TunerConfig) -> Optional[TuneStep]:
    return db.exec(
        select(TuneStep).where(TuneStep.mac == cfg.mac, TuneStep.run_id == cfg.last_run_id,
                               TuneStep.result == "running")
    ).first()


def _run_steps(db: Session, cfg: TunerConfig) -> list[TuneStep]:
    return db.exec(select(TuneStep).where(TuneStep.mac == cfg.mac, TuneStep.run_id == cfg.last_run_id)
                   .order_by(TuneStep.id)).all()


def _close_step(db: Session, step: Optional[TuneStep], result: str, reason: Optional[str], ev: Optional[dict] = None):
    if not step:
        return
    if ev:
        for k in ("samples", "avg_hashrate", "expected_hashrate", "hashrate_ratio", "max_temp",
                  "max_vr_temp", "avg_power", "efficiency_w_th", "hw_nonces", "error_pct"):
            setattr(step, k, ev.get(k))
    step.result, step.reason, step.ended_at = result, reason, _now()
    db.add(step)
    db.commit()


async def _start_test(db: Session, cfg: TunerConfig, dev: Device, freq: int, voltage: int,
                      stage: str, apply: bool = True):
    n = db.exec(select(func.count()).select_from(TuneStep)
                .where(TuneStep.mac == cfg.mac, TuneStep.run_id == cfg.last_run_id)).one()
    if n >= MAX_STEPS_PER_RUN and stage != "soak":
        await _end_search(db, cfg, dev, "step_limit", f"stopped after {n} steps")
        return
    cfg.stage = stage
    cfg.test_freq, cfg.test_voltage, cfg.test_started_at = freq, voltage, _now()
    db.add(TuneStep(mac=cfg.mac, run_id=cfg.last_run_id, stage=stage, frequency=freq,
                    core_voltage=voltage, started_at=cfg.test_started_at))
    cfg.status_msg = f"{STAGE_LABEL[stage]}: {freq} MHz @ {voltage} mV (0/{_step_minutes(cfg, stage)} min)"
    db.add(cfg)
    db.commit()
    if apply:
        await _request(db, cfg, dev, freq, voltage, f"autotune {stage}")


async def _next_floor_or_climb(db: Session, cfg: TunerConfig, dev: Device):
    """Binary search between the highest known failing voltage and the lowest known
    passing one, on a voltage_step_mv grid. When they're adjacent, the floor is found."""
    lo = cfg.floor_fail_mv            # fails (or the virtual point just under the floor setting)
    hi = cfg.floor_voltage            # passes
    step = cfg.voltage_step_mv
    gap = (hi - lo) // step
    if gap > 1:
        await _start_test(db, cfg, dev, cfg.baseline_freq, lo + step * (gap // 2), "floor")
        return
    _log(db, cfg.mac, f"Tuner: voltage floor at {cfg.baseline_freq} MHz is {hi} mV "
                      f"(started at {cfg.baseline_voltage} mV)", kind="tuner")
    cfg.pass_freq, cfg.pass_voltage = cfg.baseline_freq, hi
    await _next_climb(db, cfg, dev)


async def _next_climb(db: Session, cfg: TunerConfig, dev: Device):
    if cfg.pass_freq >= cfg.freq_max_mhz:
        await _end_search(db, cfg, dev, "freq_cap", f"stable at your {cfg.freq_max_mhz} MHz cap")
        return
    # Last step lands exactly on the cap (e.g. 725 → 735 with 25 MHz steps)
    nxt = min(cfg.pass_freq + cfg.step_mhz, cfg.freq_max_mhz)
    await _start_test(db, cfg, dev, nxt, cfg.pass_voltage, "climb")


async def _end_search(db: Session, cfg: TunerConfig, dev: Device, limited_by: str, detail: str):
    """Search is over: pick the operating point and soak it (or finish straight away)."""
    steps = _run_steps(db, cfg)
    if not _passing(steps):
        cfg.phase = "idle"
        cfg.stage = None
        cfg.status_msg = f"Autotune stopped: {detail}. No point passed, so the baseline was restored."
        if cfg.baseline_freq and cfg.baseline_voltage:
            await _request(db, cfg, dev, cfg.baseline_freq, cfg.baseline_voltage, "autotune failed, restoring baseline")
        a = _log(db, cfg.mac, f"Tuner: autotune failed: {detail}", kind="tuner")
        await _discord(a, cfg.mac)
        return

    ladder, op_idx = build_ladder(cfg, steps, limited_by)
    best = _passing(steps)
    top = best[max(best)]
    cfg.max_stable_freq, cfg.max_stable_voltage = top.frequency, top.core_voltage
    cfg.limited_by = limited_by
    cfg.limit_detail = detail
    cfg.ladder = json.dumps(ladder)
    cfg.op_index = cfg.current_index = op_idx
    cfg.soak_tries = 0
    db.add(cfg)
    db.commit()
    if cfg.soak_minutes and cfg.soak_minutes > 0:
        op = ladder[op_idx]
        await _start_test(db, cfg, dev, op["freq"], op["voltage"], "soak")
    else:
        await _complete(db, cfg, dev)


async def _soak_failed(db: Session, cfg: TunerConfig, dev: Device, reason: str):
    """Chosen point didn't hold for the full soak: one rung down and soak again."""
    lad = get_ladder(cfg)
    cfg.soak_tries = (cfg.soak_tries or 0) + 1
    if cfg.op_index > 0:
        cfg.op_index -= 1
        cfg.current_index = cfg.op_index
    r = lad[cfg.op_index]
    _log(db, cfg.mac, f"Tuner: soak failed ({reason}); trying {r['freq']} MHz @ {r['voltage']} mV", kind="tuner")
    if cfg.soak_tries >= 3 or cfg.op_index == 0:
        cfg.limit_detail = (cfg.limit_detail or "") + f"; soak failed {cfg.soak_tries}× ({reason})"
        await _complete(db, cfg, dev)
        return
    await _start_test(db, cfg, dev, r["freq"], r["voltage"], "soak")


async def _complete(db: Session, cfg: TunerConfig, dev: Device):
    lad = get_ladder(cfg)
    op = lad[cfg.op_index]
    cfg.current_index = cfg.op_index
    cfg.phase = "governor" if cfg.govern_after else "idle"
    cfg.stage = None
    cfg.test_freq = cfg.test_voltage = cfg.test_started_at = None
    floor = (f" Voltage floor at {cfg.baseline_freq} MHz: {cfg.floor_voltage} mV "
             f"(was {cfg.baseline_voltage})." if cfg.floor_voltage and cfg.floor_voltage < cfg.baseline_voltage else "")
    cfg.status_msg = (f"Autotune done: max stable {cfg.max_stable_freq} MHz @ {cfg.max_stable_voltage} mV "
                      f"({cfg.limit_detail}).{floor} Running at {op['freq']} MHz @ {op['voltage']} mV.")
    db.add(cfg)
    db.commit()
    await _request(db, cfg, dev, op["freq"], op["voltage"], "autotune complete, operating point")
    a = _log(db, cfg.mac,
             f"Tuner: autotune complete. Max stable {cfg.max_stable_freq} MHz @ {cfg.max_stable_voltage} mV, "
             f"limited by {cfg.limited_by}.{floor} Operating at {op['freq']} MHz @ {op['voltage']} mV",
             kind="tuner")
    await _discord(a, cfg.mac)


async def _abort(db: Session, cfg: TunerConfig, dev: Device, msg: str, notify: bool = True):
    f, v = _safe_point(cfg)
    cfg.phase = "idle"
    cfg.stage = None
    cfg.test_freq = cfg.test_started_at = None
    cfg.status_msg = msg
    db.add(cfg)
    db.commit()
    if f and v:
        await _request(db, cfg, dev, f, v, "autotune aborted, safe point")
    a = _log(db, cfg.mac, f"Tuner: {msg}", kind="tuner")
    if notify:
        await _discord(a, cfg.mac)


async def _tick_autotune(db: Session, cfg: TunerConfig, dev: Device):
    now = _now()
    stage = cfg.stage or "climb"
    step = _open_step(db, cfg)
    if not step or not cfg.test_started_at:
        await _end_search(db, cfg, dev, "error", "lost track of the test step")
        return
    snap = _latest(db, cfg.mac)

    if cfg.pending_apply:
        await _request(db, cfg, dev, cfg.expect_freq, cfg.expect_voltage, "retry")
        return

    # Device stopped responding mid-test: treat as a crash at this point.
    if not _fresh(snap):
        if (now - cfg.test_started_at).total_seconds() > OFFLINE_FAIL_MINUTES * 60:
            _close_step(db, step, "fail", "device stopped responding")
            await _on_fail(db, cfg, dev, step, "device stopped responding")
        return

    # Hard limits are checked on every tick, not just at the end of a window.
    over = _over_limits(cfg, snap)
    if over:
        kind, reason = over
        _close_step(db, step, kind, reason)
        cfg.test_freq = None
        if stage == "soak":
            await _soak_failed(db, cfg, dev, reason)
        else:
            await _end_search(db, cfg, dev, kind, reason)
        return

    # Did the device take the setting? (Give it one poll after the change.)
    if snap.ts > cfg.test_started_at + timedelta(seconds=45):
        f, v = _i(snap.frequency), _i(snap.core_voltage)
        if f is not None and f != cfg.test_freq:
            _close_step(db, step, "aborted", f"device reports {f} MHz, not {cfg.test_freq}")
            await _abort(db, cfg, dev, f"Autotune aborted: device didn't accept {cfg.test_freq} MHz (reports {f}). "
                                       f"It may only allow specific frequency values.")
            return
        if v is not None and v != cfg.test_voltage:
            if stage == "floor":
                # Firmware refused a voltage this low (NerdQAxe++ won't go under 1050 mV).
                _close_step(db, step, "aborted", f"device refused {cfg.test_voltage} mV (reports {v})")
                cfg.floor_fail_mv = cfg.test_voltage
                await _next_floor_or_climb(db, cfg, dev)
                return
            _close_step(db, step, "aborted", f"device reports {v} mV, not {cfg.test_voltage}")
            await _abort(db, cfg, dev, f"Autotune aborted: device didn't accept {cfg.test_voltage} mV (reports {v}).")
            return

    elapsed_min = (now - cfg.test_started_at).total_seconds() / 60
    total = _step_minutes(cfg, stage)
    if elapsed_min < total:
        cfg.status_msg = (f"{STAGE_LABEL[stage]}: {cfg.test_freq} MHz @ {cfg.test_voltage} mV "
                          f"({int(elapsed_min)}/{total} min). Chip {snap.temp or 0:.1f}°C, "
                          f"VR {snap.vr_temp or 0:.1f}°C, {snap.power or 0:.0f} W")
        db.add(cfg)
        db.commit()
        return

    window = _since(db, cfg.mac, cfg.test_started_at + timedelta(minutes=cfg.warmup_minutes))
    if len(window) < 5 and elapsed_min < total * 2:
        return  # polls were patchy; wait a bit longer for enough samples
    ev = evaluate(cfg, window, cfg.test_freq)
    measured = total - cfg.warmup_minutes
    allowance = max(cfg.max_hw_nonces_per_step,
                    round(cfg.max_hw_nonces_per_step * measured / max(1, cfg.settle_minutes) / 2))
    ok, why = judge(cfg, ev, stage == "baseline", allowance)

    if not ok:
        _close_step(db, step, "fail", why, ev)
        await _on_fail(db, cfg, dev, step, why)
        return

    if stage == "baseline":
        cfg.baseline_hr_per_mhz = ev["avg_hashrate"] / cfg.test_freq
        ev["hashrate_ratio"] = 1.0
    _close_step(db, step, "pass", None, ev)

    if stage == "soak":
        await _complete(db, cfg, dev)
        return
    if stage in ("baseline", "floor"):
        cfg.floor_voltage = cfg.test_voltage
        if stage == "baseline":
            cfg.floor_fail_mv = (cfg.voltage_min_mv or 1050) - cfg.voltage_step_mv
        await _next_floor_or_climb(db, cfg, dev)
        return
    # climb
    cfg.pass_freq, cfg.pass_voltage = cfg.test_freq, cfg.test_voltage
    await _next_climb(db, cfg, dev)


async def _on_fail(db: Session, cfg: TunerConfig, dev: Device, step: TuneStep, why: str):
    stage = step.stage or cfg.stage
    if stage == "baseline":
        await _abort(db, cfg, dev, f"Autotune stopped: your current settings ({step.frequency} MHz @ "
                                   f"{step.core_voltage} mV) aren't stable ({why}). Fix that before tuning.")
        return
    if stage == "floor":
        cfg.floor_fail_mv = step.core_voltage
        await _next_floor_or_climb(db, cfg, dev)
        return
    if stage == "soak":
        await _soak_failed(db, cfg, dev, why)
        return
    # climb: more voltage at the same clock, unless that's past the cap
    nv = step.core_voltage + cfg.voltage_step_mv
    if nv > cfg.voltage_max_mv:
        await _end_search(db, cfg, dev, "voltage_cap",
                          f"{step.frequency} MHz unstable even at your {cfg.voltage_max_mv} mV cap")
        return
    await _start_test(db, cfg, dev, step.frequency, nv, "climb")


# ── Governor ─────────────────────────────────────────────────────────────────

def _est_power(power: float, f0: int, v0: int, f1: int, v1: int) -> float:
    # Dynamic power scales roughly with f·V²
    return power * (f1 / f0) * (v1 / v0) ** 2


async def _tick_governor(db: Session, cfg: TunerConfig, dev: Device):
    lad = get_ladder(cfg)
    if not lad or cfg.current_index is None:
        cfg.phase = "idle"
        cfg.status_msg = "Governor stopped: no tuning ladder yet — run autotune first."
        db.add(cfg)
        db.commit()
        return
    cfg.current_index = max(0, min(cfg.current_index, cfg.op_index if cfg.op_index is not None else len(lad) - 1))
    cur = lad[cfg.current_index]
    snap = _latest(db, cfg.mac)

    if cfg.pending_apply:
        await _request(db, cfg, dev, cur["freq"], cur["voltage"], "retry")
        return
    if not _fresh(snap):
        cfg.status_msg = f"Waiting for device — target {cur['freq']} MHz @ {cur['voltage']} mV"
        db.add(cfg)
        db.commit()
        return

    now = _now()
    since_change = (now - cfg.last_change_at).total_seconds() / 60 if cfg.last_change_at else 1e9

    # Someone changed clock/voltage outside the tuner → hand control back.
    f, v = _i(snap.frequency), _i(snap.core_voltage)
    if since_change > 1.5 and f is not None and (f != cfg.expect_freq or (v is not None and v != cfg.expect_voltage)):
        cfg.mismatch_polls += 1
        if cfg.mismatch_polls >= 3:
            cfg.phase = "paused"
            cfg.status_msg = (f"Paused: device is at {f} MHz @ {v} mV but the tuner set "
                              f"{cfg.expect_freq} MHz @ {cfg.expect_voltage} mV — changed outside the tuner?")
            db.add(cfg)
            db.commit()
            _log(db, cfg.mac, f"Tuner: {cfg.status_msg}", kind="tuner")
            return
    else:
        cfg.mismatch_polls = 0

    recent = _since(db, cfg.mac, now - timedelta(seconds=75)) or [snap]

    def worst(attr):
        vals = [getattr(s, attr) for s in recent if getattr(s, attr) is not None]
        return max(vals) if vals else None

    t, vr, pw = worst("temp"), worst("vr_temp"), worst("power")

    # Emergency: well past a limit — drop two rungs immediately and shout.
    emerg = ((t is not None and t >= cfg.temp_max + 2) or (vr is not None and vr >= cfg.vr_temp_max + 2)
             or (pw is not None and pw >= cfg.power_max_w * 1.05))
    if emerg and cfg.current_index > 0:
        cfg.current_index = max(0, cfg.current_index - 2)
        n = lad[cfg.current_index]
        await _request(db, cfg, dev, n["freq"], n["voltage"],
                       f"emergency step-down (chip {t or 0:.1f}°C, VR {vr or 0:.1f}°C, {pw or 0:.0f} W)")
        a = _log(db, cfg.mac, f"Tuner: emergency step-down to {n['freq']} MHz — chip {t or 0:.1f}°C, "
                              f"VR {vr or 0:.1f}°C, {pw or 0:.0f} W", kind="tuner")
        await _discord(a, cfg.mac)
        return

    # Near a limit: one rung down, at most every 2 minutes so each step can take effect.
    near = ((t is not None and t >= cfg.temp_max - 1) or (vr is not None and vr >= cfg.vr_temp_max - 1)
            or (pw is not None and pw >= cfg.power_max_w))
    if near:
        if cfg.current_index == 0:
            cfg.status_msg = (f"At lowest step ({cur['freq']} MHz) and still near limits — check cooling. "
                              f"Firmware overheat protection still applies.")
            if not cfg.hot_alerted:
                cfg.hot_alerted = True
                a = _log(db, cfg.mac, f"Tuner: {cfg.status_msg}", kind="tuner")
                await _discord(a, cfg.mac)
            db.add(cfg)
            db.commit()
            return
        if since_change >= 2:
            cfg.current_index -= 1
            n = lad[cfg.current_index]
            await _request(db, cfg, dev, n["freq"], n["voltage"],
                           f"step down (chip {t or 0:.1f}°C, VR {vr or 0:.1f}°C, {pw or 0:.0f} W)")
        return
    cfg.hot_alerted = False

    # Stability watchdog at the current rung: reboots or a burst of HW nonces
    # means this rung isn't as solid as the test said. Step down and retire it.
    if since_change >= cfg.warmup_minutes + 5:
        changed = cfg.last_change_at or (now - timedelta(minutes=30))
        window = _since(db, cfg.mac, max(changed + timedelta(minutes=cfg.warmup_minutes),
                                          now - timedelta(minutes=30)))
        ev = evaluate(cfg, window, cur["freq"]) if len(window) >= 5 else None
        if ev and (ev["rebooted"] or ev["hw_nonces"] > cfg.max_hw_nonces_per_step * 2) and cfg.current_index > 0:
            bad = cur["freq"]
            cfg.current_index -= 1
            cfg.op_index = min(cfg.op_index, cfg.current_index)
            n = lad[cfg.current_index]
            why = "reboot" if ev["rebooted"] else f"{ev['hw_nonces']} HW nonces"
            await _request(db, cfg, dev, n["freq"], n["voltage"], f"instability at {bad} MHz ({why})")
            a = _log(db, cfg.mac, f"Tuner: retired {bad} MHz after {why}; new ceiling {n['freq']} MHz",
                     kind="tuner")
            await _discord(a, cfg.mac)
            return

    # Comfortably cool for a long hold: one rung up (never past the operating point).
    if cfg.current_index < cfg.op_index and since_change >= cfg.up_hold_minutes:
        hold = _since(db, cfg.mac, now - timedelta(minutes=cfg.up_hold_minutes))
        ht = [s.temp for s in hold if s.temp is not None]
        hv = [s.vr_temp for s in hold if s.vr_temp is not None]
        hp = [s.power for s in hold if s.power is not None]
        nxt = lad[cfg.current_index + 1]
        cool = (len(hold) >= 5
                and (not ht or max(ht) <= cfg.temp_max - cfg.hysteresis_c)
                and (not hv or max(hv) <= cfg.vr_temp_max - cfg.hysteresis_c)
                and (not hp or _est_power(max(hp), cur["freq"], cur["voltage"], nxt["freq"], nxt["voltage"])
                     <= cfg.power_max_w * 0.95))
        if cool:
            cfg.current_index += 1
            await _request(db, cfg, dev, nxt["freq"], nxt["voltage"],
                           f"step up (chip ≤{max(ht) if ht else 0:.1f}°C for {cfg.up_hold_minutes} min)")
            return

    top = lad[cfg.op_index]
    where = "at operating point" if cfg.current_index == cfg.op_index else f"backed off from {top['freq']} MHz"
    cfg.status_msg = (f"Holding {cur['freq']} MHz @ {cur['voltage']} mV ({where}) — chip {t or 0:.1f}/"
                      f"{cfg.temp_max:g}°C, VR {vr or 0:.1f}/{cfg.vr_temp_max:g}°C, {pw or 0:.0f}/{cfg.power_max_w:g} W")
    db.add(cfg)
    db.commit()


# ── Scheduler entry points ───────────────────────────────────────────────────

async def tick_all():
    with Session(engine) as db:
        cfgs = db.exec(select(TunerConfig).where(
            or_(TunerConfig.phase.in_(["autotune", "governor"]), TunerConfig.pending_apply == True)
        )).all()
        for cfg in cfgs:
            dev = db.get(Device, cfg.mac)
            if not dev or dev.archived:
                continue
            try:
                if cfg.phase == "autotune":
                    await _tick_autotune(db, cfg, dev)
                elif cfg.phase == "governor":
                    await _tick_governor(db, cfg, dev)
                elif cfg.pending_apply and cfg.expect_freq and cfg.expect_voltage:
                    await _request(db, cfg, dev, cfg.expect_freq, cfg.expect_voltage, "retry")
            except Exception as e:
                logger.exception(f"[tuner] tick failed for {cfg.mac}: {e}")
            finally:
                cfg.updated_at = _now()
                db.add(cfg)
                db.commit()


def recover_on_startup():
    """A backend restart mid-autotune means we lost the timing of the step under
    test. Abort it and fall back to the last point that passed (or the baseline)."""
    with Session(engine) as db:
        for cfg in db.exec(select(TunerConfig).where(TunerConfig.phase == "autotune")).all():
            step = _open_step(db, cfg)
            _close_step(db, step, "aborted", "BitScope restarted during the test")
            f, v = _safe_point(cfg)
            if cfg.stage == "soak" and get_ladder(cfg):
                # Search finished; only the confirmation run was cut short.
                cfg.phase = "governor" if cfg.govern_after else "idle"
                cfg.current_index = cfg.op_index
                cfg.status_msg = (f"Soak test interrupted by a BitScope restart. Running the chosen point "
                                  f"({f} MHz @ {v} mV) without the full soak; the governor's stability "
                                  f"watchdog will still step down if it misbehaves.")
            else:
                cfg.phase = "idle"
                cfg.status_msg = "Autotune interrupted by a BitScope restart. Returned to a known-good point."
            cfg.stage = None
            cfg.test_freq = cfg.test_started_at = None
            if f and v:
                cfg.expect_freq, cfg.expect_voltage, cfg.pending_apply = f, v, True
            db.add(cfg)
            db.add(AlertLog(mac=cfg.mac, alert_type="tuner", message=f"Tuner: {cfg.status_msg}"))
            db.commit()


# ── API ──────────────────────────────────────────────────────────────────────

def _get_or_create(db: Session, mac: str) -> TunerConfig:
    cfg = db.get(TunerConfig, mac)
    if not cfg:
        cfg = TunerConfig(mac=mac)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def _device(db: Session, mac: str) -> Device:
    dev = db.get(Device, mac.upper())
    if not dev:
        raise HTTPException(404, "Device not found")
    return dev


def _round_to(v: float, step: int) -> int:
    return int(round(v / step) * step)


def suggestions(db: Session, cfg: TunerConfig, dev: Device, snap: Optional[MetricSnapshot]) -> dict:
    th = get_thresholds(dev.mac, dev.model, db)
    raw = {}
    try:
        raw = json.loads(snap.raw) if snap and snap.raw else {}
    except Exception:
        pass
    overheat = raw.get("overheat_temp")
    temp_caps = [c - 5 for c in (th.temp_max, overheat) if c]
    vr_caps = [c - 5 for c in (th.vr_temp_max,) if c]
    f = _i(snap.frequency) if snap else None
    v = _i(snap.core_voltage) if snap else None
    return {
        "temp_max": min(temp_caps + [65]),
        "vr_temp_max": min(vr_caps + [70]),
        "power_max_w": _round_to(snap.power * 1.2, 5) if snap and snap.power else None,
        "freq_max_mhz": (f + 100) if f else None,
        "voltage_max_mv": (v + 80) if v else None,
    }


def _serialize(db: Session, cfg: TunerConfig, dev: Device) -> dict:
    snap = _latest(db, dev.mac)
    steps = []
    if cfg.last_run_id:
        steps = db.exec(select(TuneStep).where(TuneStep.mac == dev.mac, TuneStep.run_id == cfg.last_run_id)
                        .order_by(TuneStep.started_at.asc())).all()
    factory = db.exec(select(HardwareSnapshot).where(HardwareSnapshot.mac == dev.mac,
                                                     HardwareSnapshot.label == "factory")).first()
    est_steps = est_minutes = None
    if cfg.freq_max_mhz and snap and snap.frequency and snap.core_voltage:
        f0, v0 = _i(snap.frequency), _i(snap.core_voltage)
        climb = max(0, -(-(cfg.freq_max_mhz - f0) // max(1, cfg.step_mhz)))
        span = max(0, (v0 - (cfg.voltage_min_mv or 1050)) // max(1, cfg.voltage_step_mv) + 1)
        floor_tests = span.bit_length()   # binary search
        est_steps = 1 + floor_tests + climb * 2   # climb steps often need a voltage retry
        est_minutes = est_steps * (cfg.warmup_minutes + cfg.settle_minutes) + (
            cfg.warmup_minutes + cfg.soak_minutes if cfg.soak_minutes else 0)
    data = cfg.model_dump()
    data.update({
        "ladder": get_ladder(cfg),
        "missing_limits": [LIMIT_LABELS[k] for k in missing_limits(cfg)],
        "suggestions": suggestions(db, cfg, dev, snap),
        "steps": [s.model_dump() for s in steps],
        "estimated_minutes_per_step": cfg.warmup_minutes + cfg.settle_minutes,
        "estimated_steps": est_steps,
        "estimated_minutes": est_minutes,
        "factory": {"frequency": factory.frequency, "core_voltage": factory.core_voltage} if factory else None,
        "live": {
            "online": _fresh(snap),
            "frequency": _i(snap.frequency) if snap else None,
            "core_voltage": _i(snap.core_voltage) if snap else None,
            "temp": snap.temp if snap else None,
            "vr_temp": snap.vr_temp if snap else None,
            "vr_temp_int": snap.vr_temp_int if snap else None,
            "power": snap.power if snap else None,
            "hashrate": snap.hashrate if snap else None,
        },
    })
    return data


@router.get("/api/tuner")
def tuner_fleet():
    """One row per active device: tuner state plus the live readings that matter for tuning.
    Three queries total regardless of fleet size."""
    with Session(engine) as db:
        devices = db.exec(select(Device).where(Device.archived == False)).all()
        cfgs = {c.mac: c for c in db.exec(select(TunerConfig)).all()}
        macs = [d.mac for d in devices]
        latest = {}
        if macs:
            sub = (select(MetricSnapshot.mac, func.max(MetricSnapshot.id).label("mid"))
                   .where(MetricSnapshot.mac.in_(macs)).group_by(MetricSnapshot.mac).subquery())
            for s in db.exec(select(MetricSnapshot).join(sub, MetricSnapshot.id == sub.c.mid)).all():
                latest[s.mac] = s
        rows = []
        for d in devices:
            cfg = cfgs.get(d.mac)
            s = latest.get(d.mac)
            lad = get_ladder(cfg) if cfg else []
            op = lad[cfg.op_index] if cfg and lad and cfg.op_index is not None and cfg.op_index < len(lad) else None
            rows.append({
                "mac": d.mac,
                "name": d.label or d.hostname or d.mac,
                "model": d.model,
                "online": _fresh(s),
                "phase": cfg.phase if cfg else "idle",
                "status_msg": cfg.status_msg if cfg else None,
                "configured": bool(cfg) and not missing_limits(cfg),
                "temp_max": cfg.temp_max if cfg else None,
                "vr_temp_max": cfg.vr_temp_max if cfg else None,
                "power_max_w": cfg.power_max_w if cfg else None,
                "max_stable_freq": cfg.max_stable_freq if cfg else None,
                "limited_by": cfg.limited_by if cfg else None,
                "op_freq": op["freq"] if op else None,
                "baseline_freq": cfg.baseline_freq if cfg else None,
                "last_change_at": (cfg.last_change_at.strftime("%Y-%m-%dT%H:%M:%SZ")
                                   if cfg and cfg.last_change_at else None),
                "frequency": _i(s.frequency) if s else None,
                "core_voltage": _i(s.core_voltage) if s else None,
                "temp": s.temp if s else None,
                "vr_temp": s.vr_temp if s else None,
                "vr_temp_int": s.vr_temp_int if s else None,
                "power": s.power if s else None,
                "hashrate": s.hashrate if s else None,
            })
        return rows


@router.get("/api/tuner/{mac}")
def tuner_get(mac: str):
    with Session(engine) as db:
        dev = _device(db, mac)
        cfg = _get_or_create(db, dev.mac)
        return _serialize(db, cfg, dev)


@router.put("/api/tuner/{mac}/settings")
def tuner_settings(mac: str, body: dict):
    with Session(engine) as db:
        dev = _device(db, mac)
        cfg = _get_or_create(db, dev.mac)
        if cfg.phase == "autotune":
            raise HTTPException(409, "Abort the running autotune before changing settings")
        for k, val in body.items():
            if k not in EDITABLE:
                continue
            if val in ("", None):
                setattr(cfg, k, None if k in REQUIRED_LIMITS + ("freq_min_mhz",) else getattr(cfg, k))
                continue
            try:
                val = float(val)
            except (TypeError, ValueError):
                raise HTTPException(400, f"{k} must be a number")
            if val < 0:
                raise HTTPException(400, f"{k} can't be negative")
            if k == "margin_pct" and val > 50:
                raise HTTPException(400, "Margin above 50% doesn't make sense")
            if k == "min_hashrate_ratio" and not 0.5 <= val <= 1.0:
                raise HTTPException(400, "Hashrate ratio must be between 0.5 and 1.0")
            if k in ("step_mhz", "voltage_step_mv", "settle_minutes") and val < 1:
                raise HTTPException(400, f"{k} must be at least 1")
            int_fields = {"freq_max_mhz", "voltage_max_mv", "voltage_min_mv", "soak_minutes",
                          "freq_min_mhz", "voltage_margin_mv", "step_mhz",
                          "voltage_step_mv", "warmup_minutes", "settle_minutes", "up_hold_minutes",
                          "max_hw_nonces_per_step"}
            setattr(cfg, k, int(val) if k in int_fields else val)
        # If the governor is running, clamp its ladder to new caps immediately.
        lad = get_ladder(cfg)
        if lad and cfg.op_index is not None:
            while cfg.op_index > 0 and (lad[cfg.op_index]["freq"] > (cfg.freq_max_mhz or 1e9)
                                        or lad[cfg.op_index]["voltage"] > (cfg.voltage_max_mv or 1e9)):
                cfg.op_index -= 1
            if cfg.current_index is not None:
                cfg.current_index = min(cfg.current_index, cfg.op_index)
        db.add(cfg)
        db.commit()
        return _serialize(db, cfg, dev)


@router.post("/api/tuner/{mac}/autotune")
async def tuner_autotune(mac: str, body: dict | None = None):
    body = body or {}
    with Session(engine) as db:
        dev = _device(db, mac)
        cfg = _get_or_create(db, dev.mac)
        if cfg.phase == "autotune":
            raise HTTPException(409, "Autotune is already running")
        miss = missing_limits(cfg)
        if miss:
            raise HTTPException(400, "Set these limits first: " + ", ".join(LIMIT_LABELS[k] for k in miss))
        snap = _latest(db, dev.mac)
        if not _fresh(snap):
            raise HTTPException(409, "Device isn't reporting right now")
        f, v = _i(snap.frequency), _i(snap.core_voltage)
        if not f or not v:
            raise HTTPException(409, "Device isn't reporting frequency/voltage")
        if f > cfg.freq_max_mhz or v > cfg.voltage_max_mv:
            raise HTTPException(400, f"Device is already at {f} MHz @ {v} mV, above your caps")
        fw = await _device_limits(dev)
        if fw.get("absMaxFrequency") and cfg.freq_max_mhz > fw["absMaxFrequency"]:
            raise HTTPException(400, f"This board's firmware won't go above {fw['absMaxFrequency']} MHz. "
                                     f"Set Max frequency to {fw['absMaxFrequency']} or lower.")
        if fw.get("absMaxVoltage") and cfg.voltage_max_mv > fw["absMaxVoltage"]:
            raise HTTPException(400, f"This board's firmware won't go above {fw['absMaxVoltage']} mV. "
                                     f"Set Max core voltage to {fw['absMaxVoltage']} or lower.")
        if (cfg.voltage_min_mv or 0) >= cfg.voltage_max_mv:
            raise HTTPException(400, "Min core voltage must be below Max core voltage")
        over = _over_limits(cfg, snap, slack=2)
        if over:
            raise HTTPException(409, f"No headroom to test: {over[1].replace('reached', 'is within 2 of')}. "
                                     f"Improve cooling or raise the limit first.")

        run_id = (db.exec(select(func.max(TuneStep.run_id)).where(TuneStep.mac == dev.mac)).one() or 0) + 1
        cfg.last_run_id = run_id
        cfg.baseline_freq, cfg.baseline_voltage = f, v
        cfg.baseline_hr_per_mhz = None
        cfg.pass_freq = cfg.pass_voltage = None
        cfg.floor_voltage = cfg.floor_fail_mv = None
        cfg.limit_detail = None
        cfg.soak_tries = 0
        cfg.expect_freq, cfg.expect_voltage = f, v
        cfg.last_change_at = _now()
        cfg.pending_apply = False
        cfg.govern_after = bool(body.get("govern_after", True))
        cfg.phase = "autotune"
        db.add(cfg)
        db.commit()
        _log(db, dev.mac, f"Tuner: autotune started from {f} MHz @ {v} mV "
                          f"(caps {cfg.freq_max_mhz} MHz / {cfg.voltage_min_mv}-{cfg.voltage_max_mv} mV, "
                          f"limits {cfg.temp_max:g}°C chip / {cfg.vr_temp_max:g}°C VR / {cfg.power_max_w:g} W)",
             kind="tuner")
        # First test is the baseline itself — no change needed, just measure it.
        await _start_test(db, cfg, dev, f, v, "baseline", apply=False)
        return _serialize(db, cfg, dev)


@router.post("/api/tuner/{mac}/abort")
async def tuner_abort(mac: str):
    with Session(engine) as db:
        dev = _device(db, mac)
        cfg = _get_or_create(db, dev.mac)
        if cfg.phase != "autotune":
            raise HTTPException(409, "Autotune isn't running")
        _close_step(db, _open_step(db, cfg), "aborted", "aborted by user")
        await _abort(db, cfg, dev, "Autotune aborted by you. Returned to a known-good point.", notify=False)
        return _serialize(db, cfg, dev)


@router.post("/api/tuner/{mac}/governor")
async def tuner_governor(mac: str, body: dict):
    enable = bool(body.get("enable"))
    with Session(engine) as db:
        dev = _device(db, mac)
        cfg = _get_or_create(db, dev.mac)
        if cfg.phase == "autotune":
            raise HTTPException(409, "Autotune is running")
        if not enable:
            cfg.phase = "paused"
            cfg.status_msg = "Governor paused — settings left as they are."
            db.add(cfg)
            db.commit()
            _log(db, dev.mac, "Tuner: governor paused", kind="tuner")
            return _serialize(db, cfg, dev)
        lad = get_ladder(cfg)
        if not lad:
            raise HTTPException(400, "No tuning ladder yet — run autotune first")
        if missing_limits(cfg):
            raise HTTPException(400, "Set all limits first")
        # Start at the highest rung not above what the device is running now; it climbs from there.
        snap = _latest(db, dev.mac)
        cur_f = _i(snap.frequency) if snap else None
        idx = 0
        for i, r in enumerate(lad[: cfg.op_index + 1]):
            if cur_f is None or r["freq"] <= cur_f:
                idx = i
        cfg.current_index = idx
        cfg.phase = "governor"
        cfg.hot_alerted = False
        db.add(cfg)
        db.commit()
        await _request(db, cfg, dev, lad[idx]["freq"], lad[idx]["voltage"], "governor enabled")
        return _serialize(db, cfg, dev)


@router.post("/api/tuner/{mac}/restore")
async def tuner_restore(mac: str):
    with Session(engine) as db:
        dev = _device(db, mac)
        cfg = _get_or_create(db, dev.mac)
        if cfg.phase == "autotune":
            raise HTTPException(409, "Abort the autotune first")
        f, v = cfg.baseline_freq, cfg.baseline_voltage
        if not (f and v):
            raise HTTPException(400, "No baseline recorded for this device yet")
        cfg.phase = "idle"
        cfg.status_msg = f"Restored baseline {f} MHz @ {v} mV. Tuner off."
        db.add(cfg)
        db.commit()
        await _request(db, cfg, dev, f, v, "restore baseline")
        return _serialize(db, cfg, dev)
