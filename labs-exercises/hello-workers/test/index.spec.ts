import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { afterEach, describe, it, expect, vi } from "vitest";
import worker from "../src";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Hello World user worker", () => {
	describe("request for /message", () => {
		it('/ responds with "Hello from the edge!" (unit style)', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>(
				"http://example.com/message"
			);
			// Create an empty context to pass to `worker.fetch()`.
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
			await waitOnExecutionContext(ctx);
			expect(await response.text()).toMatchInlineSnapshot(
				`"Hello from the edge!"`
			);
		});

		it('responds with "Hello from the edge!" (integration style)', async () => {
			const request = new Request("http://example.com/message");
			const response = await SELF.fetch(request);
			expect(await response.text()).toMatchInlineSnapshot(
				`"Hello from the edge!"`
			);
		});
	});

	describe("request for /random", () => {
		it("/ responds with a random UUID (unit style)", async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>(
				"http://example.com/random"
			);
			// Create an empty context to pass to `worker.fetch()`.
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
			await waitOnExecutionContext(ctx);
			expect(await response.text()).toMatch(
				/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/
			);
		});

		it("responds with a random UUID (integration style)", async () => {
			const request = new Request("http://example.com/random");
			const response = await SELF.fetch(request);
			expect(await response.text()).toMatch(
				/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/
			);
		});
	});

	describe("error handling", () => {
		it("returns a sensible 500 response when an endpoint throws", async () => {
			vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
				throw new Error("UUID service failed");
			});
			const error = vi
				.spyOn(console, "error")
				.mockImplementation(() => undefined);
			const request = new Request<unknown, IncomingRequestCfProperties>(
				"http://example.com/random"
			);
			const ctx = createExecutionContext();

			const response = await worker.fetch(request, env, ctx);

			await waitOnExecutionContext(ctx);
			expect(response.status).toBe(500);
			expect(response.headers.get("Content-Type")).toContain("application/json");
			await expect(response.json()).resolves.toEqual({
				error: "Internal Server Error",
				message: "Something went wrong while handling this request.",
			});
			expect(error).toHaveBeenCalledWith(
				JSON.stringify({
					event: "error",
					message: "UUID service failed",
				})
			);
		});
	});

	describe("request for /stats", () => {
		it("returns worker metadata and logs the incoming request", async () => {
			const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
			const request = new Request<unknown, IncomingRequestCfProperties>(
				"http://example.com/stats",
				{
					headers: {
						"CF-Connecting-IP": "203.0.113.10",
					},
					cf: {
						colo: "SJC",
					},
				}
			);
			const ctx = createExecutionContext();

			const response = await worker.fetch(request, env, ctx);

			await waitOnExecutionContext(ctx);
			expect(response.status).toBe(200);
			expect(response.headers.get("Content-Type")).toContain("application/json");
			await expect(response.json()).resolves.toEqual({
				worker: "hello-workers",
				colo: "SJC",
				clientIp: "203.0.113.10",
			});
			expect(log).toHaveBeenCalledWith(
				JSON.stringify({
					event: "request",
					method: "GET",
					pathname: "/stats",
					colo: "SJC",
					clientIp: "203.0.113.10",
				})
			);
		});
	});
});
