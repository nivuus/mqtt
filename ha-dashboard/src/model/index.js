// Turns the agent's registry entries into a model the views read from.
// Pure: no Home Assistant connection, so it is unit-tested on fixtures.

import { indexByUniqueId } from '../registry.js';
import { Lookup } from './lookup.js';
import * as sys from './system.js';
import * as net from './network.js';
import * as ops from './operations.js';

export function buildModel(entries, states) {
  const q = new Lookup(indexByUniqueId(entries), states);
  const ifaces = net.interfaces(q);
  const pppoe = net.pppoe(q);
  return {
    cpu: sys.cpu(q),
    memory: sys.memory(q),
    gpu: sys.gpu(q),
    board: sys.board(q),
    ups: sys.ups(q),
    storage: sys.storage(q),
    interfaces: ifaces,
    bridges: net.bridges(q, ifaces),
    wan: net.wan(ifaces, pppoe),
    pppoe,
    guestVpn: net.guestVpn(q),
    firewall: net.firewall(q, ifaces),
    wifi: net.wifi(q),
    services: ops.services(q),
    vms: ops.vms(q),
    gaming: ops.gaming(q),
    updates: ops.updates(q),
    security: ops.security(q),
  };
}
