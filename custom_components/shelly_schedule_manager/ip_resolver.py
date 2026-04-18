from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er


def get_device_ip(hass: HomeAssistant, device_id: str) -> str | None:
    """Resolve IP/host for a Shelly device via entity registry -> config entry."""

    entity_reg = er.async_get(hass)

    for entity in entity_reg.entities.values():
        if entity.device_id != device_id:
            continue

        if not entity.config_entry_id:
            continue

        entry = hass.config_entries.async_get_entry(entity.config_entry_id)
        if not entry:
            continue

        host = entry.data.get("host")
        if host:
            return host

        ip = entry.data.get("ip")
        if ip:
            return ip

        url = entry.data.get("url")
        if isinstance(url, str) and "://" in url:
            return url.split("//", 1)[1].split("/", 1)[0]

    return None