#!/usr/bin/env node
import { Agent } from './core/Agent';
import { initializeConfigManager, getConfigManager } from './config';
import logger, { initializeLogger } from './utils/logger';
import minimist from 'minimist';
import { runCli } from './cli/index';
import * as path from 'path';

// Parse command line arguments and determine mode (CLI vs agent)
const args = minimist(process.argv.slice(2));
const command = args._[0] as string;
// Determine config path: flag or default to workspace config/agent.yaml
const configPath = args.config || path.resolve(process.cwd(), 'config', 'agent.yaml');

// Initialize configuration and logger
try {
  initializeConfigManager(configPath);
  initializeLogger();
  const config = getConfigManager().config;
  logger.debug('Configuration loaded:', JSON.stringify(config, null, 2));
} catch (e: any) {
  console.error('Configuration error:', e.message);
  process.exit(1);
}

// Dispatch CLI or start agent
if (command === 'alert' || command === 'event') {
  runCli(command, args)
    .then(() => process.exit(0))
    .catch((err: any) => {
      console.error(err.message || err);
      process.exit(1);
    });
} else {
  const agent = new Agent();
  async function main() {
    try {
      await agent.start();
      logger.info('Agent started successfully. Press Ctrl+C to stop.');
    } catch (error: any) {
      logger.error('Failed to start agent:', error.message || error);
      process.exit(1);
    }
  }
  main();
}

// Graceful shutdown is handled by signal handlers in Agent.ts
