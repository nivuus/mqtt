import { vmEntityFromDiscovery, isStale } from '../staleVmEntities';

const PREFIX = 'nivuus_vm_manager_';
const config = (uniqueId: string) => JSON.stringify({ unique_id: uniqueId, name: 'x' });

describe('vmEntityFromDiscovery', () => {
  it('reads the VM and the entity kind, dashes included', () => {
    expect(vmEntityFromDiscovery(PREFIX, config('nivuus_vm_manager_Windows-LTSC-test_state')))
      .toEqual({ vmObjectId: 'Windows-LTSC-test', suffix: 'state' });
    expect(vmEntityFromDiscovery(PREFIX, config('nivuus_vm_manager_Windows_restart')))
      .toEqual({ vmObjectId: 'Windows', suffix: 'restart' });
  });

  it('ignores removals, other features and foreign payloads', () => {
    expect(vmEntityFromDiscovery(PREFIX, '')).toBeNull();
    expect(vmEntityFromDiscovery(PREFIX, config('nivuus_firewalld_manager_home_services'))).toBeNull();
    expect(vmEntityFromDiscovery(PREFIX, 'not json')).toBeNull();
    expect(vmEntityFromDiscovery(PREFIX, config('nivuus_vm_manager_state'))).toBeNull();
  });
});

describe('isStale', () => {
  const ref = { vmObjectId: 'Windows-LTSC-test', suffix: 'state' as const };

  it('withdraws a VM libvirt no longer lists', () => {
    expect(isStale(ref, new Set(['Windows']))).toBe(true);
    expect(isStale({ ...ref, vmObjectId: 'Windows' }, new Set(['Windows']))).toBe(false);
  });

  it('withdraws nothing when virsh could not be read', () => {
    expect(isStale(ref, undefined)).toBe(false);
  });
});
