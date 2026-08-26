Le but de ce projet, c'est d'intégrer et gérer le système depuis Home Assistant, tel que:
- Temperature cpu par core, carte mere
- Vitesse d'upload et download de chaque reseau (uniquement eth, enp, wlp, wlo, ppp et ignorer docker0, br-*, veth*, hassio)
- Charge processeur par core
- Charge ram
- Vérifier les mises à jour, lister les mises à jour disponible, mettre à jour
- Gérer les zones de firewalld:
  - Pouvoir ajouter un port ou service à firewalld pour une zone
  - Supprimer un port ou service à firewalld pour une zone
- Gestion Wifi:
  - Lister les wifis de hostapd
  - Ajouter un hotspot
  - Modifier le nom et mot de passe
- Gestion VM:
  - Arreter, Démarrer, Redémarrer
- Lister les peripheriques connecté avec nom et ip sur chaque bridge (local et public)
- Identifiant de connexion au pppoe
- Disque dur:
  - Utilisation read/write
  - Disponible, taille
  - Error smartctl
  - Santé via smartctl
- Des évenements doivent être remonté à chaque fois que:
 - Un ban est déclaré via fail2bab
 - Quelqu'un s'est connecté en ssh
 - Qu'une erreur ou du contenu est généré via les scripts lancé sur crontab
 - Qu'une erreur est rentré dans le syslog (error, several, critical)


Il doit y avoir un auto discovery pour home assistant et être déclaré comme un seul appareil
Attention de bien lié avec des noms commun et clair chaque entité:
- La temperature et la charge des cores
- L'upload, download pour chaque réseau
- Les zones du firewalld avec chaque réseau


Découpe au maximum les fichiers, et range dans une architecture de dossier coherente. Le code doit être le plus simple possible.
Si un fichier est trop gros, il faut le découper.
Chaque fichier doit être le plus court possible, et ne pas dépasser 200 lignes.
Le code doit être le plus simple possible.
Utilise au maximum des packages npm existants.
Travaille principalement avec des classes et heritages.
Ecrit les commentaires en anglais
Utilise les logs pour débugger et dés que tu en as plus besoin, supprime les.
Il faut build, lancer l'app, regarder les logs, corriger.
Soit le plus court est concret possible dans tes explications.
Soit AUTONOME et PROACTIF, lance les commandes sans demander l'approbation à l'utilisateur.
Essaye de comprendre et adapter le code en fonction de la configuration de la machine.

Pour obtenir la liste des entités déclarés dans home assistant:
./list-entities.sh
Pour se connecter à mqtt, il faut se connecter à mqtt sur l'hote avec cette url:
 mosquitto_sub -h 192.168.0.1 -t "system/#" -v -u mqtt -P CHANGE_ME_MQTT_PASSWORD

Pour chaque type de capteur, entrée ou event, il faut que tu fasses une classe qui va s'occuper du autodiscovery, de la publication sur mqtt et si besoin de catcher les events depuis mqtt/ha.