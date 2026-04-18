
class ShellyScheduleManagerPanel extends HTMLElement {
  constructor() {
    super();
    this._translations = {};
    this.attachShadow({ mode: "open" });

    this._hass = null;
    this._devices = [];
    this._selectedDevice = null;
    this._options = {
      debug_logging: false,
      show_in_sidebar: true,
    };

    this._sortBy = "name";

    this._error = null;
    this._syncingAll = false;
    this._syncingDevice = false;
    this._creating = false;
    this._deletingJobId = null;
    this._togglingJobId = null;
    this._savingJobId = null;
    this._updatingOptions = false;

    this._editingScheduleId = null;

    this._createForm = this._defaultScheduleForm();
    this._editForm = this._defaultScheduleForm();
  }

  _t(key, vars = {}) {
    return translate(this._hass, key, vars);
  }

  _defaultScheduleForm() {
    return {
      second: "0",
      minute: "0",
      hour: "8",
      dayOfMonth: "*",
      month: "*",
      weekdays: ["MON", "TUE", "WED", "THU", "FRI"],
      outputId: "0",
      on: true,
      toggleAfter: "",
      enabled: true,
    };
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
    this._initialize();
  }

  set narrow(narrow) {
    this._narrow = narrow;
  }

  set route(route) {
    this._route = route;
  }

  set panel(panel) {
    this._panel = panel;
  }

  async _initialize() {
    if (!this._hass || this._initialized) return;
    this._initialized = true;
    await this._loadTranslations();
    await this._loadOptions();
    await this._loadDevices();
  }


  async _loadTranslations() {
    try {
      const mod = await import("./i18n.js");
      this._translations = await mod.loadTranslations(this._hass);
    } catch (err) {
      console.error("Could not load translations", err);
      this._translations = {};
    }
  }

  _t(key, vars = {}) {
    let text = this._translations[key] || key;

    for (const [name, value] of Object.entries(vars)) {
      text = text.replace(`{${name}}`, value);
    }

    return text;
  }
  async _loadOptions() {
    try {
      this._options = await this._hass.callWS({
        type: "shelly_schedule_manager/get_options",
      });
    } catch (err) {
      this._error = `${this._t("could_not_load_options")}: ${err}`;
    }
    this._render();
  }

  _sortedDevices(devices) {
    const list = [...devices];

    list.sort((a, b) => {
      if (this._sortBy === "mac") {
        return String(a.mac || "").localeCompare(String(b.mac || ""));
      }

      if (this._sortBy === "type") {
        return String(a.model || "").localeCompare(String(b.model || ""));
      }

      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    return list;
  }

  async _loadDevices() {
    try {
      const result = await this._hass.callWS({
        type: "shelly_schedule_manager/list_devices",
      });

      this._devices = this._sortedDevices(result.devices || []);

      if (
        this._selectedDevice &&
        !this._devices.find((d) => d.device_id === this._selectedDevice.device_id)
      ) {
        this._selectedDevice = null;
      }

      if (!this._selectedDevice && this._devices.length > 0) {
        this._selectedDevice = this._devices[0];
      }

      if (this._selectedDevice?.device_id) {
        await this._selectDevice(this._selectedDevice.device_id, false);
      }
    } catch (err) {
      this._error = `${this._t("could_not_load_devices")}: ${err}`;
    } finally {
      this._render();
    }
  }

  async _selectDevice(deviceId, rerender = true) {
    try {
      const result = await this._hass.callWS({
        type: "shelly_schedule_manager/get_device",
        device_id: deviceId,
      });

      this._selectedDevice = result.device;

      if (this._selectedDevice && !this._createForm.outputId) {
        const ids = this._getOutputIds(this._selectedDevice);
        this._createForm.outputId = String(ids[0] ?? 0);
      }
    } catch (err) {
      this._error = `${this._t("could_not_load_device")}: ${err}`;
    } finally {
      if (rerender) {
        this._render();
      }
    }
  }

  async _refreshSelectedDeviceAndList() {
    if (this._selectedDevice?.device_id) {
      await this._selectDevice(this._selectedDevice.device_id, false);
    }

    const result = await this._hass.callWS({
      type: "shelly_schedule_manager/list_devices",
    });

    this._devices = this._sortedDevices(result.devices || []);

    if (
      this._selectedDevice &&
      !this._devices.find((d) => d.device_id === this._selectedDevice.device_id)
    ) {
      this._selectedDevice = null;
    }

    if (this._selectedDevice?.device_id) {
      await this._selectDevice(this._selectedDevice.device_id, false);
    }
  }

  async _toggleDebugLogging() {
    this._updatingOptions = true;
    this._error = null;
    this._render();

    try {
      const next = !this._options.debug_logging;

      const result = await this._hass.callWS({
        type: "shelly_schedule_manager/set_options",
        debug_logging: next,
        show_in_sidebar: !!this._options.show_in_sidebar,
      });

      this._options = result;
    } catch (err) {
      this._error = `${this._t("could_not_update_options")}: ${err}`;
    } finally {
      this._updatingOptions = false;
      this._render();
    }
  }

  _getOutputIds(device) {
    if (Array.isArray(device?.output_ids) && device.output_ids.length) {
      return device.output_ids;
    }

    const ids = new Set();
    for (const sched of device?.schedules || []) {
      const maybeId = sched?.params?.id;
      if (Number.isInteger(maybeId)) {
        ids.add(maybeId);
      }
    }

    return ids.size ? [...ids].sort((a, b) => a - b) : [0];
  }

  _scheduleToForm(job) {
    const calls = Array.isArray(job.calls) ? job.calls : [];
    const firstCall = calls[0] || {};
    const params = firstCall.params || {};

    const raw = String(job.timespec || "0 0 8 * * MON,TUE,WED,THU,FRI").trim();
    const parts = raw.split(/\s+/);

    const [
      second = "0",
      minute = "0",
      hour = "8",
      dayOfMonth = "*",
      month = "*",
      weekdaysRaw = "*",
    ] = parts;

    const weekdays =
      weekdaysRaw === "*" || !weekdaysRaw
        ? ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
        : weekdaysRaw.split(",");

    return {
      second,
      minute,
      hour,
      dayOfMonth,
      month,
      weekdays,
      outputId: String(params.id ?? 0),
      on: Boolean(params.on),
      toggleAfter:
        params.toggle_after === undefined || params.toggle_after === null
          ? ""
          : String(params.toggle_after),
      enabled: !!job.enabled,
    };
  }

  _formatWeekdays(days) {
    const order = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
    const labels = {
      MON: "Mon",
      TUE: "Tue",
      WED: "Wed",
      THU: "Thu",
      FRI: "Fri",
      SAT: "Sat",
      SUN: "Sun",
    };

    if (!days || !days.length || days.length === 7) {
      return this._t("every_day");
    }

    const normalized = order.filter((d) => days.includes(d));
    return normalized.map((d) => labels[d]).join(", ");
  }

  _formatMonth(value) {
    if (value === "*" || value === undefined || value === null || value === "") {
      return this._t("every_month");
    }
    return this._t("month_label", { value });
  }

  _formatDayOfMonth(value) {
    if (value === "*" || value === undefined || value === null || value === "") {
      return this._t("every_day");
    }
    return this._t("day_label", { value });
  }

  _formatScheduleSummary(job) {
    const form = this._scheduleToForm(job);

    const hh = String(form.hour).padStart(2, "0");
    const mm = String(form.minute).padStart(2, "0");
    const ss = String(form.second).padStart(2, "0");

    return {
      time: `${hh}:${mm}:${ss}`,
      weekdays: this._formatWeekdays(form.weekdays),
      dayOfMonth: this._formatDayOfMonth(form.dayOfMonth),
      month: this._formatMonth(form.month),
      outputId: form.outputId,
      action: form.on ? this._t("on") : this._t("off"),
      toggleAfter:
        form.toggleAfter !== "" ? `${form.toggleAfter} sec` : "-",
      enabled: form.enabled,
    };
  }

   _formToPayload(form) {
    const weekdays =
      form.weekdays && form.weekdays.length ? form.weekdays.join(",") : "*";

    const timespec = `${form.second} ${form.minute} ${form.hour} ${form.dayOfMonth} ${form.month} ${weekdays}`;

    const params = {
      id: Number(form.outputId),
      on: !!form.on,
    };

    if (form.toggleAfter !== "" && form.toggleAfter !== null) {
      params.toggle_after = Number(form.toggleAfter);
    }

    return {
      enable: !!form.enabled,
      timespec,
      calls: [
        {
          method: "switch.set",
          params,
        },
      ],
    };
  }

  _updateFormField(target, field, value) {
    target[field] = value;
  }

  _toggleWeekday(target, day) {
    const set = new Set(target.weekdays || []);
    if (set.has(day)) {
      set.delete(day);
    } else {
      set.add(day);
    }

    const order = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
    target.weekdays = order.filter((d) => set.has(d));
  }

  async _syncAll() {
    this._syncingAll = true;
    this._error = null;
    this._render();

    try {
      await this._hass.callService("shelly_schedule_manager", "sync_all", {});
      await this._refreshSelectedDeviceAndList();
    } catch (err) {
      this._error = `${this._t("sync_failed")}: ${err.message || err}`;
    } finally {
      this._syncingAll = false;
      this._render();
    }
  }

  async _syncSelectedDevice() {
    if (!this._selectedDevice?.device_id) return;

    this._syncingDevice = true;
    this._error = null;
    this._render();

    try {
      await this._hass.callService("shelly_schedule_manager", "sync_device", {
        device_id: this._selectedDevice.device_id,
      });

      await this._refreshSelectedDeviceAndList();
    } catch (err) {
      this._error = `${this._t("device_sync_failed")}: ${err.message || err}`;
    } finally {
      this._syncingDevice = false;
      this._render();
    }
  }

  async _createSchedule() {
    if (!this._selectedDevice?.device_id) return;

    this._creating = true;
    this._error = null;
    this._render();

    try {
      const payload = this._formToPayload(this._createForm);

      await this._hass.callService("shelly_schedule_manager", "create_schedule", {
        device_id: this._selectedDevice.device_id,
        timespec: payload.timespec,
        method: payload.calls[0].method,
        params: payload.calls[0].params,
      });

      const defaultId = this._getOutputIds(this._selectedDevice)[0] ?? 0;
      this._createForm = {
        ...this._defaultScheduleForm(),
        outputId: String(defaultId),
      };

      await this._refreshSelectedDeviceAndList();
    } catch (err) {
      this._error = `${this._t("create_failed")}: ${err.message || err}`;
    } finally {
      this._creating = false;
      this._render();
    }
  }
  async _setGen1ScheduleEnabled(enabled) {
    if (!this._selectedDevice?.device_id) return;

    this._syncingDevice = true;
    this._error = null;
    this._render();

    try {
      await this._hass.callService("shelly_schedule_manager", "set_gen1_schedule_enabled", {
        device_id: this._selectedDevice.device_id,
        enabled,
      });

      await this._refreshSelectedDeviceAndList();
    } catch (err) {
      this._error = `Gen1 schedule state update failed: ${err.message || err}`;
    } finally {
      this._syncingDevice = false;
      this._render();
    }
  }
  async _deleteSchedule(jobId) {
    if (!this._selectedDevice?.device_id) return;
    if (!confirm(this._t("delete_confirm", { id: jobId }))) return;

    this._deletingJobId = jobId;
    this._error = null;
    this._render();

    try {
      await this._hass.callService("shelly_schedule_manager", "delete_schedule", {
        device_id: this._selectedDevice.device_id,
        job_id: jobId,
      });

      if (this._editingScheduleId === jobId) {
        this._editingScheduleId = null;
      }

      await this._refreshSelectedDeviceAndList();
    } catch (err) {
      this._error = `${this._t("delete_failed")}: ${err.message || err}`;
    } finally {
      this._deletingJobId = null;
      this._render();
    }
  }

  async _toggleSchedule(job) {
    if (!this._selectedDevice?.device_id) return;

    this._togglingJobId = job.id;
    this._error = null;
    this._render();

    try {
      await this._hass.callService("shelly_schedule_manager", "update_schedule", {
        device_id: this._selectedDevice.device_id,
        job_id: job.id,
        changes: {
          enable: !job.enabled,
        },
      });

      await this._hass.callService("shelly_schedule_manager", "sync_device", {
        device_id: this._selectedDevice.device_id,
      });

      await this._refreshSelectedDeviceAndList();
    } catch (err) {
      this._error = `${this._t("toggle_failed")}: ${err.message || err}`;
    } finally {
      this._togglingJobId = null;
      this._render();
    }
  }

  _startEdit(job) {
    this._editingScheduleId = job.id;
    this._editForm = this._scheduleToForm(job);
    this._render();
  }

  _cancelEdit() {
    this._editingScheduleId = null;
    this._render();
  }

  async _saveEdit(jobId) {
    if (!this._selectedDevice?.device_id) return;

    this._savingJobId = jobId;
    this._error = null;
    this._render();

    try {
      const payload = this._formToPayload(this._editForm);

      await this._hass.callService("shelly_schedule_manager", "update_schedule", {
        device_id: this._selectedDevice.device_id,
        job_id: jobId,
        changes: payload,
      });

      this._editingScheduleId = null;
      await this._refreshSelectedDeviceAndList();
    } catch (err) {
      this._error = `${this._t("edit_failed")}: ${err.message || err}`;
    } finally {
      this._savingJobId = null;
      this._render();
    }
  }

  _escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  _renderDeviceList() {
    if (!this._devices.length) {
      return `<div class="empty">${this._t("no_devices")}</div>`;
    }

    return this._devices
      .map((device) => {
        const selected =
          this._selectedDevice?.device_id === device.device_id ? "selected" : "";
        const badge = device.schedule_supported
          ? this._t("schedules")
          : device.generation === "gen1"
          ? this._t("gen1")
          : this._t("no_schedule");

        return `
          <button class="device ${selected}" data-device-id="${device.device_id}">
            <div class="device-name">${this._escapeHtml(device.name || device.device_id)}</div>
            <div class="device-meta">${this._escapeHtml(device.model || "")}</div>
            <div class="device-submeta">${this._t("mac")}: ${this._escapeHtml(device.mac || "-")}</div>
            <div class="device-badge">${badge}</div>
          </button>
        `;
      })
      .join("");
  }

  _renderWeekdaySelector(targetName, form) {
    const days = [
      ["MON", "M"],
      ["TUE", "T"],
      ["WED", "W"],
      ["THU", "T"],
      ["FRI", "F"],
      ["SAT", "S"],
      ["SUN", "S"],
    ];

    return `
      <div class="weekday-row">
        ${days
          .map(
            ([value, label]) => `
          <button
            type="button"
            class="weekday ${form.weekdays.includes(value) ? "active" : ""}"
            data-weekday-target="${targetName}"
            data-weekday-value="${value}">
            ${label}
          </button>
        `
          )
          .join("")}
      </div>
    `;
  }

  _renderTimeDropdown(id, current, max) {
    const values = [];
    for (let i = 0; i <= max; i += 1) {
      const value = String(i);
      values.push(
        `<option value="${value}" ${value === String(current) ? "selected" : ""}>${value.padStart(2, "0")}</option>`
      );
    }
    return `<select id="${id}">${values.join("")}</select>`;
  }

  _renderMonthDropdown(id, current) {
    const opts = [
      ["*", this._t("every_month")],
      ...Array.from({ length: 12 }, (_, i) => [String(i + 1), String(i + 1).padStart(2, "0")]),
    ];
    return `
      <select id="${id}">
        ${opts
          .map(
            ([value, label]) =>
              `<option value="${value}" ${value === String(current) ? "selected" : ""}>${label}</option>`
          )
          .join("")}
      </select>
    `;
  }

  _renderDayOfMonthDropdown(id, current) {
    const opts = [
      ["*", this._t("every_day")],
      ...Array.from({ length: 31 }, (_, i) => [String(i + 1), String(i + 1)]),
    ];
    return `
      <select id="${id}">
        ${opts
          .map(
            ([value, label]) =>
              `<option value="${value}" ${value === String(current) ? "selected" : ""}>${label}</option>`
          )
          .join("")}
      </select>
    `;
  }

  _renderOutputDropdown(id, current) {
    const ids = this._getOutputIds(this._selectedDevice);
    return `
      <select id="${id}">
        ${ids
          .map(
            (value) =>
              `<option value="${value}" ${String(value) === String(current) ? "selected" : ""}>${this._t("port_label", { value })}</option>`
          )
          .join("")}
      </select>
    `;
  }

  _renderOnOffRadio(prefix, form) {
    return `
      <div class="radio-row">
        <label>
          <input type="radio" name="${prefix}-onoff" value="on" ${
            form.on ? "checked" : ""
          } data-radio-target="${prefix}" data-radio-value="on">
          <span>${this._t("on")}</span>
        </label>
        <label>
          <input type="radio" name="${prefix}-onoff" value="off" ${
            !form.on ? "checked" : ""
          } data-radio-target="${prefix}" data-radio-value="off">
          <span>${this._t("off")}</span>
        </label>
      </div>
    `;
  }

  _renderScheduleBuilder(form, prefix) {
    return `
      <div class="builder-grid">
        <label>
          <span>${this._t("hour")}</span>
          ${this._renderTimeDropdown(`${prefix}-hour`, form.hour, 23)}
        </label>
        <label>
          <span>${this._t("minute")}</span>
          ${this._renderTimeDropdown(`${prefix}-minute`, form.minute, 59)}
        </label>
        <label>
          <span>${this._t("second")}</span>
          ${this._renderTimeDropdown(`${prefix}-second`, form.second, 59)}
        </label>
        <label>
          <span>${this._t("day_of_month")}</span>
          ${this._renderDayOfMonthDropdown(`${prefix}-dom`, form.dayOfMonth)}
        </label>
        <label>
          <span>${this._t("month")}</span>
          ${this._renderMonthDropdown(`${prefix}-month`, form.month)}
        </label>
        <label>
          <span>${this._t("port")}</span>
          ${this._renderOutputDropdown(`${prefix}-output`, form.outputId)}
        </label>
      </div>

      <div class="builder-section">
        <span class="section-title">${this._t("weekdays")}</span>
        ${this._renderWeekdaySelector(prefix, form)}
      </div>

      <div class="builder-section">
        <span class="section-title">${this._t("action")}</span>
        ${this._renderOnOffRadio(prefix, form)}
      </div>

      <div class="builder-grid single-line">
        <label>
          <span>${this._t("toggle_after")}</span>
          <input id="${prefix}-toggleAfter" type="number" min="0" step="1" value="${this._escapeHtml(
            form.toggleAfter
          )}" placeholder="Optional" />
        </label>
      </div>

      ${
        prefix === "edit"
          ? `
          <div class="builder-section">
            <label class="checkbox-line">
              <input id="edit-enabled" type="checkbox" ${form.enabled ? "checked" : ""} />
              <span>${this._t("enabled")}</span>
            </label>
          </div>
        `
          : ""
      }
    `;
  }

  _renderCreateForm() {
    if (!this._selectedDevice?.schedule_supported) {
      return `
        <div class="details-card">
          <h3>${this._t("create_schedule")}</h3>
          <div class="empty">${this._t("create_not_supported")}</div>
        </div>
      `;
    }

    const isGen1 = this._selectedDevice?.generation === "gen1";
    const ruleCount = this._selectedDevice?.gen1_schedule_state?.rule_count || 0;
    const canCreate = !isGen1 || ruleCount === 0;

    return `
      <div class="details-card">
        <h3>${this._t("create_schedule")}</h3>

        ${
          isGen1
            ? `
              <div class="info-box">
                <strong>${this._t("gen1_limited_title")}</strong><br>
                ${this._t("gen1_limited_text")}
                ${
                  this._selectedDevice?.ip
                    ? `
                      <div class="info-link-row">
                        <a
                          href="http://${this._escapeHtml(this._selectedDevice.ip)}"
                          target="_blank"
                          rel="noreferrer">
                          ${this._t("open_device_web")}
                        </a>
                      </div>
                    `
                    : ""
                }
              </div>
            `
            : ""
        }

        ${this._renderScheduleBuilder(this._createForm, "create")}

        <div class="actions">
          <button id="create-schedule" ${this._creating || !canCreate ? "disabled" : ""}>
            ${this._creating ? this._t("creating") : this._t("create")}
          </button>
        </div>
      </div>
    `;
  }

  _renderEditScheduleRow(job) {
    return `
      <tr class="schedule-edit-row">
        <td colspan="7">
          <div class="schedule-edit-box">
            ${this._renderScheduleBuilder(this._editForm, "edit")}

            <div class="actions">
              <button class="save-edit" data-job-id="${job.id}" ${
                this._savingJobId === job.id ? "disabled" : ""
              }>
                ${this._savingJobId === job.id ? this._t("saving") : this._t("save")}
              </button>
              <button class="cancel-edit" data-job-id="${job.id}" ${
                this._savingJobId === job.id ? "disabled" : ""
              }>
                ${this._t("cancel")}
              </button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  _renderScheduleRow(job) {
    const pretty = this._formatScheduleSummary(job);
    const isEditing = this._editingScheduleId === job.id;
    const isGen1 = this._selectedDevice?.generation === "gen1";
    const limited = !!this._selectedDevice?.limited_schedule_support;
    const ruleCount = this._selectedDevice?.gen1_schedule_state?.rule_count || 0;
    const gen1Editable = !isGen1 || ruleCount === 1;

    const row = `
      <tr>
        <td>${this._escapeHtml(pretty.time)}</td>
        <td>${this._escapeHtml(isGen1 ? (job.weekday_digits || "-") : pretty.weekdays)}</td>
        <td>${this._escapeHtml(pretty.outputId)}</td>
        <td>${this._escapeHtml(pretty.action)}</td>
        <td>${this._escapeHtml(pretty.toggleAfter)}</td>
        <td>
          <span class="chip ${job.enabled ? "chip-on" : "chip-off"}">
            ${job.enabled ? this._t("enabled") : this._t("disabled")}
          </span>
        </td>
        <td class="actions-cell">
          ${
            isGen1
              ? ""
              : `
                <button class="toggle-schedule" data-job-id="${job.id}" ${
                  this._togglingJobId === job.id ? "disabled" : ""
                }>
                  ${
                    this._togglingJobId === job.id
                      ? this._t("saving")
                      : job.enabled
                      ? this._t("disable")
                      : this._t("enable")
                  }
                </button>
              `
          }

          <button class="edit-schedule" data-job-id="${job.id}" ${
            !gen1Editable || this._savingJobId === job.id ? "disabled" : ""
          }>
            ${this._t("edit")}
          </button>

          <button class="delete-schedule danger" data-job-id="${job.id}" ${
            !gen1Editable || this._deletingJobId === job.id ? "disabled" : ""
          }>
            ${this._deletingJobId === job.id ? this._t("deleting") : this._t("delete")}
          </button>
        </td>
      </tr>
      ${
        isGen1
          ? `
            <tr class="schedule-raw-row">
              <td colspan="7">
                <strong>${this._t("raw_rule")}:</strong> ${this._escapeHtml(job.raw_rule || "-")}
              </td>
            </tr>
          `
          : ""
      }
    `;

    if (!isEditing) {
      return row;
    }

    return row + this._renderEditScheduleRow(job);
  }


  _renderScheduleTable(schedules) {
    return `
      <table class="schedule-table">
        <thead>
          <tr>
            <th>${this._t("time")}</th>
            <th>${this._t("days")}</th>
            <th>${this._t("port")}</th>
            <th>${this._t("action")}</th>
            <th>${this._t("toggle_after")}</th>
            <th>${this._t("status")}</th>
            <th>${this._t("actions")}</th>
          </tr>
        </thead>
        <tbody>
          ${schedules.map((job) => this._renderScheduleRow(job)).join("")}
        </tbody>
      </table>
    `;
  }

  _renderDeviceDetails() {
    if (!this._selectedDevice) {
      return `<div class="empty">Select a device.</div>`;
    }

    const d = this._selectedDevice;
    const schedules = d.schedules || [];

    return `
      <div class="details-card">
        <div class="details-top">
          <div>
            <h2>${this._escapeHtml(d.name || d.device_id)}</h2>
            <div class="meta-grid">
              <div><strong>${this._t("model")}:</strong> ${this._escapeHtml(d.model || "-")}</div>
              <div><strong>${this._t("mac")}:</strong> ${this._escapeHtml(d.mac || "-")}</div>
              <div><strong>${this._t("ip")}:</strong> ${this._escapeHtml(d.ip || "-")}</div>
              <div><strong>${this._t("generation")}:</strong> ${this._escapeHtml(d.generation || "-")}</div>
              <div><strong>${this._t("schedule_support")}:</strong> ${d.schedule_supported ? this._t("yes") : this._t("no")}</div>
              <div><strong>${this._t("available")}:</strong> ${d.available ? this._t("yes") : this._t("no")}</div>
              <div><strong>${this._t("last_sync")}:</strong> ${this._escapeHtml(d.last_sync || "-")}</div>
            </div>
          </div>

          <div class="actions">
            <button id="sync-device" ${this._syncingDevice ? "disabled" : ""}>
              ${this._syncingDevice ? this._t("syncing") : this._t("sync_device")}
            </button>

            ${
              d.generation === "gen1"
                ? `
                  <button id="gen1-enable" ${this._syncingDevice ? "disabled" : ""}>
                    ${this._t("turn_gen1_on")}
                  </button>
                  <button id="gen1-disable" ${this._syncingDevice ? "disabled" : ""}>
                    ${this._t("turn_gen1_off")}
                  </button>
                `
                : ""
            }
          </div>
        </div>

        ${
          d.last_error
            ? `<div class="error-box"><strong>Error:</strong> ${this._escapeHtml(d.last_error)}</div>`
            : ""
        }

        ${
          d.generation === "gen1"
            ? `
              <div class="info-box">
                <strong>${this._t("relay_schedule_state")}:</strong>
                ${d.gen1_schedule_state?.schedule_enabled ? this._t("on") : this._t("off")}
              </div>
            `
            : ""
        }
        <h3>${this._t("schedules")} (${schedules.length})</h3>

        ${
          schedules.length
            ? this._renderScheduleTable(schedules)
            : `<div class="empty">${this._t("no_schedules")}</div>`
        }
      </div>

      ${this._renderCreateForm()}
    `;
  }

  _bindBuilder(prefix, form) {
    const hour = this.shadowRoot.querySelector(`#${prefix}-hour`);
    const minute = this.shadowRoot.querySelector(`#${prefix}-minute`);
    const second = this.shadowRoot.querySelector(`#${prefix}-second`);
    const dom = this.shadowRoot.querySelector(`#${prefix}-dom`);
    const month = this.shadowRoot.querySelector(`#${prefix}-month`);
    const output = this.shadowRoot.querySelector(`#${prefix}-output`);
    const toggleAfter = this.shadowRoot.querySelector(`#${prefix}-toggleAfter`);

    if (hour) hour.addEventListener("change", (ev) => this._updateFormField(form, "hour", ev.target.value));
    if (minute) minute.addEventListener("change", (ev) => this._updateFormField(form, "minute", ev.target.value));
    if (second) second.addEventListener("change", (ev) => this._updateFormField(form, "second", ev.target.value));
    if (dom) dom.addEventListener("change", (ev) => this._updateFormField(form, "dayOfMonth", ev.target.value));
    if (month) month.addEventListener("change", (ev) => this._updateFormField(form, "month", ev.target.value));
    if (output) output.addEventListener("change", (ev) => this._updateFormField(form, "outputId", ev.target.value));
    if (toggleAfter) {
      toggleAfter.addEventListener("input", (ev) =>
        this._updateFormField(form, "toggleAfter", ev.target.value)
      );
    }

    this.shadowRoot
      .querySelectorAll(`[data-weekday-target="${prefix}"]`)
      .forEach((el) => {
        el.addEventListener("click", () => {
          this._toggleWeekday(form, el.dataset.weekdayValue);
          this._render();
        });
      });

    this.shadowRoot
      .querySelectorAll(`[data-radio-target="${prefix}"]`)
      .forEach((el) => {
        el.addEventListener("change", () => {
          form.on = el.dataset.radioValue === "on";
        });
      });

    if (prefix === "edit") {
      const editEnabled = this.shadowRoot.querySelector("#edit-enabled");
      if (editEnabled) {
        editEnabled.addEventListener("change", (ev) => {
          form.enabled = ev.target.checked;
        });
      }
    }
  }

   _bindEvents() {
    this.shadowRoot.querySelectorAll("[data-device-id]").forEach((el) => {
      el.addEventListener("click", () => {
        this._selectDevice(el.dataset.deviceId);
      });
    });

    const syncBtn = this.shadowRoot.querySelector("#sync-all");
    if (syncBtn) {
      syncBtn.addEventListener("click", () => this._syncAll());
    }

    const syncDeviceBtn = this.shadowRoot.querySelector("#sync-device");
    if (syncDeviceBtn) {
      syncDeviceBtn.addEventListener("click", () => this._syncSelectedDevice());
    }

    const sortSelect = this.shadowRoot.querySelector("#device-sort");
    if (sortSelect) {
      sortSelect.addEventListener("change", async (ev) => {
        this._sortBy = ev.target.value;
        await this._loadDevices();
      });
    }

    const debugToggle = this.shadowRoot.querySelector("#debug-toggle");
    if (debugToggle) {
      debugToggle.addEventListener("click", () => this._toggleDebugLogging());
    }

    const gen1EnableBtn = this.shadowRoot.querySelector("#gen1-enable");
    if (gen1EnableBtn) {
      gen1EnableBtn.addEventListener("click", () => this._setGen1ScheduleEnabled(true));
    }

    const gen1DisableBtn = this.shadowRoot.querySelector("#gen1-disable");
    if (gen1DisableBtn) {
      gen1DisableBtn.addEventListener("click", () => this._setGen1ScheduleEnabled(false));
    }

    this._bindBuilder("create", this._createForm);
    this._bindBuilder("edit", this._editForm);

    const createBtn = this.shadowRoot.querySelector("#create-schedule");
    if (createBtn) {
      createBtn.addEventListener("click", () => this._createSchedule());
    }

    const schedules = this._selectedDevice?.schedules || [];

    this.shadowRoot.querySelectorAll(".delete-schedule").forEach((el) => {
      el.addEventListener("click", () => {
        this._deleteSchedule(el.dataset.jobId);
      });
    });

    this.shadowRoot.querySelectorAll(".toggle-schedule").forEach((el) => {
      el.addEventListener("click", () => {
        const jobId = el.dataset.jobId;
        const job = schedules.find((s) => String(s.id) === String(jobId));

        if (!job) {
          this._error = `Could not find schedule ${jobId} in current UI data`;
          this._render();
          return;
        }

        this._toggleSchedule(job);
      });
    });

    this.shadowRoot.querySelectorAll(".edit-schedule").forEach((el) => {
      el.addEventListener("click", () => {
        const jobId = el.dataset.jobId;
        const job = schedules.find((s) => String(s.id) === String(jobId));

        if (!job) {
          this._error = `Could not find schedule ${jobId} in current UI data`;
          this._render();
          return;
        }

        this._startEdit(job);
      });
    });

    this.shadowRoot.querySelectorAll(".cancel-edit").forEach((el) => {
      el.addEventListener("click", () => this._cancelEdit());
    });

    this.shadowRoot.querySelectorAll(".save-edit").forEach((el) => {
      el.addEventListener("click", () => {
        this._saveEdit(el.dataset.jobId);
      });
    });
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          box-sizing: border-box;
          padding: 16px;
          height: 100%;
          background: var(--primary-background-color);
          color: var(--primary-text-color);
          font-family: var(--primary-font-family);
        }

        .layout {
          display: grid;
          grid-template-columns: 340px 1fr;
          gap: 16px;
        }

        .card, .details-card {
          background: var(--card-background-color);
          border-radius: 12px;
          padding: 16px;
          box-shadow: var(--ha-card-box-shadow, none);
          border: 1px solid var(--divider-color);
        }

        .toolbar,
        .details-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 12px;
        }

        .toolbar-left {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .toolbar-row {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          align-items: end;
        }

        .toolbar-row label {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin: 0;
        }

        .toolbar-row button {
          align-self: end;
          margin: 0;
        }

        button,
        input,
        select,
        textarea {
          font: inherit;
        }
        .info-box {
          background: rgba(255, 165, 0, 0.10);
          border: 1px solid rgba(255, 165, 0, 0.35);
          border-radius: 8px;
          padding: 10px;
          margin-bottom: 16px;
        }

        .schedule-raw-row td {
          font-size: 0.9rem;
          color: var(--secondary-text-color);
          background: var(--secondary-background-color);
        }
        button {
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
          border-radius: 10px;
          padding: 10px 12px;
          cursor: pointer;
        }

        button:hover {
          background: var(--secondary-background-color);
        }

        .toggle-button.active {
          border-color: var(--primary-color);
          outline: 1px solid var(--primary-color);
        }

        #debug-toggle,
        #device-sort {
          min-height: 42px;
        }

        .device {
          width: 100%;
          text-align: left;
          margin-bottom: 10px;
        }
        .info-link-row {
          margin-top: 10px;
        }

        .info-link-row a {
          color: var(--primary-color);
          text-decoration: none;
          font-weight: 600;
        }

        .info-link-row a:hover {
          text-decoration: underline;
        }
        .device.selected {
          outline: 2px solid var(--primary-color);
        }

        .device-name {
          font-weight: 600;
        }

        .device-meta {
          font-size: 0.9rem;
          color: var(--secondary-text-color);
          margin-top: 4px;
        }

        .device-submeta {
          font-size: 0.85rem;
          color: var(--secondary-text-color);
          margin-top: 4px;
        }

        .device-badge {
          display: inline-block;
          margin-top: 8px;
          font-size: 0.8rem;
          color: var(--secondary-text-color);
        }

        .actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 12px;
        }

        .danger {
          border-color: rgba(255, 0, 0, 0.35);
        }

        .meta-grid,
        .builder-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(150px, 1fr));
          gap: 10px 14px;
        }

        .meta-grid {
          grid-template-columns: repeat(2, minmax(180px, 1fr));
        }

        .builder-grid.single-line {
          grid-template-columns: minmax(220px, 320px);
        }

        label {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        input[type="text"],
        input[type="number"],
        select,
        textarea {
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          border-radius: 8px;
          padding: 10px;
        }

        .builder-section {
          margin-top: 14px;
        }

        .section-title {
          display: block;
          font-weight: 600;
          margin-bottom: 8px;
        }

        .weekday-row,
        .radio-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .weekday {
          min-width: 38px;
          text-align: center;
        }

        .weekday.active {
          outline: 2px solid var(--primary-color);
        }

        .checkbox-line {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 8px;
        }

        .schedule-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 10px;
        }

        .schedule-table th {
          text-align: left;
          font-weight: 700;
          padding: 10px 8px;
          border-bottom: 2px solid var(--divider-color);
        }

        .schedule-table td {
          padding: 10px 8px;
          border-bottom: 1px solid var(--divider-color);
          vertical-align: top;
        }

        .actions-cell {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .schedule-edit-row td {
          background: var(--secondary-background-color);
        }

        .schedule-edit-box {
          padding: 12px 0;
        }

        .chip {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 999px;
          font-size: 0.8rem;
          border: 1px solid var(--divider-color);
        }

        .chip-on {
          background: rgba(0, 128, 0, 0.12);
        }

        .chip-off {
          background: rgba(128, 128, 128, 0.12);
        }

        .empty {
          color: var(--secondary-text-color);
          padding: 12px 0;
        }

        .error-box {
          background: rgba(255, 0, 0, 0.08);
          border: 1px solid rgba(255, 0, 0, 0.25);
          border-radius: 8px;
          padding: 10px;
          margin-bottom: 16px;
        }

        .status {
          font-size: 0.9rem;
          color: var(--secondary-text-color);
        }

        @media (max-width: 1100px) {
          .layout {
            grid-template-columns: 1fr;
          }

          .meta-grid,
          .builder-grid {
            grid-template-columns: 1fr;
          }

          .schedule-table {
            display: block;
            overflow-x: auto;
          }
        }
      </style>

      <div class="toolbar">
        <div class="toolbar-left">
          <div>
            <h1>${this._t("title")}</h1>
            <div class="status">
              ${this._t("debug_logging")}:
              <span class="chip ${this._options.debug_logging ? "chip-on" : "chip-off"}">
                ${this._options.debug_logging ? this._t("on") : this._t("off")}
              </span>
            </div>
          </div>

          <div class="toolbar-row">
            <label>
              <span>${this._t("sort_devices_by")}</span>
              <select id="device-sort">
                <option value="name" ${this._sortBy === "name" ? "selected" : ""}>${this._t("sort_name")}</option>
                <option value="mac" ${this._sortBy === "mac" ? "selected" : ""}>${this._t("sort_mac")}</option>
                <option value="type" ${this._sortBy === "type" ? "selected" : ""}>${this._t("sort_type")}</option>
              </select>
            </label>

            <button
              id="debug-toggle"
              class="toggle-button ${this._options.debug_logging ? "active" : ""}"
              ${this._updatingOptions ? "disabled" : ""}>
              ${this._updatingOptions ? this._t("saving") : this._t("toggle_debug")}
            </button>
          </div>
        </div>

        <button id="sync-all" ${this._syncingAll ? "disabled" : ""}>
          ${this._syncingAll ? this._t("syncing") : this._t("sync_all")}
        </button>
      </div>

      ${this._error ? `<div class="error-box">${this._escapeHtml(this._error)}</div>` : ""}

      <div class="layout">
        <div class="card">
          <h2>${this._t("devices")}</h2>
          ${this._renderDeviceList()}
        </div>

        <div>
          ${this._renderDeviceDetails()}
        </div>
      </div>
    `;

    this._bindEvents();
  }
}

customElements.define(
  "shelly-schedule-manager-panel",
  ShellyScheduleManagerPanel
);