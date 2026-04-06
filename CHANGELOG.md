# BitScope Changelog

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
