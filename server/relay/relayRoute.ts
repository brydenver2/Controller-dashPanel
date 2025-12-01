/**
 * @fileoverview Relay route and service for proxying requests to nodejs-poolController backend.
 * 
 * This module provides:
 * - HTTP request relay/proxy to the backend pool controller
 * - Socket.IO connection relay for real-time events
 * - Bidirectional event forwarding between dashboard clients and backend
 * 
 * The relay pattern allows the dashboard to:
 * - Act as a proxy to the backend for all /njsPC/* requests
 * - Forward Socket.IO events from backend to connected dashboard clients
 * - Send commands from dashboard clients to the backend
 * 
 * @module server/relay/relayRoute
 */

import * as express from "express";
import * as http from "http";
import * as url from "url";
import * as extend from 'extend';
import { ApiError } from '../Errors';
import { config } from "../config/Config";
import { logger } from "../logger/Logger";
import { utils } from "../../server/Constants";
import { io as sockClient, Socket } from "socket.io-client";
// import { DefaultEventsMap } from "socket.io-client/build/typed-events";
import { DefaultEventsMap } from "@socket.io/component-emitter";
import { webApp } from "../Server";

/**
 * Express route handler for relay endpoints.
 * 
 * Registers the /njsPC/* catch-all route that proxies all requests
 * to the backend nodejs-poolController server.
 */
export class RelayRoute {
    /**
     * Initializes relay routes on the Express application.
     * 
     * Registers a catch-all route that forwards all /njsPC/* requests
     * to the backend pool controller server.
     * 
     * @param {express.Application} app - The Express application instance
     * 
     * @example
     * // Request to /njsPC/state/temps
     * // Proxied to: http://backend:4200/state/temps
     */
    public static initRoutes(app: express.Application) {
        app.all('/njsPC/*', async (req, res, next) => {
            try {
                await njsPCRelay.relayRequest(req, res, next);
            }
            catch (err) { next(err); }
        });
        //app.get('/njsPC/*', async (req, res, next) => {
        //    try {
        //        // Lets route this back to njsPC.
        //        await njsPCRelay.relayRequest(req, res, next);
        //    }
        //    catch (err) { next(err); };
        //});
        //app.put('/njsPC/*', async (req, res, next) => {
        //    try {
        //        await njsPCRelay.relayRequest(req, res, next);
        //    }
        //    catch (err) { next(err); }
        //});
        //app.search('/njsPC/*', async (req, res, next) => {
        //    try {
        //        await njsPCRelay.relayRequest(req, res, next);
        //    }
        //    catch (err) { next(err); }
        //});
        //app.delete('/njsPC/*', async (req, res, next) => {
        //    try {
        //        await njsPCRelay.relayRequest(req, res, next);
        //    }
        //    catch (err) { next(err); }
        //});
        //app.head('/njsPC/*', async (req, res, next) => {
        //    try {
        //        await njsPCRelay.relayRequest(req, res, next);
        //    }
        //    catch (err) { next(err); }
        //});
        //app.patch('/njsPC/*', async (req, res, next) => {
        //    try {
        //        await njsPCRelay.relayRequest(req, res, next);
        //    }
        //    catch (err) { next(err); }
        //});


    }

}

/**
 * Service relay class for managing backend communication.
 * 
 * Handles:
 * - HTTP request proxying to the backend pool controller
 * - Socket.IO connection management and event forwarding
 * - Automatic reconnection handling
 * 
 * Events from the backend are categorized:
 * - rs485Stats: Sent to 'rs485PortStats' channel for port statistics
 * - logMessage: Sent to 'msgLogger' channel for message logging
 * - All others: Broadcast to all connected dashboard clients
 */
class ServiceRelay {
    /** URL prefix for proxied requests */
    public prefix = '/njsPC';

    /** Whether to use proxy mode (forward events from backend) */
    public useProxy = false;

    /** Backend HTTP service configuration */
    public service: { protocol?: string, hostname?: string, port?: number, options?: any } = {};

    /** Backend Socket.IO configuration */
    public socket: { protocol?: string, hostname?: string, port?: number, options?: any } = {};

    /** @protected Socket.IO client connection to backend */
    protected _sockClient: Socket<DefaultEventsMap, DefaultEventsMap>;

    /**
     * Initializes the service relay with current configuration.
     * 
     * Reads configuration from 'web.services' section and establishes
     * Socket.IO connection to the backend if proxy mode is enabled.
     */
    public init() {
        let cfg = config.getSection('web.services');
        this.service.protocol = cfg.protocol;
        this.service.hostname = cfg.ip;
        this.service.port = cfg.port;
        this.useProxy = utils.makeBool(cfg.useProxy);
        this.socket.protocol = cfg.socket.protocol || this.service.protocol;
        this.socket.hostname = cfg.socket.hostname || this.service.hostname;
        this.socket.port = cfg.socket.port || this.service.port;
        this.socket.options = extend(true, { reconnectionDelay: 2000, reconnection: true, reconnectionDelayMax: 20000, transports: ['websocket'], upgrade: true, }, this.socket.options);
        this.initSockets();
    }

    /**
     * Gets the full Socket.IO URL for the backend connection.
     * @returns {string} The socket URL (e.g., "ws://127.0.0.1:4200")
     */
    public get socketUrl() { return `${this.socket.protocol}${this.socket.hostname}${typeof this.socket.port !== 'undefined' ? ':' + this.socket.port : ''}` }

    /**
     * Gets the full HTTP service URL for the backend.
     * @returns {string} The service URL (e.g., "http://127.0.0.1:4200")
     */
    public get serviceUrl() { return `${this.service.protocol}${this.service.hostname}${typeof this.service.port !== 'undefined' ? ':' + this.service.port : ''}` };

    /**
     * Initializes Socket.IO client connection to the backend.
     * 
     * Sets up event handlers for:
     * - Connection lifecycle (connect, disconnect, reconnect)
     * - Error handling (connect_error, connect_timeout)
     * - Event forwarding (all events from backend to dashboard clients)
     * 
     * @private
     */
    private initSockets() {
        if (typeof this._sockClient !== 'undefined') {
            if (!this._sockClient.disconnected) this._sockClient.disconnect();
            this._sockClient = undefined;
        }
        if (this.useProxy) {
            this._sockClient = sockClient(this.socketUrl, this.socket.options);
            if (typeof this._sockClient == 'undefined') {
                logger.warn(`Cannot open njsPC socket ${this.socketUrl}`);
                return;
            }
            this._sockClient.on('connect_error', (err) => { logger.error(`njsPC socket connection error: ${err}`); });
            this._sockClient.on('connect_timeout', () => { logger.error(`njsPC socket connection timeout`); });
            this._sockClient.on('reconnect', (attempts) => { logger.info(`njsPC socket reconnected after ${attempts}`); });
            this._sockClient.on('reconnect_attempt', () => { logger.warn(`njsPC socket attempting to reconnect`); });
            this._sockClient.on('reconnecting', (attempts) => { logger.warn(`njsPC socket attempting to reconnect: ${attempts}`); });
            this._sockClient.on('reconnect_failed', (err) => { logger.warn(`njsPC socket failed to reconnect: ${err}`); });
            this._sockClient.on('close', () => { logger.info(`njsPC socket closed`); });
            this._sockClient.on('connect', () => {
                logger.info(`njsPC socket connected`);
                this._sockClient.onAny((evt, data) => {
                    //logger.info(`Received ${evt}`);
                    switch (evt) {
                        case 'rs485Stats':
                            webApp.emitToChannel('rs485PortStats', evt, data);
                            break;
                        case 'logMessage':
                            webApp.emitToChannel('msgLogger', evt, data);
                            break;
                        default:
                            webApp.emitToClients(evt, data);
                            break;
                    }
                });
            });
            logger.info(`Opening socket ${this.socketUrl}`);
        }
    }

    /**
     * Relays a Socket.IO event to the backend server.
     * 
     * @param {string} evt - Event name to emit
     * @param {...any} data - Event data to send
     */
    public relaySocket(evt, ...data) {
        this._sockClient.emit(evt, data);
    }

    /**
     * Proxies an HTTP request to the backend pool controller.
     * 
     * Strips the /njsPC prefix from the URL and forwards the request
     * to the configured backend service. Response is piped back to
     * the original client.
     * 
     * @param {express.Request} req - The incoming Express request
     * @param {express.Response} res - The Express response object
     * @param {express.NextFunction} next - Express next middleware function
     * @returns {Promise<void>}
     */
    public async relayRequest(req: express.Request, res, next: express.NextFunction) {
        try {
            let proxyUrl = `${this.serviceUrl}${req.url.replace('/njsPC', '')}`;
            logger.info(`Relaying request: ${proxyUrl}`);
            let uri = url.parse(proxyUrl);
            let headers = {};
            if (typeof req.headers.connection !== 'undefined') headers['connection'] = req.headers.connection;
            if (typeof req.headers.accept !== 'undefined') headers['accept'] = req.headers.accept;
            if (typeof req.headers['user-agent'] !== 'undefined') headers['user-agent'] = req.headers['user-agent'];
            if (typeof req.headers['content-type'] !== 'undefined') headers['content-type'] = req.headers['content-type'];
            if (typeof req.headers['content-length'] !== 'undefined') headers['content-length'] = req.headers['content-length'];
            let opts = {
                protocol: uri.protocol, hostname: uri.hostname, path: uri.path, port: uri.port,
                headers: headers,
                method: req.method,
                agent: false
            };
            opts = extend(true, opts, this.service.options);
            await new Promise<void>((resolve, reject) => {
                let reqProxy = http.request(opts);
                reqProxy.on('response', (pres) => {
                    res.writeHead(pres.statusCode, pres.headers);
                    pres.pipe(res);
                    resolve();
                });
                // Sometimes the content-length of the request is not defined yet there is an empty body object.  This is something
                // that express does but we will use the content-length header to determine whether there will be content on the proxied request.
                if (typeof req.body !== 'undefined' && req.body && typeof headers['content-length'] !== 'undefined') {
                    let body = JSON.stringify(req.body);
                    const headerLen = (req.headers['content-length'] || '').toString();
                    logger.verbose(`Evaluating request body for relay: length=${body.length} headerLen=${headerLen}`);
                    if (body && body.length > 0) {
                        // If the original header declared 0 length but express/json parser produced an empty object/array, skip sending body.
                        if (headerLen === '0' && (body === '{}' || body === '[]')) {
                            logger.verbose(`Suppressing empty JSON body for ${uri.href} (header length 0, derived length ${body.length}).`);
                        }
                        else {
                            if (body.length.toString() !== headerLen && headerLen !== '0') {
                                // Downgrade to debug to avoid noisy warnings for harmless mismatches; ideally we would adjust the header earlier.
                                logger.debug(`Content-Length mismatch for ${uri.href}: Body: ${body.length} !== Header: ${headerLen}`);
                            }
                            reqProxy.write(body, (err) => {
                                if (err) logger.error(`Error writing response body: ${uri.href}: ${err.message}`);
                            });
                        }
                    }
                }
                reqProxy.on('error', (err) => {
                    logger.error(`Error relaying request ${uri.href}: ${err.message}`);
                    reject(err);
                });
                reqProxy.end();
            });
        }
        catch (err) { next(err); }
    }
}

/**
 * Singleton service relay instance.
 * Use this throughout the application to relay requests/events to the backend.
 * 
 * @type {ServiceRelay}
 */
export let njsPCRelay = new ServiceRelay();