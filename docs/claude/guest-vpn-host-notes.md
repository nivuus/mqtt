# Guest VPN: bench findings (plan Task 1)

Measured on 2026-11-09 on the isolated bench VM described in
[guest-vpn-bench.md](guest-vpn-bench.md): the same package versions as the host (NM 1.52.1,
firewalld 2.3.1 nftables, nftables 1.1.3, nm-openvpn 1.12.3, OpenVPN 2.6.14, docker-ce 29.9.3),
the host's `/etc/firewalld` copied verbatim, and the same interface names and NM zones. Nothing
was changed on the live host. Every host snapshot (nft tables, links, `ip rule`, active zones,
firewalld journal) taken before, during and after the VM runs is identical to the first one.

## Read this first

1. **Fixed on 2026-11-09, see [guest-vpn-live.md](guest-vpn-live.md): the stale `enp15s0` line
   was removed and a controlled reload succeeded at 19:52.** Before that fix, any
   `firewall-cmd --reload` on the live host cut the home LAN, exactly as at 12:09,
   with or without new zones or policies. This includes the mqtt agent's own `FirewallManager`
   and wizard handlers (`src/features/firewall/FirewallManager.ts`,
   `src/websocket/wizard/firewallHandlers.ts`), and Docker if its `docker` zone or
   `docker-forwarding` policy ever goes missing (it then calls firewalld `reload` itself).
   Cause and fix are below (12:09).
2. **Plan's retry design does not exist in NM**: "autoconnect is not implemented for VPN
   profiles" (nm-settings-nmcli(5), confirmed on the bench). `connection.autoconnect-retries 0`
   on the VPN profile has no effect. Owner decision needed (step 5).
3. **Silent leak after a real outage**: after a long silent loss, OpenVPN reconnects inside the
   same process and may reopen `nvguest0`; NM then loses the tunnel's routes but still reports
   the VPN "activated". Guests go out through Orange indefinitely with the tunnel up (step 5).
4. **`nvguest0` loses its zone on every firewalld reload or restart**, and guests are then
   blackholed (not leaked) until the VPN is re-activated (step 6). A tested fix exists.

## Step 2: root cause of the 12:09 failure

**Found, reproduced, fix verified on the bench.**

Trigger: `firewall-cmd --reload` itself. The spike's new zone `guestvpn` and policy
`guest-to-vpn` are irrelevant: a plain reload fails identically. Docker is irrelevant too: the
failure reproduces with Docker stopped.

Mechanism, firewalld 2.3.1 with `FlushAllOnReload=yes`:

1. `reload()` installs the reload DROP policy (table `inet firewalld_policy_drop`), flushes,
   and rebuilds from the permanent config. `internal.xml` still lists
   `<interface name="enp15s0"/>`, so `enp15s0` lands in `internal`, the only interface there at
   that point.
2. It then restores the interfaces NM owns, zone by zone in alphabetical order. At `home`, NM
   says `enp15s0` belongs to `home` (port of `localBridge`, `bridge-slave-enp15s0`,
   `connection.zone home`), so firewalld moves it out of `internal`. `internal` is now empty:
   `internalBridge` and `vnet17` are only restored later, at `internal`.
3. In 2.3.1, `_get_table_chains_for_policy_dispatch()` gives an "ANY → zone" policy its
   `nat`/`mangle` PREROUTING chains **only when the egress zone has no interfaces**. Policy
   `windows` (ANY → `internal`) was built while `internal` held `enp15s0`, so those chains do
   not exist. With `internal` now empty, the dispatch for `enp15s0` in `home` adds
   `jump nat_PRE_policy_windows` and `jump mangle_PRE_policy_windows`, nft answers ENOENT, and
   the whole transaction fails. These are commands #275 and #276 of the host's saved blob.
4. The exception leaves `reload()` before `set_policy("ACCEPT")`: the DROP table stays, firewalld
   goes to FAILED, and everything is dropped (radvd/ndisc6 `sendmsg: Operation not permitted`,
   LAN down).

Evidence: `31-capture-failing-blob.sh` snapshots the ruleset just before the failing transaction
and `nft-index-check.py` replays the blob against it. The only rejects are the jumps into those
two chains (rule indexes are all valid, so not a rule-index-cache problem). On the bench,
`34-reload-matrix.sh unfixed` reproduces the incident every time (2/2: plain and with the
spike's objects): reload rc=13, state `not running`, `firewalld_policy_drop` present, home and
guest stand-ins 204 → 000, SSH into the bench dead. It was recovered through the guest agent.

Why the host survives boots: at boot the activation order differs, and `internal` is not empty
when `enp15s0` leaves it. Activating `internalBridge` before the `enp15s0` port works. Activating
the port while `internal` would become empty fails the same way (bench, both orders checked).

**Fix (installer, owner's window):** remove the stale `<interface name="enp15s0"/>` line from
`/etc/firewalld/zones/internal.xml`. `enp15s0` has been a `localBridge` port bound to `home` by
NM since 2026-02-12, so the line only causes the tug-of-war. Edit the XML directly:
`firewall-cmd --permanent --remove-interface` may also rewrite the NM profile's zone. Editing the
file changes nothing at runtime; the next boot or reload uses it.

Bench with the fix (`34-reload-matrix.sh fixed`): plain reload, reload with the spike's objects,
3 more reloads, a firewalld restart, and both activation orders. Every result: rc=0, `running`,
no DROP table, home=204, guest=204.

Not the cause: the `docker-forwarding` NAME_CONFLICT. That is Docker's
`setupDockerForwardingPolicy()` calling `config.addPolicy` at every start and treating
NAME_CONFLICT as "already exists". It is logged as ERROR, is harmless, and needs no rename.

Residual risk on firewalld 2.3.1, upstream:

- The state-dependent chain set remains. When `internal` is emptied on the bench (both of its
  interfaces down) and an interface is then flapped, one transaction fails with
  `rule ref count bug` (non-fatal there; the next reload healed it). Any policy whose egress
  zone can become empty is exposed. Fixed upstream by firewalld commit `a4a308401d` ("fix(core):
  improve zone/policy dispatch", 2026-07-03), first released in v2.5.0. Debian has 2.5.2 in
  forky/sid only. Not bench-tested: verified by reading upstream `main`.
- Upstream `main` still has no exception handling around the NM-restore loop of `reload()`:
  any failing transaction there leaves the DROP table in place. Worth an upstream report.
  `ReloadPolicy` (firewalld.conf) controls that transient policy.

## Step 3: VPN profile in NM

All accepted by NM 1.52 (`40-vpn-profile.sh`):

- `connection.zone external`
- `ipv4.route-table 200`, `ipv6.route-table 200`, `ipv4.never-default no`
- the three IPv4 rules (normalized to `priority 99 from 0.0.0.0/0 iif publicBridge suppress_prefixlength 0 table 254, ...`)
- the IPv6 rule
- `ipv6.routes "::/0 table=200 type=unreachable"`

- **Device name key: `dev`** (`NM_OPENVPN_KEY_DEV`), and it needs **`dev-type=tun`** as well.
  With `dev=nvguest0` alone OpenVPN exits with "problem with tun vs. tap setting": it infers
  the type from a `tun`/`tap` name prefix.
- Fixed name side effect: a new OpenVPN cannot open `nvguest0` while the old one still holds it
  (`TUNSETIFF ... Device or resource busy`). Wait until the device is gone before re-activating.
- Import:
  - The profile and its keyfile are named after the file's basename (`alkmaar.nmconnection`);
    renaming the id does not rename the file. Find it with
    `nmcli -t -f NAME,FILENAME connection show`.
  - Inline `<ca>`/`<tls-auth>` blocks are written to the importing user's
    `~/.local/share/networkmanagement/certificates/nm-openvpn/<basename>-ca.pem` (and
    `-tls-auth.pem`), 0600 files in 0755 directories.
  - CRLF line endings and a missing final newline are accepted.
  - Silently dropped: `resolv-retry`, `persist-*`, `fast-io`, `reneg-bytes`; nm-openvpn adds
    `--persist-tun` itself.
- Secrets: written through libnm by `set-vpn-secrets.py` (reads the file itself; nothing in
  argv), `password-flags=0`. They live in `[vpn-secrets]` of the 0600 keyfile.
- **Activation needs a parent NM connection.** The WAN (`enp5s0.832`, and `enp0s2` on the
  bench) is NM-unmanaged, so a plain `nmcli connection up nivuus-guest-vpn` fails with "Could
  not find source connection". `nmcli connection up nivuus-guest-vpn ifname publicBridge` binds
  it to `bridge-publicBridge` and works. OpenVPN's own socket still follows the main table. NM
  adds no route to the VPN server.
- The provider pushes `block-outside-dns` (Windows-only). OpenVPN logs an options error but
  continues; it is not fatal.

## Step 4: tunnel up

- Exit IPs, logged every 2 s by `exit-ip-logger.sh`: guest stand-in = ZoogVPN 5.255.103.96;
  bench and `localBridge` stand-in = the uplink (the host's Orange IP) on every sample while
  the tunnel was up or down.
- `nvguest0` is bound to `external` (`firewall-cmd --get-zone-of-interface`). The firewalld
  journal shows **no entry** for this binding at the default log level: a successful bind is
  silent.
- Pushed: IPv4 DNS 10.20.128.1; IPv4 10.20.172.x/32 point-to-point. **IPv6 is pushed too**: a
  ULA `/64` on `nvguest0` and routes `::/3`, `2000::/4`, `3000::/4`, `fc00::/7` into table 200.
  These are more specific than the planned `::/0 unreachable`, so guest IPv6 is sent into the
  tunnel. firewalld's masquerade is IPv4-only, so it leaves un-NATed and times out. On the host
  it would expose the guests' delegated prefix to the provider.
- **Fix: `ipv6.ignore-auto-routes yes` on the VPN profile.** Table 200 then holds only the
  unreachable default and the on-link ULA; guest IPv6 fails in about 1 s (ICMPv6 unreachable)
  and IPv4 keeps going through the tunnel.

## Step 5: retries (FAILED: owner decides)

- `connection.autoconnect yes` with `autoconnect-retries 0` on the VPN profile: nothing happens,
  not even after an NM restart. NM documents that VPN autoconnect is not implemented.
- `connection.secondaries <vpn uuid>` on `bridge-publicBridge` works: activating
  `publicBridge` brings the VPN up. The UUID changes on every re-import, so a delete + import
  leaves `secondaries` pointing at a deleted profile.
- Endpoint blocked 2 min on output (immediate EPERM): OpenVPN never reached its ping timeout and
  resumed the same session at unblock. NM showed "activated" throughout. Guests had no internet
  for the 2 min (no fallback, no leak).
- Endpoint blocked 5 min silently (input drop, like a real outage):
  - NM stayed "activated" and `nvguest0` stayed up (`--persist-tun`); guests had no internet for
    the whole outage.
  - OpenVPN did `ping-restart` after about 2 min, then retried internally every 60 s (its own
    retry, unbounded).
  - On reconnect the server pushed a different address ("Pulled options changed on restart, will
    need to close and reopen TUN/TAP device"). `nvguest0` was recreated under a new ifindex, and
    NM logged `unable to configure IPv4 route ... table 200` and dropped the device.
  - Result: table 200 has no IPv4 route, rule 100 falls through to `main`, and **guests leave
    through Orange while NM reports the VPN "activated"** and the tunnel itself is up. It does
    not heal by itself; `nmcli connection down`/`up` restores it.
- `vpn.persistent yes` + `+vpn.data ping-exit=60` (4 min silent block, 4 min watch):
  - The pushed `ping-restart` fired first (about 2 min), then `ping-exit` after 60 s more, and
    OpenVPN exited.
  - NM removed the VPN and its rules: the state shown is truthful, guests fell back to Orange
    at once, `publicBridge` stayed up, no leak.
  - **NM never reconnected**, neither during the block nor in the 4 min after the unblock.
    `vpn.persistent` does not make NM retry this plugin, and the secondary is only started
    when `publicBridge` itself activates.

What NM cannot give, with any setting tried: "retry forever" together with "fall back during
the outage, return after".
- Without `ping-exit`: guests are blackholed during the outage, then may stay on Orange with the
  VPN shown "activated".
- With `ping-exit`: the fallback is clean and truthful, but nothing ever brings the tunnel back.

The agent must not paper over this with its own retry loop without an owner decision.

## Step 6: guest DNS DNAT, reload and restart

- Bench mechanism: an NM dispatcher hook (`90-nivuus-guest-vpn-dns.dispatcher`) creates
  `inet nivuus_guest_vpn` on `vpn-up` from `VPN_IP4_NAMESERVERS`, and deletes it on `vpn-down`.
  The table holds a DNAT of udp/tcp 53 arriving on `publicBridge` to the pushed DNS, and a
  reject of IPv6 53 (input and forward).
- Leak test (unique names, tcpdump on both sides): names queried through the router resolver,
  through `@8.8.8.8` and over TCP to `@1.1.1.1` appear **0 times in clear on the uplink**, and
  all go through `nvguest0`. Guest IPv6 DNS to the router or to `2001:4860:4860::8888`:
  unreachable.
- `firewall-cmd --reload` and `systemctl restart firewalld` (bench only): the table survives
  both, and leak tests still pass. `localBridge` keeps its zone and the home stand-in never lost
  internet.
- **`nvguest0` loses its zone on both**: "no zone". It falls into the default zone `internal`,
  and guests get no internet (blackholed, not leaked) until the VPN is re-activated.
  - firewalld's NM restore finds `nvguest0`'s NM device, whose active connection is NM's
    generated external `nvguest0` profile (no zone), not the VPN profile.
  - NM does not re-add VPN interfaces after a firewalld reload or restart.
- **Tested fix:** a permanent `<interface name="nvguest0"/>` in `external.xml` (the name is
  fixed). firewalld then binds it on every reload and restart, and NM's `connection.zone`
  agrees, so there is no tug-of-war like `enp15s0`. Checked: reload, 2 more reloads, restart,
  VPN down/up, reload. Every time `nvguest0=external` and guest 204, no errors. This is a
  one-time permanent firewalld change on the host (installer, owner's window), not a new zone
  or policy.

## Step 7: fallback, re-import, path directives

| Action while the tunnel is up | Guest back on the uplink | Guest DNS | `localBridge` stand-in |
| --- | --- | --- | --- |
| `nmcli connection down` | 0.3 s | answers (DNAT table removed) | unaffected |
| `nmcli connection delete` | 0.3 s | answers | unaffected |
| delete + re-import | 0.8 s | answers | unaffected |

Path-taking directives on import (`71-import-directives.sh`):
- `ca <file>`, `tls-auth <file> 1`, and `crl-verify <file>` (stored as `crl-verify-file`) are
  stored as references to the original paths. Nothing is copied, so the files must stay.
- `auth-user-pass <file>`: the file is ignored. No username or password is imported, and
  `password-flags` defaults to 1 (agent-owned).

## `localBridge` internet during the bench

The exit-IP log ran from 13:35:01 to 14:16:34 (bench clock, UTC), covering steps 3 to 7.
- `localBridge` stand-in: 1,085 of 1,121 samples on the uplink. All 36 failures fall in
  13:39:46–13:41:31, the NM restart experiment below.
- Bench itself: 1,121 of 1,121 samples on the uplink.

The home stand-in lost internet only in two deliberate experiments, and never because of a VPN
step:
- the unfixed 12:09 reproductions;
- a `systemctl restart NetworkManager`. NM then re-assumed `localBridge` as a generated
  in-memory connection: no zone, no dnsmasq. That lasted from 13:39:42 until the profile was
  re-activated. The host's `bridge-localBridge` has the same `ipv6.method manual`. The host has
  never restarted NM outside boots (journal since 2026-10-21), so this is unverified there, but
  an NM package upgrade restarts NM: treat it as a risk to `localBridge`.

## Owner decisions needed before Task 2+

1. When to apply the `internal.xml` fix (and nothing reloads firewalld on the host until then).
2. Retry and outage behaviour. NM alone offers either OpenVPN's internal retry (blackhole
   during the outage, then the reconnect leak) or `ping-exit` (clean fallback, never
   reconnects). Meeting goal 4 needs something outside NM to re-activate the profile, such as
   an explicit agent-side supervisor, which the plan forbids today. Owner's call.
3. Whether to add the permanent `nvguest0` binding in `external.xml`, so the zone survives
   reloads.
4. Add `ipv6.ignore-auto-routes yes` to the VPN profile settings.

## Task 9b — agent build on the bench

2026-11-09, bench VM (QEMU user-mode networking only), bench clock UTC, 17:00–17:28. The `.deb`
was built from `feat/guest-vpn` at `5a5e859` (`npm run package:deb`) and installed in the VM,
with mosquitto inside the VM, an agent config enabling only `guest_vpn`, and `NIVUUS_WS_TOKEN`
generated in the VM. `vpn.import_profile` / `vpn.get_status` were sent by nivuus_vpn's own
`client.py` + `payloads.py` (Home Assistant stubbed by a plain aiohttp session), the switch by
`mosquitto_pub`. Fixtures: `src/features/vpn/__tests__/fixtures/bench/` (`manifest.json` holds
the command, exit code and stderr of each capture; used by `benchFixtures.test.ts`). Host: the
snapshots taken before the VM start and after its shutdown are identical (nft tables, links,
`ip rule`, `ip -6 rule`, active zones, empty firewalld journal), and the host answered 204
throughout.

**Result: the build does not work with nmcli 1.52. Three agent defects and one packaging defect.**

| # | Where | What (real output) |
| --- | --- | --- |
| D1 | `nmProfiles.ts` `keyfileOf` | `nmcli -g GENERAL.FILENAME connection show uuid <u>` prints nothing (rc 0) on an inactive profile and fails with rc 2 on an active one (`invalid field 'GENERAL.FILENAME'`). So `vpn.import_profile` always fails ("NetworkManager reported no keyfile"), fresh or re-import. The list form `nmcli -g UUID,FILENAME connection show` works. |
| D2 | `guestVpnStatus.ts` `SHOW_FIELDS` | `-f vpn.data,GENERAL.STATE,VPN.VPN-STATE,IP4.DNS` fails with rc 2 on inactive **and** active profiles: `invalid field 'VPN.VPN-STATE'; allowed fields: vpn.service-type,...` (the `VPN` group collides with the `vpn` setting). The full `nmcli -t connection show uuid` lists `VPN.VPN-STATE:5 - VPN connected`, but it cannot be selected with `-f`. Effect: the state is always `error` ("reading the VPN state failed"), never `connected` or `disabled`; `tunnelHealth` never runs, the DNS DNAT table is never filled, the unhealthy-tunnel restart never fires. |
| D3 | `nmGuestVpn.ts` `up()` | `nmcli connection up uuid <u> ifname publicBridge` returns rc 0 in 19 ms ("Connection successfully activated (controller waiting for ports)") without waiting for the VPN. With a wrong password OpenVPN then gets `AUTH_FAILED`, but the agent saw a success: no `lastError`, no backoff, `next_attempt` null, and `up` ran on **every 15 s tick** (23 attempts from 17:05:05 to 17:10:33). |
| D4 | `debian/mqtt-system-agent.service`, `postinst.sh` | Fresh install: `ReadWritePaths=/opt/mqtt-system-agent/cache` does not exist, so the unit fails with `226/NAMESPACE` in a restart loop. The bench created the directory by hand. |

Because of D1 the profile was imported by a stand-in that replays the agent's exact steps
(staging name `nivuus-guest-vpn_a`, `profileSettingsArgs` copied from the agent's log line,
credentials written into the keyfile from a file, `connection load`, rename by UUID). NM's
certificate copies are named `nivuus-guest-vpn_a-ca.pem` and `-tls-auth.pem`, as expected.

### Step 1: real output vs the unit-test mocks

- `ip -j -4 route show table 200`, healthy: `{"dst":"default","gateway":"10.20.172.17","dev":"nvguest0",...}`
  plus host routes. Matches `hasDefaultVia` (the `default` form; the def1 pair was never seen).
  Inactive and C1 leak: `[]`.
- `ip -j -4 rule show`: `{"priority":100,"src":"all","iif":"publicBridge","table":"200","protocol":"static"}`,
  as in the mock. Rule 99 prints `suppress_prefixlen` (mock: `suppress_prefixlength`; not read).
- Inactive profile, `-t -f vpn.data,GENERAL.STATE,IP4.DNS`: only the `vpn.data` line, rc 0, as
  the mock.
- `vpn.data` escaping: ':' inside values is **not** escaped in `-t` detail mode
  (`remote = nl2.webunlim.com:1194`); the mock has `\:`. Harmless for the parser. `vpn.data`
  carries `username = ...`, and the full listing prints it in `VPN.USERNAME` and `VPN.CFG[n]`
  (redacted in the fixtures).

### Step 2

| Check | Result |
| --- | --- |
| `vpn.get_status` / `vpn.import_profile` with client.py | protocol OK (auth, reply, `parse_status`); import FAILS (D1) |
| Switch ON (MQTT) | `nmcli up` at once; guest on the provider's exit IP within 3 s; state shown `error` (D2) |
| Switch OFF | down within 2 s, guest on the uplink at the next 2 s sample; state shown `error` (D2) |
| Re-import while up | fails on D1 before touching anything; live tunnel and certificates untouched |
| Wrong password | FAIL: no backoff, an attempt every 15 s, `next_attempt` null (D3) |
| Agent restart with the tunnel up | tunnel untouched (no `up`/`down`), guest stayed on the provider |

### Step 3: C1 and provider outage

- **Plain outage** (silent drop of UDP from port 1194 for 150 s, from 17:12:20): guests got no
  answer until OpenVPN's `ping-restart` (+119 s) then `ping-exit` (+180 s); NM dropped the VPN
  and guests were on the uplink at 17:15:21, **181 s** after the outage started. The agent ran
  `up` on the next tick (17:15:33); guests were back on the provider at 17:15:37. The designed
  15–30 s fallback did not happen (D2: no health check). The unblock (+153 s) fell between
  `ping-restart` and `ping-exit`, but OpenVPN did not reconnect before `ping-exit`.
- **C1 reproduced** (130 s silent block from 17:20:16): `ping-restart` at +119 s, reconnect at
  17:22:31 with "Pulled options changed on restart, will need to close and reopen TUN/TAP device",
  a new address, and NM's `unable to configure IPv4 route ... table 200`. From 17:22:32, NM showed
  `activated`, table 200 was empty, rule 100 was present, and the guest left through the uplink
  for the whole 4 min watched, until healed by switch OFF/ON. The agent did nothing (D2), so
  `down()`/`up()` on lost routes is **not proven** on the real build. HA never showed
  `connected`, but only because every state was `error`. `tunnelHealth` does flag the captured C1
  state (`benchFixtures.test.ts`).
- Home stand-in (`localBridge`), sampled every 2 s from 17:00:23 to 17:27:41 (763 samples): on
  the uplink on every sample, except two inside the deliberate step-4 failure (17:27:24 and
  17:27:27).

### Step 4: the 12:09 failure and the staged revert

`scripts/bench/80-staged-revert.sh`, run through `vm.sh qga`:
- Healthy start (fixed `internal.xml`): bindings as on the host, home 204, guest 204.
- The host's `internal.xml` (stale `enp15s0`) copied back, then `firewall-cmd --reload`: rc 13,
  firewalld `not running`, `firewalld_policy_drop` present, home 000, guest 000; firewalld logs
  `Could not process rule: No such file or directory`.
- `nft delete table inet firewalld_policy_drop`: rc 0 in 17 ms; home 204 and guest 204 on the
  next probe, although firewalld is still `not running`.
- Zone backup restored, then `systemctl restart firewalld` (0.9 s): `running`, no DROP table,
  home 204, guest 204, every binding as on the host, `nvguest0` in `external`. The only error is
  the known, harmless Docker `NAME_CONFLICT`.

### Re-run of Steps 2 and 3 after the fixes

2026-11-09, bench clock UTC, 17:43–18:00. The `.deb` was built from `feat/guest-vpn` at `2a77517`
(fixes `46574cd` D1–D3, `6aa71a2` D4, `2a77517` test helpers out of the executable) and
installed in the VM after `rm -rf /opt/mqtt-system-agent` and deleting every `nivuus-guest-vpn*`
profile and certificate. Host: snapshots `t9f-pre` / `t9f-post` identical (`same:` x5, empty
firewalld journal), 18 connectivity checks, all 204. Logs: `/root/work/guest-vpn-bench/t9f/vm-logs/`.

The fixes, as the captures dictate (nmcli 1.52.1):
- D1: the keyfile comes from `nmcli -g UUID,FILENAME connection show` (list form).
- D2: the status reads `-t -f vpn.data,GENERAL.STATE,IP4.DNS`. `VPN.*` cannot be selected with
  `-f` at all (`-f VPN` selects the `vpn` setting); for a VPN, NM derives GENERAL.STATE from the
  VPN state (`nm-vpn-connection.c`, `_state_to_ac_state`), so it is enough.
- D3: the cause is nmcli's `nmc_activation_get_effective_state` (libnmc-base): an activating
  connection whose device is a bridge in IP_CONFIG..ACTIVATED counts as activated ("controller
  waiting for ports"), so `--wait` does not help. `up()` now polls `-t -f GENERAL.STATE` by UUID:
  `activated` = success, gone = failure (NM removes a failed VPN's active connection: wrong
  password, gone 2.6 s after `up`), still `activating` after 90 s = cancel (`down`) and fail.
- D4: `ReadWritePaths=` removed (no-op with `ProtectSystem=false`; the agent creates `cache/`).

| Check | Result |
| --- | --- |
| Fresh install, no `cache/` | unit `active (running)`, no 226/NAMESPACE; `cache/` still absent |
| Import (client.py) | `connected` in 2.1 s, staging `_a`, `-ca.pem`/`-tls-auth.pem` as `_a-` |
| Re-import while up | `connected` in 6.4 s, profile now `_b`, `_a` certificates removed, old tunnel down 17:44:27, new one activated 17:44:33 (the exit-IP logger was not yet running) |
| Wrong password (import while up) | import reply `error`, `activation_failed: true` in 3.3 s; `up` attempts at 17:45:05.5 (import), 08.3, 36.7, 46:06.5, 47:06.5, 49:06.7, next published 53:06.6: spacing 28, 30, 60, 120, 240 s (the 15 s step lands on the second tick) |
| Switch OFF / ON (MQTT) | `disabled` and guest on the uplink within 2 s; `connected` 2 s after ON, guest on the provider |
| Agent restart, tunnel up | no `up`/`down`, guest on the provider on every sample, `connected` on the first tick |
| Plain outage (150 s silent drop of UDP from 1194, from 17:51:32) | DNAT removed at +7 s (first failed DNS probe), `down` at +22 s, guest on the uplink at **+23 s** (was 181 s); retry `up` activating 62 s then dropped (NM's 60 s VPN timeout), next `up` 15 s later; guest back on the provider 9 s after the unblock |
| C1 (130 s silent block, agent stopped so it could not pre-empt C1) | from 17:58:30 NM `activated`, table 200 empty, rule 100 present, guest on the uplink. Agent started 17:58:52: `error` with the fault at 17:58:53 (**1 s**), DNAT removed 17:58:54, `down` 17:59:08, `up` 17:59:23, `connected` and guest on the provider at 17:59:25: **32 s** from detection to recovery; `connected` never shown during C1 |
| Home stand-in (`localBridge`) | 448 samples every 2 s, 17:44:51–18:00:41: 0 off the uplink (the logger was not running 17:43:25–17:44:51: `/root/exit-ip-logger.sh` is not executable; it now runs as `bash /root/exit-ip-logger.sh`) |

Remaining (not fixed here):
- An import whose activation fails is not counted by the backoff: the next tick retries at once
  (17:45:08, 3 s after the import's attempt).
- The backoff runs from the start of the failed attempt; an attempt that times out after 60 s
  therefore publishes a `next_attempt` already in the past (17:53:21 published 17:52:50).
- `postinst.sh` enables the unit by path (`systemctl enable /lib/systemd/system/...`), which
  links `/etc/systemd/system/mqtt-system-agent.service`; with merged `/usr`, `is-enabled` then
  fails ("Too many levels of symbolic links") and `prerm.sh`'s `systemctl disable` refuses a
  linked unit, so `dpkg -P` fails under `set -e`.

The bench now holds the fixed package, profile `nivuus-guest-vpn` (`_b`, password in its keyfile),
the desired state ON, `/root/t9f/` (scripts, logs, `wrong.txt` with the username and a wrong
password), mosquitto, `/etc/mqtt-system-agent.env`, and the old DNS dispatcher hook in
`/root/old-bench/`. The VM is shut down; no `.deb` is left on the bench or in the worktree.
