# Update Intervals Configuration

Ce document explique les intervalles de mise à jour recommandés pour chaque feature et la logique derrière ces choix.

## Intervalles Recommandés

### Features Haute Fréquence (< 1 minute)

Aucune - Les données système ne nécessitent pas d'updates en dessous de 60 secondes.

### Features Fréquence Moyenne (1-2 minutes)

| Feature | Intervalle | Raison |
|---------|-----------|--------|
| `cpu_temperature` | 60s | Les températures CPU changent graduellement |
| `cpu_load` | 60s | La charge CPU est moyennée, pas besoin de plus |
| `memory_usage` | 60s | L'utilisation RAM évolue lentement |
| `network_stats` | 60s | Les stats réseau sont suffisantes chaque minute |
| `event_monitor` | 60s | Surveillance des logs (fail2ban, auth, syslog) |
| `connected_devices` | 120s | Liste des appareils connectés (opération coûteuse) |

### Features Fréquence Basse (5+ minutes)

| Feature | Intervalle | Raison |
|---------|-----------|--------|
| `disk_usage` | 300s (5min) | L'espace disque change très lentement |
| `firewalld_manager` | 300s (5min) | Les zones firewall sont rarement modifiées |
| `vm_manager` | 300s (5min) | L'état des VMs change rarement automatiquement |

### Features Fréquence Très Basse (1+ heures)

| Feature | Intervalle | Raison |
|---------|-----------|--------|
| `smart_status` | 3600s (1h) | La santé des disques évolue très lentement |
| `hostapd_manager` | 3600s (1h) | La configuration WiFi est rarement modifiée |
| `system_updates` | 86400s (24h) | Les mises à jour sont vérifiées une fois par jour |
| `pppoe_credentials` | 21600s (6h) | Les identifiants PPPoE changent rarement |

## Optimisations de Performance

### ConnectedDevices

Cette feature est particulièrement coûteuse car elle fait:
- Requêtes ARP pour chaque bridge
- Résolution DNS pour chaque appareil
- Lookup MAC vendor pour chaque appareil

**Optimisations implémentées:**
- Cache hostname avec TTL de 1 heure
- Évite les résolutions DNS répétées
- Batch lookup pour les vendors MAC
- Intervalle augmenté à 120s

### NetworkStats

Cette feature récupère les statistiques pour tous les interfaces réseau.

**Considérations:**
- Évite les interfaces Docker (docker0, br-*, veth*)
- Focus sur les interfaces physiques (eth, enp, wlp, wlo, ppp)
- Les stats sont calculées par différence, donc un intervalle trop court donne des valeurs peu fiables

## Ajustements Personnalisés

Vous pouvez ajuster ces intervalles dans `config/agent.yaml` selon vos besoins:

```yaml
features:
  cpu_load:
    enabled: true
    update_interval_seconds: 60  # Ajustez cette valeur
```

### Recommandations

- ⚡ **Ne descendez pas en dessous de 30s** pour les features système
- 🔋 **Augmentez les intervalles** si vous voulez économiser les ressources
- 📊 **Monitoring intensif**: gardez 60s pour cpu/memory/network
- 🌙 **Mode économie**: passez à 120s+ pour toutes les features
- 🚫 **Évitez les intervalles < 15s**: surcharge système et MQTT

## Impact sur les Performances

### Avant Optimisation
- Messages MQTT: ~9/minute
- Appels système: ~200/minute (connected_devices)
- Charge CPU: Élevée

### Après Optimisation
- Messages MQTT: ~3.5/minute (-60%)
- Appels système: ~20/minute (-90%)
- Charge CPU: Réduite

## Debugging

Pour voir les intervalles actuels de vos features:

```bash
grep -A 1 "update_interval_seconds:" config/agent.yaml
```

Pour monitorer la fréquence d'envoi MQTT:

```bash
mosquitto_sub -h YOUR_HOST -t "system_agent/#" -v -u USER -P PASS | ts '%Y-%m-%d %H:%M:%S'
```
