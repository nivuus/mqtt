#!/usr/bin/env bash
# Runs INSIDE the bench VM, as a transient unit:
#   systemd-run --unit=exit-ip-logger /root/exit-ip-logger.sh
# Every 2 s, logs the public exit IP seen by the bench itself, the localBridge
# stand-in (homedev) and the publicBridge stand-in (guest), in parallel.
# "-" means no answer within 3 s. Log: /root/exit-ip.log
LOG=/root/exit-ip.log
URL=https://api.ipify.org

probe() { # netns|"" -> exit IP or "-"
  local ip
  if [ -n "$1" ]; then
    ip="$(ip netns exec "$1" curl -s -m 3 "$URL" 2>/dev/null)"
  else
    ip="$(curl -s -m 3 "$URL" 2>/dev/null)"
  fi
  [[ "$ip" =~ ^[0-9a-f.:]+$ ]] && echo "$ip" || echo "-"
}

while true; do
  start=$(date +%s.%N)
  tmp=$(mktemp -d)
  probe "" > "$tmp/bench" & probe homedev > "$tmp/home" & probe guest > "$tmp/guest" &
  wait
  printf '%s bench=%s home=%s guest=%s\n' "$(date '+%T')" \
    "$(cat "$tmp/bench")" "$(cat "$tmp/home")" "$(cat "$tmp/guest")" >> "$LOG"
  rm -rf "$tmp"
  sleep "$(echo "2 - ($(date +%s.%N) - $start)" | bc -l | awk '{print ($1 > 0) ? $1 : 0}')"
done
