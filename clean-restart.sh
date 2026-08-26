#!/bin/bash

LOG_FILE="/tmp/mqtt-system-agent.log"
HA_TOKEN=""

function log() {
  echo "$1"
  echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> ${LOG_FILE}
}

# Create fresh log file
echo "--- Clean Restart Script $(date '+%Y-%m-%d %H:%M:%S') ---" > ${LOG_FILE}

# Stop any running instances
log "Arrêt de l'agent en cours..."
pkill -f "node /home/mallanic/Projects/mqtt-system-agent/node_modules/.bin/ts-node" || true
pkill -f "node dist/index.js" || true
sleep 2

# Try to get HA token 
log "Récupération du token Home Assistant..."
if [ -f ~/.homeassistant/.storage/auth ]; then
  HA_TOKEN=$(cat ~/.homeassistant/.storage/auth | jq -r '.data.refresh_tokens[0].token')
  log "Token récupéré avec succès."
else
  log "AVERTISSEMENT: Impossible de récupérer le token Home Assistant. Certaines opérations seront ignorées."
fi

# Only attempt to interact with Home Assistant if we have a token
if [ ! -z "$HA_TOKEN" ]; then
  log "Suppression des entités MQTT dans Home Assistant..."
  curl -s -X GET -H "Authorization: Bearer $HA_TOKEN" \
      "http://localhost:8123/api/states" | \
      jq -r '.[] | select(.entity_id | contains("system_monitor_")) | .entity_id' | \
      while read entity_id; do
        log "Suppression de $entity_id"
        curl -s -X DELETE -H "Authorization: Bearer $HA_TOKEN" \
            "http://localhost:8123/api/states/$entity_id"
      done

  # Force Home Assistant to reload MQTT integration
  log "Redémarrage de l'intégration MQTT dans Home Assistant..."
  curl -s -X POST -H "Authorization: Bearer $HA_TOKEN" \
      -H "Content-Type: application/json" \
      "http://localhost:8123/api/services/mqtt/reload"
fi

# Clean up MQTT retained messages
log "Nettoyage des topics MQTT..."
mosquitto_pub -h 192.168.0.1 -u mqtt -P CHANGE_ME_MQTT_PASSWORD -t "system/mqtt-system-agent/status" -m '{"status":"offline"}' -r
sleep 1

# Loop through all the HA discovery topics and remove them
log "Suppression de tous les topics de découverte..."
mosquitto_sub -h 192.168.0.1 -u mqtt -P CHANGE_ME_MQTT_PASSWORD -t 'homeassistant/#' -v -C 1 -W 3 | grep "system_agent" | cut -d' ' -f1 | while read topic; do
  log "Suppression du topic: $topic"
  mosquitto_pub -h 192.168.0.1 -u mqtt -P CHANGE_ME_MQTT_PASSWORD -t "$topic" -n -r
done

# Rebuild the project
log "Compilation de l'agent..."
npm run build
if [ $? -ne 0 ]; then
  log "ERREUR: La compilation a échoué."
  exit 1
fi

# Start the agent
log "Démarrage de l'agent..."
nohup node dist/index.js > ${LOG_FILE} 2>&1 &
PID=$!
sleep 2

# Check if agent is running
if ps -p $PID > /dev/null; then
  log "Agent démarré avec succès (PID: $PID)!"
else
  log "ERREUR: L'agent n'a pas démarré correctement."
  cat ${LOG_FILE}
  exit 1
fi

log "Pour voir les logs de l'agent, exécutez: tail -f ${LOG_FILE}"
