from __future__ import annotations

from aiohttp import ClientResponseError
from homeassistant.helpers.aiohttp_client import async_get_clientsession


class ShellyClient:
    """Minimal Shelly client with Gen2+/RPC support detection."""

    def __init__(self, hass, ip: str) -> None:
        self.hass = hass
        self.ip = ip
        self.base = f"http://{ip}/rpc"

    async def call(self, method: str, params: dict | None = None) -> dict:
        """Call a Shelly Gen2+/Gen3 RPC method."""
        url = f"{self.base}/{method}"
        session = async_get_clientsession(self.hass)

        async with session.post(url, json=params or {}) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def list_methods(self) -> list[str]:
        result = await self.call("Shelly.ListMethods")
        methods = result.get("methods", [])
        return methods if isinstance(methods, list) else []

    async def detect_generation(self) -> str:
        try:
            await self.list_methods()
            return "gen2plus"
        except ClientResponseError as err:
            if err.status == 404:
                return "gen1"
            return "unknown"
        except Exception:
            return "unknown"

    async def get_config(self) -> dict:
        return await self.call("Shelly.GetConfig")