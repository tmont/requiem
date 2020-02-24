import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import * as stream from 'stream';
import * as express from 'express';
import * as requiem from '../';
import expect = require('expect.js');

type UrlType =
	'200.json' |
	'200.txt' |
	'500.json' |
	'500.txt' |
	'headers.xml' |
	'auth' |
	'timeout' |
	'destroy' |
	'redirect/invalid' |
	'redirect/1/200.json' |
	'redirect/2/200.json' |
	'redirect/3/200.json' |
	'redirect/result/200.json' |
	'redirect/result/500.json' |
	'post.json'
	;

const defaultJson = {
	hello: 'world',
};
const defaultText = 'hello world';
const defaultXml = '<?xml version="1.0" ?><hello>world</hello>';

const routeHandlers: Record<UrlType, express.RequestHandler> = {
	auth: (req, res) => {
		const auth = req.headers.authorization;
		res.setHeader('Content-Type', 'text/plain');
		res.send(auth);
	},
	timeout: (req, res) => {
		setTimeout(() => {
			res.setHeader('Content-Type', 'text/plain');
			res.send('did not timeout');
		}, 1000);
	},
	destroy: (req, res) => {
		res.destroy();
	},
	'headers.xml': (req, res) => {
		res.setHeader('Content-Type', 'application/xml');
		res.setHeader('Content-Length', defaultXml.length);
		res.setHeader('X-Hello', 'World');
		res.setHeader('X-Array', [ 'foo', 'bar' ]);
		res.statusCode = 201;
		res.send(defaultXml);
	},
	'200.json': (req, res) => {
		res.setHeader('Content-Type', 'application/json; charset=utf-8');
		res.send(defaultJson);
	},
	'200.txt': (req, res) => {
		res.setHeader('Content-Type', 'text/plain');
		res.send(defaultText);
	},
	'500.json': (req, res) => {
		res.setHeader('Content-Type', 'application/json; charset=utf-8');
		res.status(500);
		res.send(defaultJson);
	},
	'500.txt': (req, res) => {
		res.setHeader('Content-Type', 'text/plain');
		res.status(500);
		res.send(defaultText);
	},
	'redirect/result/500.json': (req, res) => {
		res.setHeader('Location', '/500.json');
		res.sendStatus(302);
	},
	'redirect/3/200.json': (req, res) => {
		res.setHeader('Location', '/redirect/2/200.json');
		res.sendStatus(302);
	},
	'redirect/2/200.json': (req, res) => {
		res.setHeader('Location', '/redirect/1/200.json');
		res.sendStatus(302);
	},
	'redirect/1/200.json': (req, res) => {
		res.setHeader('Location', '/redirect/result/200.json');
		res.sendStatus(302);
	},
	'redirect/result/200.json': (req, res) => {
		res.setHeader('Location', '/200.json');
		res.sendStatus(302);
	},
	'redirect/invalid': (req, res) => {
		res.setHeader('Location', '/####');
		res.sendStatus(302);
	},
	'post.json': (req, res) => {
		const body = req.body;
		res.setHeader('Content-Type', 'application/json');
		res.json(body);
	},
};

describe('requiem', () => {
	let httpServer: http.Server;
	let httpsServer: http.Server;
	let app: express.Application;
	const httpPort = 11000;
	const httpsPort = httpPort + 1;

	const getUrl = (protocol: 'http' | 'https', type: UrlType): string => {
		const port = protocol === 'http' ? httpPort : httpsPort;
		return `${protocol}://localhost:${port}/${type}`;
	};

	before((done) => {
		app = express();
		app.use(express.urlencoded({extended: true}));
		app.use(express.json());

		Object.keys(routeHandlers).forEach((type) => {
			const handler = routeHandlers[type];
			app.get(`/${type}`, handler);
			app.post(`/${type}`, handler);
		});

		httpServer = app.listen(httpPort, done);
	});

	before((done) => {
		if (!app) {
			done(new Error('express app not set up'));
			return;
		}
		const options: https.ServerOptions = {
			cert: fs.readFileSync(path.join(__dirname, 'cert.pem')),
			key: fs.readFileSync(path.join(__dirname, 'key.pem')),
		};
		httpsServer = https.createServer(options, app).listen(httpsPort, done);
	});

	after((done) => {
		if (!httpServer) {
			done();
			return;
		}

		httpServer.close(done);
	});

	after((done) => {
		if (!httpsServer) {
			done();
			return;
		}

		httpsServer.close(done);
	});

	const getBodyFromDataStream = (res: http.IncomingMessage): Promise<Buffer> => {
		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = [];
			res.on('data', chunk => chunks.push(chunk));
			res.on('error', reject);
			res.on('end', () => {
				try {
					resolve(Buffer.concat(chunks));
				} catch (e) {
					reject(e);
					return;
				}

				resolve();
			});
		});
	};

	const protocols: [ 'http', 'https' ] = [ 'http', 'https' ];

	const commonOptions: Pick<https.RequestOptions, 'rejectUnauthorized'> = {
		rejectUnauthorized: false,
	};

	it(`should handle invalid URL`, async () => {
		try {
			await requiem.request({
				url: 'nope',
			});
		} catch (e) {
			const err = e as requiem.RequiemError;
			expect(err.code).to.equal('InvalidUrl');
			return;
		}

		throw new Error('Expected error to be thrown');
	});

	it(`should require one of "url" or "host"`, async () => {
		try {
			await requiem.request({} as any);
		} catch (e) {
			const err = e as requiem.RequiemError;
			expect(err.code).to.equal('InvalidUrl');
			return;
		}

		throw new Error('Expected error to be thrown');
	});

	protocols.forEach((protocol) => {
		describe(protocol, () => {
			describe('request', () => {
				it(`should request ${protocol} URL`, async () => {
					const url = getUrl(protocol, '200.json');
					const res = await requiem.request({
						...commonOptions,
						url,
					});

					expect(res.requestedUrl).to.equal(url);
					expect(res.statusCode).to.equal(200);
					expect(res.headers['content-type']).to.equal('application/json; charset=utf-8');
					expect(res).to.not.have.property('body');

					// verify body
					const buffer = await getBodyFromDataStream(res);
					const json = JSON.parse(buffer.toString('utf8'));
					expect(json).to.eql(defaultJson);
				});

				if (protocol === 'http') {
					it(`should request ${protocol} URL with string`, async () => {
						const url = getUrl(protocol, '200.json');
						const res = await requiem.request(url);

						expect(res.requestedUrl).to.equal(url);
						expect(res.statusCode).to.equal(200);
						expect(res.headers['content-type']).to.equal('application/json; charset=utf-8');
						expect(res).to.not.have.property('body');

						// verify body
						const buffer = await getBodyFromDataStream(res);
						const json = JSON.parse(buffer.toString('utf8'));
						expect(json).to.eql(defaultJson);
					});
				}

				it(`should request ${protocol} URL with auth`, async () => {
					const url = getUrl(protocol, 'auth');
					const res = await requiem.request({
						...commonOptions,
						url,
						auth: 'deadbeef',
					});

					expect(res.requestedUrl).to.equal(url);
					expect(res.statusCode).to.equal(200);
					expect(res).to.not.have.property('body');

					// verify body
					const buffer = await getBodyFromDataStream(res);
					expect(buffer.toString()).to.equal('Basic ZGVhZGJlZWY=');
				});

				it(`should request ${protocol} URL and timeout`, async () => {
					const url = getUrl(protocol, 'timeout');
					try {
						await requiem.request({
							...commonOptions,
							url,
							timeout: 100,
						});
					} catch (e) {
						const err = e as requiem.RequiemError;
						expect(err.code).to.equal('Timeout');
						expect(err.req).to.be.an('object');
						expect(err.message).to.equal('Reached timeout limit (100ms), request aborted');
						return;
					}

					throw new Error('expected error to be thrown');
				});

				it(`should request ${protocol} URL and gracefully handle socket hang up`, async () => {
					const url = getUrl(protocol, 'destroy');
					try {
						await requiem.request({
							...commonOptions,
							url,
						});
					} catch (e) {
						const err = e as Error & { code: string };
						expect(err.code).to.equal('ECONNRESET');
						return;
					}

					throw new Error('expected error to be thrown');
				});

				it(`should request ${protocol} URL and handle abortion`, async () => {
					const url = getUrl(protocol, 'timeout');
					const options = {
						url,
						...commonOptions,
					};
					try {
						const req = requiem.createRequest(options);
						setTimeout(() => req.abort(), 100);
						await requiem.sendRequest(req, options);
					} catch (e) {
						const err = e as requiem.RequiemError;
						expect(err.code).to.equal('RequestAbort');
						expect(err.req).to.be.an('object');
						expect(err.message).to.equal('Request was aborted');
						return;
					}

					throw new Error('expected error to be thrown');
				});

				it(`should request ${protocol} URL and handle request error`, async () => {
					const url = getUrl(protocol, 'timeout');
					const options = {
						url,
						...commonOptions,
					};
					const err = new Error('sux');
					try {
						const req = requiem.createRequest(options);
						setTimeout(() => req.emit('error', err), 100);
						await requiem.sendRequest(req, options);
					} catch (e) {
						expect(e).to.equal(err);
						return;
					}

					throw new Error('expected error to be thrown');
				});

				if (protocol === 'https') {
					it(`should request ${protocol} URL and handle SSL error`, async () => {
						const url = getUrl(protocol, '200.json');
						const options = {
							url,
						};
						try {
							await requiem.request(options);
						} catch (e) {
							expect(e.message).to.equal('self signed certificate');
							return;
						}

						throw new Error('expected error to be thrown');
					});
				}

				it(`should request ${protocol} URL that returns 5xx`, async () => {
					const url = getUrl(protocol, '500.json');
					const res = await requiem.request({
						...commonOptions,
						url,
					});

					expect(res.requestedUrl).to.equal(url);
					expect(res.statusCode).to.equal(500);
					expect(res.headers['content-type']).to.equal('application/json; charset=utf-8');
					expect(res).to.not.have.property('body');

					// verify body
					const buffer = await getBodyFromDataStream(res);
					const json = JSON.parse(buffer.toString('utf8'));
					expect(json).to.eql(defaultJson);
				});

				it(`should request ${protocol} URL and follow redirects by default`, async () => {
					const res = await requiem.request({
						...commonOptions,
						url: getUrl(protocol, 'redirect/3/200.json'),
					});

					expect(res.statusCode).to.equal(200);
					expect(res.headers['content-type']).to.equal('application/json; charset=utf-8');
					expect(res).to.not.have.property('body');

					// verify body
					const buffer = await getBodyFromDataStream(res);
					const json = JSON.parse(buffer.toString('utf8'));
					expect(json).to.eql(defaultJson);
				});

				it(`should request ${protocol} URL and follow redirects that returns 5xx`, async () => {
					const url = getUrl(protocol, 'redirect/result/500.json');
					const res = await requiem.request({
						...commonOptions,
						url,
					});

					expect(res.requestedUrl).to.equal(getUrl(protocol, '500.json'));
					expect(res.statusCode).to.equal(500);
					expect(res.headers['content-type']).to.equal('application/json; charset=utf-8');
					expect(res).to.not.have.property('body');

					// verify body
					const buffer = await getBodyFromDataStream(res);
					const json = JSON.parse(buffer.toString('utf8'));
					expect(json).to.eql(defaultJson);
				});

				it('should throw error for too many redirects', async () => {
					const url = getUrl(protocol, 'redirect/3/200.json');
					try {
						await requiem.request({
							...commonOptions,
							url,
							followRedirects: 2,
						});
					} catch (e) {
						const err = e as requiem.RequiemError;
						expect(err.message).to.equal(`"${url}" redirected too many times (max redirects: 2)`);
						expect(err.res).to.be.an('object');
						expect(err.res!.statusCode).to.equal(302);
						return;
					}

					throw new Error(`expected an error to be thrown`);
				});

				it('should post JSON', async () => {
					const url = getUrl(protocol, 'post.json');
					const bodyJson = {
						post: 'data',
					};
					const res = await requiem.request({
						...commonOptions,
						url,
						method: 'POST',
						bodyJson,
					});

					expect(res.requestedUrl).to.equal(getUrl(protocol, 'post.json'));
					expect(res.statusCode).to.equal(200);
					expect(res.headers['content-type']).to.equal('application/json; charset=utf-8');
					expect(res).to.not.have.property('body');

					// verify body
					const buffer = await getBodyFromDataStream(res);
					const json = JSON.parse(buffer.toString('utf8'));
					expect(json).to.eql(bodyJson);
				});

				it('should post JSON with Buffer', async () => {
					const url = getUrl(protocol, 'post.json');
					const bodyJson = {
						post: 'data',
					};
					const res = await requiem.request({
						...commonOptions,
						url,
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: Buffer.from(JSON.stringify(bodyJson)),
					});

					expect(res.requestedUrl).to.equal(getUrl(protocol, 'post.json'));
					expect(res.statusCode).to.equal(200);
					expect(res.headers['content-type']).to.equal('application/json; charset=utf-8');
					expect(res).to.not.have.property('body');

					// verify body
					const buffer = await getBodyFromDataStream(res);
					const json = JSON.parse(buffer.toString('utf8'));
					expect(json).to.eql(bodyJson);
				});

				it('should throw error for invalid status code', async () => {
					const url = getUrl(protocol, '500.json');
					try {
						await requiem.request({
							...commonOptions,
							url,
							throwOnErrorResponse: true,
						});
					} catch (e) {
						const err = e as requiem.RequiemError;
						expect(err.code).to.equal('InvalidStatusCode');
						expect(err.message).to.equal(`Received invalid status code from "${url}": 500`);
						expect(err.res).to.be.an('object');
						expect(err.res!.statusCode).to.equal(500);
						return;
					}

					throw new Error('expected error to be thrown');
				});

				it('should throw error if status code does not match', async () => {
					const url = getUrl(protocol, '200.json');
					try {
						await requiem.request({
							...commonOptions,
							url,
							throwOnErrorResponse: 123,
						});
					} catch (e) {
						const err = e as requiem.RequiemError;
						expect(err.code).to.equal('InvalidStatusCode');
						expect(err.res).to.be.an('object');
						expect(err.res!.statusCode).to.equal(200);
						expect(err.message).to.equal(`Received invalid status code from "${url}": 200 (expected 123)`);
						return;
					}

					throw new Error('expected error to be thrown');
				});
			});

			describe('requestJson', () => {
				it(`should request ${protocol} URL`, async () => {
					const url = getUrl(protocol, '200.json');
					const result = await requiem.requestJson<typeof defaultJson>({
						...commonOptions,
						url,
					});

					expect(result.statusCode).to.equal(200);
					expect(result.requestedUrl).to.equal(url);
					expect(result).to.have.property('body');
					expect(result.body).to.eql(defaultJson);
				});

				if (protocol === 'http') {
					it(`should request ${protocol} URL with string`, async () => {
						const url = getUrl(protocol, '200.json');
						const result = await requiem.requestJson<typeof defaultJson>(url);
						expect(result.statusCode).to.equal(200);
						expect(result.requestedUrl).to.equal(url);
						expect(result).to.have.property('body');
						expect(result.body).to.eql(defaultJson);
					});
				}

				it(`should request ${protocol} URL that returns 5xx`, async () => {
					const url = getUrl(protocol, '500.json');
					const result = await requiem.requestJson<typeof defaultJson>({
						...commonOptions,
						url: url,
					});

					expect(result.statusCode).to.equal(500);
					expect(result.requestedUrl).to.equal(url);
					expect(result).to.have.property('body');
					expect(result.body).to.eql(defaultJson);
				});

				it(`should handle ${protocol} URL that does not return JSON`, async () => {
					try {
						await requiem.requestJson<typeof defaultJson>({
							...commonOptions,
							url: getUrl(protocol, '200.txt'),
						});
					} catch (e) {
						const err = e as requiem.RequiemError;
						expect(err.code).to.equal('InvalidJsonBody');
						expect(err.res).to.be.an('object');
						expect(err.res!.statusCode).to.equal(200);
						expect(err.message).to.equal('Failed to parse body as JSON: Unexpected token h in JSON at position 0');
						return;
					}

					throw new Error('Expected error to be thrown');
				});

				it(`should handle ${protocol} URL that returns 5xx and does not return JSON`, async () => {
					try {
						await requiem.requestJson<typeof defaultJson>({
							...commonOptions,
							url: getUrl('http', '500.txt'),
						});
					} catch (e) {
						const err = e as requiem.RequiemError;
						expect(err.code).to.equal('InvalidJsonBody');
						expect(err.res).to.be.an('object');
						expect(err.res!.statusCode).to.equal(500);
						expect(err.message).to.equal('Failed to parse body as JSON: Unexpected token h in JSON at position 0');
						return;
					}

					throw new Error('Expected error to be thrown');
				});

				it('should post JSON', async () => {
					const url = getUrl(protocol, 'post.json');
					const bodyJson = {
						post: 'data',
					};
					const result = await requiem.requestJson<typeof bodyJson>({
						...commonOptions,
						url,
						method: 'POST',
						bodyJson,
					});
					expect(result.statusCode).to.equal(200);
					expect(result.requestedUrl).to.equal(url);
					expect(result).to.have.property('body');
					expect(result.body).to.eql(bodyJson);
				});

				it('should throw error for invalid status code', async () => {
					const url = getUrl(protocol, '500.json');
					try {
						await requiem.requestJson({
							...commonOptions,
							url,
							throwOnErrorResponse: true,
						});
					} catch (e) {
						const err = e as requiem.RequiemError;
						expect(err.code).to.equal('InvalidStatusCode');
						expect(err.res).to.be.an('object');
						expect(err.res!.statusCode).to.equal(500);
						expect(err.message).to.equal(`Received invalid status code from "${url}": 500`);
						return;
					}

					throw new Error('expected error to be thrown');
				});
			});

			describe('requestBody', () => {
				it(`should request ${protocol} URL`, async () => {
					const url = getUrl(protocol, '200.json');
					const res = await requiem.requestBody({
						...commonOptions,
						url,
					});

					expect(res.requestedUrl).to.equal(url);
					expect(res.statusCode).to.equal(200);
					expect(res.body).to.be.a(Buffer);
					expect(res.body.toString('utf8')).to.equal(JSON.stringify(defaultJson));
				});

				if (protocol === 'http') {
					it(`should request ${protocol} URL with string`, async () => {
						const url = getUrl(protocol, '200.json');
						const res = await requiem.requestBody(url);

						expect(res.requestedUrl).to.equal(url);
						expect(res.statusCode).to.equal(200);
						expect(res.body).to.be.a(Buffer);
						expect(res.body.toString('utf8')).to.equal(JSON.stringify(defaultJson));
					});
				}

				it(`should request ${protocol} URL that returns 5xx`, async () => {
					const url = getUrl(protocol, '500.json');
					const res = await requiem.requestBody({
						...commonOptions,
						url,
					});

					expect(res.requestedUrl).to.equal(url);
					expect(res.statusCode).to.equal(500);
					expect(res.body).to.be.a(Buffer);
					expect(res.body.toString('utf8')).to.equal(JSON.stringify(defaultJson));
				});

				it('should post JSON', async () => {
					const url = getUrl(protocol, 'post.json');
					const bodyJson = {
						post: 'data',
					};
					const buffer = Buffer.from(JSON.stringify(bodyJson));
					const result = await requiem.requestBody({
						...commonOptions,
						url,
						method: 'POST',
						bodyJson,
					});

					expect(Buffer.compare(result.body, buffer)).to.equal(0);
				});

				it('should throw error for invalid status code', async () => {
					const url = getUrl(protocol, '500.json');
					try {
						await requiem.requestBody({
							...commonOptions,
							url,
							throwOnErrorResponse: true,
						});
					} catch (e) {
						const err = e as requiem.RequiemError;
						expect(err.code).to.equal('InvalidStatusCode');
						expect(err.res).to.be.an('object');
						expect(err.res!.statusCode).to.equal(500);
						expect(err.message).to.equal(`Received invalid status code from "${url}": 500`);
						return;
					}
				});
			});

			describe('streaming', () => {
				it(`should request ${protocol} URL as readable stream`, async () => {
					const url = getUrl(protocol, '200.json');
					const res = await requiem.request({
						...commonOptions,
						url,
					});

					expect(res.requestedUrl).to.equal(url);
					await new Promise((resolve, reject) => {
						const passthru = new stream.PassThrough();
						res.pipe(passthru)
							.on('error', reject)
							.on('finish', resolve);
					});
				});

				describe('Reverse proxy', () => {
					let otherApp: express.Application;
					let otherServer: http.Server;
					const otherPort = httpsPort + 1;

					beforeEach((done) => {
						otherApp = express();
						otherApp.use(express.urlencoded({extended: true}));
						otherApp.use(express.json());
						otherServer = otherApp.listen(otherPort, done);
					});

					afterEach((done) => {
						if (!otherServer) {
							done();
							return;
						}

						otherServer.close(done);
					});

					it(`should request ${protocol} URL as readable stream and pipe to HTTP response as JSON`, async () => {
						otherApp.get('/test', async (req, res) => {
							const url = getUrl(protocol, '200.json');
							const requiemRes = await requiem.request({
								...commonOptions,
								url,
							});

							requiemRes.reverseProxy(res);
						});

						const res = await requiem.requestJson(`http://localhost:${otherPort}/test`);
						expect(res.body).to.eql(defaultJson);
					});

					it(`should request ${protocol} URL as reverse proxy and propagate status code`, async () => {
						otherApp.get('/test', async (req, res) => {
							const url = getUrl(protocol, '500.json');
							const requiemRes = await requiem.request({
								...commonOptions,
								url,
							});

							requiemRes.reverseProxy(res);
						});

						const res = await requiem.requestJson(`http://localhost:${otherPort}/test`);
						expect(res.body).to.eql(defaultJson);
						expect(res.statusCode).to.equal(500);
					});

					it(`should request ${protocol} URL as reverse proxy and propagate headers`, async () => {
						otherApp.get('/test', async (req, res) => {
							const url = getUrl(protocol, 'headers.xml');
							const requiemRes = await requiem.request({
								...commonOptions,
								url,
							});

							requiemRes.reverseProxy(res);
						});

						const res = await requiem.requestBody(`http://localhost:${otherPort}/test`);
						expect(res.statusCode).to.equal(201);
						expect(res.body.toString('utf8')).to.eql(defaultXml);
						expect(res.headers['content-type']).to.equal('application/xml; charset=utf-8');
						expect(res.headers['content-length']).to.equal(String(defaultXml.length));
						expect(res.headers['x-hello']).to.equal('World');
						expect(res.headers['x-array']).to.equal('foo, bar');
					});
				});

				if (protocol === 'http') {
					it(`should request ${protocol} URL with string as readable stream`, async () => {
						const url = getUrl(protocol, '200.json');
						const res = await requiem.request(url);

						expect(res.requestedUrl).to.equal(url);
						await new Promise((resolve, reject) => {
							const passthru = new stream.PassThrough();
							res.pipe(passthru)
								.on('error', reject)
								.on('finish', resolve);
						});
					});
				}

				it(`should request ${protocol} URL as readable stream for 5xx`, async () => {
					const url = getUrl(protocol, '500.json');
					const res = await requiem.request({
						...commonOptions,
						url,
					});

					expect(res.requestedUrl).to.equal(url);
					await new Promise((resolve, reject) => {
						const passthru = new stream.PassThrough();
						res.pipe(passthru)
							.on('error', reject)
							.on('finish', resolve);
					});
				});

				it('should post JSON', async () => {
					const url = getUrl(protocol, 'post.json');
					const bodyJson = {
						post: 'data',
					};
					const res = await requiem.request({
						...commonOptions,
						url,
						bodyJson,
					});

					expect(res.requestedUrl).to.equal(url);
					await new Promise((resolve, reject) => {
						const passthru = new stream.PassThrough();
						res.pipe(passthru)
							.on('error', reject)
							.on('finish', resolve);
					});
				});
			});
		});
	});
});
