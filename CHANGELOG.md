# BitScope Changelog

## v0.6.7 — 2026-04-07

### Fixed
- **Auto factory snapshot not being taken** — the `HardwareSnapshot` creation code was in the wrong version of the scanner and never made it into the actual codebase. Fixed: factory snapshot is now correctly captured the moment a new device is first discovered
- **Snapshots page missing from sidebar** — was present in nav array but being cut off on some viewport sizes
- **nginx envsubst breaking frontend** — `envsubst` was replacing all nginx variables (`$host`, `$uri`, `$remote_addr`) alongside `$BITSCOPE_BACKEND_URL`, resulting in a broken proxy. Fixed with a custom entrypoint that passes explicit variable list: `envsubst '${BITSCOPE_BACKEND_URL}'`

### Added
- **Mobile responsive layout** — hamburger menu button on screens ≤768px, slide-in sidebar overlay, stat grids collapse to 2-col, device grid goes to 1-col, device detail collapses to single column

---

## v0.6.5 — 2026-04-07

### Added
- **Per-device activity log** — each device detail page now has a collapsible Activity log panel showing all alerts and events for that device: offline/online transitions, temperature/fan/power/error breaches, hardware configure applies, new device discovery. Shows 5 most recent by default, expandable to see all. Respects timezone setting. Auto-refreshes every 30s with the rest of the page.
- **`/api/devices/{mac}/alerts` endpoint** — returns alerts filtered to a single device MAC. Also updated `/api/alerts` to accept an optional `?mac=` query parameter.

---

## v0.6.4 — 2026-04-07

### Added
- **VR temp on temperature graph** — device detail temperature chart now shows both chip temp (orange) and VR temp (coral dashed) on the same axes, with the threshold reference line applying to chip temp
- **Fan RPM graph** — new Fan RPM chart below the existing graphs, showing Fan 1 and Fan 2 (if present) with the fan_rpm_min threshold as a reference line
- **Hardware snapshots** — automatic factory snapshot captured on first device discovery, recording: frequency, core voltage (set and actual), fan mode, manual/PID fan speed, PID target temp, overheat/shutdown temp, firmware version
  - New **Snapshots** sidebar page shows all snapshots grouped by device, filterable by factory/manual, searchable
  - Manual snapshot button on device detail page (📷 Snapshot) — prompts for a label
  - Factory snapshots are permanent and cannot be deleted — they are the baseline record of how the device arrived from manufacturer
  - New DB table: `hardware_snapshots` — created automatically, safe upgrade from previous versions

---

## v0.6.3 — 2026-04-06

### Fixed
- **Pool checker payout analysis for fee-split SOLO** — when a SOLO pool shows two coinbase outputs (one to miner, one to pool operator fee address), the checker now correctly identifies this as non-custodial SOLO with a pool fee, rather than incorrectly classifying it as custodial. Specifically recognises the pattern: Output 1 = pool fee address, Output 2 = miner's wallet address (matching the stratum username). Adds a note explaining that if you run the pool yourself and both addresses are yours, you keep 100% of any block found.

---

## v0.6.2 — 2026-04-06

### Fixed / Improved
- **Pool checker now shows actual Bitcoin addresses** — coinbase outputs are fully decoded using bech32 encoding. P2WPKH (bc1q…), P2TR (bc1p…), P2WSH, P2PKH (1…) and P2SH (3…) addresses all resolved correctly
- **Correct coinbase assembly** — coinbase1 + extranonce1 + extranonce2(zeros, correct size) + coinbase2 is now assembled exactly as per Stratum V1 spec, matching what pool_checkr produces
- **Block height decoded** — BIP34 block height extracted from coinbase script
- **nTime decoded** — timestamp shown as UTC datetime
- **ScriptSig text shown** — full coinbase script decoded as ASCII (pool identity, block height, etc.)
- **OP_RETURN data decoded** — null data outputs shown with decoded text
- **Pool Checker moved to sidebar** — dedicated page accessible directly from nav, separate from Pool Monitor

### Added
- **Pure Python bech32 encoder** — no runtime dependencies, supports P2WPKH, P2WSH, P2TR (bech32m)
- **nBits→difficulty** — converts compact difficulty target from notify params

---

## v0.6.1 — 2026-04-06

### Added
- **Coinbase transaction decoder** — the pool checker now decodes the raw coinbase transaction from `mining.notify` to reveal exactly who receives block rewards
- **Payout type analysis** — infers from stratum data whether a pool is SOLO, PPLNS, or FPPS:
  - Difficulty > 1 trillion → SOLO (full network difficulty = only pays on block find)
  - Single coinbase output → non-custodial (reward goes directly to miner's address on block find)
  - Multiple outputs → pool takes a fee cut, custodial arrangement
  - Auth result interpretation — whether your wallet address format is accepted
- **Coinbase output display** — shows each output's address type (P2WPKH/P2TR/P2SH/OP_RETURN), hash, and value for the block template
- **Pool REST API proxy** — `/api/pools/query-api?url=` proxies GET requests to pool REST APIs to bypass browser CORS restrictions

---

## v0.6.0 — 2026-04-06

### Added
- **Pool Monitor page** — monitors stratum pools via full Stratum V1 handshake (subscribe + authorize), not just TCP ping. Shows RTT, difficulty, auth result, job received status. Auto-checks every 5 minutes. Discord alerts on pool going offline or coming back online. Multiple pools supported, each with label, host, port, TLS toggle, worker address.
- **Pool Checker tool** (inspired by skot/pool_checkr) — on-demand stratum connection to any pool. Reports: RTT, whether your wallet address authorizes successfully, pool-set difficulty, whether a job was received, extranonce1, coinbase prefix decoded to human-readable text (often contains pool identity), and inference on payout type (solo pools set difficulty = full network difficulty, PPLNS pools set much lower).

---

## v0.5.7 — 2026-04-06

### Fixed
- **Configure: offline devices now blocked** — offline devices and devices with no known IP are greyed out and their checkboxes disabled. Quick-select buttons (Online/All/model) only select devices that are reachable. Previously offline devices could be selected and would produce connection errors on apply.
- **Configure: selection cleared on tab switch** — switching between Pool/System/Hardware now clears the device selection, requiring a conscious re-selection. Prevents accidentally applying the wrong profile type to previously selected devices.
- **Configure: full IP shown** — device selector shows full IP address (e.g. `192.168.60.211`) instead of last two octets, making it easier to identify devices.
- **Timezone toggle now works live** — changing Local/UTC in the sidebar now immediately re-renders chart timestamps and X axis tick labels. Previously the toggle updated the preference but charts only reflected it on next full page navigation.
- **Chart timestamps respect timezone** — all chart X axis ticks and tooltip timestamps now use the selected timezone. Previously hardcoded to local browser time regardless of toggle state.
- **Log timestamps respect timezone** — Logs page now shows timestamps in the selected timezone with the timezone name displayed in the footer.
- **Chart colors respect dark/grey theme** — chart grid lines, axis labels, and tooltip now use theme colors instead of hardcoded light-mode colors.

---

## v0.5.6 — 2026-04-06

### Fixed
- **Fan control completely broken** — three wrong field names confirmed by reading the device API directly:
  - `autofanspeed` should be integer `2` (auto PID) or `0` (manual) — NOT the string `"Auto Fan Control (PID)"` and NOT `1`
  - Manual fan speed should be sent as `manualFanSpeed` — NOT `fanspeed` (that field is read-only, it returns the current measured fan %)
  - PID target temperature should be sent as `pidTargetTemp` — NOT `temptarget`
- **Graphs skip offline periods** — when a device was powered off and back on, the chart drew a straight line across the downtime gap instead of showing a break. Fixed two ways:
  1. Charts now use `connectNulls={false}` so null values break the line
  2. Metrics API now inserts null sentinel rows at the edges of any gap > 3 minutes, making offline periods visible as blank space on the X axis

---

## v0.5.5 — 2026-04-05

### Added (diagnostic)
- **PATCH request/response logging** — every configure attempt now logs the exact JSON payload sent to the device and the exact response body. Visible in the Logs page. Use this to diagnose fan control issues.
- **`/api/devices/{mac}/fanfields` debug endpoint** — returns all fan/temp related keys from the device's latest raw API snapshot. Hit from browser to see exactly what field names the device uses.

---

## v0.5.4 — 2026-04-05

### Fixed
- **Auto fan mode broken on NerdQAxe++ / NerdOCTAxe** — the configure endpoint was sending `autofanspeed: 1` (integer) but the firmware expects `autofanspeed: "Auto Fan Control (PID)"` (string). Sending integer `1` triggers the firmware error `"invalid temp control mode: 1. Defaulting to manual mode 100%"`. Fixed: now sends the string `"Auto Fan Control (PID)"` for auto, and `""` for manual
- **Fan controller shown as toggle** — replaced the on/off toggle with a dropdown matching exactly what the device UI shows: `Manual` / `Auto Fan Control (PID)`. Makes it unambiguous which mode maps to which firmware value

---

## v0.5.3 — 2026-04-05

### Fixed
- **Profiles page blank screen for System and Hardware types** — `ReadOnly` component was receiving `theme` as a prop but calling it like a hook value, crashing on render. Fixed by using `useTheme()` hook inside `ReadOnly` directly. Also `Row` sub-component was still defined inside `ReadOnly` (same inline-component focus bug). Extracted to module-level `ProfileRow` component
- **`inp` style variable undefined** — editor fields for system/hardware profiles referenced an `inp` style object that was only defined inside `ProfilePoolSection`. Replaced all raw `<input style={inp}>` elements with a new `ProfileInp` component defined at module level

---

## v0.5.2 — 2026-04-05

### Fixed
- **Input focus loss when typing** — root cause: `Tog`, `F`, `PoolSection`, `Row` components were defined *inside* the `Profiles()` and `Configure()` function bodies. Every keystroke triggered a re-render which recreated those function references, causing React to unmount and remount the inputs (losing focus after each character). Fixed by moving all sub-components to module level outside the parent component
- **Fan speed not applying** — `fanspeed` payload was conditionally excluded. Now always sent alongside `autofanspeed`
- **Second apply failing** — errors now caught in try/catch and shown in ResultPanel instead of crashing the apply function state
- **Confirmation missing full change list** — `ChangeTable` component added showing all settings being applied (pool URL, ports, workers, TLS, fan, freq, voltage, restart etc.) before confirming
- **IP not visible in device selector** — now shows last two octets (e.g. `60.13`) below device name. Devices with no IP show `no IP` with a ⚠ warning icon and are excluded from default selection
- **Model lock not deselecting incompatible devices** — fixed in v0.5.1 but also now applied when loading a hardware profile that has a model_lock

---

## v0.5.1 — 2026-04-05

### Fixed
- **WiFi password not pulling from profile** — `wifi_password` was missing from the `applyProfile()` merge for system profiles
- **Fan speed not applying** — `fanspeed` was only sent in the payload when `autofanspeed` was false, but the condition check was wrong. Now always included in the payload alongside `autofanspeed`
- **Model lock didn't auto-filter devices** — selecting a model lock now immediately filters the device selector to only show devices of that model (deselects incompatible ones automatically)
- **Hostname template `{devicename}` ambiguity** — removed `{devicename}` token (was using the device's current hostname which is confusing). Default template changed to `{model}-{last4mac}` (e.g. `NerdQAxeplus-b220`). Available tokens: `{model}`, `{last4mac}`, `{hostname}`, `{mac}`
- **Model name in hostname** — `NerdQAxe++` now sanitises to `NerdQAxeplus` (no special chars), `NerdOCTAxe-y` remains `NerdOCTAxe-y`. Double dashes collapsed.
- **Password fields now masked** — pool passwords, fallback passwords, and WiFi password all use masked input with 👁 show/hide toggle in Configure and Profiles pages

### Added
- **Experimental banner** — amber warning banner at top of Configure page explaining the page pushes live changes to devices

---

## v0.5.0 — 2026-04-05

### Added — Configure page (major rework)
- **Dedicated Configure page** — replaces all per-device and fleet modals with a unified left-nav page accessible from sidebar and device detail
- **Three typed profile types** — Pool, System, Hardware stored in separate subdirectories `/data/profiles/<type>/`
- **Pool profiles** — primary + fallback pool, worker, password, TLS. Fleet-safe (any model)
- **System profiles** — hostname template with token engine (`{devicename}`, `{model}`, `{last4mac}`, `{mac}`), WiFi (skipped if blank), display timeout, stats frequency. Fleet-safe
- **Hardware profiles** — fan, temps, frequency, core voltage. Model-locked: stored with `model_lock` field, fleet apply blocked if devices contain mismatched models
- **Live hostname preview** — resolves template tokens against each selected device before applying, shown in both edit and confirm screens
- **Device selector** — right sidebar with model group quick-select buttons, online filter, model-lock greyed-out indicator
- **Two-step confirmation** — pool applies immediately, system and hardware go through a review screen showing exactly what will change per device
- **Apply history** — every configure action logged with timestamp, device, action description, visible in Configure page
- **Saved profiles sidebar** — click any saved profile to pre-fill the current form instantly
- **Factory defaults revert** — hardware profiles can set `use_factory_defaults: true` to revert ASIC to firmware defaults without needing to know the values
- **WiFi safety warning** — shown in both edit and confirm screens when WiFi SSID is being changed
- **Model mismatch warning** — shown inline when hardware profile `model_lock` doesn't match all selected devices
- **Capture from device** — reads live device API and creates a typed profile (pool/system/hardware separately)

### Changed
- Configure button on device detail page now navigates to Configure page pre-filtered to that device instead of opening a modal
- Fleet config button on Devices page now navigates to Configure page
- Profiles page redesigned with type selector (Pool/System/Hardware tabs), matching the three profile types
- `profiles.py` completely rewritten with typed subdirectory structure and `ensure_dirs()` seeding all three defaults on first boot

### Removed
- `ConfigurePanel.jsx` (per-device modal) — replaced by Configure page
- `FleetConfigPanel.jsx` (fleet modal) — replaced by Configure page
- Old `/api/fleet/configure/pool` endpoint — replaced by `/api/configure/pool` (takes `macs[]`)
- Old `/api/devices/{mac}/configure/pool` and `/api/devices/{mac}/configure/system` — merged into fleet endpoints

---

## v0.4.3 — 2026-04-05

### Fixed
- **Fallback password missing from configure panel** — field existed in state and payload but was never rendered in the pool tab. Fixed, apply button wrapper div also repaired
- **Profile editor layout** — completely redesigned: primary pool and fallback pool now shown as separate cards with coloured dot indicators (green for primary, grey for fallback), system settings in a third card below. Read-only view mirrors the same card structure
- **Fan speed field in profiles** — manual fan speed field now appears conditionally when auto fan is disabled

---

## v0.4.2 — 2026-04-05

### Fixed
- **Capture from device 500** — `re` module imported inside function after it was used, causing `UnboundLocalError`. Fixed by using `import re as _re` at the top of the function
- **Log filter buttons** — active filter button didn't visually deactivate when clicking another. Rewrote button styles to properly reflect active/inactive state with correct colours
- **Profiles missing password fields** — password and fallback password fields were in the data but missing from the Profiles edit form and read-only view
- **Fleet config no profile dropdown** — profile selector was only in per-device configure panel, not fleet config. Added to fleet panel with same apply-on-select behaviour
- **Fleet config missing fallback password** — fallback password field and confirmation display added

---

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
