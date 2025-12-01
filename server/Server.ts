/**
 * @fileoverview Web server implementation for the dashPanel application.
 * 
 * Provides multi-protocol server support including:
 * - HTTP server with Express.js
 * - HTTPS server with SSL/TLS support
 * - HTTP/2 server (placeholder for future implementation)
 * - Socket.IO for real-time WebSocket communication
 * - SSDP and mDNS discovery (placeholders)
 * 
 * The server acts as both a web server for the dashboard UI and a relay
 * for communication with the nodejs-poolController backend.
 * 
 * @module server/Server
 */

import * as os from 'os';
import * as path from "path";
import * as express from "express";
import * as fs from "fs";
import { URL } from "url";
import { Client } from "node-ssdp";
import { config } from "../server/config/Config";
import { logger } from "../server/logger/Logger";
import * as http2 from "http2";
import * as http from "http";
import * as https from "https";
import * as extend from 'extend';
import { ApiError } from './Errors';
import { UploadRoute, BackgroundUpload } from "./upload/upload";
import { setTimeout } from "timers";
import { ConfigRoute } from "./api/Config";
import { MessagesRoute } from "./api/Messages";
import { Timestamp, utils } from "./Constants";
import { RelayRoute, njsPCRelay } from "./relay/relayRoute";
import { Namespace, RemoteSocket, Server as SocketIoServer, Socket } from "socket.io";
import { DefaultEventsMap } from "socket.io/dist/typed-events";

/**
 * Main web server orchestrator class.
 * 
 * Manages multiple protocol servers (HTTP, HTTPS, HTTP/2) and provides
 * a unified interface for emitting events to connected clients.
 * 
 * @example
 * import { webApp } from './Server';
 * 
 * // Initialize all configured servers
 * webApp.init();
 * 
 * // Emit event to all connected clients
 * webApp.emitToClients('poolState', { temp: 78 });
 */
export class WebServer {
    /** @private Array of active protocol servers */
    private _servers: ProtoServer[] = []; 

    constructor() { }

    /**
     * Initializes all configured web servers.
     * 
     * Reads the 'web.servers' configuration section and initializes
     * appropriate server instances for each enabled protocol.
     */
    public init() {
        let cfg = config.getSection('web');
        let srv;
        for (let s in cfg.servers) {
            let c = cfg.servers[s];
            switch (s) {
                case 'http':
                    srv = new HttpServer();
                    this._servers.push(srv);
                    srv.init(c);
                    break;
                case 'https':
                    srv = new HttpsServer();
                    this._servers.push(srv);
                    srv.init(cfg.servers[s]);
                    break;
            }
        }
    }

    /**
     * Emits an event to all connected Socket.IO clients across all servers.
     * 
     * @param {string} evt - The event name to emit
     * @param {...any} data - Data to send with the event
     */
    public emitToClients(evt: string, ...data: any) {
        for (let i = 0; i < this._servers.length; i++) {
            this._servers[i].emitToClients(evt, ...data);
        }
    }

    /**
     * Emits an event to clients in a specific Socket.IO channel/room.
     * 
     * @param {string} channel - The channel/room name to emit to
     * @param {string} evt - The event name to emit
     * @param {...any} data - Data to send with the event
     */
    public emitToChannel(channel: string, evt: string, ...data: any) {
        for (let i = 0; i < this._servers.length; i++) {
            this._servers[i].emitToChannel(channel, evt, ...data);
        }
    }
}

/**
 * Base class for all protocol server implementations.
 * 
 * Provides common interface for server state and event emission.
 * @abstract
 */
class ProtoServer {
    /** Flag indicating if the server is currently running */
    public isRunning: boolean = false;

    /**
     * Emits an event to all connected clients.
     * @param {string} evt - Event name
     * @param {...any} data - Event data
     */
    public emitToClients(evt: string, ...data: any) {}

    /**
     * Emits an event to a specific channel.
     * @param {string} channel - Channel name
     * @param {string} evt - Event name
     * @param {...any} data - Event data
     */
    public emitToChannel(channel: string, evt: string, ...data: any) { }
}

/**
 * HTTP/2 server implementation (placeholder).
 * 
 * @extends ProtoServer
 */
export class Http2Server extends ProtoServer {
    /** The HTTP/2 server instance */
    public server: http2.Http2Server;

    /** Express application instance */
    public app: express.Application;

    /**
     * Initializes the HTTP/2 server.
     * @param {object} cfg - Server configuration
     */
    public init(cfg) {
        if (cfg.enabled) {
            this.app = express();
            // TODO: create a key and cert at some time but for now don't fart with it.
        }
    }
}

/**
 * HTTP server implementation with Socket.IO support.
 * 
 * Provides the main web server functionality including:
 * - Static file serving for the dashboard UI
 * - API route registration
 * - Socket.IO real-time communication
 * - CORS support for cross-origin requests
 * 
 * @extends ProtoServer
 */
export class HttpServer extends ProtoServer {
    /** Express application instance */
    public app: express.Application;

    /** Node.js HTTP server instance */
    public server: http.Server;

    /** @private IP address family preference */
    private family = 'IPv4';

    /** @private HTTP port number */
    private _httpPort: number;

    /**
     * Gets the network interface information for the server.
     * Finds the first non-internal IPv4 interface with a valid MAC address.
     * @private
     * @returns {os.NetworkInterfaceInfo|undefined} Network interface info or undefined
     */
    private getInterface() {
        const networkInterfaces = os.networkInterfaces();
        // RKS: We need to get the scope-local nic. This has nothing to do with IP4/6 and is not necessarily named en0 or specific to a particular nic.  We are
        // looking for the first IPv4 interface that has a mac address which will be the scope-local address.  However, in the future we can simply use the IPv6 interface
        // if that is returned on the local scope but I don't know if the node ssdp server supports it on all platforms.
        let fallback; // Use this for WSL adapters.
        for (let name in networkInterfaces) {
            let nic = networkInterfaces[name];
            for (let ndx in nic) {
                let addr = nic[ndx];
                // All scope-local addresses will have a mac.  In a multi-nic scenario we are simply grabbing
                // the first one we come across.
                if (!addr.internal && addr.mac.indexOf('00:00:00:') < 0 && addr.family === this.family) {
                    if (!addr.mac.startsWith('00:'))
                        return addr;
                    else if (typeof fallback === 'undefined') fallback = addr;
                }
            }
        }
        return fallback;
    }

    /**
     * Gets the server's IP address.
     * @returns {string} The IP address or '0.0.0.0' if not determined
     */
    public ip() { return typeof this.getInterface() === 'undefined' ? '0.0.0.0' : this.getInterface().address; }

    /**
     * Gets the server's MAC address.
     * @returns {string} The MAC address or '00:00:00:00' if not determined
     */
    public mac() { return typeof this.getInterface() === 'undefined' ? '00:00:00:00' : this.getInterface().mac; }

    /**
     * Gets the HTTP port number.
     * @returns {number} The configured HTTP port
     */
    public httpPort(): number { return this._httpPort }

    /**
     * Initializes the HTTP server with the provided configuration.
     * 
     * Sets up:
     * - Express application with middleware
     * - CORS headers for cross-origin requests
     * - Static file serving for UI assets
     * - API route handlers
     * - Socket.IO server for real-time communication
     * - Error handling middleware
     * 
     * @param {object} cfg - Server configuration object
     * @param {boolean} cfg.enabled - Whether to enable the server
     * @param {string} cfg.ip - IP address to bind to
     * @param {number} cfg.port - Port number to listen on
     * @param {boolean} [cfg.httpsRedirect] - Whether to redirect to HTTPS
     */
    public init(cfg) {
        if (cfg.enabled) {
            this.app = express();
            this._httpPort = cfg.port;
            //this.app.use();
            this.server = http.createServer(this.app);
            if (cfg.httpsRedirect) {
                var cfgHttps = config.getSection('web.server.https');
                this.app.get('*', (res: express.Response, req: express.Request) => {
                    let host = res.get('host');
                    host = typeof cfgHttps.port !== 'undefined' ? host.replace(/:\d+$/, ':' + cfgHttps.port) : host;
                    this._httpPort = cfgHttps.port;
                    return res.redirect('https://' + host + req.url);
                });
            }
            this.app.use((req, res, next) => {
                res.header('Access-Control-Allow-Origin', '*');
                res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
                res.header('Access-Control-Allow-Methods', 'OPTIONS, GET, POST, PUT, DELETE');
                if ('OPTIONS' === req.method) {
                    res.sendStatus(200);
                }
                else {
                    console.log(`${req.ip} ${req.method} ${req.url}`);
                    next();
                }
            });
            this.app.use(express.static(path.join(process.cwd(), 'pages'), { maxAge: '1d' }));
            this.app.use(express.json());
            // Put in a custom replacer so that we can send error messages to the client.  If we don't do this the base properties of Error
            // are omitted from the output.
            this.app.set('json replacer', (key, value) => {
                if (value instanceof Error) {
                    var err = {};
                    Object.getOwnPropertyNames(value).forEach((prop) => { err[prop] = value[prop]; });
                    //console.log('We have an error');
                    //console.log(err);
                    return err;
                }
                return value;
            });
            this.initSockets();
            // start our server on port
            let self = this;
            this.server.listen(cfg.port, cfg.ip, function () {
                //console.log(self);
                logger.info('Server is now listening on %s:%s - %s:%s', cfg.ip, cfg.port, self.ip(), self.httpPort());
            });
            this.app.use('/socket.io-client', express.static(path.join(process.cwd(), '/node_modules/socket.io-client/dist/'), { maxAge: '60d' }));
            this.app.use('/jquery', express.static(path.join(process.cwd(), '/node_modules/jquery/'), { maxAge: '60d' }));
            this.app.use('/jquery-ui', express.static(path.join(process.cwd(), '/node_modules/jquery-ui-dist/'), { maxAge: '60d' }));
            this.app.use('/jquery-ui-touch-punch', express.static(path.join(process.cwd(), '/node_modules/jquery-ui-touch-punch-c/'), { maxAge: '60d' }));
            this.app.use('/font-awesome', express.static(path.join(process.cwd(), '/node_modules/@fortawesome/fontawesome-free/'), { maxAge: '60d' }));
            this.app.use('/scripts', express.static(path.join(process.cwd(), '/scripts/'), { maxAge: '1d' }));
            this.app.use('/themes', express.static(path.join(process.cwd(), '/themes/'), { maxAge: '1d' }));
            this.app.use('/icons', express.static(path.join(process.cwd(), '/themes/icons'), { maxAge: '1d' }));
            RelayRoute.initRoutes(this.app);
            ConfigRoute.initRoutes(this.app);
            MessagesRoute.initRoutes(this.app);
            UploadRoute.initRoutes(this.app);
            // This is last so that it is picked up when we have an error.
            this.app.use((error, req, res, next) => {
                logger.error(error);
                if (!res.headersSent) {
                    let httpCode = error.httpCode || 500;
                    res.status(httpCode).send(error);
                }
            });
            this.isRunning = true;
            njsPCRelay.init();
        }
    }

    /** Socket.IO server instance */
    public sockServer: SocketIoServer<DefaultEventsMap, DefaultEventsMap>;

    /** @private Array of connected sockets */
    private _sockets: RemoteSocket<DefaultEventsMap, any>[] = [];

    /**
     * Emits an event to all connected Socket.IO clients.
     * @param {string} evt - Event name
     * @param {...any} data - Event data
     */
    public emitToClients(evt: string, ...data: any) {
        if (this.isRunning) {
            this.sockServer.emit(evt, ...data);
        }
    }

    /**
     * Emits an event to clients in a specific Socket.IO channel/room.
     * @param {string} channel - Channel name
     * @param {string} evt - Event name
     * @param {...any} data - Event data
     */
    public emitToChannel(channel: string, evt: string, ...data: any) {
        //console.log(`Emitting to channel ${channel} - ${evt}`)
        if (this.isRunning) {
            this.sockServer.to(channel).emit(evt, ...data);
        }
    }

    /**
     * Initializes Socket.IO server with event handlers.
     * 
     * Sets up handlers for:
     * - sendRS485PortStats: Toggle RS485 port statistics streaming
     * - sendLogMessages: Toggle log message streaming
     * - sendOutboundMessage: Send outbound RS485 message
     * 
     * @protected
     */
    protected initSockets() {
        let options = {
            allowEIO3: true,
            cors: {
                origin: true,
                methods: ["GET", "POST"],
                credentials: true
            }
        }
        this.sockServer = new SocketIoServer(this.server, options);
        this.sockServer.on("connection", (sock: Socket) => {
            logger.info(`New socket client connected ${sock.id} -- ${sock.client.conn.remoteAddress}`);
            this.socketHandler(sock);
            sock.on('connect_error', (err) => {
                logger.error('Socket server error %s', err.message);
            });
            sock.on('reconnect_failed', (err) => {
                logger.error('Failed to reconnect with socket %s', err.message);
            });
            sock.on('sendRS485PortStats', (sendPortStatus: boolean) => {
                console.log(`sendRS485PortStats set to ${sendPortStatus}`);
                // When we receive this we need to relay this.
                if (!sendPortStatus) sock.leave('rs485PortStats');
                else sock.join('rs485PortStats');
                njsPCRelay.relaySocket('sendRS485PortStats', sendPortStatus);
            });
            sock.on('sendLogMessages', (sendMessages: boolean) => {
                console.log(`sendLogMessages set to ${sendMessages}`);
                if (!sendMessages) sock.leave('msgLogger');
                else sock.join('msgLogger');
                njsPCRelay.relaySocket('sendLogMessages', sendMessages);
            });
            sock.on('sendOutboundMessage', (data) => {
                njsPCRelay.relaySocket('sendOutboundMessage', data);
            });

        });
        this.app.use('/socket.io-client', express.static(path.join(process.cwd(), '/node_modules/socket.io-client/dist/'), { maxAge: '60d' }));
    }

    /**
     * Handles individual socket connections.
     * Sets up error handling and lifecycle events for each socket.
     * @private
     * @param {Socket} sock - The Socket.IO socket instance
     */
    private socketHandler(sock: Socket) {
        let self = this;
        setTimeout(async () => {
            // refresh socket list with every new socket
            self._sockets = await self.sockServer.fetchSockets();
        }, 100)
        sock.on('error', (err) => {
            logger.error('Error with socket: %s', err);
        });
        sock.on('close', async (id) => {
            logger.info('Socket diconnecting %s', id);
            self._sockets = await self.sockServer.fetchSockets();
        });
        sock.on('echo', (msg) => { sock.emit('echo', msg); });
    }
}

/**
 * HTTPS server implementation with SSL/TLS support.
 * 
 * Extends HttpServer with:
 * - SSL certificate loading
 * - HTTPS-specific configuration
 * - Secure socket initialization
 * 
 * @extends HttpServer
 */
export class HttpsServer extends HttpServer {
    /** HTTPS server instance */
    declare server: https.Server;

    /**
     * Initializes the HTTPS server with SSL configuration.
     * 
     * @param {object} cfg - Server configuration
     * @param {boolean} cfg.enabled - Whether to enable HTTPS
     * @param {string} cfg.ip - IP address to bind to
     * @param {number} cfg.port - Port number (default 5151)
     * @param {string} cfg.sslKeyFile - Path to SSL private key file
     * @param {string} cfg.sslCertFile - Path to SSL certificate file
     */
    public async init(cfg) {
        // const auth = require('http-auth');
	// this.uuid = cfg.uuid;
        if (!cfg.enabled) return;
        try {
            this.app = express();
            // Enable Authentication (not yet implemented - this code from nodejs-poolController)
            /*             if (cfg.authentication === 'basic') {
                            let basic = auth.basic({
                                realm: "nodejs-poolController.",
                                file: path.join(process.cwd(), cfg.authFile)
                            })
                            this.app.use(function(req, res, next) {
                                    (auth.connect(basic))(req, res, next);
                            });
                        } */
            if (cfg.sslKeyFile === '' || cfg.sslCertFile === '' || !fs.existsSync(path.join(process.cwd(), cfg.sslKeyFile)) || !fs.existsSync(path.join(process.cwd(), cfg.sslCertFile))) {
                logger.warn(`HTTPS not enabled because key or crt file is missing.`);
                return;
            }
            let opts = {
                key: fs.readFileSync(path.join(process.cwd(), cfg.sslKeyFile), 'utf8'),
                cert: fs.readFileSync(path.join(process.cwd(), cfg.sslCertFile), 'utf8'),
                requestCert: false,
                rejectUnauthorized: false
            }
            this.server = https.createServer(opts, this.app);

	    this.app.use(express.static(path.join(process.cwd(), 'pages'), { maxAge: '1d' }));
            this.app.use(express.json());
            this.app.use((req, res, next) => {
                res.header('Access-Control-Allow-Origin', '*');
                res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, api_key, Authorization'); // api_key and Authorization needed for Swagger editor live API document calls
                res.header('Access-Control-Allow-Methods', 'OPTIONS, GET, POST, PUT, DELETE');
                if ('OPTIONS' === req.method) { res.sendStatus(200); }
                else {
                    if (!req.url.startsWith('/upnp.xml')) {
                        logger.info(`[${new Date().toLocaleString()}] ${req.ip} ${req.method} ${req.url} ${typeof req.body === 'undefined' ? '' : JSON.stringify(req.body)}`);
	    //   logger.logAPI(`{"dir":"in","proto":"api","requestor":"${req.ip}","method":"${req.method}","path":"${req.url}",${typeof req.body === 'undefined' ? '' : `"body":${JSON.stringify(req.body)},`}"ts":"${Timestamp.toISOLocal(new Date())}"}${os.EOL}`);
                    }
                    next();
                }
            });


            // Put in a custom replacer so that we can send error messages to the client.  If we don't do this the base properties of Error
            // are omitted from the output.
            this.app.set('json replacer', (key, value) => {
                if (value instanceof Error) {
                    var err = {};
                    Object.getOwnPropertyNames(value).forEach((prop) => {
                        if (prop === "level") err[prop] = value[prop].replace(/\x1b\[\d{2}m/g, '') // remove color from level
                        else err[prop] = value[prop];
                    });
                    return err;
                }
                return value;
            });

	    ConfigRoute.initRoutes(this.app);
	    // StateRoute.initRoutes(this.app);
	    // UtilitiesRoute.initRoutes(this.app);
	    
            // The socket initialization needs to occur before we start listening.  If we don't then
            // the headers from the server will not be picked up.
	    this.initSockets();
	    let serlf = this;
	    this.app.use('/socket.io-client', express.static(path.join(process.cwd(), '/node_modules/socket.io-client/dist/'), { maxAge: '60d' }));
            this.app.use('/jquery', express.static(path.join(process.cwd(), '/node_modules/jquery/'), { maxAge: '60d' }));
            this.app.use('/jquery-ui', express.static(path.join(process.cwd(), '/node_modules/jquery-ui-dist/'), { maxAge: '60d' }));
            this.app.use('/jquery-ui-touch-punch', express.static(path.join(process.cwd(), '/node_modules/jquery-ui-touch-punch-c/'), { maxAge: '60d' }));
            this.app.use('/font-awesome', express.static(path.join(process.cwd(), '/node_modules/@fortawesome/fontawesome-free/'), { maxAge: '60d' }));
            this.app.use('/scripts', express.static(path.join(process.cwd(), '/scripts/'), { maxAge: '1d' }));
            this.app.use('/themes', express.static(path.join(process.cwd(), '/themes/'), { maxAge: '1d' }));
            this.app.use('/icons', express.static(path.join(process.cwd(), '/themes/icons'), { maxAge: '1d' }));
            RelayRoute.initRoutes(this.app);
            ConfigRoute.initRoutes(this.app);
            MessagesRoute.initRoutes(this.app);
            UploadRoute.initRoutes(this.app);
            this.app.use((error, req, res, next) => {
                logger.error(error);
                if (!res.headersSent) {
                    let httpCode = error.httpCode || 500;
                    res.status(httpCode).send(error);
                }
            });

            // start our server on port
            this.server.listen(cfg.port, cfg.ip, function () {
                logger.info('HTTPS Server is now listening on %s:%s', cfg.ip, cfg.port);
	    });
            this.isRunning = true;
        }
        catch (err) {
            logger.error(`Error starting up https server: ${err}`)
        }
    }
}

/**
 * SSDP (Simple Service Discovery Protocol) server placeholder.
 * 
 * Will enable automatic discovery of the dashboard panel on local networks.
 * @extends ProtoServer
 */
export class SspdServer extends ProtoServer {
    /** SSDP server instance */
    public server: any;
}

/**
 * mDNS (Multicast DNS) server placeholder.
 * 
 * Will enable Bonjour/Avahi discovery of the dashboard panel.
 * @extends ProtoServer
 */
export class MdnsServer extends ProtoServer {
    /** mDNS server instance */
    public server: any;
}

/**
 * Singleton web application instance.
 * Use this throughout the application to access the web server.
 * 
 * @type {WebServer}
 */
export const webApp = new WebServer();
