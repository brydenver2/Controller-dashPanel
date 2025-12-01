/**
 * @fileoverview Logging system for the dashPanel application.
 * 
 * Provides a Winston-based logging wrapper with configurable log levels.
 * The logger is a singleton instance that should be used throughout the application.
 * 
 * Log levels (in order of priority):
 * - error: Error conditions
 * - warn: Warning conditions
 * - info: Informational messages
 * - verbose: Detailed informational messages
 * - debug: Debug-level messages
 * - silly: Extremely detailed debug messages
 * 
 * @module server/logger/Logger
 */

import * as path from 'path';
import * as fs from 'fs';
import * as winston from 'winston';
import * as os from 'os';
import { config } from '../config/Config';

/**
 * Logger class providing Winston-based logging functionality.
 * 
 * This class wraps Winston logger to provide a consistent logging interface
 * throughout the application. It reads configuration from the 'log' section
 * of the application configuration.
 * 
 * @example
 * import { logger } from './logger/Logger';
 * 
 * logger.info('Server started on port %s', 5150);
 * logger.error('Failed to connect: %s', error.message);
 */
class Logger {
    /**
     * Creates a new Logger instance.
     * Loads configuration from the 'log' config section.
     */
    constructor() {
        this.cfg = config.getSection('log');
    }

    /** @private Configuration object from 'log' section */
    private cfg;

    /** @private Winston logger instance */
    private _logger: winston.Logger;

    /**
     * Initializes the Winston logger with configured settings.
     * 
     * Creates a Winston logger with:
     * - Log level from configuration (default: 'info')
     * - Colorized console output
     * - String interpolation support (splat)
     * - Simple format output
     */
    public init() {
        logger._logger = winston.createLogger({
            level: logger.cfg.app.level,
            format: winston.format.combine(winston.format.colorize(), winston.format.splat(), winston.format.simple()),
            transports: [new winston.transports.Console()]
        });
    }

    /**
     * Logs an informational message.
     * @param {...any} args - Message and optional format arguments
     */
    public info(...args: any[]) { logger._logger.info.apply(logger._logger, arguments); }

    /**
     * Logs a warning message.
     * @param {...any} args - Message and optional format arguments
     */
    public warn(...args: any[]) { logger._logger.warn.apply(logger._logger, arguments); }

    /**
     * Logs a verbose message.
     * @param {...any} args - Message and optional format arguments
     */
    public verbose(...args: any[]) { logger._logger.verbose.apply(logger._logger, arguments); }

    /**
     * Logs a debug message.
     * @param {...any} args - Message and optional format arguments
     */
    public debug(...args: any[]) { logger._logger.debug.apply(logger._logger, arguments); }

    /**
     * Logs an error message.
     * @param {...any} args - Message and optional format arguments
     */
    public error(...args: any[]) { logger._logger.error.apply(logger._logger, arguments); }

    /**
     * Logs a silly (trace-level) message.
     * @param {...any} args - Message and optional format arguments
     */
    public silly(...args: any[]) { logger._logger.silly.apply(logger._logger, arguments); }

    /**
     * Checks if a byte value is in the included array.
     * @private
     * @param {number} byte - The byte value to check
     * @param {number[]} arr - Array of included values
     * @returns {boolean} True if byte is in array or array is empty
     */
    private isIncluded(byte: number, arr: number[]): boolean {
        if (typeof(arr) === 'undefined' || !arr || arr.length === 0) return true;
        if (arr.indexOf(byte) !== -1) return true;
        return false;
    }

    /**
     * Checks if a byte value is in the excluded array.
     * @private
     * @param {number} byte - The byte value to check
     * @param {number[]} arr - Array of excluded values
     * @returns {boolean} True if byte is in the exclusion array
     */
    private isExcluded(byte: number, arr: number[]): boolean {
        if (typeof (arr) === 'undefined' || !arr) return false;
        if (arr && arr.length === 0) return false;
        if (arr.indexOf(byte) !== -1) return true;
        return false;
    }

    /**
     * Flushes any buffered log messages.
     * Currently a no-op placeholder for future implementation.
     */
    public flushLogs() {
    }
}

/**
 * Singleton logger instance.
 * Use this throughout the application for consistent logging.
 * 
 * @type {Logger}
 */
export var logger = new Logger();