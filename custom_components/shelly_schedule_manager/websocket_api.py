from __future__ import annotations

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import (
    CONF_DEBUG_LOGGING,
    CONF_SHOW_IN_SIDEBAR,
    DATA_STORE,
    DOMAIN,
)


def _get_entry(hass: HomeAssistant) -> ConfigEntry | None:
    return next(iter(hass.config_entries.async_entries(DOMAIN)), None)


def _get_store(hass: HomeAssistant, entry: ConfigEntry):
    return hass.data[DOMAIN][entry.entry_id][DATA_STORE]


@websocket_api.websocket_command(
    {
        "type": "shelly_schedule_manager/list_devices",
    }
)
@websocket_api.async_response
async def ws_list_devices(hass, connection, msg):
    """Return all stored devices."""
    entry = _get_entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_loaded", "Integration is not loaded")
        return

    store = _get_store(hass, entry)
    data = store.get_data()

    devices = [
        value
        for key, value in data.get("devices", {}).items()
        if key != "_meta"
    ]

    connection.send_result(
        msg["id"],
        {
            "devices": devices,
        },
    )


@websocket_api.websocket_command(
    {
        "type": "shelly_schedule_manager/get_device",
        "device_id": str,
    }
)
@websocket_api.async_response
async def ws_get_device(hass, connection, msg):
    """Return one stored device."""
    entry = _get_entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_loaded", "Integration is not loaded")
        return

    store = _get_store(hass, entry)
    device = store.get_device(msg["device_id"])

    if device is None:
        connection.send_error(msg["id"], "not_found", "Device not found")
        return

    connection.send_result(
        msg["id"],
        {
            "device": device,
        },
    )


@websocket_api.websocket_command(
    {
        "type": "shelly_schedule_manager/get_options",
    }
)
@websocket_api.async_response
async def ws_get_options(hass, connection, msg):
    """Return current config entry options."""
    entry = _get_entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_loaded", "Integration is not loaded")
        return

    connection.send_result(
        msg["id"],
        {
            CONF_DEBUG_LOGGING: entry.options.get(CONF_DEBUG_LOGGING, False),
            CONF_SHOW_IN_SIDEBAR: entry.options.get(CONF_SHOW_IN_SIDEBAR, True),
        },
    )


@websocket_api.websocket_command(
    {
        "type": "shelly_schedule_manager/set_options",
        CONF_DEBUG_LOGGING: bool,
        CONF_SHOW_IN_SIDEBAR: bool,
    }
)
@websocket_api.async_response
async def ws_set_options(hass, connection, msg):
    """Update config entry options."""
    entry = _get_entry(hass)
    if entry is None:
      connection.send_error(msg["id"], "not_loaded", "Integration is not loaded")
      return

    hass.config_entries.async_update_entry(
        entry,
        options={
            CONF_DEBUG_LOGGING: msg[CONF_DEBUG_LOGGING],
            CONF_SHOW_IN_SIDEBAR: msg[CONF_SHOW_IN_SIDEBAR],
        },
    )

    connection.send_result(
        msg["id"],
        {
            "ok": True,
            CONF_DEBUG_LOGGING: msg[CONF_DEBUG_LOGGING],
            CONF_SHOW_IN_SIDEBAR: msg[CONF_SHOW_IN_SIDEBAR],
        },
    )


@websocket_api.websocket_command(
    {
        "type": "shelly_schedule_manager/list_groups",
    }
)
@websocket_api.async_response
async def ws_list_groups(hass, connection, msg):
    """Return stored groups."""
    entry = _get_entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_loaded", "Integration is not loaded")
        return

    store = _get_store(hass, entry)
    data = store.get_data()

    connection.send_result(
        msg["id"],
        {
            "groups": data.get("groups", {}),
        },
    )


async def async_register_websocket_api(hass: HomeAssistant) -> None:
    """Register websocket commands."""
    websocket_api.async_register_command(hass, ws_list_devices)
    websocket_api.async_register_command(hass, ws_get_device)
    websocket_api.async_register_command(hass, ws_get_options)
    websocket_api.async_register_command(hass, ws_set_options)
    websocket_api.async_register_command(hass, ws_list_groups)