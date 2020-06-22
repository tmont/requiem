"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
const http = require("http");
const https = require("https");
const formatUrl = (args) => {
    if (!args.host) {
        throw new Error(`requiem expects either "url" or "host" option to be specified`);
    }
    const url = new URL(`${args.protocol || 'http:'}//${args.host || 'example.com'}`);
    if (args.port) {
        url.port = args.port;
    }
    if (args.path || args.pathname) {
        url.pathname = args.path || args.pathname;
    }
    return url;
};
const defaultFollowRedirects = 5;
class RequiemError extends Error {
    constructor(code, message, req, res) {
        super(message);
        this.code = code;
        this.req = req || null;
        this.res = res || null;
    }
}
exports.RequiemError = RequiemError;
const createResponse = (incoming, url) => {
    return Object.assign(incoming, {
        requestedUrl: url,
        reverseProxy: (outgoing) => {
            Object.keys(incoming.headers).forEach((name) => {
                const value = incoming.headers[name];
                if (typeof (value) !== 'undefined') {
                    outgoing.setHeader(name, value);
                }
            });
            if (typeof (incoming.statusCode) !== 'undefined') {
                outgoing.statusCode = incoming.statusCode;
            }
            return incoming.pipe(outgoing);
        }
    });
};
const followRedirects = async (urls, res, options, depth = 0) => {
    const statusCode = res.statusCode;
    if (options.followRedirects === false) {
        return res;
    }
    const maxDepth = typeof (options.followRedirects) !== 'undefined' ?
        options.followRedirects :
        defaultFollowRedirects;
    if (depth > maxDepth) {
        throw new RequiemError('TooManyRedirects', `"${urls[0]}" redirected too many times (max redirects: ${maxDepth})`, null, res);
    }
    const location = res.headers.location;
    if (!statusCode || statusCode < 300 || statusCode >= 400 || !location) {
        return res;
    }
    let newUrl;
    try {
        const parsedUrl = new URL(location, urls[urls.length - 1]);
        newUrl = parsedUrl.href;
    }
    catch (e) {
        throw new RequiemError('InvalidRedirectUrl', `Invalid redirect URL: ${location}`, null, res);
    }
    return new Promise((resolve, reject) => {
        const urlOptions = Object.assign({}, options);
        delete urlOptions.host;
        delete urlOptions.path;
        delete urlOptions.port;
        delete urlOptions.protocol;
        const newOptions = Object.assign(Object.assign({}, urlOptions), { url: newUrl, method: 'GET' });
        const req = exports.createRequest(newOptions);
        req.on('response', (res) => {
            res.on('error', reject);
            const reqRes = createResponse(res, newUrl);
            followRedirects(urls.concat(newUrl), reqRes, options, depth + 1)
                .then(resolve)
                .catch(reject);
        });
        wireRequestEvents(req, newOptions, reject);
        req.end();
    });
};
const responseHandler = async (req, res, options) => {
    const reqRes = createResponse(res, req.requestedUrl);
    const result = await followRedirects([req.requestedUrl], reqRes, options);
    if ('throwOnErrorResponse' in options) {
        if (typeof (options.throwOnErrorResponse) === 'number') {
            if (result.statusCode !== options.throwOnErrorResponse) {
                throw new RequiemError('InvalidStatusCode', `Received invalid status code from "${result.requestedUrl}": ${result.statusCode} ` +
                    `(expected ${options.throwOnErrorResponse})`, req, result);
            }
        }
        else if (options.throwOnErrorResponse && result.statusCode && result.statusCode >= 400) {
            throw new RequiemError('InvalidStatusCode', `Received invalid status code from "${result.requestedUrl}": ${result.statusCode}`, req, result);
        }
    }
    return result;
};
const wireRequestEvents = (req, options, reject) => {
    let timedOut = false;
    let rejected = false;
    req.on('error', reject);
    req.on('timeout', () => {
        timedOut = true;
        if (!req.aborted) {
            req.abort();
        }
    });
    req.on('abort', () => {
        if (rejected) {
            return;
        }
        rejected = true;
        if (timedOut) {
            const timeout = options.timeout;
            reject(new RequiemError('Timeout', `Reached timeout limit (${'timeout' in options ? timeout + 'ms' : 'node default'}), request aborted`, req));
        }
        else {
            reject(new RequiemError('RequestAbort', 'Request was aborted', req));
        }
    });
};
const isUrlOptions = (options) => {
    return typeof (options.url) === 'string';
};
const isUrlBodyOptions = (options) => {
    const key = 'body';
    return key in options;
};
const isUrlBodyJsonOptions = (options) => {
    const key = 'bodyJson';
    return key in options;
};
const isHostBodyOptions = (options) => {
    const key = 'body';
    return key in options;
};
const isHostBodyJsonOptions = (options) => {
    const key = 'bodyJson';
    return key in options;
};
const getObjectionsObject = (options) => {
    if (typeof (options) === 'string') {
        return {
            url: options,
        };
    }
    return options;
};
exports.createRequest = (options) => {
    const optionsObj = getObjectionsObject(options);
    optionsObj.method = optionsObj.method || 'GET';
    const { followRedirects, throwOnErrorResponse } = optionsObj, reqOptions = __rest(optionsObj, ["followRedirects", "throwOnErrorResponse"]);
    // ensure we don't pass around anything extraneous
    delete reqOptions.body;
    delete reqOptions.bodyJson;
    const httpOptions = reqOptions;
    let urlStr;
    let url;
    try {
        url = isUrlOptions(optionsObj) ?
            new URL(optionsObj.url) :
            formatUrl(optionsObj);
        urlStr = url.toString();
    }
    catch (e) {
        throw new RequiemError('InvalidUrl', `URL could not be formatted properly`);
    }
    const lib = /^https:/.test(urlStr) ? https : http;
    const req = lib.request(url, httpOptions);
    return Object.assign(req, {
        requestedUrl: urlStr,
    });
};
exports.sendRequest = (req, options) => {
    const optionsObj = getObjectionsObject(options);
    return new Promise((resolve, reject) => {
        req.on('response', (res) => {
            res.on('error', reject);
            responseHandler(req, res, optionsObj)
                .then(resolve)
                .catch(reject);
        });
        wireRequestEvents(req, optionsObj, reject);
        if (isHostBodyJsonOptions(optionsObj) || isUrlBodyJsonOptions(optionsObj)) {
            req.setHeader('Content-Type', 'application/json');
            try {
                req.write(JSON.stringify(optionsObj.bodyJson));
            }
            catch (e) {
                reject(e);
                return;
            }
        }
        else if (isHostBodyOptions(optionsObj) || isUrlBodyOptions(optionsObj)) {
            req.write(optionsObj.body);
        }
        req.end();
    });
};
exports.request = (options) => {
    const optionsObj = getObjectionsObject(options);
    const req = exports.createRequest(optionsObj);
    return exports.sendRequest(req, optionsObj);
};
exports.requestBody = async (options) => {
    const res = await exports.request(options);
    const buffers = [];
    return new Promise((resolve) => {
        res.on('data', chunk => buffers.push(chunk));
        res.on('end', () => {
            const result = Object.assign(res, {
                body: Buffer.concat(buffers),
            });
            resolve(result);
        });
    });
};
exports.requestJson = async (options) => {
    const res = await exports.requestBody(options);
    const body = res.body;
    const bodyStr = body.toString('utf8');
    try {
        const json = JSON.parse(bodyStr);
        return Object.assign(res, {
            body: json,
        });
    }
    catch (e) {
        throw new RequiemError('InvalidJsonBody', `Failed to parse body as JSON: ${e.message}`, null, res);
    }
};
//# sourceMappingURL=index.js.map