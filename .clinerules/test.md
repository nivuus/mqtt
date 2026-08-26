Pour valider chaque tâche, effectue un test dédié pour chaque fonctionnalité :

- Température CPU par core et carte mère : Vérifie la remontée de chaque température dans Home Assistant.
- Vitesse d’upload/download par interface réseau : Confirme que chaque interface (eth, enp, wlp, wlo, ppp) publie bien ses valeurs, et que docker0, br-*, veth*, hassio sont ignorés.
- Charge CPU par core : Vérifie la présence et la mise à jour de chaque entité.
- Charge RAM : Contrôle la valeur et la fréquence de mise à jour.
- Vérification et gestion des mises à jour : Teste la détection, la liste et l’application des mises à jour.
- Firewalld : Ajoute/supprime un port/service à une zone, puis vérifie la prise en compte dans Home Assistant.
- Gestion Wifi : Liste les réseaux hostapd, ajoute/modifie un hotspot, vérifie la remontée des changements.
- Gestion VM : Démarre, arrête, redémarre une VM et vérifie la remontée d’état.
- Liste des périphériques par bridge : Vérifie la détection du nom et IP sur chaque bridge.
- Identifiant PPPoE : Contrôle la bonne remontée de l’identifiant.
- Disque dur : Vérifie l’utilisation, la taille, l’espace disponible, les erreurs et la santé via smartctl.

Pour chaque test, vérifie la création de l’entité correspondante dans Home Assistant via `./list-entities.sh` et la bonne publication MQTT.