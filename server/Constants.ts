/**
 * @fileoverview Utility classes and constants for the dashPanel application.
 * 
 * Provides commonly used utilities including:
 * - Timestamp formatting with timezone support
 * - Type conversion utilities (boolean, numbers, duration)
 * - Unit conversion for temperature and volume
 * - String and object manipulation helpers
 * 
 * @module server/Constants
 */

import * as util from 'util';

/**
 * Utility class for timestamp formatting and manipulation.
 * Provides static methods for formatting dates with timezone information.
 */
export class Timestamp {
  /**
   * Converts a Date object to an ISO 8601 formatted string with local timezone offset.
   * 
   * Unlike the standard toISOString() which returns UTC time with 'Z' suffix,
   * this method preserves the local time and appends the timezone offset.
   * 
   * @param {Date} dt - The date to format
   * @returns {string} ISO 8601 formatted date string with timezone offset (e.g., "2024-01-15T10:30:00.000-0500")
   * 
   * @example
   * const formatted = Timestamp.toISOLocal(new Date());
   * // Returns: "2024-01-15T10:30:00.000-0500"
   */
  public static toISOLocal(dt): string {
    let tzo = dt.getTimezoneOffset();
    var pad = function (n) {
      var t = Math.floor(Math.abs(n));
      return (t < 10 ? '0' : '') + t;
    };
    return new Date(dt.getTime() - (tzo * 60000)).toISOString().slice(0, -1) + (tzo > 0 ? '-' : '+') + pad(tzo / 60) + pad(tzo % 60)
  }
}

/**
 * General utility class providing type conversion, unit conversion, and helper methods.
 * 
 * This class is instantiated as a singleton (utils) and provides various
 * utility methods used throughout the application.
 */
export class Utils {
    /**
     * Converts various value types to a boolean.
     * 
     * Handles multiple input types:
     * - Boolean: returns as-is
     * - Undefined: returns false
     * - Number: returns true if >= 1
     * - String: parses 'on', 'true', 'yes', 'y' as true; 'off', 'false', 'no', 'n' as false
     * 
     * @param {any} val - The value to convert to boolean
     * @returns {boolean} The converted boolean value
     * 
     * @example
     * utils.makeBool('yes');  // true
     * utils.makeBool('no');   // false
     * utils.makeBool(1);      // true
     * utils.makeBool(0);      // false
     */
    public makeBool(val) {
        if (typeof (val) === 'boolean') return val;
        if (typeof (val) === 'undefined') return false;
        if (typeof (val) === 'number') return val >= 1;
        if (typeof (val) === 'string') {
            if (val === '' || typeof val === 'undefined') return false;
            switch (val.toLowerCase().trim()) {
                case 'on':
                case 'true':
                case 'yes':
                case 'y':
                    return true;
                case 'off':
                case 'false':
                case 'no':
                case 'n':
                    return false;
            }
            if (!isNaN(parseInt(val, 10))) return parseInt(val, 10) >= 1;
        }
        return false;
    }

    /**
     * Generates a UUID (Universally Unique Identifier).
     * 
     * Uses a compact algorithm to generate a UUID v4 compatible string.
     * 
     * @param {any} [a] - Internal parameter for recursion
     * @param {any} [b] - Internal parameter for recursion
     * @returns {string} A UUID string in format "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
     * 
     * @example
     * const id = utils.uuid();
     * // Returns: "550e8400-e29b-41d4-a716-446655440000"
     */
    public uuid(a?, b?) { for (b = a = ''; a++ < 36; b += a * 51 & 52 ? (a ^ 15 ? 8 ^ Math.random() * (a ^ 20 ? 16 : 4) : 4).toString(16) : '-'); return b }

    /**
     * Unit conversion utilities for temperature and volume.
     * 
     * Provides conversion methods between different units:
     * - Temperature: Fahrenheit (f), Celsius (c), Kelvin (k)
     * - Volume: gallons (gal), liters (l), milliliters (ml), centiliters (cl), ounces (oz), pints, quarts (qt)
     */
    public convert = {
        temperature: {
            f: {
                k: (val) => { return (val - 32) * (5 / 9) + 273.15; },
                c: (val) => { return (val - 32) * (5 / 9); },
                f: (val) => { return val; }
            },
            c: {
                k: (val) => { return val + 273.15; },
                c: (val) => { return val; },
                f: (val) => { return (val * (9 / 5)) + 32; }
            },
            k: {
                k: (val) => { return val; },
                c: (val) => { return val - 273.15; },
                f: (val) => { return ((val - 273.15) * (9 / 5)) + 32; }
            },
            convertUnits: (val: number, from: string, to: string) => {
                if (typeof val !== 'number') return null;
                let fn = this.convert.temperature[from.toLowerCase()];
                if (typeof fn !== 'undefined' && typeof fn[to.toLowerCase()] === 'function') return fn[to.toLowerCase()](val);
            }
        },
        volume: {
            gal: {
                l: (val) => { return val * 3.78541; },
                ml: (val) => { return val * 3.78541 * 1000; },
                cl: (val) => { return val * 3.78541 * 100; },
                gal: (val) => { return val; },
                oz: (val) => { return val * 128; },
                pint: (val) => { return val / 8; },
                qt: (val) => { return val / 4; },
            },
            l: {
                l: (val) => { return val; },
                ml: (val) => { return val * 1000; },
                cl: (val) => { return val * 100; },
                gal: (val) => { return val * 0.264172; },
                oz: (val) => { return val * 33.814; },
                pint: (val) => { return val * 2.11338; },
                qt: (val) => { return val * 1.05669; },
            },
            ml: {
                l: (val) => { return val * .001; },
                ml: (val) => { return val; },
                cl: (val) => { return val * .1; },
                gal: (val) => { return val * 0.000264172; },
                oz: (val) => { return val * 0.033814; },
                pint: (val) => { return val * 0.00211338; },
                qt: (val) => { return val * 0.00105669; },
            },
            cl: {
                l: (val) => { return val * .01; },
                ml: (val) => { return val * 10; },
                cl: (val) => { return val; },
                gal: (val) => { return val * 0.00264172; },
                oz: (val) => { return val * 0.33814; },
                pint: (val) => { return val * 0.0211338; },
                qt: (val) => { return val * 0.0105669; },
            },
            oz: {
                l: (val) => { return val * 0.0295735; },
                ml: (val) => { return val * 29.5735; },
                cl: (val) => { return val * 2.95735; },
                gal: (val) => { return val * 0.0078125; },
                oz: (val) => { return val; },
                pint: (val) => { return val * 0.0625; },
                qt: (val) => { return val * 0.03125; },
            },
            pint: {
                l: (val) => { return val * 0.473176; },
                ml: (val) => { return val * 473.176; },
                cl: (val) => { return val * 47.3176; },
                gal: (val) => { return val * 0.125; },
                oz: (val) => { return val * 16; },
                pint: (val) => { return val; },
                qt: (val) => { return val * 0.5; },
            },
            qt: {
                l: (val) => { return val * 0.946353; },
                ml: (val) => { return val * 946.353; },
                cl: (val) => { return val * 94.6353; },
                gal: (val) => { return val * 0.25; },
                oz: (val) => { return val * 32; },
                pint: (val) => { return val * 2; },
                qt: (val) => { return val; },

            },
            convertUnits: (val: number, from: string, to: string) => {
                if (typeof val !== 'number') return null;
                let fn = this.convert.volume[from.toLowerCase()];
                if (typeof fn !== 'undefined' && typeof fn[to.toLowerCase()] === 'function') return fn[to.toLowerCase()](val);
            }
        }
    }

    /**
     * Formats a duration in seconds to a human-readable string.
     * 
     * @param {number} seconds - The duration in seconds
     * @returns {string} Formatted duration string (e.g., "2hrs 30min 15sec")
     * 
     * @example
     * utils.formatDuration(3665);  // "1hr 1min 5sec"
     * utils.formatDuration(0);     // "0sec"
     */
    public formatDuration(seconds: number): string {
        if (seconds === 0) return '0sec';
        var fmt = '';
        let hrs = Math.floor(seconds / 3600);
        let min = Math.floor((seconds - (hrs * 3600)) / 60);
        let sec = seconds - ((hrs * 3600) + (min * 60));
        if (hrs > 1) fmt += (hrs.toString() + 'hrs');
        else if (hrs > 0) fmt += (hrs.toString() + 'hr');

        if (min > 0) fmt += ' ' + (min + 'min');
        if (sec > 0) fmt += ' ' + (sec + 'sec');
        return fmt.trim();
    }

    /**
     * Parses a string containing a number, removing non-numeric characters.
     * 
     * @param {string} val - The string to parse
     * @returns {number|undefined} The parsed number, or undefined if invalid
     * 
     * @example
     * utils.parseNumber("$1,234.56");  // 1234.56
     * utils.parseNumber("100");        // 100
     */
    public parseNumber(val: string): number {
        if (typeof val === 'number') return val;
        else if (typeof val === 'undefined' || val === null) return;
        let tval = val.replace(/[^0-9\.\-]+/g, '');
        let v;
        if (tval.indexOf('.') !== -1) {
            v = parseFloat(tval);
            v = this.roundNumber(v, tval.length - tval.indexOf('.'));
        }
        else v = parseInt(tval, 10);
        return v;
    }

    /**
     * Rounds a number to a specified number of decimal places.
     * 
     * @param {number} num - The number to round
     * @param {number} dec - The number of decimal places
     * @returns {number} The rounded number
     */
    public roundNumber(num, dec) { return +(Math.round(+(num + 'e+' + dec)) + 'e-' + dec); };

    /**
     * Parses a duration string to seconds.
     * 
     * Supports formats like "2hr 30min 15sec" or combinations thereof.
     * 
     * @param {string|number} duration - The duration to parse
     * @returns {number} The duration in seconds
     * 
     * @example
     * utils.parseDuration("1hr 30min");  // 5400
     * utils.parseDuration("45sec");      // 45
     */
    public parseDuration(duration: string): number {
        if (typeof duration === 'number') return parseInt(duration, 10);
        else if (typeof duration !== 'string') return 0;
        let seconds = 0;
        let arr = duration.split(' ');
        for (let i = 0; i < arr.length; i++) {
            let s = arr[i];
            if (s.endsWith('sec')) seconds += this.parseNumber(s);
            if (s.endsWith('min')) seconds += (this.parseNumber(s) * 60);
            if (s.endsWith('hr')) seconds += (this.parseNumber(s) * 3600);
            if (s.endsWith('hrs')) seconds += (this.parseNumber(s) * 3600);
        }
        return seconds;
    }

    /**
     * Checks if a value is null, undefined, or an empty string.
     * 
     * @param {any} val - The value to check
     * @returns {boolean} True if the value is null, undefined, or empty string
     */
    public isNullOrEmpty(val: any) { return (typeof val === 'string') ? val === null || val === '' : typeof val === 'undefined' || val === null; }

    /**
     * Returns a promise that resolves after a specified delay.
     * 
     * @param {number} ms - The delay in milliseconds
     * @returns {Promise<void>} Promise that resolves after the delay
     * 
     * @example
     * await utils.sleep(1000);  // Wait 1 second
     */
    public sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    /**
     * Serializes an object to JSON string, handling circular references.
     * 
     * Unlike JSON.stringify, this method explicitly iterates over own property
     * names to avoid issues with circular references.
     * 
     * @param {object} obj - The object to serialize
     * @param {Function} [fn] - Optional replacer function
     * @returns {string} JSON string representation
     */
    public serialize(obj, fn?: (key, value) => any): string {
        let op = Object.getOwnPropertyNames(obj);
        let s = '{';
        for (let i in op) {
            let prop = op[i];
            if (typeof obj[prop] === 'undefined' || typeof obj[prop] === 'function') continue;
            let v = typeof fn === 'function' ? fn(prop, obj[prop]) : obj[prop];
            if (typeof v === 'undefined') continue;
            s += `"${prop}": ${JSON.stringify(v, fn)},`;
        }
        if (s.charAt(s.length - 1) === ',') s = s.substring(0, s.length - 1);
        return s + '}';
    }

    /**
     * Creates a deep copy of an object with optional property transformation.
     * 
     * Recursively copies object properties, handling arrays and nested objects.
     * Boxed primitives are unboxed to their raw values.
     * 
     * @param {object} obj - The object to copy
     * @param {Function} [fn] - Optional function to transform each property
     * @returns {object} A new object with copied/transformed properties
     */
    public replaceProps(obj, fn?: (key, value) => any): any {
        let op = Object.getOwnPropertyNames(obj);
        if (typeof obj === 'undefined') return undefined;
        let isArray = Array.isArray(obj);
        let o = isArray ? [] : {};
        for (let i in op) {
            let prop = op[i];
            if (typeof obj[prop] === 'undefined' || typeof obj[prop] === 'function') continue;
            let v = typeof fn === 'function' ? fn(prop, obj[prop]) : obj[prop];
            if (typeof v === 'undefined') continue;
            if (util.types.isBoxedPrimitive(v))
                o[prop] = v.valueOf();
            if (Array.isArray(v) || typeof v === 'object')
                o[prop] = utils.replaceProps(v, fn);
            else
                o[prop] = v;
        }
        return o;
    }
}

/**
 * Singleton instance of the Utils class.
 * Use this throughout the application for utility functions.
 * 
 * @type {Utils}
 * 
 * @example
 * import { utils } from './Constants';
 * 
 * const isEnabled = utils.makeBool('yes');
 * const delay = await utils.sleep(1000);
 */
export const utils = new Utils();