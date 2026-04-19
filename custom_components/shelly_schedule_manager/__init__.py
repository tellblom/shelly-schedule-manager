from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv

from .const import (
    CONF_DEBUG_LOGGING,
    CONF_SHOW_IN_SIDEBAR,
    DATA_RUNTIME,
    DATA_STORE,
    DOMAIN,
)
from .device_discovery import get_shelly_devices
from .gen1_client import ShellyGen1Client
from .gen1_schedule_service import ShellyGen1ScheduleService
from .ip_resolver import get_device_ip
from .panel import async_register_panel
from .shelly_client import ShellyClient
from .shelly_schedule_service import ShellyScheduleService
from .storage import ShellyScheduleStorage
from .websocket_api import async_register_websocket_api

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def safe_call(fn, *args, **kwargs) -> dict[str, Any]:
    """Wrap async calls so service handlers never explode."""
    try:
        result = await fn(*args, **kwargs)
        return {"ok": True, "result": result}
    except Exception as err:  # noqa: BLE001
        _LOGGER.exception("Shelly Schedule Manager call failed")
        return {"ok": False, "error": str(err)}


def utc_now_iso() -> str:
    """Return current UTC time in ISO format."""
    return datetime.now(UTC).isoformat()


def _is_debug(entry: ConfigEntry) -> bool:
    """Return whether debug logging is enabled."""
    return entry.options.get(CONF_DEBUG_LOGGING, False)


def _debug_log(entry: ConfigEntry, message: str, *args) -> None:
    """Write debug log message when enabled in options."""
    if _is_debug(entry):
        _LOGGER.warning(message, *args)


def extract_output_ids(config: dict) -> list[int]:
    """Extract Gen2 output IDs from config payload."""
    output_ids: list[int] = []

    for key in config.keys():
        if key.startswith("switch:"):
            try:
                output_ids.append(int(key.split(":", 1)[1]))
            except ValueError:
                continue

    return sorted(set(output_ids))


def build_gen1_raw_rule_from_timespec_and_params(timespec: str, params: dict) -> str:
    """Convert UI schedule data into a Gen1 raw schedule rule."""
    parts = str(timespec).split()
    if len(parts) < 6:
        raise ValueError("Unsupported Gen1 timespec")

    _second, minute, hour, _dom, _month, weekday_field = parts[:6]

    action = "on" if params.get("on", False) else "off"

    day_map = {
        "MON": "0",
        "TUE": "1",
        "WED": "2",
        "THU": "3",
        "FRI": "4",
        "SAT": "5",
        "SUN": "6",
    }

    if weekday_field == "*":
        weekday_digits = "0123456"
    else:
        weekday_digits = "".join(
            day_map[day]
            for day in weekday_field.split(",")
            if day in day_map
        )

    if not weekday_digits:
        weekday_digits = "0123456"

    return f"{str(hour).zfill(2)}{str(minute).zfill(2)}-{weekday_digits}-{action}"


async def _async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload config entry when options are updated."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the integration domain."""
    hass.data.setdefault(DOMAIN, {})
    await async_register_websocket_api(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Shelly Schedule Manager from a config entry."""
    store = ShellyScheduleStorage(hass)
    await store.async_load()

    hass.data[DOMAIN][entry.entry_id] = {
        DATA_STORE: store,
        DATA_RUNTIME: {
            "last_sync": None,
        },
    }

    entry.async_on_unload(entry.add_update_listener(_async_reload_entry))

    await async_register_panel(
        hass,
        show_in_sidebar=entry.options.get(CONF_SHOW_IN_SIDEBAR, True),
    )

    _debug_log(entry, "Shelly Schedule Manager setup entry_id=%s", entry.entry_id)

    async def _list_devices_internal() -> list[dict[str, Any]]:
        devices = get_shelly_devices(hass)

        await store.async_update_device_partial(
            "_meta",
            {
                "last_device_scan": utc_now_iso(),
                "device_count": len(devices),
            },
        )

        for device in devices:
            device_id = device["id"]
            ip = get_device_ip(hass, device_id)

            current = store.get_device(device_id) or {}
            await store.async_set_device(
                device_id,
                {
                    "device_id": device_id,
                    "name": device["name"],
                    "model": device["model"],
                    "manufacturer": device["manufacturer"],
                    "identifiers": device["identifiers"],
                    "mac": device.get("mac"),
                    "ip": ip,
                    "schedules": current.get("schedules", []),
                    "last_sync": current.get("last_sync"),
                    "available": ip is not None,
                    "last_error": current.get("last_error"),
                    "generation": current.get("generation"),
                    "schedule_supported": current.get("schedule_supported"),
                    "output_ids": current.get("output_ids", []),
                    "limited_schedule_support": current.get(
                        "limited_schedule_support", False
                    ),
                    "gen1_schedule_state": current.get("gen1_schedule_state"),
                },
            )

        _debug_log(entry, "Discovered %s Shelly devices", len(devices))
        return devices

    async def _sync_device_internal(device_id: str) -> None:
        device = store.get_device(device_id)

        if device is None:
            devices = get_shelly_devices(hass)
            match = next((d for d in devices if d["id"] == device_id), None)
            if match is None:
                raise ValueError(f"Unknown device_id: {device_id}")

            ip = get_device_ip(hass, device_id)
            device = {
                "device_id": device_id,
                "name": match["name"],
                "model": match["model"],
                "manufacturer": match["manufacturer"],
                "identifiers": match["identifiers"],
                "mac": match.get("mac"),
                "ip": ip,
                "schedules": [],
                "last_sync": None,
                "available": ip is not None,
                "last_error": None,
                "generation": None,
                "schedule_supported": None,
                "output_ids": [],
                "limited_schedule_support": False,
                "gen1_schedule_state": None,
            }

        ip = get_device_ip(hass, device_id) or device.get("ip")
        if not ip:
            raise ValueError("IP not found for device")

        client = ShellyClient(hass, ip)

        # Fast path for Gen2
        if device.get("generation") == "gen2plus" and device.get("schedule_supported") is True:
            schedule_service = ShellyScheduleService(client)
            result = await safe_call(schedule_service.list)

            if not result["ok"]:
                await store.async_update_device_partial(
                    device_id,
                    {
                        "ip": ip,
                        "available": False,
                        "last_error": result["error"],
                    },
                )
                return

            config_result = await safe_call(client.get_config)
            output_ids = device.get("output_ids", [0])

            if config_result["ok"]:
                output_ids = extract_output_ids(config_result["result"]) or [0]

            await store.async_set_device(
                device_id,
                {
                    **device,
                    "ip": ip,
                    "available": True,
                    "schedules": result["result"],
                    "output_ids": output_ids,
                    "last_sync": utc_now_iso(),
                    "last_error": None,
                },
            )
            hass.data[DOMAIN][entry.entry_id][DATA_RUNTIME]["last_sync"] = utc_now_iso()
            return

        generation_result = await safe_call(client.detect_generation)
        if not generation_result["ok"]:
            await store.async_update_device_partial(
                device_id,
                {
                    "ip": ip,
                    "available": False,
                    "generation": "unknown",
                    "schedule_supported": False,
                    "last_error": generation_result["error"],
                },
            )
            return

        generation = generation_result["result"]

        if generation == "gen1":
            gen1_service = ShellyGen1ScheduleService(ShellyGen1Client(hass, ip))

            relays_result = await safe_call(gen1_service.list_relays)
            schedules_result = await safe_call(gen1_service.list)

            if not relays_result["ok"] or not schedules_result["ok"]:
                await store.async_set_device(
                    device_id,
                    {
                        **device,
                        "ip": ip,
                        "available": True,
                        "generation": "gen1",
                        "schedule_supported": True,
                        "output_ids": [],
                        "schedules": [],
                        "limited_schedule_support": True,
                        "gen1_schedule_state": None,
                        "last_sync": utc_now_iso(),
                        "last_error": (
                            relays_result.get("error")
                            if not relays_result["ok"]
                            else schedules_result.get("error")
                        ),
                    },
                )
                return

            output_ids = relays_result["result"]
            gen1_state = None
            if output_ids:
                state_result = await safe_call(
                    gen1_service.get_relay_schedule_state, output_ids[0]
                )
                if state_result["ok"]:
                    gen1_state = state_result["result"]

            await store.async_set_device(
                device_id,
                {
                    **device,
                    "ip": ip,
                    "available": True,
                    "generation": "gen1",
                    "schedule_supported": True,
                    "output_ids": output_ids,
                    "schedules": schedules_result["result"],
                    "limited_schedule_support": True,
                    "gen1_schedule_state": gen1_state,
                    "last_sync": utc_now_iso(),
                    "last_error": None,
                },
            )
            return

        if generation != "gen2plus":
            await store.async_update_device_partial(
                device_id,
                {
                    "ip": ip,
                    "available": False,
                    "generation": "unknown",
                    "schedule_supported": False,
                    "last_error": "Could not determine Shelly generation",
                },
            )
            return

        methods_result = await safe_call(client.list_methods)
        if not methods_result["ok"]:
            await store.async_update_device_partial(
                device_id,
                {
                    "ip": ip,
                    "available": False,
                    "generation": "gen2plus",
                    "schedule_supported": False,
                    "last_error": methods_result["error"],
                },
            )
            return

        methods = methods_result["result"]
        if "Schedule.List" not in methods:
            await store.async_set_device(
                device_id,
                {
                    **device,
                    "ip": ip,
                    "available": True,
                    "generation": "gen2plus",
                    "schedule_supported": False,
                    "schedules": [],
                    "output_ids": [],
                    "limited_schedule_support": False,
                    "last_sync": utc_now_iso(),
                    "last_error": None,
                },
            )
            return

        schedule_service = ShellyScheduleService(client)
        result = await safe_call(schedule_service.list)

        if not result["ok"]:
            await store.async_update_device_partial(
                device_id,
                {
                    "ip": ip,
                    "available": False,
                    "generation": "gen2plus",
                    "schedule_supported": True,
                    "last_error": result["error"],
                },
            )
            return

        config_result = await safe_call(client.get_config)
        output_ids = device.get("output_ids", [0])

        if config_result["ok"]:
            output_ids = extract_output_ids(config_result["result"]) or [0]

        await store.async_set_device(
            device_id,
            {
                **device,
                "ip": ip,
                "available": True,
                "generation": "gen2plus",
                "schedule_supported": True,
                "schedules": result["result"],
                "output_ids": output_ids,
                "limited_schedule_support": False,
                "last_sync": utc_now_iso(),
                "last_error": None,
            },
        )

        hass.data[DOMAIN][entry.entry_id][DATA_RUNTIME]["last_sync"] = utc_now_iso()

    async def list_devices(call: ServiceCall) -> None:
        await _list_devices_internal()

    async def sync_device(call: ServiceCall) -> None:
        await _sync_device_internal(call.data["device_id"])

    async def sync_all(call: ServiceCall) -> None:
        await _list_devices_internal()
        data = store.get_data()

        for device_id in data["devices"]:
            if device_id == "_meta":
                continue
            await _sync_device_internal(device_id)

    async def get_schedules(call: ServiceCall) -> None:
        device_id = call.data["device_id"]
        force = call.data.get("force", False)

        if force or store.get_device(device_id) is None:
            await _sync_device_internal(device_id)

    async def create_schedule(call: ServiceCall) -> None:
        device_id = call.data["device_id"]
        timespec = call.data["timespec"]
        method = call.data["method"]
        params = call.data.get("params", {})

        device = store.get_device(device_id)
        if device is None:
            raise ValueError("Unknown device_id")

        ip = device.get("ip") or get_device_ip(hass, device_id)
        if not ip:
            raise ValueError("IP not found for device")

        generation = device.get("generation")

        if generation == "gen2plus":
            if not device.get("schedule_supported"):
                raise ValueError("Schedules are not supported for this device yet")

            schedule_service = ShellyScheduleService(ShellyClient(hass, ip))
            result = await safe_call(schedule_service.create, timespec, method, params)
            if not result["ok"]:
                raise ValueError(result["error"])

        elif generation == "gen1":
            relay_id = int(params.get("id", 0))
            gen1_service = ShellyGen1ScheduleService(ShellyGen1Client(hass, ip))
            raw_rule = build_gen1_raw_rule_from_timespec_and_params(timespec, params)
            result = await safe_call(gen1_service.create_single_rule, relay_id, raw_rule)
            if not result["ok"]:
                raise ValueError(result["error"])

        else:
            raise ValueError("Unsupported device generation")

        await _sync_device_internal(device_id)

    async def update_schedule(call: ServiceCall) -> None:
        device_id = call.data["device_id"]
        job_id = call.data["job_id"]
        changes = call.data.get("changes", {})

        device = store.get_device(device_id)
        if device is None:
            raise ValueError("Unknown device_id")

        ip = device.get("ip") or get_device_ip(hass, device_id)
        if not ip:
            raise ValueError("IP not found for device")

        generation = device.get("generation")

        if generation == "gen2plus":
            if not device.get("schedule_supported"):
                raise ValueError("Schedules are not supported for this device yet")

            schedule_service = ShellyScheduleService(ShellyClient(hass, ip))
            normalized_changes = dict(changes)

            if set(normalized_changes.keys()) == {"enable"}:
                result = await safe_call(
                    schedule_service.update,
                    int(job_id),
                    {"enable": bool(normalized_changes["enable"])},
                )
                if not result["ok"]:
                    raise ValueError(result["error"])
            else:
                allowed = {}
                if "enable" in normalized_changes:
                    allowed["enable"] = bool(normalized_changes["enable"])
                if "timespec" in normalized_changes:
                    allowed["timespec"] = normalized_changes["timespec"]
                if "calls" in normalized_changes:
                    allowed["calls"] = normalized_changes["calls"]

                result = await safe_call(
                    schedule_service.update,
                    int(job_id),
                    allowed,
                )
                if not result["ok"]:
                    raise ValueError(result["error"])

        elif generation == "gen1":
            matched_schedule = next(
                (
                    sched
                    for sched in device.get("schedules", [])
                    if str(sched.get("id")) == str(job_id)
                ),
                None,
            )
            if matched_schedule is None:
                raise ValueError("Gen1 schedule not found")

            relay_id = matched_schedule.get("relay_id")
            if relay_id is None:
                raise ValueError("Gen1 relay id missing")

            calls = changes.get("calls", [])
            params = calls[0].get("params", {}) if calls else matched_schedule.get("params", {})
            timespec = changes.get("timespec", matched_schedule.get("timespec"))
            enable = changes.get("enable", matched_schedule.get("enabled", True))
            raw_rule = build_gen1_raw_rule_from_timespec_and_params(timespec, params)

            gen1_service = ShellyGen1ScheduleService(ShellyGen1Client(hass, ip))
            result = await safe_call(
                gen1_service.update_single_rule,
                relay_id,
                raw_rule,
                enable,
            )
            if not result["ok"]:
                raise ValueError(result["error"])

        else:
            raise ValueError("Unsupported device generation")

        await _sync_device_internal(device_id)

    async def delete_schedule(call: ServiceCall) -> None:
        device_id = call.data["device_id"]
        job_id = call.data["job_id"]

        device = store.get_device(device_id)
        if device is None:
            raise ValueError("Unknown device_id")

        ip = device.get("ip") or get_device_ip(hass, device_id)
        if not ip:
            raise ValueError("IP not found for device")

        generation = device.get("generation")

        if generation == "gen2plus":
            if not device.get("schedule_supported"):
                raise ValueError("Schedules are not supported for this device yet")

            schedule_service = ShellyScheduleService(ShellyClient(hass, ip))
            result = await safe_call(schedule_service.delete, job_id)
            if not result["ok"]:
                raise ValueError(result["error"])

        elif generation == "gen1":
            matched_schedule = next(
                (
                    sched
                    for sched in device.get("schedules", [])
                    if str(sched.get("id")) == str(job_id)
                ),
                None,
            )
            if matched_schedule is None:
                raise ValueError("Gen1 schedule not found")

            relay_id = matched_schedule.get("relay_id")
            if relay_id is None:
                raise ValueError("Gen1 relay id missing")

            gen1_service = ShellyGen1ScheduleService(ShellyGen1Client(hass, ip))
            result = await safe_call(gen1_service.delete_single_rule, relay_id)
            if not result["ok"]:
                raise ValueError(result["error"])

        else:
            raise ValueError("Unsupported device generation")

        await _sync_device_internal(device_id)

    async def set_group(call: ServiceCall) -> None:
        await store.async_set_group(
            call.data["group_name"],
            call.data.get("device_ids", []),
        )

    async def set_gen1_schedule_enabled(call: ServiceCall) -> None:
        device_id = call.data["device_id"]
        enabled = call.data["enabled"]

        device = store.get_device(device_id)
        if device is None:
            raise ValueError("Unknown device_id")

        if device.get("generation") != "gen1":
            raise ValueError("This service is only valid for Gen1 devices")

        ip = device.get("ip") or get_device_ip(hass, device_id)
        if not ip:
            raise ValueError("IP not found for device")

        output_ids = device.get("output_ids", [])
        relay_id = int(output_ids[0]) if output_ids else 0

        gen1_service = ShellyGen1ScheduleService(ShellyGen1Client(hass, ip))
        result = await safe_call(
            gen1_service.set_schedule_enabled,
            relay_id,
            bool(enabled),
        )
        if not result["ok"]:
            raise ValueError(result["error"])

        await _sync_device_internal(device_id)

    hass.services.async_register(DOMAIN, "list_devices", list_devices)
    hass.services.async_register(DOMAIN, "sync_device", sync_device)
    hass.services.async_register(DOMAIN, "sync_all", sync_all)
    hass.services.async_register(DOMAIN, "get_schedules", get_schedules)
    hass.services.async_register(DOMAIN, "create_schedule", create_schedule)
    hass.services.async_register(DOMAIN, "update_schedule", update_schedule)
    hass.services.async_register(DOMAIN, "delete_schedule", delete_schedule)
    hass.services.async_register(DOMAIN, "set_group", set_group)
    hass.services.async_register(
        DOMAIN, "set_gen1_schedule_enabled", set_gen1_schedule_enabled
    )

    _LOGGER.info("Shelly Schedule Manager loaded with storage backend")
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload config entry."""
    hass.data[DOMAIN].pop(entry.entry_id, None)
    return True
