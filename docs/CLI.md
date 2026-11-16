# Command line

The agent binary doubles as a small client. `src/index.ts` looks at the first positional
argument: `alert` or `event` runs the CLI and exits, anything else starts the agent.

```
mqtt-system-agent [--config <path>] event <type> [options]
node bin/mqtt-system-agent.js ...            # from a checkout, after `npm run build`
```

Every invocation first loads the configuration (`--config <path>`, otherwise
`config/agent.yaml` relative to the **current directory**; the installed package keeps its file at
`/opt/mqtt-system-agent/config/agent.yaml`, so pass `--config` when you are not in
`/opt/mqtt-system-agent`). The broker host, port, TLS settings and `base_topic` come from that
file; `MQTT_USERNAME` and `MQTT_PASSWORD` in the environment override the credentials.
A configuration error prints `Configuration error: ...` and exits with status 1.

## `event`

Publishes one event to the broker and exits.

| Option | Meaning |
|---|---|
| `<type>` (positional) or `--type <type>` | Required. Event type, copied to the `type` field. |
| `--payload '<json>'` | Optional JSON object. Its keys are merged at the top level of the event, after `type` and `timestamp`, so they can override them. Invalid JSON is an error. |
| `--id <id>` | Optional. Copied to the event as `id` and used as the device id in the topic. Without it the event is published once per entry of `device_info.identifiers`. |
| `--severity <value>` | Optional. Copied to the event as `severity`. |
| `--config <path>` | Configuration file (see above). |

The event is a JSON object `{ "type": ..., "timestamp": <ISO 8601>, ...payload }`. For each
target id the command publishes, with a connection that has no last will (so disconnecting does
not mark the agent offline):

1. a retained discovery message creating the sensor `<id>_event` on
   `homeassistant/sensor/<id>/event/config` (the topic segments are made legal by
   `discoveryTopic()`), and
2. the event itself, retained, QoS 1, on `<base_topic>/<id>/event`.

On success it prints `Event sent: {...}` and exits 0; on error it prints the message and exits 1.

```bash
mqtt-system-agent --config /opt/mqtt-system-agent/config/agent.yaml \
  event backup_done --severity info --payload '{"duration_s": 42}'
```

The sensor state is the event `type`; the other fields are its attributes. See
[ALERTS.md](ALERTS.md).

## `alert`

`alert` is recognised by `src/index.ts` and sent to the CLI dispatcher, but
`src/cli/index.ts` handles `event` only and rejects anything else with
`Unknown CLI command: alert. Only 'event' is supported.` (exit status 1). A sender class exists
(`src/cli/AlertSender.ts`: `--message`, `--level`/`--severity`, `--id`) but is not wired in, so
the `alert` command does not work today.
