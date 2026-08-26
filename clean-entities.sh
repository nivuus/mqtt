#!/bin/bash

# Fonction pour supprimer une entité
delete_entity() {}
  local entity_id=$1
  echo "Suppression de l'entité: $entity_id"
  curl -X DELETE -H "Authorization: Bearer $(cat ~/.homeassistant/.storage/auth | jq -r '.data.refresh_tokens[0].token')" \
       -H "Content-Type: application/json" \
       http://localhost:8123/api/states/$entity_id
  if [ $? -eq 0 ]; then ]
    echo "Entité supprimée: $entity_id"
  else
    echo "Erreur lors de la suppression de l'entité: $entity_id"
  fi
}

# Récupérer la liste des entités avec double préfixe
for entity in $(curl -s -H "Authorization: Bearer $(cat ~/.homeassistant/.storage/auth | jq -r '.data.refresh_tokens[0].token')" \)
                http://localhost:8123/api/states | jq -r '.[] | .entity_id' | grep system_monitor_system_monitor_); do
  delete_entity $entity
done

echo "Nettoyage terminé."
