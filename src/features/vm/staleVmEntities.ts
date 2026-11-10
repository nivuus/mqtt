// src/features/vm/staleVmEntities.ts
//
// Which retained VM entities belong to a VM libvirt no longer has.
//
// VmManager publishes one state sensor and three buttons per VM, all with
// retained discovery and a retained state. It used to forget a VM the moment
// virsh stopped listing it, so a deleted VM stayed in Home Assistant forever
// with its last state: "Windows-LTSC-test", a test guest removed after the
// installer's acceptance run, still read "running" months later. Reading the
// agent's own retained discovery back from the broker finds such leftovers
// whatever happened while the agent was down.

export const VM_ENTITY_SUFFIXES = ['state', 'start', 'stop', 'restart'] as const;
export type VmEntitySuffix = typeof VM_ENTITY_SUFFIXES[number];

export interface VmEntityRef {
  vmObjectId: string;
  suffix: VmEntitySuffix;
}

/**
 * The VM entity a retained discovery payload describes, or null when the
 * payload is not one of this feature's VM entities. `uniqueIdPrefix` is the
 * feature's unique_id prefix, e.g. `nivuus_vm_manager_`.
 */
export function vmEntityFromDiscovery(uniqueIdPrefix: string, payload: string): VmEntityRef | null {
  if (!payload) return null; // an empty retained payload is a removal
  let uniqueId: unknown;
  try {
    uniqueId = (JSON.parse(payload) as { unique_id?: unknown }).unique_id;
  } catch {
    return null; // not a discovery config of ours
  }
  if (typeof uniqueId !== 'string' || !uniqueId.startsWith(uniqueIdPrefix)) return null;
  const rest = uniqueId.slice(uniqueIdPrefix.length);
  for (const suffix of VM_ENTITY_SUFFIXES) {
    if (rest.endsWith(`_${suffix}`) && rest.length > suffix.length + 1) {
      return { vmObjectId: rest.slice(0, -(suffix.length + 1)), suffix };
    }
  }
  return null;
}

/**
 * True when the entity must be withdrawn. `liveVmObjectIds` is undefined
 * when virsh could not be read: then nothing is withdrawn, since an outage
 * of libvirt is not a deletion.
 */
export function isStale(ref: VmEntityRef, liveVmObjectIds: ReadonlySet<string> | undefined): boolean {
  return liveVmObjectIds !== undefined && !liveVmObjectIds.has(ref.vmObjectId);
}
