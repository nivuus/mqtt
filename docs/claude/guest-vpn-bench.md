# Guest VPN bench VM

An isolated VM that mirrors the live router's NetworkManager and firewalld setup, so that
firewall and VPN mechanisms can be tried without touching the host. Findings live in
[guest-vpn-host-notes.md](guest-vpn-host-notes.md). The scripts are in `scripts/bench/` and are
not packaged.

## Isolation contract

- The VM's only NIC is QEMU user-mode networking (`-netdev user`, slirp). No tap, no bridge, no
  libvirt network, no libvirt domain: nothing on the host binds to a firewalld zone, and the VM's
  traffic leaves the host as ordinary host-originated sockets.
- Before and after every VM start, run `scripts/bench/host-snapshot.sh <label>` on the host and
  compare with `host-snapshot.sh --diff <a> <b>`. It records `nft list tables`, link names,
  `ip rule`/`ip -6 rule`, `firewall-cmd --get-active-zones`, the firewalld journal since the
  first snapshot, and a connectivity check. Every comparison must print `same:` five times and
  an empty journal.
- Everything that changes networking runs inside the VM. Host-side commands are read-only.

## Layout

| Item | Value |
| --- | --- |
| Work dir (host) | `/root/work/guest-vpn-bench` (disk, seed, SSH key, snapshots) |
| Base image | `debian-13-genericcloud-amd64.qcow2` from cloud.debian.org, SHA512 checked against `SHA512SUMS` |
| Disk | `bench.qcow2`, a 12 GiB overlay on `img/base.qcow2` |
| VM | KVM, 2 vCPU, 2 GiB, cloud-init NoCloud seed (`seed.iso`, root SSH key only) |
| Access | `ssh -p 2422 root@127.0.0.1` (host port 2222 is taken); QEMU guest agent on `qga.sock` |
| Versions | NetworkManager 1.52.1, firewalld 2.3.1 (nftables), nftables 1.1.3, network-manager-openvpn 1.12.3, OpenVPN 2.6.14, docker-ce 29.9.3, the same as the host |

Inside the VM, every name is the host's name:

| Interface | How | Zone (source) |
| --- | --- | --- |
| `enp0s2` | QEMU uplink, NM-unmanaged (like `enp5s0.832`) | `external` (permanent, `external.xml` renamed) |
| `localBridge` | NM bridge, `ipv4.method shared` 192.168.0.1/24, IPv6 manual | `home` (NM) |
| `enp15s0` | NM dummy, port of `localBridge` | `home` (NM), and `internal` in the host's `internal.xml` |
| `publicBridge` | NM bridge, shared 192.168.2.1/24 | `public` (NM) |
| `internalBridge` + `vnet17` | NM bridge + NM tap port | `internal` (NM) |
| `enp5s0`, `enp5s0.835` | NM dummy + VLAN | `drop` (NM) |
| `wpan0` | unmanaged tun | `trusted` (permanent) |
| `docker0` + 19 `br-*` | Docker networks `bench1..19` | `docker` |
| netns `homedev` | veth `homedev-h` in `localBridge`, 192.168.0.50 | home-device stand-in |
| netns `guest` | veth `guest-h` in `publicBridge`, 192.168.2.50, fd00:0:0:20::50 | guest stand-in |

`/etc/firewalld` is a copy of the host's (zones, policies, services, `direct.xml`,
`firewalld.conf`); the only edit is `enp5s0.832` → `enp0s2` in `external.xml`. Docker's
`daemon.json` has `"iptables": false` as on the host.

## Rebuild from scratch

On the host (all paths absolute, `S=/root/work/mqtt-guest-vpn/scripts/bench`,
`W=/root/work/guest-vpn-bench`):

1. Fetch and verify the image: download `SHA512SUMS` and
   `debian-13-genericcloud-amd64.qcow2` from
   `https://cloud.debian.org/images/cloud/trixie/latest/`, then
   `grep " debian-13-genericcloud-amd64.qcow2$" SHA512SUMS | sha512sum -c -`. Copy it to
   `$W/img/base.qcow2` and create the overlay:
   `qemu-img create -f qcow2 -F qcow2 -b $W/img/base.qcow2 $W/bench.qcow2 12G`.
2. `ssh-keygen -t ed25519 -N "" -f $W/bench_key`, write a NoCloud `user-data` that installs the
   public key for root plus a `meta-data`, and build the seed:
   `xorriso -as mkisofs -output $W/seed.iso -volid cidata -joliet -rock user-data meta-data`.
3. `$S/host-snapshot.sh pre && $S/vm.sh start && $S/host-snapshot.sh post && $S/host-snapshot.sh --diff pre post`.
4. `$S/vm.sh ssh bash -s < $S/10-install.sh`, then `apt-get install qemu-guest-agent python3-gi gir1.2-nm-1.0 bc`
   in the VM.
5. Copy the host's firewalld config: `tar -C / -czf $W/host-firewalld.tgz etc/firewalld`
   (read-only on the host), copy it in and unpack it as `/root/host-firewalld`.
6. `$S/vm.sh ssh bash -s < $S/20-topology.sh`, then copy `25-standins.sh` to `/root/` and run
   it (after every VM boot too: network namespaces do not persist).

## Scripts

| Script | Where | Purpose |
| --- | --- | --- |
| `vm.sh start/stop/ssh/scp/qga` | host | Run the VM; `qga` runs a command through the guest agent when the bench's firewall has locked SSH out |
| `host-snapshot.sh` | host | Read-only proof that the host did not change |
| `10-install.sh`, `20-topology.sh`, `25-standins.sh` | VM | Build the bench (above) |
| `31-capture-failing-blob.sh` + `nft-index-check.py` | VM | Capture the ruleset just before a failing firewalld transaction and replay the blob against it to name the command nft rejects |
| `34-reload-matrix.sh unfixed\|fixed` | VM, via `qga` | Reproduce the 12:09 incident and check the fix |
| `40-vpn-profile.sh` + `set-vpn-secrets.py` | VM | Import the ZoogVPN profile as `nivuus-guest-vpn` with the plan's settings; credentials are read from `/root/vpn/auth.txt` by libnm, never in argv |
| `exit-ip-logger.sh` | VM, `systemd-run --unit=exit-ip-logger` | Every 2 s: public exit IP of the bench, `homedev` and `guest` to `/root/exit-ip.log` |
| `50-block-endpoint.sh` | VM, `systemd-run` | Block the OpenVPN endpoint (output EPERM or silent input drop), then watch recovery |
| `90-nivuus-guest-vpn-dns.dispatcher` | VM, `/etc/NetworkManager/dispatcher.d/` | Bench DNS DNAT while the tunnel is up |
| `60-dns-and-reload.sh` | VM | Leak test, IPv6 DNS, survival across `firewall-cmd --reload` and firewalld restart |
| `70-fallback-and-import.sh` | VM | Fallback timings and import behaviour of path-taking directives |

Run one long test at a time: the block tests and the logger share files in `/root/`.

## Credentials

The `.ovpn` and the credentials file are copied with `scp` to `/root/vpn/` (0700 dir, 0600
files). `set-vpn-secrets.py` reads the file itself and stores the secret through libnm with
`password-flags=0`; nothing secret is passed in argv, printed or logged. The VM disk holds the
password in the profile's keyfile (0600): treat `bench.qcow2` as a secret.

## State left behind

The VM is shut down with its disk kept. On the next boot, run `25-standins.sh`. Bring the tunnel
up with `nmcli connection up nivuus-guest-vpn ifname publicBridge`, or re-activate
`bridge-publicBridge`: it lists the VPN in `connection.secondaries`.

The bench now differs from a fresh `20-topology.sh` + `40-vpn-profile.sh` run because of the
last experiments:
- `internal.xml` carries the 12:09 fix: no `enp15s0`. Restore with `34-reload-matrix.sh unfixed`
  (through `vm.sh qga`).
- `external.xml` lists `nvguest0` permanently.
- The VPN profile has `ipv6.ignore-auto-routes yes`, `vpn.persistent yes` and
  `vpn.data ping-exit=60`.
- The DNS dispatcher hook is installed.
- `/root/exit-ip-final.log` keeps the exit-IP log of the run. Bench clock is UTC.
