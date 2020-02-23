import * as http from 'http';
import * as https from 'https';
import * as tls from 'tls';

const formatUrl = (args: any): URL => {
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

interface BaseRequiemOptions extends
	tls.SecureContextOptions,
	Pick<https.RequestOptions, 'rejectUnauthorized' | 'servername'>,
	Pick<http.RequestOptions, 'headers' | 'timeout' | 'auth' | 'agent'> {
	method?: string;
	followRedirects?: number;
	throwOnErrorResponse?: boolean | number;
}

const defaultFollowRedirects = 5;

interface WithBody {
	body?: string | Buffer;
}

interface WithBodyJson {
	bodyJson?: any;
}

interface HostOptions {
	host: string;
	path?: string;
	pathname?: string;
	port?: number;
	protocol?: string;
}

interface UrlOptions {
	url: string;
}

export interface RequiemUrlOptions extends BaseRequiemOptions, UrlOptions, Partial<Record<keyof HostOptions, undefined>> {}
export interface RequiemHostOptions extends BaseRequiemOptions, HostOptions, Partial<Record<keyof UrlOptions, undefined>> {}

export interface RequiemUrlWithBodyOptions extends RequiemUrlOptions, WithBody, Partial<Record<keyof WithBodyJson, undefined>> {}
export interface RequiemUrlWithJsonOptions extends RequiemUrlOptions, WithBodyJson, Partial<Record<keyof WithBody, undefined>> {}
export interface RequiemHostWithBodyOptions extends RequiemHostOptions, WithBody, Partial<Record<keyof WithBodyJson, undefined>> {}
export interface RequiemHostWithJsonOptions extends RequiemHostOptions, WithBodyJson, Partial<Record<keyof WithBody, undefined>> {}

type RequiemOptionsObject =
	RequiemUrlWithBodyOptions |
	RequiemUrlWithJsonOptions |
	RequiemHostWithBodyOptions |
	RequiemHostWithJsonOptions;

export type RequiemOptions = string | RequiemOptionsObject;

export interface RequiemResponse extends http.IncomingMessage {
	requestedUrl: string;
}

export interface RequiemResponseWithBody<T> extends RequiemResponse {
	body: T;
}

export interface RequiemRequest extends http.ClientRequest {
	requestedUrl: string;
}

export type RequiemErrorCode =
	'Timeout' |
	'RequestAbort' |
	'TooManyRedirects' |
	'InvalidUrl' |
	'InvalidStatusCode' |
	'InvalidJsonBody' |
	'InvalidRedirectUrl';

export class RequiemError extends Error {
	public readonly req: RequiemRequest | null;
	public readonly res: RequiemResponse | null;
	public readonly code: RequiemErrorCode;

	public constructor(
		code: RequiemErrorCode,
		message: string,
		req?: RequiemRequest | null,
		res?: RequiemResponse | null,
	) {
		super(message);
		this.code = code;
		this.req = req || null;
		this.res = res || null;
	}
}

const followRedirects = async (
	urls: string[],
	res: RequiemResponse,
	options: RequiemOptionsObject,
	depth = 0,
): Promise<RequiemResponse> => {
	const statusCode = res.statusCode;
	const maxDepth = options.followRedirects || defaultFollowRedirects;
	if (depth > maxDepth) {
		throw new RequiemError(
			'TooManyRedirects',
			`"${urls[0]}" redirected too many times (max redirects: ${maxDepth})`,
			null,
			res,
		);
	}

	const location = res.headers.location;
	if (!statusCode || statusCode < 300 || statusCode >= 400 || !location) {
		return res;
	}

	let newUrl: string;
	try {
		const parsedUrl = new URL(location, urls[urls.length - 1]);
		newUrl = parsedUrl.href;
	} catch (e) {
		throw new RequiemError(
			'InvalidRedirectUrl',
			`Invalid redirect URL: ${location}`,
			null,
			res,
		);
	}

	return new Promise<RequiemResponse>((resolve, reject) => {
		const urlOptions = { ...options };
		delete (urlOptions as RequiemHostOptions).host;
		delete (urlOptions as RequiemHostOptions).path;
		delete (urlOptions as RequiemHostOptions).port;
		delete (urlOptions as RequiemHostOptions).protocol;

		const newOptions: RequiemOptionsObject = {
			...(urlOptions as RequiemUrlOptions),
			url: newUrl,
			method: 'GET',
		};
		const req = createRequest(newOptions);
		req.on('response', (res) => {
			res.on('error', reject);
			const reqRes: RequiemResponse = Object.assign(res, {
				requestedUrl: newUrl,
			});

			followRedirects(urls.concat(newUrl), reqRes, options, depth + 1)
				.then(resolve)
				.catch(reject);
		});
		wireRequestEvents(req, newOptions, reject);
		req.end();
	});
};

const responseHandler = async (
	req: RequiemRequest,
	res: http.IncomingMessage,
	options: RequiemOptionsObject,
): Promise<RequiemResponse> => {
	const reqRes: RequiemResponse = Object.assign(res, {
		requestedUrl: req.requestedUrl,
	});
	const result = await followRedirects([req.requestedUrl], reqRes, options);
	if ('throwOnErrorResponse' in options) {
		if (typeof(options.throwOnErrorResponse) === 'number') {
			if (result.statusCode !== options.throwOnErrorResponse) {
				throw new RequiemError(
					'InvalidStatusCode',
					`Received invalid status code from "${result.requestedUrl}": ${result.statusCode} ` +
						`(expected ${options.throwOnErrorResponse})`,
					req,
					result,
				);
			}
		} else if (options.throwOnErrorResponse && result.statusCode && result.statusCode >= 400) {
			throw new RequiemError(
				'InvalidStatusCode',
				`Received invalid status code from "${result.requestedUrl}": ${result.statusCode}`,
				req,
				result,
			);
		}
	}
	return result;
};

const wireRequestEvents = (req: RequiemRequest, options: RequiemOptionsObject, reject: (err: Error) => void): void => {
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
			reject(new RequiemError(
				'Timeout',
				`Reached timeout limit (${'timeout' in options ? timeout + 'ms' : 'node default'}), request aborted`,
				req,
			));
		} else {
			reject(new RequiemError('RequestAbort', 'Request was aborted', req));
		}
	});
};

const isUrlOptions = (options: RequiemOptions): options is RequiemUrlOptions => {
	return typeof((options as RequiemUrlOptions).url) === 'string';
};

const isUrlBodyOptions = (options: RequiemOptions): options is RequiemUrlWithBodyOptions => {
	const key: keyof WithBody = 'body';
	return key in (options as WithBody);
};

const isUrlBodyJsonOptions = (options: RequiemOptions): options is RequiemUrlWithJsonOptions => {
	const key: keyof WithBodyJson = 'bodyJson';
	return key in (options as WithBodyJson);
};

const isHostBodyOptions = (options: RequiemOptions): options is RequiemHostWithBodyOptions => {
	const key: keyof WithBody = 'body';
	return key in (options as WithBody);
};

const isHostBodyJsonOptions = (options: RequiemOptions): options is RequiemHostWithJsonOptions => {
	const key: keyof WithBodyJson = 'bodyJson';
	return key in (options as WithBodyJson);
};

const getObjectionsObject = (options: RequiemOptions): RequiemOptionsObject => {
	if (typeof(options) === 'string') {
		return {
			url: options,
		};
	}

	return options;
};

export const createRequest = (options: RequiemOptions): RequiemRequest => {
	const optionsObj = getObjectionsObject(options);
	optionsObj.method = optionsObj.method || 'GET';
	const { followRedirects, throwOnErrorResponse, ...reqOptions } = optionsObj;

	// ensure we don't pass around anything extraneous
	delete (reqOptions as any as WithBody).body;
	delete (reqOptions as any as WithBodyJson).bodyJson;

	const httpOptions: https.RequestOptions = reqOptions;

	let urlStr: string;
	let url: URL;
	try {
		url = isUrlOptions(optionsObj) ?
			new URL(optionsObj.url) :
			formatUrl(optionsObj);
		urlStr = url.toString();
	} catch (e) {
		throw new RequiemError('InvalidUrl', `URL could not be formatted properly`);
	}

	const lib = /^https:/.test(urlStr) ? https : http;
	const req = lib.request(url, httpOptions);
	return Object.assign(req, {
		requestedUrl: urlStr,
	});
};

export const sendRequest = (req: RequiemRequest, options: RequiemOptions): Promise<RequiemResponse> => {
	const optionsObj = getObjectionsObject(options);
	return new Promise<RequiemResponse>((resolve, reject) => {
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
			} catch (e) {
				reject(e);
				return;
			}
		} else if (isHostBodyOptions(optionsObj) || isUrlBodyOptions(optionsObj)) {
			req.write(optionsObj.body);
		}

		req.end();
	});
};

export const request = (options: RequiemOptions): Promise<RequiemResponse> => {
	const optionsObj = getObjectionsObject(options);
	const req = createRequest(optionsObj);
	return sendRequest(req, optionsObj);
};

export const requestBody = async (options: RequiemOptions): Promise<RequiemResponseWithBody<Buffer>> => {
	const res = await request(options);
	const buffers: Buffer[] = [];
	return new Promise<RequiemResponseWithBody<Buffer>>((resolve) => {
		res.on('data', chunk => buffers.push(chunk));
		res.on('end', () => {
			const result: RequiemResponseWithBody<Buffer> = Object.assign(res, {
				body: Buffer.concat(buffers),
			});

			resolve(result);
		});
	});
};

export const requestJson = async <T = any>(options: RequiemOptions): Promise<RequiemResponseWithBody<T>> => {
	const res = await requestBody(options);
	const body = res.body;
	const bodyStr = body.toString('utf8');
	try {
		const json = JSON.parse(bodyStr);
		return Object.assign(res, {
			body: json,
		});
	} catch (e) {
		throw new RequiemError(
			'InvalidJsonBody',
			`Failed to parse body as JSON: ${e.message}`,
			null,
			res,
		);
	}
};
