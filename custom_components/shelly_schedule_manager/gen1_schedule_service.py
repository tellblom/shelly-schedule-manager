from __future__ import annotations

from .gen1_client import ShellyGen1Client


def build_panel_timespec_from_raw_rule(rule: str) -> str:
    """
    Convert raw Gen1 rules into a pseudo-timespec for the UI.

    We intentionally keep the weekday digits as raw trailing field if we cannot
    safely map them. The panel can still display time and raw rule separately.
    """
    parts = rule.split("-")
    if len(parts) != 3:
        return "0 00 08 * * *"

    hhmm, weekday_digits, _action = parts
    hour = hhmm[:2]
    minute = hhmm[2:4]
    return f"0 {minute} {hour} * * {weekday_digits}"


def parse_gen1_rule(rule: str, relay_id: int, index: int, enabled: bool) -> dict:
    parts = rule.split("-")
    action = "unknown"
    hour = "08"
    minute = "00"
    weekday_digits = "*"

    if len(parts) == 3:
        hhmm, weekday_digits, action = parts
        hour = hhmm[:2]
        minute = hhmm[2:4]

    return {
        "id": f"gen1-{relay_id}-{index}",
        "enabled": enabled,
        "timespec": build_panel_timespec_from_raw_rule(rule),
        "calls": [
            {
                "method": "switch.set",
                "params": {
                    "id": relay_id,
                    "on": action == "on",
                },
            }
        ],
        "method": "switch.set",
        "params": {
            "id": relay_id,
            "on": action == "on",
        },
        "generation": "gen1",
        "relay_id": relay_id,
        "raw_rule": rule,
        "hour": hour,
        "minute": minute,
        "weekday_digits": weekday_digits,
        "action": action,
    }


class ShellyGen1ScheduleService:
    """Safe-mode schedule handling for relay-based Gen1 devices."""

    def __init__(self, client: ShellyGen1Client) -> None:
        self.client = client

    async def list_relays(self) -> list[int]:
        settings = await self.client.get_settings()
        relays = settings.get("relays", [])
        return list(range(len(relays)))

    async def get_relay_schedule_state(self, relay_id: int) -> dict:
        relay = await self.client.get_relay_settings(relay_id)
        rules = relay.get("schedule_rules", []) or []
        enabled = bool(relay.get("schedule", False))

        return {
            "relay_id": relay_id,
            "schedule_enabled": enabled,
            "schedule_rules": rules,
            "rule_count": len(rules),
        }

    async def list(self) -> list[dict]:
        relay_ids = await self.list_relays()
        normalized: list[dict] = []

        for relay_id in relay_ids:
            relay = await self.client.get_relay_settings(relay_id)
            enabled = bool(relay.get("schedule", False))
            rules = relay.get("schedule_rules", []) or []

            for index, rule in enumerate(rules):
                normalized.append(
                    parse_gen1_rule(
                        rule=rule,
                        relay_id=relay_id,
                        index=index,
                        enabled=enabled,
                    )
                )

        return normalized

    async def set_schedule_enabled(self, relay_id: int, enabled: bool) -> dict:
        relay = await self.client.get_relay_settings(relay_id)
        rules = relay.get("schedule_rules", []) or []

        await self.client.update_relay_settings(
            relay_id=relay_id,
            schedule_enabled=enabled,
            schedule_rules=rules,
        )

        verify = await self.client.get_relay_settings(relay_id)
        return {"ok": True, "verify": verify}

    async def create_single_rule(
        self,
        relay_id: int,
        raw_rule: str,
    ) -> dict:
        relay = await self.client.get_relay_settings(relay_id)
        rules = list(relay.get("schedule_rules", []) or [])

        if rules:
            raise ValueError(
                "Gen1 limited mode: creating a new schedule is only supported when no existing relay rules are present."
            )

        await self.client.update_relay_settings(
            relay_id=relay_id,
            schedule_enabled=True,
            schedule_rules=[raw_rule],
        )

        verify = await self.client.get_relay_settings(relay_id)
        return {"ok": True, "verify": verify}

    async def update_single_rule(
        self,
        relay_id: int,
        raw_rule: str,
        enabled: bool | None = None,
    ) -> dict:
        relay = await self.client.get_relay_settings(relay_id)
        rules = list(relay.get("schedule_rules", []) or [])

        if len(rules) != 1:
            raise ValueError(
                "Gen1 limited mode: editing is only supported when exactly one relay rule exists."
            )

        current_enabled = bool(relay.get("schedule", False))
        schedule_enabled = current_enabled if enabled is None else bool(enabled)

        await self.client.update_relay_settings(
            relay_id=relay_id,
            schedule_enabled=schedule_enabled,
            schedule_rules=[raw_rule],
        )

        verify = await self.client.get_relay_settings(relay_id)
        return {"ok": True, "verify": verify}

    async def delete_single_rule(self, relay_id: int) -> dict:
        relay = await self.client.get_relay_settings(relay_id)
        rules = list(relay.get("schedule_rules", []) or [])

        if len(rules) != 1:
            raise ValueError(
                "Gen1 limited mode: deleting is only supported when exactly one relay rule exists."
            )

        await self.client.update_relay_settings(
            relay_id=relay_id,
            schedule_enabled=False,
            schedule_rules=[],
        )

        verify = await self.client.get_relay_settings(relay_id)
        return {"ok": True, "verify": verify}