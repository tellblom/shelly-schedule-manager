from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback

from .const import (
    CONF_DEBUG_LOGGING,
    CONF_SHOW_IN_SIDEBAR,
    DEFAULT_DEBUG_LOGGING,
    DEFAULT_SHOW_IN_SIDEBAR,
    DOMAIN,
)


class ShellyScheduleManagerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Config flow for Shelly Schedule Manager."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Handle the initial step."""

        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(
                title="Shelly Schedule Manager",
                data={},
                options={
                    CONF_DEBUG_LOGGING: DEFAULT_DEBUG_LOGGING,
                    CONF_SHOW_IN_SIDEBAR: DEFAULT_SHOW_IN_SIDEBAR,
                },
            )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({}),
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return ShellyScheduleManagerOptionsFlow()


class ShellyScheduleManagerOptionsFlow(config_entries.OptionsFlow):
    """Handle options flow for Shelly Schedule Manager."""

    async def async_step_init(self, user_input=None):
        """Manage the options."""

        current_debug = self.config_entry.options.get(
            CONF_DEBUG_LOGGING,
            DEFAULT_DEBUG_LOGGING,
        )
        current_sidebar = self.config_entry.options.get(
            CONF_SHOW_IN_SIDEBAR,
            DEFAULT_SHOW_IN_SIDEBAR,
        )

        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        schema = vol.Schema(
            {
                vol.Required(
                    CONF_DEBUG_LOGGING,
                    default=current_debug,
                ): bool,
                vol.Required(
                    CONF_SHOW_IN_SIDEBAR,
                    default=current_sidebar,
                ): bool,
            }
        )

        return self.async_show_form(
            step_id="init",
            data_schema=schema,
        )