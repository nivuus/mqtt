#!/bin/bash

# Get all entities with system_monitor in their name and display their state and attributes
curl -X POST -sSL \
  -H "Authorization: Bearer <HA_LONG_LIVED_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"template": "Sensors:\n{% for entity in states.sensor if \"nivuus\" in entity.entity_id %}- {{ entity.entity_id }} | State: {{ entity.state }} | Available: {{ entity.available }}\n{% endfor %}\n\nSwitches:\n{% for entity in states.switch if \"nivuus\" in entity.entity_id %}- {{ entity.entity_id }} | State: {{ entity.state }} | Available: {{ entity.available }}\n{% endfor %}\n\nButtons:\n{% for entity in states.button if \"nivuus\" in entity.entity_id %}- {{ entity.entity_id }} | State: {{ entity.state }} | Available: {{ entity.available }}\n{% endfor %}"}' \
  http://localhost:8123/api/template

# Script to delete duplicate entities with double prefix (uncomment to use)
# Delete entities with double prefix (system_monitor_system_monitor_*)
# curl -X POST -sSL \
#   -H "Authorization: Bearer <HA_LONG_LIVED_TOKEN>" \
#   -H "Content-Type: application/json" \
#   -d '{"entity_id": "sensor.system_monitor_system_monitor_*"}' \
#   http://localhost:8123/api/states