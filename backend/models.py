from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel, Column, JSON
import json


class Device(SQLModel, table=True):
    __tablename__ = "devices"
    mac: str = Field(primary_key=True)
    label: Optional[str] = None
    notes: Optional[str] = None
    model: Optional[str] = None          # NerdQAxe++, Bitaxe Gamma, etc.
    asic_model: Optional[str] = None     # BM1370, BM1368, etc.
    asic_count: Optional[int] = None
    board_version: Optional[str] = None
    first_seen: datetime = Field(default_factory=datetime.utcnow)
    last_seen: Optional[datetime] = None
    last_ip: Optional[str] = None
    hostname: Optional[str] = None
    firmware_version: Optional[str] = None
    is_manual: bool = False              # true = manually added
    archived: bool = False               # manually archived by user
    pinned_fields: Optional[str] = None  # JSON array of extra field names to show
    hw_nonce_total: int = 0            # cumulative all-time nonce count (survives reboots)
    hw_nonce_rate_1h: Optional[float] = None  # rolling 1h rate (nonces/hour), updated each poll


class MetricSnapshot(SQLModel, table=True):
    __tablename__ = "metrics"
    id: Optional[int] = Field(default=None, primary_key=True)
    mac: str = Field(index=True)
    ts: datetime = Field(default_factory=datetime.utcnow, index=True)
    session_id: Optional[int] = Field(default=None, index=True)

    # Core metrics (always present)
    hashrate: Optional[float] = None
    hashrate_1m: Optional[float] = None
    hashrate_10m: Optional[float] = None
    hashrate_1h: Optional[float] = None
    hashrate_1d: Optional[float] = None
    expected_hashrate: Optional[float] = None
    temp: Optional[float] = None
    vr_temp: Optional[float] = None
    power: Optional[float] = None
    voltage: Optional[float] = None
    current: Optional[float] = None
    core_voltage: Optional[int] = None
    core_voltage_actual: Optional[int] = None
    frequency: Optional[int] = None
    fan_rpm: Optional[int] = None
    fan2_rpm: Optional[int] = None
    fan_speed: Optional[float] = None
    error_percentage: Optional[float] = None
    shares_accepted: Optional[int] = None
    shares_rejected: Optional[int] = None
    best_diff: Optional[float] = None
    best_session_diff: Optional[float] = None
    uptime_seconds: Optional[int] = None
    wifi_rssi: Optional[int] = None

    # NerdQAxe+ specific
    asic_temps: Optional[str] = None     # JSON array
    duplicate_hw_nonces: Optional[int] = None   # raw counter from device (resets on reboot)
    hw_nonce_delta: Optional[int] = None         # nonces that occurred THIS poll window
    last_ping_rtt: Optional[float] = None
    recent_ping_loss: Optional[float] = None
    pool_difficulty: Optional[int] = None
    max_power: Optional[float] = None
    min_power: Optional[float] = None

    # Full raw JSON snapshot - never lose data
    raw: Optional[str] = None


class Session(SQLModel, table=True):
    __tablename__ = "sessions"
    id: Optional[int] = Field(default=None, primary_key=True)
    mac: str = Field(index=True)
    label: Optional[str] = None
    notes: Optional[str] = None
    started_at: datetime = Field(default_factory=datetime.utcnow)
    ended_at: Optional[datetime] = None
    verdict: Optional[str] = None        # PASS, WARN, FAIL
    verdict_reasons: Optional[str] = None  # JSON array of reasons


class ThresholdConfig(SQLModel, table=True):
    __tablename__ = "thresholds"
    id: Optional[int] = Field(default=None, primary_key=True)
    # scope: 'global', 'type:<model>', 'device:<mac>'
    scope: str = Field(index=True)
    temp_max: Optional[float] = 75.0
    vr_temp_max: Optional[float] = 80.0
    power_over_spec_pct: Optional[float] = 110.0  # % above device maxPower
    error_pct_max: Optional[float] = 2.0
    duplicate_hw_nonces_max: Optional[int] = 0
    ping_loss_max: Optional[float] = 5.0
    fan_rpm_min: Optional[int] = 500
    hashrate_below_expected_pct: Optional[float] = 15.0
    wifi_rssi_min: Optional[int] = -80
    offline_after_polls: Optional[int] = 3
    power_max_w: Optional[float] = None  # Absolute watt limit — None = disabled.
    hw_nonce_rate_warn: Optional[float] = 1.0    # nonces/hour — warn threshold
    hw_nonce_rate_alert: Optional[float] = 5.0   # nonces/hour — alert threshold
    hw_nonce_rate_critical: Optional[float] = 20.0  # nonces/hour — critical threshold
    hw_nonce_consecutive_polls: Optional[int] = 3   # must breach for N polls before alerting


class HardwareSnapshot(SQLModel, table=True):
    """Records hardware settings at the moment a device is first discovered.
    Also supports manual snapshots. Acts as a baseline / factory record."""
    __tablename__ = "hardware_snapshots"
    id: Optional[int] = Field(default=None, primary_key=True)
    mac: str = Field(index=True)
    ts: datetime = Field(default_factory=datetime.utcnow)
    label: Optional[str] = None          # "factory", "manual", "post-flash", etc.
    # Core settings captured
    frequency: Optional[int] = None
    core_voltage: Optional[int] = None
    core_voltage_actual: Optional[int] = None
    autofanspeed: Optional[int] = None   # 0=manual, 2=auto
    fanspeed: Optional[float] = None     # current fan %
    manual_fan_speed: Optional[int] = None
    pid_target_temp: Optional[int] = None
    overheat_temp: Optional[int] = None
    # Device identity at snapshot time
    firmware_version: Optional[str] = None
    asic_model: Optional[str] = None
    device_model: Optional[str] = None
    # Full raw API response for completeness
    raw: Optional[str] = None


class AlertLog(SQLModel, table=True):
    __tablename__ = "alert_log"
    id: Optional[int] = Field(default=None, primary_key=True)
    mac: str = Field(index=True)
    ts: datetime = Field(default_factory=datetime.utcnow)
    alert_type: str   # offline, overheat, error_rate, power_over_spec, hw_nonce, new_device
    message: str
    value: Optional[str] = None
    threshold: Optional[str] = None
    sent_discord: bool = False


class ScanConfig(SQLModel, table=True):
    __tablename__ = "scan_config"
    id: Optional[int] = Field(default=None, primary_key=True)
    subnet: str
    enabled: bool = True
    label: Optional[str] = None


class HWNonceEvent(SQLModel, table=True):
    """Individual nonce fault event derived from poll delta — persists across reboots."""
    __tablename__ = "hw_nonce_events"
    id: Optional[int] = Field(default=None, primary_key=True)
    mac: str = Field(index=True)
    ts: datetime = Field(default_factory=datetime.utcnow, index=True)
    delta: int                          # nonces that occurred in this poll window
    raw_counter: int                    # device counter value at time of detection
    uptime_seconds: Optional[int] = None
    temp: Optional[float] = None
    frequency: Optional[int] = None
    core_voltage: Optional[int] = None
    session_id: Optional[int] = None


class DigestConfig(SQLModel, table=True):
    """Daily digest configuration."""
    __tablename__ = "digest_config"
    id: Optional[int] = Field(default=None, primary_key=True)
    enabled: bool = True
    hour_utc: int = 22                  # 22:00 UTC = 8am AEST
    minute_utc: int = 0
    last_sent: Optional[datetime] = None


class UIPref(SQLModel, table=True):
    """Key-value store for UI preferences that persist across browsers/devices.
    Single global namespace since BitScope has no user accounts."""
    __tablename__ = "ui_prefs"
    key: str = Field(primary_key=True)
    value: str                       # JSON-encoded value
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class TunerConfig(SQLModel, table=True):
    """Per-device auto-tuner: safety limits, discovered ladder, and live state."""
    __tablename__ = "tuner_config"
    mac: str = Field(primary_key=True)

    # ── Safety limits (user-set; autotune refuses to start until all are set) ──
    temp_max: Optional[float] = None          # chip temp ceiling (°C)
    vr_temp_max: Optional[float] = None       # VR temp ceiling (°C)
    power_max_w: Optional[float] = None       # PSU / board power ceiling (W)
    freq_max_mhz: Optional[int] = None        # never request above this
    voltage_max_mv: Optional[int] = None      # never request above this
    freq_min_mhz: Optional[int] = None        # governor floor (default: baseline - 4 steps)

    # ── Tuning behaviour ──────────────────────────────────────────────────────
    margin_pct: float = 5.0                   # run this % below the proven max frequency
    voltage_margin_mv: int = 10               # extra mV added at the operating point
    step_mhz: int = 25
    voltage_step_mv: int = 10
    warmup_minutes: int = 2                   # ignored after each change
    settle_minutes: int = 10                  # measured window per autotune step
    hysteresis_c: float = 5.0                 # must be this far under limits to step up
    up_hold_minutes: int = 15                 # min time at a step before stepping up
    min_hashrate_ratio: float = 0.96          # measured / expected to count as stable
    max_hw_nonces_per_step: int = 2           # duplicate HW nonces allowed per measured window
    max_error_pct: float = 1.0

    # ── Baseline (settings when autotune started — what "restore" goes back to) ─
    baseline_freq: Optional[int] = None
    baseline_voltage: Optional[int] = None
    baseline_hr_per_mhz: Optional[float] = None   # measured GH/s per MHz at baseline

    # ── Results ───────────────────────────────────────────────────────────────
    max_stable_freq: Optional[int] = None
    max_stable_voltage: Optional[int] = None
    limited_by: Optional[str] = None          # stability | thermal | power | freq_cap | voltage_cap
    ladder: Optional[str] = None              # JSON [{"freq":..,"voltage":..,"tested":bool}], low → high
    op_index: Optional[int] = None            # ladder index of the operating point (top the governor may use)
    last_run_id: Optional[int] = None

    # ── Live state ────────────────────────────────────────────────────────────
    phase: str = "idle"                       # idle | autotune | governor | paused
    current_index: Optional[int] = None       # governor's current ladder index
    last_change_at: Optional[datetime] = None
    expect_freq: Optional[int] = None         # what we last asked the device for
    expect_voltage: Optional[int] = None
    mismatch_polls: int = 0
    pending_apply: bool = False               # expect_* not yet pushed (device was unreachable)
    govern_after: bool = True                 # start the governor when autotune finishes
    hot_alerted: bool = False                 # "at lowest step and still hot" already sent
    test_freq: Optional[int] = None           # autotune: point under test
    test_voltage: Optional[int] = None
    test_started_at: Optional[datetime] = None
    pass_freq: Optional[int] = None           # autotune: last passing point
    pass_voltage: Optional[int] = None
    status_msg: Optional[str] = None
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class TuneStep(SQLModel, table=True):
    """One measured point during an autotune run."""
    __tablename__ = "tune_steps"
    id: Optional[int] = Field(default=None, primary_key=True)
    mac: str = Field(index=True)
    run_id: int = Field(index=True)
    frequency: int
    core_voltage: int
    started_at: datetime
    ended_at: Optional[datetime] = None
    samples: int = 0
    avg_hashrate: Optional[float] = None
    expected_hashrate: Optional[float] = None
    hashrate_ratio: Optional[float] = None
    max_temp: Optional[float] = None
    max_vr_temp: Optional[float] = None
    avg_power: Optional[float] = None
    efficiency_w_th: Optional[float] = None
    hw_nonces: Optional[int] = None
    error_pct: Optional[float] = None
    result: str = "running"                   # running | pass | fail | thermal | power | aborted
    reason: Optional[str] = None
