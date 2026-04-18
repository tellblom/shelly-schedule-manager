from __future__ import annotations

from .shelly_client import ShellyClient


def normalize_job(job: dict) -> dict:
    """Normalize a Shelly schedule job."""
    calls = job.get("calls", [])
    first_call = calls[0] if calls else {}

    return {
        "id": job.get("id"),
        "enabled": job.get("enable"),
        "timespec": job.get("timespec"),
        "calls": calls,
        "method": first_call.get("method"),
        "params": first_call.get("params", {}),
    }


class ShellyScheduleService:
    """CRUD wrapper for Shelly Gen2+/Gen3/Gen4 schedules."""

    def __init__(self, client: ShellyClient) -> None:
        self.client = client

    async def list(self) -> list[dict]:
        """List schedules from the Shelly device."""
        result = await self.client.call("Schedule.List")
        return [normalize_job(job) for job in result.get("jobs", [])]

    async def create(self, timespec: str, method: str, params: dict) -> dict:
        """Create a new schedule."""
        payload = {
            "enable": True,
            "timespec": timespec,
            "calls": [
                {
                    "method": str(method).lower(),
                    "params": params,
                }
            ],
        }
        return await self.client.call("Schedule.Create", payload)

    async def update(self, job_id: int | str, changes: dict) -> dict:
        """
        Update an existing schedule.

        For Gen2+ devices, Schedule.Update is happiest with a minimal payload.
        So we only send fields that are explicitly being changed.
        """
        payload: dict = {"id": int(job_id)}

        # Minimal payload for pure enable/disable
        if "enable" in changes and len(changes) == 1:
            payload["enable"] = bool(changes["enable"])
            return await self.client.call("Schedule.Update", payload)

        if "timespec" in changes:
            payload["timespec"] = changes["timespec"]

        if "enable" in changes:
            payload["enable"] = bool(changes["enable"])

        if "calls" in changes:
            normalized_calls = []
            for call in changes["calls"]:
                normalized_calls.append(
                    {
                        **call,
                        "method": str(call.get("method", "")).lower(),
                    }
                )
            payload["calls"] = normalized_calls

        return await self.client.call("Schedule.Update", payload)

    async def delete(self, job_id: int | str) -> dict:
        """Delete a schedule."""
        return await self.client.call("Schedule.Delete", {"id": int(job_id)})