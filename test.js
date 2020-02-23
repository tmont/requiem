const fs = require('fs');
const requiem = require('./');

const test = async () => {
	const postJsonOptions = {
		url: 'https://example.com/',
		method: 'POST',
		bodyJson: {
			hello: 'world'
		}
	};
	const postBufferOptions = {
		url: 'https://example.com/',
		method: 'POST',
		body: 'hello world'
	};
	const noRedirectOptions = {
		url: 'https://example.com/',
		followRedirects: 0
	};
	const throwOnErrorOptions = {
		url: 'https://example.com/',
		throwOnErrorResponse: true
	};
	await Promise.all([
		requiem.requestBody('https://example.com/')
			.then((res) => console.log(res.body.toString('utf8')))
			.catch((err) => console.error(err)),

		requiem.request('https://example.com/')
			.then((res) => {
				return new Promise((resolve, reject) => {
					res.pipe(fs.createWriteStream('./example.html'))
						.on('error', reject)
						.on('finish', resolve);
				});
			})
			.catch((err) => console.error(err)),

		requiem.requestJson('https://jsonplaceholder.typicode.com/posts/1')
			.then((json) => console.log(json))
			.catch((err) => console.error(err)),


		requiem.request(postJsonOptions)
			.then((res) => console.log(res.statusCode))
			.catch((err) => console.error(err)),


		requiem.request(postBufferOptions)
			.then((res) => console.log(res.statusCode))
			.catch((err) => console.error(err)),


		requiem.requestBody(noRedirectOptions)
			.then((res) => console.log(res.body.toString('utf8')))
			.catch((err) => console.error(err)),

		requiem.requestBody(throwOnErrorOptions)
			.then((res) => console.log(res.body.toString('utf8')))
			.catch((err) => console.error(err)),
	]);
};

test()
	.then(() => {
		console.log('all done');
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
