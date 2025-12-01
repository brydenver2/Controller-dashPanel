/**
 * @fileoverview Outbound message queue management for the dashPanel application.
 * 
 * Provides functionality for:
 * - Managing collections of outbound RS485 messages
 * - Saving and loading message queues to/from disk
 * - Supporting message test modules for debugging
 * 
 * Queues are stored in the data/outQueues/ directory as JSON files.
 * 
 * @module server/queues/outboundQueue
 */

import * as path from 'path';
import * as fs from 'fs';
import * as extend from 'extend';
import { logger } from '../../server/logger/Logger';

/**
 * Collection class for managing outbound message queues.
 * 
 * Extends Array to provide additional functionality for
 * loading, saving, and managing message queues.
 * 
 * @extends Array<outboundQueue>
 */
class outboundQueueCollection extends Array<outboundQueue> {
    /** @private Path to queue storage directory */
    private _queuePath: string;

    /** @private Flag indicating if collection is initialized */
    private _isInitialized: boolean = false;

    /**
     * Creates a new outbound queue collection.
     * @param {...outboundQueue} items - Initial queue items
     */
    constructor(...items) {
        super(...items);
        this._queuePath = path.posix.join(process.cwd(), '/data/outQueues/');
        this._isInitialized = true;
    }

    /**
     * Loads all queue descriptors from disk.
     * 
     * Scans the queue directory for:
     * - Queue descriptor JSON file (outQueues.json)
     * - Individual queue files (.out extension)
     * - Test module scripts (.js files in testModules directory)
     */
    public loadDescriptors() {
        this.length = 0; // Truncate the current list.
        let data = [];
        if (fs.existsSync(this.queuePath + 'outQueues.json')) {
            try {
                data = JSON.parse(fs.readFileSync(this.queuePath + 'outQueues.json', 'utf8') || '[]');
            }
            catch (err) {
                logger.error(err);
            }
        }
        this.length = 0;
        for (let i = 0; i < data.length; i++) {
            this.push(Object.assign(new outboundQueue(), data[i]));
        }
        let nextId = this.getNextId();

        // List all the files in the directory
        try {
            fs.readdirSync(outQueues.queuePath).forEach(file => {
                if (path.extname(file) === '.out') {
                    let name = path.parse(file).name;
                    let q = this.find(elem => { return elem.fileName === name });
                    if (typeof q === 'undefined') {
                        q = new outboundQueue();
                        q.fileName = name;
                        q.name = name.replace('_', ' ');
                        q.id = nextId++;
                    }
                }
            });
        }
        catch (err) {
            logger.error(err);
        }
        // We should have the descriptors matched up with the queues.  Now sort them by name.
        this.sort((a, b) => { return a.name.localeCompare(b.name); });

        // Now lets load up all the .js modules int the testmodules directory. 
        try {
            fs.readdirSync(path.posix.join(process.cwd(), '/scripts/messages/testModules')).forEach(file => {
                if (path.extname(file) === '.js') {
                    let name = path.parse(file).name;
                    let q = this.find(elem => { return elem.fileName === name });
                    if (typeof q === 'undefined') {
                        let d = {
                            fileName: name + path.extname(file),
                            name: name.replace('_', ' '),
                            type: 'testModule',
                            id: nextId++,
                            description: `Test module for generating outbound messages`
                        }
                        this.push(Object.assign(new outboundQueue(), d));
                    }
                }
            });
        }
        catch (err) { logger.error(err); }
    }

    /**
     * Gets the path to the queue storage directory.
     * @returns {string} The queue directory path
     */
    public get queuePath(): string { return this._queuePath; }

    /**
     * Gets the next available queue ID.
     * @returns {number} The next ID (max existing + 1)
     */
    public getNextId(): number {
        let maxId = 0;
        this.forEach(q => { maxId = Math.max(q.id, maxId); })
        return maxId + 1;
    }

    /**
     * Saves a queue (creates new or updates existing).
     * 
     * @param {object} queue - Queue data to save
     * @param {number} [queue.id] - Existing queue ID for updates
     * @param {string} queue.name - Queue name
     * @param {string} [queue.description] - Queue description
     * @param {string} [queue.fileName] - Custom file name
     * @param {object[]} [queue.messages] - Messages to save
     * @returns {Promise<outboundQueue>} The saved queue
     * @throws {Error} If queue name/filename already exists
     */
    public async saveQueue(queue: any): Promise<outboundQueue> {
        // First things first.  See if we have a queue with the id.
        let oldq;
        if (typeof queue.id !== 'undefined') {
            // This is an existing queue.  We are simply renaming it.
            oldq = this.find(q => { return queue.id === q.id });
            if (typeof oldq === 'undefined') return Promise.reject(new Error(`Queue does not exist. Could not find queue for id# ${queue.id}.`));
            if (typeof queue.name !== 'undefined') oldq.name = queue.name;
            if (typeof queue.description !== 'undefined') oldq.description = queue.description;
            if (typeof queue.fileName !== 'undefined' && queue.fileName !== oldq.fileName && fs.existsSync(this.queuePath + oldq.fileName)) {
                // We need to rename the file.
                try {
                    fs.renameSync(this.queuePath + oldq.fileName, this.queuePath + queue.fileName);
                    oldq.fileName = queue.fileName;
                }
                catch (err) { return Promise.reject(err); }
            }
        }
        else {
            // Make sure we don't have any naming conflicts.
            if (typeof queue.name === 'undefined') return Promise.reject(new Error(`Queues must have a valid name.`));
            oldq = this.find(q => { return queue.name === q.name });
            if (typeof oldq !== 'undefined') return Promise.reject(new Error(`Names must be unique. ${queue.name} aldready exists.`));
            let fname: string = queue.fileName || this.makeFileName(queue.name);
            oldq = this.find(q => { return queue.fileName === fname });
            if (typeof oldq !== 'undefined') return Promise.reject(new Error(`File names must be unique. The filename ${fname} is already used.`));
            oldq = new outboundQueue();
            oldq.name = queue.name;
            oldq.description = queue.description;
            oldq.filename = fname;
            oldq.id = this.getNextId();
            this.push(oldq);
        }
        this.update((err) => { if (err) return Promise.reject(err); });
        // If the messages have been provided then we need to update the file.
        if (typeof queue.messages !== 'undefined') {
            oldq.saveMessagesSync(queue.messages, (err) => { if (err) return Promise.reject(err); });
        }
        return Promise.resolve(oldq);
    }

    /**
     * Persists the queue collection descriptor to disk.
     * @param {Function} cb - Callback function called with error if any
     */
    public update(cb: (err?) => {}) {
        try {
            fs.writeFileSync(this.queuePath + 'outQueues.json', JSON.stringify(this));
            if (typeof cb !== 'undefined') cb();
        }
        catch (err) {
            if (typeof cb !== 'undefined') cb(err);
        }
    }

    /**
     * Finds a queue by ID.
     * @param {outboundQueue} q - Queue with ID to find
     * @returns {outboundQueue|undefined} The matching queue
     */
    public findQueue(q: outboundQueue) {
        return this.find(queue => {
            if (typeof q.id !== 'undefined' && queue.id === q.id) return true;
            return false;
        });
    }

    /**
     * Creates a safe filename from a queue name.
     * Replaces special characters with underscores.
     * @param {string} name - Queue name to convert
     * @returns {string} Safe filename with .out extension
     */
    public makeFileName(name: string) { return name.replace(/[&\/\\#,+$~%.'":*?<>{}]/g, '_') + '.out'; }

    /**
     * Initializes the queue collection by loading descriptors.
     */
    public init() {
        this.loadDescriptors();
    }
}

/**
 * Individual outbound message queue.
 * 
 * Represents a collection of RS485 messages that can be
 * saved to and loaded from disk.
 */
class outboundQueue {
    /** @private File name for this queue */
    private _fileName: string;

    constructor() { }

    /** Unique queue identifier */
    public id: number;

    /** Display name for the queue */
    public name: string;

    /** Optional description */
    public description: string;

    /** Queue type: 'messageList' or 'testModule' */
    public type: string = 'messageList';

    /** Array of messages in this queue */
    public messages: any[];

    /** Gets the file name for this queue */
    public get fileName(): string { return typeof this._fileName === 'undefined' ? this.name.replace(' ', '_') + '.out' : this.fileName; }

    /** Sets the file name for this queue */
    public set fileName(val: string) { this._fileName = val; }

    /**
     * Saves messages to the queue file synchronously.
     * @param {object[]} msgs - Messages to save
     * @param {Function} cb - Callback function
     * @returns {boolean} True if successful
     */
    public saveMessagesSync(msgs, cb): boolean {
        let fd;
        let eol = require('os').EOL;
        try {
            let file = outQueues.queuePath + this.fileName;
            if (fs.existsSync(file)) fs.unlinkSync(file);
            fd = fs.openSync(file, 'a');
            for (let i = 0; i < msgs.length; i++) {
                (i !== 0) ? fs.appendFileSync(fd, eol + JSON.stringify(msgs[i]), 'utf8') : fs.appendFileSync(fd, JSON.stringify(msgs[i]), 'utf8');
            }
            if(typeof cb !== 'undefined') cb();
        }
        catch (err) {
            logger.error(err);
            if (typeof cb !== 'undefined') cb(err); return false;
        }
        finally {
            if (typeof fd !== 'undefined') fs.closeSync(fd);
        }
        return true;
    }

    /**
     * Loads messages from the queue file.
     * @param {Function} [cb] - Optional callback function
     * @returns {object[]} Array of loaded messages
     */
    public loadMessages(cb?: (err?) => {}): any {
        let msgs = [];
        let eol = require('os').EOL;
        try {
            let file = outQueues.queuePath + this.fileName;
            let arr = fs.readFileSync(file).toString().split(eol);
            for (let i = 0; i < arr.length; i++) {
                let msg = JSON.parse(arr[i].trim());
                msgs.push(msg);
            }
            if (typeof (cb) !== 'undefined') cb();

        }
        catch (err) {
            if (typeof (cb) !== 'undefined') cb(err);
        }
        return msgs;
    }
}

/**
 * Singleton outbound queue collection instance.
 * Use this throughout the application to manage message queues.
 * 
 * @type {outboundQueueCollection}
 */
export var outQueues: outboundQueueCollection = new outboundQueueCollection();