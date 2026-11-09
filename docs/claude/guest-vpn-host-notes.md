# Guest VPN: bench findings (plan Task 1)

Measured on 2026-11-09 on the isolated bench VM described in
[guest-vpn-bench.md](guest-vpn-bench.md): the same package versions as the host (NM 1.52.1,
firewalld 2.3.1 nftables, nftables 1.1.3, nm-openvpn 1.12.3, OpenVPN 2.6.14, docker-ce 29.9.3),
the host's `/etc/firewalld` copied verbatim, and the same interface names and NM zones. Nothing
was changed on the live host. Every host snapshot (nft tables, links, `ip rule`, active zones,
firewalld journal) taken before, during and after the VM runs is identical to the first one.

## Read this first

1. **Any `firewall-cmd --reload` on the live host today cuts the home LAN**, exactly as at 12:09,
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
