# Shelly Schedule Manager

[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-Integration-41BDF5?logo=home-assistant)](https://www.home-assistant.io/)
[![HACS Custom](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://hacs.xyz)
[![release](https://img.shields.io/github/v/release/tellblom/shelly-schedule-manager?display_name=tag)](https://github.com/tellblom/shelly-schedule-manager/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/arboeh/shABman/blob/main/LICENSE)
[![maintained](https://img.shields.io/maintenance/yes/2026)](https://github.com/arboeh/shABman/graphs/commit-activity)
[![Shelly](https://img.shields.io/badge/Shelly-Gen2%2FGen3-00A1DF?logo=shelly)](https://shelly.cloud)


Manage and control **Shelly device schedules** directly from Home Assistant with a clean and user-friendly interface.

---

## ✨ Features

- 📅 View schedules across all Shelly devices
- ➕ Create new schedules
- ✏️ Edit existing schedules
- 🗑️ Delete schedules
- 🔄 Sync devices manually
- 🧠 Automatic detection of device capabilities (Gen1 vs Gen2+)
- 🖥️ Optional sidebar panel
- 🐞 Optional debug logging

---

## ⚙️ Supported Devices

### ✅ Gen2 / Gen3 / Gen4 (RPC-based)

Full schedule support:

- Create schedules
- Edit schedules
- Enable / Disable schedules
- Delete schedules

---

### ⚠️ Gen1 Devices (Limited Mode)

Gen1 devices use an older API with significant limitations.

This integration provides a **safe mode** for Gen1:

- ✅ View schedules
- ✅ Enable / disable schedules (applies to the entire relay)
- ✅ Create / edit / delete schedules **when exactly one rule exists**

#### Limitations

- ❌ Multiple schedule rules cannot be safely modified individually
- ❌ Enable / disable is **not per schedule** — it applies to all schedules on the relay

If multiple rules exist:

- They will be displayed
- Editing is restricted to avoid corrupting device configuration

👉 For advanced schedule management, use the device web interface.

---

## 🚀 Quick Start

### Step 1: Install the Integration

**Prerequisites:** [HACS](https://hacs.xyz/) must be installed.

Click below to open in HACS:

[![Open HACS Repository](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=tellblom&repository=shelly-schedule-manager&category=integration)

Then:

1. Click **Download**
2. Restart Home Assistant

---

<details>
<summary><strong>Manual Installation</strong></summary>

1. Copy:

```text
custom_components/shelly_schedule_manager
