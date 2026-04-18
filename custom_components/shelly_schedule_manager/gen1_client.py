from __future__ import annotations

import asyncio

from homeassistant.helpers.aiohttp_client import async_get_clientsession


class ShellyGen1Client:
    """Minimal Shelly Gen1 HTTP client."""

    def __init__(self, hass, ip: str) -> None:
        self.hass = hass
        self.ip = ip
        self.base = f"http://{ip}"

    async def get(self, path: str, params: list[tuple[str, str]] | None = None) -> dict:
        session = async_get_clientsession(self.hass)
        url = f"{self.base}{path}"

        async def _do_request():
            async with session.get(url, params=params) as resp:
                resp.raise_for_status()
                return await resp.json()

        return await asyncio.wait_for(_do_request(), timeout=10)

    async def get_settings(self) -> dict:
        return await self.get("/settings")

    async def get_relay_settings(self, relay_id: int) -> dict:
        return await self.get(f"/settings/relay/{relay_id}")

    async def update_relay_settings(
        self,
        relay_id: int,
        schedule_enabled: bool,
        schedule_rules: list[str],
    ) -> dict:
        params: list[tuple[str, str]] = [
            ("schedule", "true" if schedule_enabled else "false"),
        ]

        if schedule_rules:
            for rule in schedule_rules:
                params.append(("schedule_rules", rule))
        else:
            params.append(("schedule_rules", ""))

        return await self.get(f"/settings/relay/{relay_id}", params=params)