// src/utils/logger.ts

import { getConfigManager } from '../config';

enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4, // To disable all logs if needed
}

interface Logger {
  debug: (...args: any[]) => void;
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  setLevel: (level: string) => void;
}

let currentLogLevel: LogLevel = LogLevel.INFO; // Default level

const getLogLevelFromString = (levelStr: string): LogLevel => {
  switch (levelStr?.toLowerCase()) {
    case 'debug':
      return LogLevel.DEBUG;
    case 'info':
      return LogLevel.INFO;
    case 'warn':
      return LogLevel.WARN;
    case 'error':
      return LogLevel.ERROR;
    default:
      // console.warn(`Invalid log level '${levelStr}' in config, defaulting to 'info'.`);
      return LogLevel.INFO;
  }
};

// Logger level will be initialized explicitly via initializeLogger() after ConfigManager is ready


const logger: Logger = {
  setLevel: (level: string) => {
    currentLogLevel = getLogLevelFromString(level);
  },
  debug: (...args: any[]) => {
    if (currentLogLevel <= LogLevel.DEBUG) {
      console.debug(...args);
    }
  },
  info: (...args: any[]) => {
    if (currentLogLevel <= LogLevel.INFO) {
      console.info(...args);
    }
  },
  warn: (...args: any[]) => {
    if (currentLogLevel <= LogLevel.WARN) {
      console.warn(...args);
    }
  },
  error: (...args: any[]) => {
    if (currentLogLevel <= LogLevel.ERROR) {
      console.error(...args);
    }
  },
};

/**
 * Initializes the logger with the level from the configuration.
 * This should be called after the ConfigManager is initialized.
 */
export function initializeLogger(): void {
  try {
    const configManager = getConfigManager();
    const levelFromConfig = configManager.config.logging?.level;
    if (levelFromConfig) {
      logger.setLevel(levelFromConfig);
      // logger.debug(`Logger initialized with level: ${levelFromConfig}`);
    } else {
      // logger.warn('Logging level not found in config, using default.');
    }
  } catch (error) {
    // console.error('Failed to initialize logger from config:', error);
    // Fallback to default if config is not available
    logger.setLevel('info');
  }
}


export default logger;
