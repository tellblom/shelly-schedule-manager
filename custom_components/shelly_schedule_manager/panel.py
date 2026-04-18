from __future__ import annotations

import os
from pathlib import Path

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import DOMAIN

PANEL_URL_PATH = "shelly-schedule-manager"
PANEL_TITLE = "Shelly Schedule Manager"
PANEL_ICON = "mdi:calendar-clock"
PANEL_COMPONENT_NAME = "custom"
PANEL_TAG = "shelly-schedule-manager-panel"
STATIC_URL = f"/api/{DOMAIN}/static"
MODULE_URL = f"{STATIC_URL}/panel.js"


async def async_register_panel(hass: HomeAssistant, show_in_sidebar: bool) -> None:
    """Register static files and sidebar panel."""
    static_dir = Path(__file__).parent / "frontend"
    panel_js = static_dir / "panel.js"

    if not panel_js.is_file():
        raise FileNotFoundError(f"Panel JS not found: {panel_js}")

    mtime = await hass.async_add_executor_job(lambda: int(os.path.getmtime(panel_js)))

    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                STATIC_URL,
                str(static_dir),
                cache_headers=False,
            )
        ]
    )

    # Avoid duplicate registration on reloads
    if PANEL_URL_PATH in hass.data.get("frontend_panels", {}):
        return

    frontend.async_register_built_in_panel(
        hass,
        component_name=PANEL_COMPONENT_NAME,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        frontend_url_path=PANEL_URL_PATH,
        config={
            "_panel_custom": {
                "name": PANEL_TAG,
                "js_url": f"{MODULE_URL}?v={mtime}",
                "embed_iframe": False,
                "trust_external": False,
            }
        },
        require_admin=False,
        update=False,
    )