# BitScope Changelog

## v0.4.1 — 2026-04-05

### Fixed
- **Profiles recursion crash** — `ensure_dir()` called `save_profile()` which called `ensure_dir()` again infinitely. Fixed by writing the default profile file directly in `ensure_dir` without calling `save_profile`, and by calling `PROFILES_DIR.mkdir()` directly in `save_profile` without calling `ensure_dir`
- **Frequency tuning** — the preset dropdown only showed options from `frequencyOptions[]` (e.g. up to 600 MHz) but NerdQAxe++ units can run at 735 MHz or higher. Now shows both a preset dropdown AND a free-text number input so any value can be entered
- **Profile dropdown missing** — was empty because profiles couldn't be created (recursion crash). Now seeds correctly on first boot
- **Default fan** — configure panel and new profiles now default to manual fan 100% instead of auto, matching typical pre-sale test setup

---

## v0.4.0 — 2026-04-05

### Added
- **Device configuration panel** — configure pool, system settings, and tuning per device from the UI
  - Pool tab: primary/fallback URL, port, worker, password, TLS toggle
  - System tab: hostname, fan control, overheat temp, display timeout, stats frequency
  - Tuning tab: frequency and core voltage with mandatory two-step confirmation screen
- **Fleet pool configuration** — push pool settings to multiple devices simultaneously with device selector and confirmation step
- **HW Nonce tracking engine** — full nonce fault tracking across reboots
  - Per-poll delta calculation, cumulative all-time counter (survives reboots)
  - Three-tier Discord alerts: warn (1/hr), alert (5/hr), critical (20/hr)
  - Consecutive-poll debounce — avoids false alarms from brief spikes
  - `HWNonceEvent` table stores every fault with timestamp, temp, freq, voltage context
  - Nonce rate graph (bar chart) on device detail page with 1h/6h/24h/7d/30d range
- **Daily HW nonce digest** — configurable Discord summary of nonce activity across all devices
- **Device archive** — manually archive devices; auto-archive after 1 week offline
- **Device search** — search across name, MAC, model, IP; includes archived devices
- **Configurable table columns** — 38 columns across 5 groups, persisted in localStorage
- **Fleet sparkline charts** — hashrate/power/efficiency sparklines on stat cards with expandable 24h chart
- **Discord alert checkboxes** — toggle individual alert types from the Alerts page
- **Fleet log viewer** — real-time backend log stream in the UI
- **Timezone toggle** — Local / UTC switch in sidebar

### Fixed
- Fleet configure pool 500 error (asyncio import scope issue)
- Devices showing offline incorrectly (UTC datetime serialization — missing Z suffix)
- Discord alert spam — alerts now fire once on breach, once on resolve (rising/falling edge)
- Per-ASIC temps showing blank when all zeros (NerdOCTAxe firmware reports zeros)

### Changed
- Power threshold now uses absolute `power_max_w` (W) instead of `power_over_spec_pct` — avoids false alerts on factory-overclocked units
- Table view is now default (replaces card view default)
- Sort key and direction persisted in localStorage across navigation
- Difficulty formatted as Bitaxe-style K/M/G/T/P suffixes

---

## v0.3.0 — 2026-04-04

### Added
- All 38 AxeOS API fields available as table columns
- IP address column with clickable link to device AxeOS web UI
- Manual archive/unarchive button per device
- Custom graph time range (date picker) on device detail page
- Export metrics by date range (CSV) from Devices page
- Pool info panel on device detail — shows URL, port, TLS badge, RTT, accept/reject per pool
- Shares % rejected displayed alongside share counts
- Best difficulty formatted with K/M/G/T/P suffixes
- Max temp 24h column (backend query, not just live value)
- Firmware version column
- Last updated column
- Nonce rate /hr and all-time total columns

### Fixed
- Sort persistence across page navigation
- Ascending/descending sort toggle per column

---

## v0.2.0 — 2026-04-03

### Added
- Dark / grey / light theme with persistence
- Discord alert toggle (on/off) in sidebar
- Alert debounce — fires on state change only, resolves when condition clears
- Per-device power threshold (`power_max_w`) — replaces unreliable API `maxPower` field
- Threshold hierarchy: global → device type → per-device
- Delete threshold overrides
- Threshold inheritance source shown in UI (global / type / device)
- Table view with sortable columns
- Session comparison panel (delta table for two sessions)
- CSV export per session
- Fleet stats: total hashrate, power, efficiency
- Manual refresh button
- Scanner page with subnet management and manual add by IP
- Identify device button (flashes LED)

### Fixed
- NerdQAxe++ extended API fields (per-ASIC temps, dual-pool, TLS stratum, ping RTT)
- AxeOS CSRF header requirement

---

## v0.1.0 — 2026-04-02 — Initial release

- Auto-discovery via HTTP sweep (same method as AxeOS Swarm)
- MAC-address primary identity — survives IP/hostname/firmware changes
- 30s metric polling with full raw JSON storage
- Test sessions with PASS/WARN/FAIL verdict
- Discord alerts: offline, overheat, error rate, power, HW nonces, new device
- Device detail page with hashrate/temp/power/error graphs
- Sessions page with history and CSV export
- Thresholds: global and per-device-type
- Docker Compose deployment
