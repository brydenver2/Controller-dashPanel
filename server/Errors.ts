/**
 * @fileoverview Custom error handling utilities for the API.
 * 
 * Provides the ApiError class that extends the standard Error class with
 * additional properties for HTTP status codes and error codes. This allows
 * for consistent error handling across the API endpoints.
 * 
 * @module server/Errors
 */

import * as path from "path";

/**
 * Custom error class for API-related errors.
 * 
 * Extends the standard Error class to include:
 * - HTTP status code for proper response handling
 * - Internal error code for categorization
 * - Position information (file, line, column) parsed from stack trace
 * 
 * @extends Error
 * 
 * @example
 * // Throw a 404 error
 * throw new ApiError('Resource not found', 404, 404);
 * 
 * @example
 * // Throw a validation error
 * throw new ApiError('Invalid parameter', 100, 400);
 */
export class ApiError extends Error {
    /**
     * Internal error code for categorization.
     * Can be used to identify specific error types within the application.
     * @type {number}
     * @default 0
     */
    public code: number = 0;

    /**
     * HTTP status code to return to the client.
     * @type {number}
     * @default 500
     */
    public httpCode: number = 500;

    /**
     * Position information extracted from the stack trace.
     * Contains file path, line number, and column number where error occurred.
     * @type {{ dir?: string, file?: string, line?: number, column?: number }}
     */
    public position: any = {}

    /**
     * Creates a new ApiError instance.
     * 
     * @param {string} message - The error message
     * @param {number} [code=0] - Internal error code for categorization
     * @param {number} [httpCode=400] - HTTP status code to return to client
     */
    constructor(message: string, code?: number, httpCode?: number) {
        super(message);
        this.name = 'ApiError';
        this.code = code || 0;
        this.httpCode = httpCode || 400;
        let pos: any = {};
        if (typeof this.stack !== 'undefined') {
            try {
                // Parse stack trace to extract position information
                // NodeJS doesn't include line numbers and source in Error properties,
                // only in the text-based stack trace
                let lines = this.stack.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    let line = lines[i];
                    if (line.trimLeft().startsWith('at ')) {
                        let lastParen = line.lastIndexOf(')');
                        let firstParen = line.indexOf('(');
                        if (lastParen >= 0 && firstParen >= 0) {
                            let p = line.substring(firstParen + 1, lastParen);
                            let m = /(\:\d+\:\d+)(?!.*\1)/g;
                            let matches = p.match(m);
                            let linecol = '';
                            let lastIndex = -1;
                            if (matches.length > 0) {
                                linecol = matches[matches.length - 1];
                                lastIndex = p.lastIndexOf(linecol);
                                p = p.substring(0, lastIndex);
                                if (linecol.startsWith(':')) linecol = linecol.substring(1);
                                let lastcolon = linecol.lastIndexOf(':');
                                if (lastcolon !== -1) {
                                    pos.column = parseInt(linecol.substring(lastcolon + 1), 10);
                                    pos.line = parseInt(linecol.substring(0, lastcolon), 10);
                                }
                            }
                            let po = path.parse(p);
                            pos.dir = po.dir;
                            pos.file = po.base;
                        }
                        break;
                    }
                }
            } catch (e) { }
        }
        this.position = pos;
    }
}