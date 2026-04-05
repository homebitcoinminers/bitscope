# BitScope

Pre-sale QA monitoring for Bitaxe, NerdQAxe++, and NerdOCTAxe miners.

Auto-discovers miners on your LAN, logs all metrics against MAC address, lets you run test sessions before sale, and compare a returned device's historical performance against how it ran when you sold it.

**Built by [homebitcoinminers](https://github.com/homebitcoinminers)**

---

## Features

- **Auto-discovery** — scans subnets via HTTP (same method as AxeOS Swarm), adds new miners automatically
- **MAC-first identity** — device is the same device regardless of IP, hostname, or firmware changes
- **Full metric logging** — every field from `/api/system/info` stored, including NerdQAxe++ extras (per-ASIC temps, PID, dual-pool, TLS stratum)
- **Test sessions** — start/end a QA session, auto-generates PASS/WARN/FAIL verdict
- **Session comparison** — compare any two sessions side by side (e.g. "when sold" vs "after return")
- **CSV export** — full session data export for records
- **Threshold hierarchy** — global defaults → device type overrides → per-device overrides
- **Discord alerts** — offline, overheat, error rate, power over spec, HW nonce faults, new device found
- **Identify button** — flash device LED to locate it physically on your bench

## Quick start

```bash
git clone https://github.com/homebitcoinminers/bitscope
cd bitscope
cp .env.example .env
# Edit .env — add your Discord webhook and subnet if different from 192.168.60.0/24
docker compose up -d
```

Open **http://your-server-ip:8080**

## Unraid setup

1. Install the **Compose Manager** plugin from the Unraid Community Apps store
2. Add a new stack, point it at this repo or paste the `docker-compose.yml`
3. Set the volume path to `/mnt/user/appdata/bitscope`
4. Set your `.env` variables in the Compose Manager UI
5. Start the stack

Data persists in a Docker volume (`bitscope_data`) mapped to `/data` inside the container.

## Configuration

All config via `.env`:

| Variable | Default | Description |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | — | Discord webhook for alerts |
| `SCAN_SUBNETS` | `192.168.60.0/24` | Comma-separated subnets to scan |
| `POLL_INTERVAL` | `30` | Seconds between device polls |
| `SCAN_INTERVAL` | `300` | Seconds between subnet scans |
| `DATA_RETENTION_DAYS` | `365` | Days of metrics to keep |

Additional subnets can also be added from the Scanner page in the UI without restarting.

## QA workflow

1. Power on the miner, let it appear automatically (or add manually by IP)
2. Click the device → **Start test session** — give it a label like "Pre-sale test"
3. Let it run for your desired burn-in period (30 min minimum recommended)
4. Click **End session** — verdict auto-generated (PASS / WARN / FAIL)
5. Export CSV for your records
6. If a customer returns a device, enter the MAC → compare the return session vs the original sale session

## Threshold hierarchy

```
Global defaults
  └── Device type (e.g. NerdQAxe++)
        └── Per-device (specific MAC)
```

Most specific wins. NerdQAxe++ ships with tighter defaults (70°C vs 75°C global) since it runs hotter by design and has its own `overheat_temp` field.

## Supported devices

Any device running AxeOS or a compatible fork (ESP-Miner):

- Bitaxe Gamma, Supra, Ultra, Max
- NerdQAxe+, NerdQAxe++
- NerdOCTAxe
- NerdAxe

NerdQAxe++ extended fields (per-ASIC temps, PID thermal control, dual-pool with TLS, `duplicateHWNonces`, ping loss) are automatically detected and displayed when present.

## API

The backend exposes a REST API at `:8000`. See FastAPI auto-docs at `http://your-server-ip:8000/docs`.

## Development

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev   # proxies /api to localhost:8000
```

## License

MIT
