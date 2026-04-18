from __future__ import annotations

import re

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr


HEX12_RE = re.compile(r"^[0-9A-Fa-f]{12}$")


def _format_mac(value: str) -> str:
    value = value.upper()
    return ":".join(value[i:i + 2] for i in range(0, 12, 2))


def extract_mac_from_identifiers(identifiers: list) -> str | None:
    """Extract a MAC-like value from Shelly identifiers."""
    for identifier in identifiers:
        if not isinstance(identifier, (tuple, list)) or len(identifier) != 2:
            continue

        domain, value = identifier

        if not isinstance(value, str):
            continue

        if HEX12_RE.match(value):
            return _format_mac(value)

        if domain == "shelly":
            cleaned = value.replace(":", "").replace("-", "")
            if HEX12_RE.match(cleaned):
                return _format_mac(cleaned)

    return None


def get_shelly_devices(hass: HomeAssistant) -> list[dict]:
    """Return Shelly devices already present in Home Assistant."""
    registry = dr.async_get(hass)
    devices: list[dict] = []

    for device in registry.devices.values():
        manufacturer = (device.manufacturer or "").lower()
        if "shelly" not in manufacturer:
            continue

        identifiers = list(device.identifiers)
        devices.append(
            {
                "id": device.id,
                "name": device.name_by_user or device.name or device.id,
                "model": device.model,
                "manufacturer": device.manufacturer,
                "identifiers": identifiers,
                "mac": extract_mac_from_identifiers(identifiers),
                "config_entries": list(device.config_entries),
            }
        )

    return devices