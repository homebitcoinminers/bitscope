import os
from sqlmodel import SQLModel, create_engine, Session, select
from models import ThresholdConfig, ScanConfig

DATABASE_URL = f"sqlite:////data/bitscope.db"
engine = create_engine(DATABASE_URL, echo=False)


def init_db():
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        # Seed global threshold defaults if not present
        existing = session.exec(select(ThresholdConfig).where(ThresholdConfig.scope == "global")).first()
        if not existing:
            session.add(ThresholdConfig(scope="global"))
            session.commit()

        # Seed default NerdQAxe++ type threshold (runs hotter)
        existing_type = session.exec(
            select(ThresholdConfig).where(ThresholdConfig.scope == "type:NerdQAxe++")
        ).first()
        if not existing_type:
            session.add(ThresholdConfig(scope="type:NerdQAxe++", temp_max=70.0, vr_temp_max=75.0))
            session.commit()

        # Seed default scan subnet from env if no subnets configured
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
    # 1. Try device-level
    device_thresh = session.exec(
        select(ThresholdConfig).where(ThresholdConfig.scope == f"device:{mac}")
    ).first()
    if device_thresh:
        return device_thresh

    # 2. Try device-type level
    if model:
        type_thresh = session.exec(
            select(ThresholdConfig).where(ThresholdConfig.scope == f"type:{model}")
        ).first()
        if type_thresh:
            return type_thresh

    # 3. Fall back to global
    global_thresh = session.exec(
        select(ThresholdConfig).where(ThresholdConfig.scope == "global")
    ).first()
    return global_thresh or ThresholdConfig(scope="global")
