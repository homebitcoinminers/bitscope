# BitScope

Fleet management, monitoring, and QA tool for home Bitcoin miners running AxeOS — Bitaxe, NerdQAxe++, NerdOCTAxe, and compatible devices.

**Current version: v0.6.6** — see [CHANGELOG.md](CHANGELOG.md) for full history.

---

## ⚠️ Disclaimer

BitScope is provided as-is for informational and management purposes only.

**By using BitScope, you acknowledge and agree:**

- You are solely responsible for any changes made to your mining devices through this tool, including pool configuration, frequency, and voltage adjustments
- Changing frequency or core voltage above factory defaults may void device warranties, cause hardware damage, reduce component lifespan, or cause unexpected behaviour
- Always verify settings directly on the device after applying changes — BitScope proxies the AxeOS API but cannot guarantee the device accepted all settings
- The authors of BitScope accept no liability for hardware damage, financial loss, lost hashrate, or any other consequence arising from use of this software
- This software has not been audited for security. Do not expose it to the public internet. Run it on a trusted local network only
- All device data is stored locally in a SQLite database. You are responsible for backups

**This is open source software. Review the code before running it on your infrastructure.**

---

## Features

### Monitoring
- **Auto-discovery** — scans subnets via HTTP (same method as AxeOS Swarm), adds new miners automatically
- **MAC-first identity** — device is the same device regardless of IP, hostname, or firmware changes
- **Full metric logging** — every field from `/api/system/info` stored every 30s, including NerdQAxe++ extras (per-ASIC temps, PID, dual-pool, TLS stratum, ping RTT)
- **Fleet dashboard** — total hashrate, power, efficiency, per-device status cards
- **Device detail** — live metrics, multi-graph view (hashrate, chip+VR temp, power, error rate, fan RPM), per-ASIC temp bars
- **Activity log** — per-device history of all alerts and events (offline, overheat, configure changes)

### Graphs
- Hashrate (Now / 1m avg / 10m avg)
- Temperature — chip and VR on the same axes with threshold reference line
- Power, error rate, fan RPM
- Time ranges: 1h / 6h / 24h / 7d / 2w / 1mo / all / custom date range
- X axis labels adapt to span (HH:mm for short ranges, date+time for multi-day, date-only for multi-week)
- Offline periods shown as gaps in the line, not interpolated

### Alerts & Discord
- Offline / back online
- Overheat (chip, VR, per-ASIC)
- Error rate exceeded
- Power over spec
- Fan failure (RPM below minimum)
- Weak WiFi signal
- HW nonce faults (possible ASIC damage indicator)
- New device discovered
- Hardware configure applied
- All alerts fire on state **change only** (rising/falling edge) — no repeated spam
- Daily HW nonce digest

### Fleet configuration
- Apply pool, system, or hardware settings to one or many devices at once
- Hardware profile locks to a specific model — prevents accidentally applying settings across device types
- Fan control: Manual or Auto Fan Control (PID) — uses correct NerdQAxe++ field names (`autofanspeed=2`, `manualFanSpeed`, `pidTargetTemp`)
- Two-step confirmation for hardware changes
- Offline devices are disabled in the selector — only reachable devices can be configured

### Profiles
- Saved pool / system / hardware profiles
- Apply a saved profile to a device or fleet in one click
- Three typed profile directories: `pool/`, `system/`, `hardware/`

### Hardware Snapshots
- **Factory snapshot** — automatically captured when a device is first discovered, recording exact freq, voltage, fan mode, and thermal settings as shipped. Cannot be deleted.
- **Manual snapshots** — take a snapshot any time from the device detail page (📷 Snapshot button). Useful before/after overclocking or firmware flashes.
- Snapshots page shows all snapshots grouped by device, filterable by factory/manual

### QA Sessions
- Start/end a named test session per device
- Auto-generates PASS / WARN / FAIL verdict on session end
- Compare any two sessions side by side
- CSV export for records

### HW Nonce Tracking
- Delta per poll, cumulative lifetime counter
- Rolling 1h rate with three alert tiers: warn / alert / critical
- Consecutive-poll debounce to avoid noise on reboot
- Suppressed during first 5 minutes of uptime and after tuning changes
- Bar chart history (1h / 6h / 24h / 7d / 30d), per-device advice

### Pool Monitor
- **Uptime monitor** — Stratum V1 handshake (subscribe + authorize) to any number of pools, every 5 minutes
- Shows RTT, difficulty, auth result, job received status
- Discord alerts on pool going offline or coming back online
- **Pool Checker** — on-demand Stratum connection with full coinbase decode:
  - Actual Bitcoin addresses from coinbase outputs (bech32 encoded, P2WPKH/P2TR/P2SH)
  - Payout type inference (SOLO vs PPLNS, custodial vs non-custodial)
  - Pool fee split detection

### Other
- **Scanner** — manual subnet scan, add devices by IP
- **Thresholds** — global / device-type / per-device threshold hierarchy
- **Profiles** — save and reuse pool/system/hardware configs
- **Logs** — in-container log viewer with level filter
- **Timezone toggle** — switch between local time and UTC, updates all graphs and timestamps live
- **Dark / grey / light theme**

---

## Quick start

```bash
git clone https://github.com/homebitcoinminers/bitscope
cd bitscope
cp .env.example .env
# Edit .env — set your Discord webhook and subnet
docker compose up -d
```

Open **http://your-server-ip:8080**

The backend API is available at **http://your-server-ip:8000** with auto-docs at `/docs`.

---

## How it works (networking)

BitScope is two containers:

```
Browser → frontend (nginx :8080)
              └── /api/* → proxy → backend (FastAPI :8000)
                                        └── polls miners on your LAN
```

The frontend container runs nginx which serves the React app and **proxies all `/api/` requests to the backend**. The backend URL is configurable via the `BITSCOPE_BACKEND_URL` environment variable (default: `http://backend:8000`).

When both containers are on the same Docker Compose network (the default), Docker's internal DNS resolves the service name `backend` automatically — no hardcoded IPs needed.

**Custom configurations:**

```bash
# Different network / standalone backend
BITSCOPE_BACKEND_URL=http://192.168.1.50:8000

# Renamed backend service in docker-compose.yml
BITSCOPE_BACKEND_URL=http://my-backend-name:8000

# Backend on a different port
BITSCOPE_BACKEND_URL=http://backend:9000
```

Your browser only ever talks to port 8080. The backend port 8000 is exposed for direct API access and the FastAPI auto-docs at `/docs`.

---

## Unraid setup

1. Install **Compose Manager** from Community Apps
2. Create a new stack and paste the contents of `docker-compose.yml`
3. Add your `.env` variables in the Compose Manager UI (or create `/mnt/user/appdata/bitscope/.env`)
4. Start the stack

Data persists in the `bitscope_data` Docker volume (mapped to `/data` inside the backend container). **Do not delete this volume** — it contains your SQLite database with all historical metrics, sessions, alerts, and snapshots.

---

## Configuration

All config via `.env`:

| Variable | Default | Description |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | — | Discord webhook URL for alerts |
| `SCAN_SUBNETS` | `192.168.60.0/24` | Comma-separated subnets to scan for miners |
| `POLL_INTERVAL` | `30` | Seconds between device metric polls |
| `SCAN_INTERVAL` | `300` | Seconds between full subnet scans |
| `DATA_RETENTION_DAYS` | `365` | Days of metric history to retain |

Additional subnets can be added live from the Scanner page without restarting.

---

## Database

SQLite at `/data/bitscope.db` inside the backend container, mapped to the `bitscope_data` volume.

**Safe to upgrade without deleting the DB.** New columns are nullable with defaults; new tables are created automatically on startup. The DB has never required a manual migration.

Key tables:
- `devices` — one row per MAC address
- `metrics` — every poll snapshot (30s interval by default)
- `sessions` — QA test sessions with verdict
- `thresholds` — global / type / device threshold configs
- `alert_log` — all alerts ever fired
- `hw_nonce_events` — individual HW nonce occurrences
- `hardware_snapshots` — factory and manual hardware setting snapshots
- `pool_monitors` — uptime monitor config (JSON file at `/data/pool_monitors.json`)

---

## Supported devices

Any device running AxeOS / ESP-Miner or a compatible fork:

| Device | Notes |
|---|---|
| Bitaxe Gamma, Supra, Ultra, Max | Standard AxeOS fields |
| NerdQAxe+, NerdQAxe++ | Extended fields: per-ASIC temps, PID fan control, dual-pool TLS, `duplicateHWNonces`, ping RTT |
| NerdOCTAxe | Same as NerdQAxe++ |
| NerdAxe | Standard AxeOS fields |

Fan control uses the correct field names for NerdQAxe++/NerdOCTAxe firmware: `autofanspeed` (0=manual, 2=auto PID), `manualFanSpeed`, `pidTargetTemp` — not the standard Bitaxe fields which differ.

---

## QA workflow

1. Power on the miner — it appears automatically within one scan cycle (default 5 min)
2. Click the device → **Start test session**, give it a label (e.g. "Pre-sale burn-in")
3. Let it run for your desired period (30 min minimum recommended)
4. Click **End session** — PASS / WARN / FAIL verdict generated automatically
5. Export CSV for your records
6. If a customer returns a device, look up the MAC → compare return session vs original sale session

---

## Threshold hierarchy

```
Global defaults
  └── Device type (e.g. NerdQAxe++)
        └── Per-device (specific MAC)
```

Most specific wins. NerdQAxe++ ships with tighter defaults (70°C vs 75°C global) since it runs hotter by design.

---

## Development

```bash
# Backend (Python 3.12 + FastAPI)
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (React + Vite) — separate terminal
cd frontend
npm install
npm run dev   # dev server at :5173, proxies /api to localhost:8000
```

Build and run locally with Docker:

```bash
docker compose -f docker-compose.build.yml up --build
```

---

## License

MIT
