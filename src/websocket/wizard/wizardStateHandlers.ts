// src/websocket/wizard/wizardStateHandlers.ts

import { FeatureHandlers } from '../types';

interface WizardState {
  currentStep: number;
  steps: string[];
  completed: boolean;
  completedSteps: string[];
}

function initialState(): WizardState {
  return {
    currentStep: 0,
    steps: ['network', 'firewall', 'wifi', 'pppoe', 'vm', 'summary'],
    completed: false,
    completedSteps: [],
  };
}

/** Simple in-memory wizard state, one per handler set. */
export function createWizardStateHandlers(): FeatureHandlers {
  let wizardState = initialState();

  return {
    get_state: async () => wizardState,

    set_step: async (params) => {
      const { step } = params as { step: number | string };
      if (typeof step === 'number') {
        wizardState.currentStep = step;
      } else {
        const index = wizardState.steps.indexOf(step);
        if (index !== -1) wizardState.currentStep = index;
      }
      return wizardState;
    },

    complete: async () => {
      wizardState.completed = true;
      return wizardState;
    },

    reset: async () => {
      wizardState = initialState();
      return wizardState;
    },
  };
}
