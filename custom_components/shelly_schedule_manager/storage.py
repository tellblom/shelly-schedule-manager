from __future__ import annotations

from copy import deepcopy
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DEFAULT_GROUP, STORAGE_KEY, STORAGE_VERSION


def _default_data() -> dict[str, Any]:
    return {
        "devices": {},
        "groups": {
            DEFAULT_GROUP: []
        }
    }


class ShellyScheduleStorage:
    """Persistent storage for Shelly Schedule Manager."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.data: dict[str, Any] = _default_data()

    async def async_load(self) -> dict[str, Any]:
        stored = await self._store.async_load()
        if stored is None:
            self.data = _default_data()
        else:
            self.data = stored
            self.data.setdefault("devices", {})
            self.data.setdefault("groups", {DEFAULT_GROUP: []})
        return self.data

    async def async_save(self) -> None:
        await self._store.async_save(self.data)

    def get_data(self) -> dict[str, Any]:
        return deepcopy(self.data)

    def get_device(self, device_id: str) -> dict[str, Any] | None:
        return self.data["devices"].get(device_id)

    async def async_set_device(
        self,
        device_id: str,
        payload: dict[str, Any],
    ) -> None:
        self.data["devices"][device_id] = payload
        await self.async_save()

    async def async_update_device_partial(
        self,
        device_id: str,
        patch: dict[str, Any],
    ) -> None:
        current = self.data["devices"].get(device_id, {})
        current.update(patch)
        self.data["devices"][device_id] = current
        await self.async_save()

    async def async_remove_device(self, device_id: str) -> None:
        self.data["devices"].pop(device_id, None)

        for members in self.data["groups"].values():
            if device_id in members:
                members.remove(device_id)

        await self.async_save()

    async def async_set_group(self, group_name: str, device_ids: list[str]) -> None:
        self.data["groups"][group_name] = sorted(set(device_ids))
        await self.async_save()

    async def async_add_device_to_group(self, group_name: str, device_id: str) -> None:
        self.data["groups"].setdefault(group_name, [])
        if device_id not in self.data["groups"][group_name]:
            self.data["groups"][group_name].append(device_id)
        await self.async_save()

    async def async_remove_device_from_group(self, group_name: str, device_id: str) -> None:
        members = self.data["groups"].get(group_name, [])
        if device_id in members:
            members.remove(device_id)
        await self.async_save()