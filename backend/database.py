import os
from sqlmodel import SQLModel, create_engine, Session, select
from sqlalchemy import event, text
from models import ThresholdConfig, ScanConfig, DigestConfig, HWNonceEvent

DATABASE_URL = f"sqlite:////data/bitscope.db"
engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False, "timeout": 30},
)


# ── SQLite tuning: enable WAL mode + sensible pragmas on every connection ────
@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")          # concurrent reads while writing
    cur.execute("PRAGMA synchronous=NORMAL")        # safe with WAL, much faster
    cur.execute("PRAGMA cache_size=-64000")         # 64MB page cache (was ~2MB default)
    cur.execute("PRAGMA temp_store=MEMORY")         # temp tables in RAM
    cur.execute("PRAGMA mmap_size=268435456")       # 256MB memory-mapped I/O
    cur.execute("PRAGMA busy_timeout=10000")        # 10s wait on locks
    cur.close()


def _add_missing_columns():
    """create_all() never alters existing tables. Add new nullable columns here."""
    wanted = {
        "metrics": [("vr_temp_int", "REAL")],
    }
    with engine.begin() as conn:
        for table, cols in wanted.items():
            have = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            for name, typ in cols:
                if have and name not in have:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {typ}"))


def _run_once(key: str, sql: str):
    """Run a data migration exactly once, tracked by a marker row in ui_prefs."""
    with engine.begin() as conn:
        done = conn.execute(text("SELECT 1 FROM ui_prefs WHERE key = :k"), {"k": key}).first()
        if done:
            return
        conn.execute(text(sql))
        conn.execute(text("INSERT INTO ui_prefs (key, value, updated_at) VALUES (:k, 'true', CURRENT_TIMESTAMP)"),
                     {"k": key})


def init_db():
    SQLModel.metadata.create_all(engine)
    _add_missing_columns()
    # v0.8.2: autotune steps default to 5 min (1 warmup + 4 measured). Move devices that
    # still have the old untouched 2 + 10 defaults; custom timings are left alone.
    _run_once("_migration.tuner_step_5min",
              "UPDATE tuner_config SET warmup_minutes = 1, settle_minutes = 4 "
              "WHERE warmup_minutes = 2 AND settle_minutes = 10")

    # ── Performance indexes — created if missing, no-op if already there ─────
    with engine.begin() as conn:
        # Composite (mac, ts DESC) — covers "latest snapshot per device" + per-device range queries
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_metrics_mac_ts ON metrics (mac, ts DESC)"))
        # Speed up hw_nonce queries by mac+ts
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_hwnonce_mac_ts ON hw_nonce_events (mac, ts DESC)"))
        # Alerts ordered by ts (most recent N)
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_alerts_ts ON alert_log (ts DESC)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_alerts_mac_ts ON alert_log (mac, ts DESC)"))
        # Sessions by mac
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_sessions_mac_started ON sessions (mac, started_at DESC)"))
        # Active sessions lookup
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_sessions_active ON sessions (mac) WHERE ended_at IS NULL"))
        # Hardware snapshots by mac
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_hwsnap_mac_ts ON hardware_snapshots (mac, ts DESC)"))

    with Session(engine) as session:
        # Seed global threshold defaults
        existing = session.exec(select(ThresholdConfig).where(ThresholdConfig.scope == "global")).first()
        if not existing:
            session.add(ThresholdConfig(scope="global"))
            session.commit()

        existing_type = session.exec(
            select(ThresholdConfig).where(ThresholdConfig.scope == "type:NerdQAxe++")
        ).first()
        if not existing_type:
            session.add(ThresholdConfig(scope="type:NerdQAxe++", temp_max=70.0, vr_temp_max=75.0))
            session.commit()

        existing_digest = session.exec(select(DigestConfig)).first()
        if not existing_digest:
            session.add(DigestConfig())
            session.commit()

        existing_scan = session.exec(select(ScanConfig)).first()
        if not existing_scan:
            raw = os.getenv("SCAN_SUBNETS", "192.168.60.0/24")
            for subnet in raw.split(","):
                subnet = subnet.strip()
                if subnet:
                    session.add(ScanConfig(subnet=subnet))
            session.commit()


def get_session():
    with Session(engine) as session:
        yield session


def get_thresholds(mac: str, model: str | None, session: Session) -> ThresholdConfig:
    """Return the most specific threshold config for a device."""
    device_thresh = session.exec(
        select(ThresholdConfig).where(ThresholdConfig.scope == f"device:{mac}")
    ).first()
    if device_thresh:
        return device_thresh
    if model:
        type_thresh = session.exec(
            select(ThresholdConfig).where(ThresholdConfig.scope == f"type:{model}")
        ).first()
        if type_thresh:
            return type_thresh
    global_thresh = session.exec(
        select(ThresholdConfig).where(ThresholdConfig.scope == "global")
    ).first()
    return global_thresh or ThresholdConfig(scope="global")
