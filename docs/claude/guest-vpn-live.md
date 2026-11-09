# Guest VPN: live rollout on the router (plan Task 10)

Done on 2026-11-09 with the owner present, from merged `main` (mqtt #36 `2bfd0e7`, installer #62
`0e07fcd`, home-manager #8 `0680226`). Every risky step ran behind a dead-man switch armed
through `systemd-run` (a revert timer plus a watcher that pings 1.1.1.1 and 9.9.9.9 every 5 s
and reverts after 3 failures or a lingering `inet firewalld_policy_drop`). It never fired.

## Preflight findings

- Only saved NM connections are restored on a firewalld reload. firewalld 2.3.1 tests
  `NM.SettingsConnectionFlags.NM_VOLATILE`, which this libnm does not define, so it always falls
  back to `get_unsaved()`. `wpan0`, `docker0` and the Docker `br-*` bridges are unsaved and keep
  the binding from their zone file; every saved connection's `connection.zone` matched the zone
  files once the stale `enp15s0` line was gone from `internal.xml`.
- Check this first if a reload ever fails: a zone file listing an interface that NM puts in
  another zone (see [guest-vpn-host-notes.md](guest-vpn-host-notes.md), 12:09).

## Steps and results

| Step | Result |
|---|---|
| Installer step `firewalld_zone.py external nvguest0` | one line added to `external.xml`, `--check-config` success |
| One `firewall-cmd --reload` (19:52:37) | rc 0 in 1 s, `running`, no DROP table, active zones unchanged except the runtime-only leftovers (`guestvpn`, `guest-to-vpn`, unplugged 4G phone); Docker re-added its bridges within seconds; LAN device fine |
| Agent `.deb` (`dpkg -i`) | restarted, `guest_vpn` state `no_config`, `ip rule`/nft/zones identical |
| `nivuus update home-manager` 1.4.0 + HA restart | `nivuus_vpn` loaded, four Guest VPN entities registered |
| Profile upload from the owner's phone | `nivuus-guest-vpn_a` imported, inactive, keyfile 600; credentials absent from the journal and HA logs |
| Switch on (20:07:19) | `connected` at 20:07:22: rules 99–101, table 200 default via `nvguest0`, IPv6 unreachable, DNS DNAT to the pushed 10.20.128.1 |
| Guest phone on the guest Wi-Fi | exit IP 5.255.103.96 (ZoogVPN), no IPv6, DNS queries seen on `nvguest0`; host and `localBridge` stay on Orange |

## Provider outage

Blocked 5.255.103.96 udp 1194 both ways in a throwaway nft table:

| Event | Time | Delay |
|---|---|---|
| Block | 20:14:32 | |
| First failed DNS probe | 20:14:45 | +13 s |
| Tunnel down, guests on Orange (rules gone, DNS table emptied) | 20:15:04 | **+32 s** |
| Attempt during the block (NM `connect timeout exceeded`, TLS never negotiated) | 20:15:27 → 20:16:28 | NM's 60 s VPN timeout |
| Unblock | 20:16:23 | |
| Next attempt (30 s backoff), connected | 20:16:59 | **+36 s** |

During the fallback the guest phone showed the Orange IP and used the router's DNS. After
recovery: exit IP 5.255.103.96 again, "On Orange" off.

## Not done yet

- Re-upload of a different ZoogVPN server (switch-over), left for another day.
- `next activation attempt at …` is logged in UTC (`toISOString`), while the journal is local
  time: harmless, but confusing when reading the log.
