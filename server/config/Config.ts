/**
 * @fileoverview Configuration management for the dashPanel application.
 * 
 * Handles loading, merging, and persisting application configuration.
 * Configuration sources (in order of priority):
 * 1. Environment variables (POOL_WEB_* prefix)
 * 2. User config.json file
 * 3. Default configuration (defaultConfig.json)
 * 
 * The configuration is automatically persisted to config.json when modified.
 * 
 * @module server/config/Config
 */

import * as path from 'path';
import * as fs from 'fs';
import * as extend from 'extend';
import { logger } from '../logger/Logger';

/**
 * Configuration management class.
 * 
 * Provides hierarchical configuration management with:
 * - Automatic merging of defaults with user configuration
 * - Support for dotted path notation (e.g., 'web.services.port')
 * - Environment variable overrides for Docker deployments
 * - Atomic file writes to prevent corruption
 * - Recovery from corrupted configuration files
 * 
 * @example
 * import { config } from './config/Config';
 * 
 * // Get a configuration section
 * const webConfig = config.getSection('web.services');
 * 
 * // Update a configuration section
 * config.setSection('web.services.port', 4200);
 */
class Config {
    /** @private Path to the configuration file */
    private cfgPath: string;

    /** @private The loaded configuration object */
    private _cfg: any;

    /** @private Flag indicating if configuration was successfully initialized */
    private _isInitialized: boolean = false;

    /**
     * Creates a new Config instance and loads configuration.
     * 
     * Initialization process:
     * 1. Load defaultConfig.json as base configuration
     * 2. Merge with existing config.json if present
     * 3. Handle migration from legacy config location
     * 4. Apply environment variable overrides
     * 5. Write merged configuration back to config.json
     * 
     * @throws {Error} If configuration cannot be read or parsed
     */
    constructor() {
        // Fixed configuration path relative to working directory.
        this.cfgPath = path.join(process.cwd(), 'config.json');
        const legacyRootCfg = path.sep + 'config.json';
        const defaultPath = path.join(process.cwd(), 'defaultConfig.json');
        const packagePath = path.join(process.cwd(), 'package.json');
        try {
            // Read defaults and package first
            const def = JSON.parse(fs.readFileSync(defaultPath, 'utf8').trim());
            const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8').trim());
            let existing: any = {};
            if (fs.existsSync(this.cfgPath)) {
                const attemptRead = () => {
                    const raw = fs.readFileSync(this.cfgPath, 'utf8');
                    if (raw.trim().length === 0) {
                        console.warn('config.json is empty; using defaults and will populate file on next write.');
                        return {};
                    }
                    return JSON.parse(raw);
                }
                try {
                    existing = attemptRead();
                } catch (parseErr) {
                    // Try stale tmp file if present (previous atomic write crash)
                    const tmpPath = this.cfgPath + '.tmp';
                    if (fs.existsSync(tmpPath)) {
                        try {
                            const rawTmp = fs.readFileSync(tmpPath, 'utf8');
                            if (rawTmp.trim().length > 0) {
                                existing = JSON.parse(rawTmp);
                                console.warn('Recovered configuration from temporary file.');
                            }
                        } catch {
                            // fall through to rebuild
                        }
                    }
                    if (!existing || Object.keys(existing).length === 0) {
                        console.warn(`config.json corrupt or unreadable (${parseErr}). Rebuilding from defaults.`);
                        // Backup bad file for inspection (if non-empty)
                        try {
                            const orig = fs.readFileSync(this.cfgPath);
                            if (orig.length > 0) fs.writeFileSync(this.cfgPath + '.corrupt', orig);
                        } catch { /* ignore */ }
                        existing = {};
                    }
                }
            } else if (fs.existsSync(legacyRootCfg)) {
                // Legacy location migration (/config.json at filesystem root)
                try {
                    const raw = fs.readFileSync(legacyRootCfg, 'utf8');
                    existing = JSON.parse(raw);
                    console.log('Migrating legacy /config.json to working directory.');
                } catch (e) {
                    console.warn(`Failed to read legacy /config.json (${e}). Ignoring.`);
                }
            }
            this._cfg = extend(true, {}, def, existing, { appVersion: { installed: packageJson.version } });
            this._isInitialized = true;
            this.getEnvVariables();
            this.update();
        } catch (err) {
            console.log(`Error reading configuration information.  Aborting startup: ${err}`);
            throw err;
        }
    }

    /**
     * Persists the current configuration to the config.json file.
     * 
     * Only writes if initialization was successful. Handles write permission
     * errors gracefully by disabling future write attempts.
     */
    public update() {
        // Don't overwrite the configuration if we failed during the initialization.
        try {
            if (!this._isInitialized) return;
            try {
                fs.writeFileSync(this.cfgPath, JSON.stringify(this._cfg, undefined, 2), { encoding: 'utf8' });
                console.log(`Updated configuration file`);
            } catch (e:any) {
                if (e && (e.code === 'EACCES' || e.code === 'EROFS')) {
                    console.error(`Configuration file not writable (${e.code}). Further config writes will be skipped. Mount a writable volume or adjust permissions for ${this.cfgPath}.`);
                    this._isInitialized = false; // suppress future attempts
                    return;
                }
                throw e;
            }
        }
        catch (err) { console.log(`Error writing configuration file ${err}`); }
    }

    /**
     * Sets a configuration section value.
     * 
     * Supports dotted path notation to set nested configuration values.
     * Automatically persists changes to config.json if the value changed.
     * 
     * @param {string} section - The configuration path (e.g., 'web.services.port')
     * @param {any} val - The value to set
     * 
     * @example
     * config.setSection('web.services.port', 4200);
     * config.setSection('log.app.level', 'debug');
     */
    public setSection(section: string, val) {
        let c = this._cfg;
        if (section.indexOf('.') !== -1) {
            let arr = section.split('.');
            for (let i = 0; i < arr.length - 1; i++) {
                if (typeof c[arr[i]] === 'undefined')
                    c[arr[i]] = {};
                c = c[arr[i]];
            }
            section = arr[arr.length - 1];
        }
        if (JSON.stringify(c[section]) === JSON.stringify(val)) {
            logger.silly(`setSection: Config section and val are identical.  Not updating.`)
        }
        else {
            c[section] = val;
            this.update();
        }
    }

    /**
     * Gets a configuration section value.
     * 
     * Supports dotted path notation to retrieve nested configuration values.
     * Returns a deep copy merged with optional default values.
     * 
     * @param {string} [section] - The configuration path (e.g., 'web.services'). If undefined, returns entire config.
     * @param {any} [opts] - Optional default values to merge with the result
     * @returns {any} The configuration value (deep copy)
     * 
     * @example
     * const webServices = config.getSection('web.services');
     * const logLevel = config.getSection('log.app.level');
     * const fullConfig = config.getSection(); // Returns entire config
     */
    public getSection(section?: string, opts?: any): any {
        if (typeof (section) === 'undefined') return this._cfg;
        var c: any = this._cfg;
        if (section.indexOf('.') !== -1) {
            var arr = section.split('.');
            for (let i = 0; i < arr.length; i++) {
                if (typeof (c[arr[i]]) === 'undefined') {
                    c = null;
                    break;
                }
                else
                    c = c[arr[i]];
            }
        }
        else
            c = c[section];
        return extend(true, {}, opts || {}, c || {});
    }

    /**
     * Initializes required data directories.
     * 
     * Creates the following directories if they don't exist:
     * - data/ - General data storage
     * - data/outQueues/ - Outbound message queue storage
     */
    public init() {
        let baseDir = process.cwd();
        this.ensurePath(baseDir + '/data/');
        this.ensurePath(baseDir + '/data/outQueues/');
    }

    /**
     * Ensures a directory path exists, creating it if necessary.
     * @private
     * @param {string} dir - The directory path to ensure
     */
    private ensurePath(dir: string) {
        fs.mkdir(dir, { recursive: true }, (err) => {
            if (err) console.log(`Error creating directory: ${dir} - ${err}`);
        });
    }

    /**
     * Applies environment variable overrides to configuration.
     * 
     * Supports both legacy and new hierarchical environment variables:
     * 
     * Legacy variables:
     * - POOL_HTTP_IP - Backend service IP
     * - POOL_HTTP_PORT - Backend service port
     * 
     * New hierarchical variables (POOL_WEB_* prefix):
     * - POOL_WEB_SERVERS_HTTP_PORT - HTTP server port
     * - POOL_WEB_SERVERS_HTTPS_PORT - HTTPS server port
     * - POOL_WEB_SERVICES_IP - Backend service IP
     * - POOL_WEB_SERVICES_PORT - Backend service port
     * - POOL_WEB_SERVICES_PROTOCOL - Backend protocol (http:// or https://)
     * 
     * @private
     */
    private getEnvVariables() {
        // set docker env variables to config.json, if they are set
        let env = process.env;
        // Legacy simple overrides (backward compatibility)
        if (typeof env.POOL_HTTP_IP !== 'undefined' && env.POOL_HTTP_IP !== this._cfg.web.services.ip) {
            this._cfg.web.services.ip = env.POOL_HTTP_IP;
        }
        if (typeof env.POOL_HTTP_PORT !== 'undefined') {
            const port = parseInt(env.POOL_HTTP_PORT, 10);
            if (!isNaN(port) && port !== this._cfg.web.services.port) this._cfg.web.services.port = port;
        }

        // Expanded hierarchical overrides using POOL_WEB_* naming convention
        // Examples expected from docker-compose comments:
        //   POOL_WEB_SERVERS_HTTP_PORT=5150
        //   POOL_WEB_SERVERS_HTTPS_PORT=5151
        //   POOL_WEB_SERVICES_IP=127.0.0.1
        //   POOL_WEB_SERVICES_PORT=4200
        //   POOL_WEB_SERVICES_PROTOCOL=http://
        // Mapping strategy: POOL_WEB_ prefix removed, remaining path split by '_' and applied to this._cfg.web.*
        Object.keys(env)
            .filter(k => k.startsWith('POOL_WEB_'))
            .forEach(k => {
                try {
                    const raw = env[k];
                    if (typeof raw === 'undefined') return;
                    const pathParts = k.replace('POOL_WEB_', '').toLowerCase().split('_');
                    // Special handling for servers.http.port and servers.https.port
                    // Recognize patterns: SERVERS_HTTP_PORT / SERVERS_HTTPS_PORT
                    let target = this._cfg.web;
                    if (pathParts[0] === 'servers') {
                        // servers.http.port => this._cfg.web.servers.http.port
                        if (pathParts.length >= 3) {
                            const proto = pathParts[1]; // http / https / http2
                            const field = pathParts[2]; // port or enabled etc.
                            if (!target.servers) target.servers = {};
                            if (!target.servers[proto]) target.servers[proto] = {};
                            if (field === 'port') {
                                const v = parseInt(raw, 10);
                                if (!isNaN(v)) target.servers[proto].port = v;
                            }
                            else if (field === 'enabled') {
                                target.servers[proto].enabled = ['true', '1', 'yes', 'on'].includes(raw.toLowerCase());
                            }
                            else {
                                target.servers[proto][field] = raw;
                            }
                        }
                        return; // handled
                    }
                    // services.* mapping: SERVICES_IP, SERVICES_PORT, SERVICES_PROTOCOL
                    if (pathParts[0] === 'services') {
                        if (!target.services) target.services = {};
                        if (pathParts.length >= 2) {
                            const field = pathParts[1];
                            if (field === 'port') {
                                const v = parseInt(raw, 10);
                                if (!isNaN(v)) target.services.port = v;
                            }
                            else {
                                target.services[field] = raw;
                            }
                        }
                        return;
                    }
                } catch (e) {
                    logger.warn(`Failed to apply env override ${k}: ${e}`);
                }
            });
    }
}

/**
 * Singleton configuration instance.
 * Use this throughout the application to access configuration.
 * 
 * @type {Config}
 * 
 * @example
 * import { config } from './config/Config';
 * 
 * const port = config.getSection('web.servers.http.port');
 */
export var config: Config = new Config();