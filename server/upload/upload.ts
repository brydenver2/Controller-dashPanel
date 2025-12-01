/**
 * @fileoverview File upload handling for the dashPanel application.
 * 
 * Provides functionality for:
 * - Log file uploads and parsing (RS485 message logs, hex streams)
 * - Background image uploads for dashboard customization
 * - File type detection and automatic format handling
 * 
 * Supported log file formats:
 * - JSON message logs from nodejs-poolController
 * - Hex stream files (AquaLink D format)
 * 
 * @module server/upload/upload
 */

import * as express from 'express';
import * as extend from 'extend';
import * as multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';

import { config } from '../../server/config/Config';
import { logger } from '../../server/logger/Logger';
import { Message, Inbound } from '../../server/messages/messages';

/**
 * Enumeration of supported log file types.
 */
export enum LogFileTypes {
    /** Hex stream format (pipe-delimited hex bytes) */
    HexStream = 'hexstream',
    /** JSON message format (one message per line) */
    Messages = 'messages',
    /** Unknown or unsupported format */
    Unknown = 'unknown'
}

/**
 * Upload route handler class.
 * 
 * Registers file upload endpoints on the Express application.
 */
export class UploadRoute {
    /**
     * Initializes upload routes on the Express application.
     * 
     * Registered routes:
     * - POST /upload/logfile - Upload and parse RS485 log files
     * - POST /upload/backgroundFile - Upload dashboard background images
     * 
     * @param {express.Application} app - The Express application instance
     */
    public static initRoutes(app: express.Application) {
        app.post('/upload/logfile', (req, res, next) => {
            var upload = logUpload.upload.single('logFile');
            upload(req, res, function (err) {
                if (err) {
                    console.log(err);
                    res.status(500).send(err);
                }
                else {
                    let filePath = path.posix.join(process.cwd(), req.file.path);
                    let lft = LogUpload.getLogFileType(filePath);
                    switch (lft) {
                        case LogFileTypes.HexStream:
                            res.status(200).send(LogUpload.readAquaLinkDFile(filePath));
                            break;
                        case LogFileTypes.Messages:
                            res.status(200).send(LogUpload.readLogFile(filePath));
                            break;

                    }
                }
            });
        });
        app.post('/upload/backgroundFile', (req, res, next) => {
            let upload = backgroundUpload.upload.single('backgroundFile');
            upload(req, res, function (err) {
                if (err) {
                    console.log(err);
                    res.status(500).send(err);
                }
                else {
                    let backgrounds = BackgroundUpload.getBackgrounds();
                    res.status(200).send({
                        uploaded: backgrounds.find(elem => elem.name === req.file.filename),
                        backgrounds: backgrounds
                    });
                }
            });
        });
    }
}

/**
 * Log file upload handler class.
 * 
 * Manages uploading and parsing of RS485 communication log files.
 * Supports both JSON message format and hex stream formats.
 */
export class LogUpload {
    /**
     * Creates a new LogUpload instance.
     * 
     * Configures multer middleware for log file uploads with
     * disk storage to the configured upload path.
     */
    constructor() {
        let cfg = config.getSection('uploads.logFile', { uploads: { logFile: { path: 'uploads/' } } });
        try {
            if (!fs.existsSync(cfg.path)) {
                fs.mkdirSync(cfg.path);
            }
            this._multer = multer({
                dest: cfg.path,
                storage: multer.diskStorage({
                    destination: (req, file, cb) => {
                        if (!fs.existsSync(cfg.path)) {
                            fs.mkdirSync(cfg.path);
                        }
                        cb(null, cfg.path);
                    },
                    filename: (req, file, cb) => {
                        let target = path.posix.join(process.cwd(), cfg.path, file.originalname);
                        let p = path.parse(target);
                        let ord = 1;
                        if (this.preserveFile) {
                            while (fs.existsSync(target)) {
                                //console.log(p);
                                var name = p.name;
                                if (name.endsWith('_' + (ord - 1))) {
                                    name = name.substring(0, name.lastIndexOf('_' + (ord - 1)));
                                }
                                target = path.posix.join(process.cwd(), cfg.path, name + '_' + ord + p.ext);
                                p = path.posix.parse(target);
                                ord++;
                            }
                        }
                        cb(null, p.name + p.ext);
                    }
                })
            });
        } catch (err) { logger.error(err); }
    }

    /** @private Multer middleware instance */
    private _multer = multer({});

    /** Whether to preserve existing files with ordinal suffixes */
    public preserveFile: boolean = false;

    /** Gets the configured multer middleware */
    public get upload() { return this._multer; }

    /**
     * File filter for log file uploads.
     * Only allows .log files.
     * @static
     */
    public static logFilter(req, file, cb) {
        if (!file.originalname.match(/\.(log|)$/)) {
            return cb(new Error('Only .log files are allowed!'), false);
        }
        cb(null, true);
    }

    /**
     * Parses a packet message into a Message object.
     * @static
     * @param {object} msg - The message to parse
     * @returns {Message} The parsed message
     */
    public static parsePacket(msg) {
        let m: Message = new Message();
        //m.parseV5(msg);
        return m;
    }

    /**
     * Converts a v5 format message to the internal format.
     * @static
     * @param {object} msg - The v5 format message
     * @returns {object|Message} The converted message
     */
    public static fromVer5(msg) {
        if (msg.type === 'packet') {
            return LogUpload.parsePacket(msg);
        }
        else if (msg.type === 'url') {
            return {
                id: Message.nextMessageId,
                proto: 'api',
                dir: msg.direction === 'inbound' ? 'in' : 'out',
                requestor: '',
                method: '',
                path: msg.url,
                body: undefined,
                ts: msg.timestamp
            };
        }
    }

    /**
     * Reads and parses an AquaLink D format hex stream file.
     * 
     * The file contains pipe-delimited hexadecimal bytes that are
     * parsed into RS485 messages.
     * 
     * @static
     * @param {string} filepath - Path to the hex stream file
     * @returns {object[]} Array of parsed message objects
     */
    public static readAquaLinkDFile(filepath) {
        let fd;
        let messages = [];
        try {
            let stat = fs.statSync(filepath);
            let pos = 0;
            fd = fs.openSync(filepath, 'r');
            let buff = Buffer.alloc(100);
            let arrBytes: number[] = [];
            let msg: Message;
            while (pos < stat.size) {
                let len = fs.readSync(fd, buff, 0, Math.min(stat.size - pos, 100), pos);
                pos += len;
                if (len > 0) {
                    let bytes = buff.toString('utf8').split(/\|/).filter(Boolean);
                    for (let i = 0; i < bytes.length; i++) arrBytes.push(parseInt(bytes[i], 16));
                }
                for (let ndx = 0; ndx < arrBytes.length;) {
                    let msg: Message;
                    do {
                        if (typeof (msg) === 'undefined' || msg === null || msg.isComplete || !msg.isValid) {
                            msg = new Message();
                            ndx = msg.readPacket(arrBytes);
                        }
                        else ndx = msg.mergeBytes(arrBytes);
                        if (msg.isComplete) {
                            if (msg.isValid) {
                                msg.id = Message.nextMessageId;
                                messages.push(msg.toLogObject());
                            }
                            else {
                                arrBytes = arrBytes.slice(ndx);
                                arrBytes.unshift(...msg.term);
                                arrBytes.unshift(...msg.payload);
                                arrBytes.unshift(...msg.header.slice(1));
                                ndx = 0;
                                msg = null;
                            }
                        }
                        if (ndx > 0) {
                            arrBytes = arrBytes.slice(ndx);
                            ndx = 0;
                        }
                        else break;

                    } while (ndx < arrBytes.length);
                    break;
                }
            }
        }
        catch (err) { logger.error(`Error reading ${filepath}: ${err.message}`); }
        finally { if (typeof fd !== 'undefined') fs.closeSync(fd); }
        return messages;
    }

    /**
     * Alternative implementation for reading AquaLink D format files.
     * Loads entire file into memory before parsing.
     * @static
     * @param {string} filepath - Path to the hex stream file
     * @returns {object[]} Array of parsed message objects
     * @deprecated Use readAquaLinkDFile for large files
     */
    public static readAquaLinkDFile1(filepath) {
        let bytes = fs.readFileSync(filepath, "utf8").split(/\|/).filter(Boolean);
        // convert all the bytes to numbers.
        let arrBytes: number[] = [];
        for (let i = 0; i < bytes.length; i++) {
            arrBytes.push(parseInt(bytes[i], 16));
        }
        // Ok so now we have the array of bytes we need to parse that into message structures.  We are simply
        // going to read this in as an array of bytes just like it is read in njsPC.
        let messages = [];
        for (let ndx = 0; ndx < arrBytes.length;) {
            let msg: Message;
            do {
                if (typeof (msg) === 'undefined' || msg === null || msg.isComplete || !msg.isValid) {
                    msg = new Message();
                    ndx = msg.readPacket(arrBytes);
                }
                else ndx = msg.mergeBytes(arrBytes);
                if (msg.isComplete) {
                    if (msg.isValid) {
                        msg.id = Message.nextMessageId;
                        messages.push(msg.toLogObject());
                    }
                    else {
                        arrBytes = arrBytes.slice(ndx);
                        arrBytes.unshift(...msg.term);
                        arrBytes.unshift(...msg.payload);
                        arrBytes.unshift(...msg.header.slice(1));
                        ndx = 0;
                        msg = null;
                    }
                }
                if (ndx > 0) {
                    arrBytes = arrBytes.slice(ndx);
                    ndx = 0;
                }
                else break;

            } while (ndx < arrBytes.length);
        }
        return messages;
    }

    /**
     * Determines the type of a log file by examining its first bytes.
     * @static
     * @param {string} filePath - Path to the file to check
     * @returns {LogFileTypes} The detected file type
     */
    public static getLogFileType(filePath) {
        let lft = LogFileTypes.Unknown;
        let fd;
        try {
            fd = fs.openSync(filePath, 'r');
            let buff = Buffer.alloc(2);
            let bytesRead = fs.readSync(fd, buff, 0, 2, 0);
            if (bytesRead === 2) {
                let s = buff.toString('utf8');
                if (s[0] === '{') lft = LogFileTypes.Messages;
                else if (s[0] === '0' && s[1].toLowerCase() === 'x') lft = LogFileTypes.HexStream;
            }
        }
        catch (err) {
            logger.error(`Error reading file ${filePath}`);
        }
        finally { if (typeof fd !== 'undefined') fs.closeSync(fd); }
        return lft;
    }

    /**
     * Reads and parses a JSON-format log file.
     * Each line should contain a JSON message object.
     * @static
     * @param {string} filePath - Path to the log file
     * @returns {object[]} Array of parsed message objects
     */
    public static readLogFile(filePath) {
        let lines = fs.readFileSync(filePath, 'utf8').split(/[\n\r]/).filter(Boolean);
         let arr = [];
        Message._messageId = 0;
        let cmsg = null;
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            if (line.indexOf('][') !== -1) line = line.replace(/\]\[/g, '],[');
            try {
                let msg = JSON.parse(line);
                if (typeof msg.level !== 'undefined') {
                    if (cmsg !== null && cmsg.valid && !cmsg._complete)
                        cmsg.mergeBytes(msg.packet);
                    else
                        cmsg = LogUpload.fromVer5(msg);
                    if (cmsg._complete || cmsg.proto === 'api') {
                        if(cmsg.proto !== 'api') arr.push(cmsg); // Kill these for now as they really don't tell us anything.
                        cmsg = null;
                    }
                }
                else
                    arr.push(msg);
            }
            catch (err) {
                logger.error(err);
                logger.error(line);
            }
        }
        return arr;
    }
}

/**
 * Background image upload handler class.
 * 
 * Manages uploading and listing of dashboard background images.
 * Images are stored in the themes/Images directory.
 */
export class BackgroundUpload {
    /** Upload destination path */
    public path = path.posix.join(process.cwd(), 'themes/Images');

    /**
     * Creates a new BackgroundUpload instance.
     * Configures multer middleware for image uploads.
     */
    constructor() {
        try {
            this._multer = multer({
                dest: this.path,
                storage: multer.diskStorage({
                    destination: (req, file, cb) => {
                        cb(null, this.path);
                    },
                    filename: (req, file, cb) => {
                        let target = path.posix.join(process.cwd(), this.path, file.originalname);
                        let p = path.parse(target);
                        let ord = 1;
                        if (this.preserveFile) {
                            while (fs.existsSync(target)) {
                                //console.log(p);
                                var name = p.name;
                                if (name.endsWith('_' + (ord - 1))) {
                                    name = name.substring(0, name.lastIndexOf('_' + (ord - 1)));
                                }
                                target = path.posix.join(process.cwd(), this.path, name + '_' + ord + p.ext);
                                p = path.posix.parse(target);
                                ord++;
                            }
                        }
                        cb(null, p.name + p.ext);
                    }
                })
            });
        } catch (err) { logger.error(err); }
    }

    /** @private Multer middleware instance */
    private _multer = multer({});

    /** Whether to preserve existing files with ordinal suffixes */
    public preserveFile: boolean = false;

    /** Gets the configured multer middleware */
    public get upload() { return this._multer; }

    /**
     * Gets a list of all available background images.
     * @static
     * @returns {Array<{name: string, ext: string, size: number, url: string}>} Array of background image metadata
     */
    public static getBackgrounds(): { name: string, ext: string, size: number, url: string }[] {
        let arr = [];
        let dir = path.posix.join(process.cwd(), 'themes/Images');
        let files = fs.readdirSync(dir, { withFileTypes: true });
        for (let i = 0; i < files.length; i++) {
            let f = files[i];
            if (f.isFile()) {
                let ext = path.extname(f.name).toLocaleLowerCase();
                if (['.jpg', '.gif', '.png', '.bmp', '.tiff'].includes(ext)) {
                    let stat = fs.statSync(path.posix.join(dir, f.name));
                    arr.push({ name: f.name, ext: ext, size: stat.size, url:`/themes/Images/${f.name}` });
                }
            }
        }
        return arr;
    }
}

/** Singleton log upload handler instance */
const logUpload = new LogUpload();

/** Singleton background upload handler instance */
const backgroundUpload = new BackgroundUpload();
