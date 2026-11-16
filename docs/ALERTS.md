# Alerts and events in Home Assistant

The agent creates two kinds of "message" sensors, plus one sensor per automatic event type.

## Alert and event sensors

When the agent connects to the broker (`src/core/Agent.ts`), it publishes retained discovery
messages, for each id in `device_info.identifiers`, for two sensors on the agent's device:

| Sensor | Unique id | State topic | State shown |
|---|---|---|---|
| System Alert Sensor | `<id>_alert` | `<base_topic>/<id>/alert` | `message` field of the JSON payload |
| System Event Sensor | `<id>_event` | `<base_topic>/<id>/event` | `type` field of the JSON payload |

Both read the whole payload as attributes (`json_attributes_topic`). Publishing a JSON object
to one of these topics, for example with any MQTT client, updates the sensor:

```bash
mosquitto_pub -h <broker> -u <account> -P <password> -r \
  -t system_agent/nivuus/alert -m '{"level":"warning","message":"Disk almost full"}'
```

The event topic is also what `mqtt-system-agent event` writes to ([CLI.md](CLI.md)).

Nothing in the agent itself publishes to the `<id>/alert` topic, and the `alert` CLI command is
not functional today ([CLI.md](CLI.md#alert)); only external publishers feed the alert sensor.

## Automatic events (`event_monitor`)

The `event_monitor` feature (`src/features/events/EventMonitor.ts`) watches the host and
publishes each occurrence, non-retained, on `<base_topic>/<id>/events/<type>`, and keeps a
"last event" sensor per type (state: timestamp of the last occurrence, attributes: the fields
of the event). Types declared for discovery:

| Type | Source |
|---|---|
| `fail2ban_ban` | `fail2ban_log` in the configuration (`/var/log/fail2ban.log`) |
| `ssh_login` | `auth_log` (`/var/log/auth.log`) |
| `syslog_error` | syslog entries at the levels in `syslog_watch_level` |
| `clamav_virus` | ClamAV `clamd` detections read from the journal (`journalctl -t clamd`) |

String fields are truncated before publication and the raw log line is attached as
`original_log_line`. Home Assistant automations can trigger on the `events/<type>` topics with
an MQTT trigger.
