## Requiem
A simple, dependency-free wrapper around Node's HTTP request functionality.

Using `http` and/or `https` is annoying, hence the existence of other
libraries like `request`, `axios`, `got`, etc. Those are all very
full-featured, with many bells and whistles.

`requiem` simply makes working with `http.request` more convenient.

`requiem` is not browser-compatible; it is meant for Node.JS environments only.

### Features
- Follow redirects (configurable via `followRedirects` configuration option)
- Timeouts will throw errors, don't have to abort the request yourself (configurable via `timeout` configuration option)
- Supports all configuration parameters you can pass to `http.request()`
- Streaming
- Promise-based
- First-class JSON support
- First-class TypeScript support
- Automatically throw based on status code (configurable via `throwOnErrorResponse` configuration option)

### Example usage
```javascript
const requiem = require('requiem-http');

// GET the response body as a Buffer
requiem.requestBody('https://example.com/')
  .then((res) => console.log(res.body.toString('utf8')))
  .catch((err) => console.error(err));

// get the raw HTTP request and do whatever with it (e.g. for streaming)
requiem.request('https://example.com/')
  .then((res) => {
    return new Promise((resolve, reject) => {
      res.pipe(fs.createWriteStream('./example.html'))
        .on('error', reject)
        .on('finish', resolve);
      });
    })
  .catch((err) => console.error(err));

// get the response body as JSON
requiem.requestJson('https://jsonplaceholder.typicode.com/posts/1')
  .then((json) => console.log(json))
  .catch((err) => console.error(err));

// POST a JSON body
const postJsonOptions = {
  url: 'https://example.com/',
  method: 'POST',
  bodyJson: {
    hello: 'world'
  }
};
requiem.request(postJsonOptions)
  .then((res) => console.log(res.statusCode))
  .catch((err) => console.error(err));

// POST a Buffer/string
const postBufferOptions = {
  url: 'https://example.com/',
  method: 'POST',
  body: 'hello world'
};
requiem.request(postBufferOptions)
  .then((res) => console.log(res.statusCode))
  .catch((err) => console.error(err));

// request a URL but don't follow redirects
// an error is thrown with code "TooManyRedirects" if the redirect limit is reached
const noRedirectOptions = {
  url: 'https://example.com/',
  followRedirects: 0
};
requiem.requestBody(noRedirectOptions)
  .then((res) => console.log(res.body.toString('utf8')))
  .catch((err) => console.error(err));

// request a URL and throw if the status is >= 400
// an error is thrown with code "InvalidStatusCode" if status >= 400
const throwOnErrorOptions = {
  url: 'https://example.com/',
  throwOnErrorResponse: true
};
requiem.requestBody(throwOnErrorOptions)
  .then((res) => console.log(res.body.toString('utf8')))
  .catch((err) => console.error(err));
```

### API
All functions take the exact same arguments: an `options` object:

```typescript
interface RequiemOptions {
  // specifying the URL to request
  url: string; // required if "host" is not set
  host: string; // required if "url" is not set
  path?: string;
  port?: string;
  protocol?: string;

  // request body (only one of "body" and "bodyJson" may be set)
  body?: string | Buffer;
  bodyJson?: any;

  method?: string; // defaults to 'GET'

  // convenience options
  followRedirects?: number; // max number of redirects to follow (defaults to 5)
  throwOnErrorResponse?: boolean | number; // if boolean, throw if response status is >= 400
                                           // if number, throw if response status is not an exact match
                                           // default is "false"

  // all other builtin HTTP/HTTPS options for http.request() or https.request()
  auth?: string;
  agent?: http.Agent | boolean;
  headers?: any;
  timeout?: number;
  rejectUnauthorized?: boolean;
  ciphers?: string;
  // ...
}
```

#### `.request(options: RequiemOptions): Promise<RequiemResponse>`
Creates and sends a request. Returns the response. Most useful for streaming
or otherwise handling the response yourself.

The response body is not consumed.

`RequiemResponse` is the following:

```typescript
interface RequiemResponse extends http.IncomingMessage {
  requestedUrl: string;
}
``` 

#### `.requestBody(options: RequiemOptions): Promise<RequiemResponseWithBody>`
Sends a request, consumes the response body, and returns the response with the
`body` attached as a `Buffer`:

```typescript
interface RequiemResponseWithBody extends RequiemResponse {
  body: Buffer;
}
``` 

#### `.requestJson<T = any>(options: RequiemOptions): Promise<T>`
Sends a request, consumes the response body, and parses the body as JSON via `JSON.parse`.

If the response is not valid JSON, an error is thrown with code `InvalidJsonBody`.
