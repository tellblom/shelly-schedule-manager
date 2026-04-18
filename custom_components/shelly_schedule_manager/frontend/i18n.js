const LANGUAGE_LOADERS = {
  en: () => import("./locales/en.js"),
  sv: () => import("./locales/sv.js"),
};

let _cache = {};

export function getLanguage(hass) {
  const lang = hass?.locale?.language || hass?.language || "en";
  return LANGUAGE_LOADERS[lang] ? lang : "en";
}

export async function loadTranslations(hass) {
  const lang = getLanguage(hass);

  if (_cache[lang]) {
    return _cache[lang];
  }

  const mod = await LANGUAGE_LOADERS[lang]();
  _cache[lang] = mod.default || {};
  return _cache[lang];
}

export async function translateAsync(hass, key, vars = {}) {
  const dict = await loadTranslations(hass);
  const fallback = langFallback(key);
  let text = dict[key] || fallback || key;

  for (const [name, value] of Object.entries(vars)) {
    text = text.replace(`{${name}}`, value);
  }

  return text;
}

function langFallback(key) {
  return DEFAULT_EN[key] || key;
}

const DEFAULT_EN = {
  title: "Shelly Schedule Manager",
  debug_logging: "Debug logging",
  on: "On",
  off: "Off",
  toggle_debug: "Toggle Debug",
  sort_devices_by: "Sort devices by",
  sort_name: "Name",
  sort_mac: "MAC",
  sort_type: "Type",
  sync_all: "Sync all",
  syncing: "Syncing...",
  devices: "Devices",
  no_devices: "No Shelly devices found yet.",
  model: "Model",
  mac: "MAC",
  ip: "IP",
  generation: "API Family",
  schedule_support: "Schedule support",
  available: "Available",
  last_sync: "Last sync",
  yes: "Yes",
  no: "No",
  schedules: "Schedules",
  no_schedules: "No schedules for this device.",
  sync_device: "Sync device",
  create_schedule: "Create schedule",
  create: "Create",
  creating: "Creating...",
  hour: "Hour",
  minute: "Minute",
  second: "Second",
  day_of_month: "Day of month",
  month: "Month",
  port: "Port",
  weekdays: "Weekdays",
  action: "Action",
  toggle_after: "Toggle after (seconds)",
  enabled: "Enabled",
  disabled: "Disabled",
  status: "Status",
  actions: "Actions",
  time: "Time",
  days: "Days",
  delete: "Delete",
  deleting: "Deleting...",
  edit: "Edit",
  save: "Save",
  saving: "Saving...",
  cancel: "Cancel",
  disable: "Disable",
  enable: "Enable",
  every_day: "Every day",
  every_month: "Every month",
  schedule: "Schedule",
  gen1: "Gen1",
  no_schedule: "No schedule",
  create_not_supported: "This device does not support schedules yet.",
  device_sync_failed: "Device sync failed",
  create_failed: "Create failed",
  edit_failed: "Edit failed",
  delete_failed: "Delete failed",
  toggle_failed: "Toggle failed",
  sync_failed: "Sync failed",
  could_not_load_options: "Could not load options",
  could_not_load_devices: "Could not load devices",
  could_not_load_device: "Could not load device",
  could_not_update_options: "Could not update options",
  delete_confirm: "Delete schedule {id}?",
  month_label: "Month {value}",
  day_label: "Day {value}",
  toggle_after_summary: "toggle after {value}",
  port_label: "Port {value}",
  gen1_limited_title: "Gen1 limited schedule support",
  gen1_limited_text:
    "Gen1 devices use an older schedule API. In this mode, only one relay schedule rule can be safely created, edited or deleted from this panel. If multiple rules already exist, they can be viewed here, but advanced per-rule editing is intentionally disabled to avoid corrupting device schedules.",
  gen1_schedule_enabled: "Gen1 relay schedules",
  turn_gen1_on: "Enable schedules",
  turn_gen1_off: "Disable schedules",
  raw_rule: "Raw rule",
  relay_schedule_state: "Relay schedule state",
  open_device_web: "Open device web interface",
};