// src/websocket/wizard/__tests__/systemHandlers.test.ts

import { WizardHandler } from '../../WizardHandler';
import { execute_argv, execute_command } from '../../../utils/exec';

jest.mock('../../../utils/exec', () => ({ execute_argv: jest.fn(), execute_command: jest.fn() }));

describe('wizard system actions', () => {
  it('has no apply_updates: package upgrades belong to the AptUpdates feature', async () => {
    const handler = new WizardHandler();
    await expect(handler.handleCommand({
      id: 't', type: 'action', feature: 'system', action: 'apply_updates', params: {},
    })).rejects.toThrow('Unknown action');
    expect(execute_argv).not.toHaveBeenCalled();
    expect(execute_command).not.toHaveBeenCalled();
  });
});
