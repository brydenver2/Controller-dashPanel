/* ------- AquaButler REST routes are mounted inside Server.ts init() -------
 * The server's HttpServer instances own the express.Application; we
 * attach AquaButler's router from there so the routes land on the
 * correct app instance (and get the correct CORS / static middleware
 * ordering). See `initAquaButler` in server/aquabutler/index.ts.
 */
import { logger } from "./server/logger/Logger";
import { config } from "./server/config/Config";
import { webApp } from "./server/Server";
import { outQueues } from "./server/queues/outboundQueue";
import { njsPCRelay } from "./server/relay/relayRoute";
import { initAquaButlerOnServer, shutdownAquaButler } from "./server/aquabutler";
import * as readline from 'readline';

export function initAsync() {
    return Promise.resolve()
        .then(function () { config.init(); })
        .then(function () { logger.init(); })
        .then(function () { webApp.init(); })
        .then(function () { outQueues.init(); })
        .then(function () { return initAquaButlerOnServer(webApp); });
}
export function stopAsync(): Promise<void> {
    return Promise.resolve()
        .then(function () { return shutdownAquaButler(); })
        .then(function () { console.log('Shutting down open processes'); })
        .then(function () { process.exit(); });
}
if (process.platform === 'win32') {
    let rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on('SIGINT', function () { stopAsync(); });
}
else {
    process.on('SIGINT', function () { return stopAsync(); });
}
initAsync();