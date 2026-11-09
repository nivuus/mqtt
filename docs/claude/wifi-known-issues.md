# Wi-Fi feature: known issues left open

Recorded by the Wi-Fi audit of 2026-11-09. The owner chose to **record** these, not fix them yet.

## 1. A change from Home Assistant leaves the hostapd files world-readable

`writeHostapdConfig()` (`src/features/wifi/hostapdService.ts`) writes the new configuration to
`/tmp/hostapd_<timestamp>.conf` with `fs.writeFileSync`, then `sudo mv`s it over
`/etc/hostapd/<band>.conf`. The agent runs as root with `UMask=0022`
(`systemctl show mqtt-system-agent -p UMask`), so the temp file is created `0644`, and `mv`
keeps that mode: after the first SSID, password or security change made from HA, both files
(which hold every `wpa_passphrase` / `sae_password`) become readable by every local user and
every container that sees `/etc`. Today they are `0600` only because they were last edited by
hand.

Two smaller defects on the same path:
- `/tmp` is a tmpfs on this host, so `/tmp` → `/etc` is a copy followed by an unlink, not the
  atomic rename the old documentation claimed. A crash in between can leave a truncated file.
- The name is predictable (`Date.now()`), and the file exists in `/tmp` with the secrets in
  it until the `mv` runs.

Direction of the fix: write the temp file in the destination directory with mode `0600`
(`fs.openSync(path, 'wx', 0o600)` or `fs.writeFileSync(..., { mode: 0o600, flag: 'wx' })`),
`fsync`, then `fs.renameSync` over the target; keep the `.backup` copy at `0600` too.

## Also noticed, not part of the audit list

- Every network's password is published as a **retained** MQTT state
  (`hostapd_manager/network_<id>/password/state`, text entity in `mode: text`). Anyone with
  broker credentials, and HA's recorder/history, holds the Wi-Fi passwords in clear.
