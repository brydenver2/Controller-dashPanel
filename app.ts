/**
 * @fileoverview Main application entry point for nodejs-poolController-dashPanel.
 * 
 * This file orchestrates the initialization sequence for the dashboard panel application,
 * which serves as a frontend relay to a separate nodejs-poolController backend server.
 * 
 * The initialization sequence is:
 * 1. Configuration - Load and merge default/user configuration
 * 2. Logger - Initialize Winston-based logging system
 * 3. Web Application - Start HTTP/HTTPS servers with Socket.IO
 * 4. Outbound Queues - Initialize message queue management
 * 
 * @module app
 * @author Russell Goldin (tagyoureit)
 * @license GPL-3.0
 */

import { logger } from "./server/logger/Logger";
import { config } from "./server/config/Config";
import { webApp } from "./server/Server";
import { outQueues } from "./server/queues/outboundQueue";
import { njsPCRelay } from "./server/relay/relayRoute";
import * as readline from 'readline';

/**
 * Initializes the application asynchronously in a specific order.
 * 
 * The initialization order is critical:
 * 1. config.init() - Ensures data directories exist
 * 2. logger.init() - Sets up Winston logger with configured log level
 * 3. webApp.init() - Starts HTTP/HTTPS servers and Socket.IO
 * 4. outQueues.init() - Loads outbound message queue descriptors
 * 
 * @returns {Promise<void>} Resolves when all components are initialized
 * 
 * @example
 * // Application startup
 * initAsync().then(() => {
 *   console.log('Application started successfully');
 * });
 */
export function initAsync() {
    return Promise.resolve()
        .then(function () { config.init(); })
        .then(function () { logger.init(); })
        .then(function () { webApp.init(); })
        .then(function () { outQueues.init(); })
}

/**
 * Gracefully shuts down the application.
 * 
 * This function is called when the application receives a SIGINT signal
 * (e.g., Ctrl+C in terminal). It logs the shutdown message and exits
 * the process.
 * 
 * @returns {Promise<void>} Resolves after initiating process exit
 */
export function stopAsync(): Promise<void> {
    return Promise.resolve()
        .then(function () { console.log('Shutting down open processes'); })
        .then(function () { process.exit(); });
}

// Platform-specific signal handling for graceful shutdown
if (process.platform === 'win32') {
    // Windows requires readline interface to capture SIGINT
    let rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on('SIGINT', function () { stopAsync(); });
}
else {
    // Unix-like systems can directly listen for SIGINT
    process.on('SIGINT', function () { return stopAsync(); });
}

// Start the application
initAsync();