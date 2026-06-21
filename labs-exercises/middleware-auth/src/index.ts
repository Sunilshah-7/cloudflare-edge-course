/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { compose, cors, logging, rateLimit, validateJsonBody, auth } from './middleware';
import { handleRequest } from './handler';

const middlewares = [
	cors('*'),
	rateLimit(10, 60_000),
	logging,
	validateJsonBody,
	auth('https://your-jwks-url.com', 'your-audience'),
];
const handler = compose(middlewares, handleRequest);

export default {
	fetch: handler,
} satisfies ExportedHandler<Env>;
