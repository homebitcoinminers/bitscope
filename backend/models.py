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
