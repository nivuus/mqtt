/**
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 */

import type {Config} from 'jest';

const config: Config = {
  clearMocks: true,
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageProvider: "v8",
  preset: "ts-jest",
  testEnvironment: "node",
  // Default testMatch also collects non-test files under __tests__/ (e.g. mocks
  // like MockMqttClient.ts), which Jest then fails for having no tests. Restrict
  // to files that actually declare tests.
  testMatch: ["**/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest"
  }
};

export default config;
