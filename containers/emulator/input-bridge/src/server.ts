import { Value } from "@sinclair/typebox/value";
import { Hono } from "hono";

import { type CommandResult, type CommandRunner, DesmumeDriver } from "./desmume-driver.js";
import { type ButtonRequest, ButtonSchema, type TouchRequest, TouchSchema } from "./types.js";

const toErrorMessage = (error: unknown): string => {
	if (error instanceof Error) {
		return error.message;
	}
	return "unknown";
};

const readBytes = async (stream: ReadableStream<Uint8Array> | null): Promise<Uint8Array> => {
	if (stream === null) {
		return new Uint8Array();
	}
	const buffer = await new Response(stream).arrayBuffer();
	return new Uint8Array(buffer);
};

const readText = async (stream: ReadableStream<Uint8Array> | null): Promise<string> => {
	const bytes = await readBytes(stream);
	return new TextDecoder().decode(bytes);
};

export const createBunRunner = (): CommandRunner => {
	const runner: CommandRunner = {
		async run(cmd: string, args: readonly string[], opts?: { readonly input?: string }): Promise<CommandResult> {
			const spawn = Bun.spawn([cmd, ...args], {
				stdin: opts?.input === undefined ? "ignore" : "pipe",
				stdout: "pipe",
				stderr: "pipe",
			});

			const stdin = spawn.stdin;
			if (opts?.input !== undefined && stdin !== undefined && stdin !== null) {
				const payload = new TextEncoder().encode(opts.input);
				await stdin.write(payload);
				await stdin.end();
			}

			const stdout = await readBytes(spawn.stdout);
			const stderr = await readText(spawn.stderr);
			const code = await spawn.exited;

			return { stdout, stderr, code };
		},
	};
	return runner;
};

export const buildApp = (driver: DesmumeDriver) => {
	const app = new Hono();

	app.get("/health", (context) => {
		return context.json({ status: "ok" });
	});

	app.post("/button", async (context) => {
		const body = await context.req.json();
		let payload: ButtonRequest;
		try {
			payload = Value.Parse(ButtonSchema, body);
		} catch {
			return context.json({ ok: false, error: "invalid button payload" }, 400);
		}

		try {
			await driver.pressButton(payload.button, payload.hold_ms);
			return context.json({ ok: true });
		} catch (error) {
			return context.json({ ok: false, error: toErrorMessage(error) }, 503);
		}
	});

	app.post("/touch", async (context) => {
		const body = await context.req.json();
		let payload: TouchRequest;
		try {
			payload = Value.Parse(TouchSchema, body);
		} catch {
			return context.json({ ok: false, error: "invalid touch payload" }, 400);
		}

		try {
			await driver.touch(payload.x, payload.y);
			return context.json({ ok: true });
		} catch (error) {
			return context.json({ ok: false, error: toErrorMessage(error) }, 503);
		}
	});

	app.get("/screenshot", async (context) => {
		try {
			const screenshot = await driver.captureScreen();
			return context.json({
				image: screenshot.base64,
				width: screenshot.width,
				height: screenshot.height,
			});
		} catch (error) {
			return context.json({ ok: false, error: toErrorMessage(error) }, 503);
		}
	});

	return app;
};

if (import.meta.main) {
	const driver = new DesmumeDriver(createBunRunner());
	const app = buildApp(driver);
	const port = 7878;
	console.log(`[input-bridge] listening on :${port}`);
	Bun.serve({ port, fetch: app.fetch });
}
