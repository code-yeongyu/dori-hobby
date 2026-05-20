import { describe, expect, it } from "vitest";

import { type CommandResult, type CommandRunner, DesmumeDriver } from "../src/desmume-driver.js";
import { buildApp } from "../src/server.js";
import { BUTTON_KEY_MAP, NDS_BUTTONS } from "../src/types.js";

type RunCall = {
	readonly cmd: string;
	readonly args: readonly string[];
	readonly input?: string;
};

const jsonHeaders = { "content-type": "application/json" };
const textBytes = (value: string): Uint8Array => new TextEncoder().encode(value);

class MockRunner implements CommandRunner {
	public readonly calls: RunCall[] = [];
	private readonly queue: CommandResult[];

	public constructor(queue: readonly CommandResult[]) {
		this.queue = [...queue];
	}

	public async run(cmd: string, args: readonly string[], opts?: { readonly input?: string }): Promise<CommandResult> {
		const call: RunCall = opts?.input === undefined ? { cmd, args } : { cmd, args, input: opts.input };
		this.calls.push(call);
		const next = this.queue.shift();
		if (next !== undefined) {
			return next;
		}
		return { stdout: new Uint8Array(), stderr: "", code: 0 };
	}
}

const setup = (runner: CommandRunner, sleep?: (ms: number) => Promise<void>) => {
	const driver = new DesmumeDriver(runner, sleep);
	return { driver, app: buildApp(driver) };
};

describe("input-bridge HTTP server", () => {
	it("responds with health status", async () => {
		const runner = new MockRunner([]);
		const { app } = setup(runner, async () => {});

		const response = await app.request("/health");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ status: "ok" });
	});

	it("presses each DS button via /button", async () => {
		for (const button of NDS_BUTTONS) {
			const runner = new MockRunner([{ stdout: textBytes("9001\n"), stderr: "", code: 0 }]);
			const { app } = setup(runner, async () => {});

			const response = await app.request("/button", {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify({ button }),
			});

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({ ok: true });
			expect(runner.calls).toEqual([
				{ cmd: "xdotool", args: ["search", "--class", "desmume"] },
				{ cmd: "xdotool", args: ["windowfocus", "--sync", "9001"] },
				{ cmd: "xdotool", args: ["key", "--window", "9001", BUTTON_KEY_MAP[button]] },
			]);
		}
	});

	it("rejects invalid button payloads", async () => {
		const runner = new MockRunner([]);
		const { app } = setup(runner, async () => {});

		const response = await app.request("/button", {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ button: "Invalid" }),
		});

		expect(response.status).toBe(400);
	});

	it("accepts in-range touch coordinates", async () => {
		for (const point of [
			{ x: 0, y: 0 },
			{ x: 128, y: 96 },
			{ x: 255, y: 191 },
		]) {
			const runner = new MockRunner([{ stdout: textBytes("300\n"), stderr: "", code: 0 }]);
			const { app } = setup(runner, async () => {});

			const response = await app.request("/touch", {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify(point),
			});

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({ ok: true });
		}
	});

	it("rejects out-of-range touch values in request validation", async () => {
		const runner = new MockRunner([]);
		const { app } = setup(runner, async () => {});

		const invalidPayloads = [
			{ x: 256, y: 0 },
			{ x: 0, y: 192 },
			{ x: -1, y: 0 },
		];

		for (const payload of invalidPayloads) {
			const response = await app.request("/touch", {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify(payload),
			});

			expect(response.status).toBe(400);
		}
	});

	it("captures screenshots via /screenshot", async () => {
		const runner = new MockRunner([
			{ stdout: textBytes("300\n"), stderr: "", code: 0 },
			{ stdout: Uint8Array.of(137, 80, 78, 71), stderr: "", code: 0 },
		]);
		const { app } = setup(runner, async () => {});

		const response = await app.request("/screenshot");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ image: "iVBORw==", width: 512, height: 768 });
	});

	it("uses hold_ms as keydown + keyup flow", async () => {
		const runner = new MockRunner([{ stdout: textBytes("300\n"), stderr: "", code: 0 }]);
		const sleeps: number[] = [];
		const { app } = setup(runner, async (ms: number) => {
			sleeps.push(ms);
		});

		const response = await app.request("/button", {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ button: "A", hold_ms: 500 }),
		});

		expect(response.status).toBe(200);
		expect(sleeps).toEqual([500]);
		expect(runner.calls).toEqual([
			{ cmd: "xdotool", args: ["search", "--class", "desmume"] },
			{ cmd: "xdotool", args: ["windowfocus", "--sync", "300"] },
			{ cmd: "xdotool", args: ["keydown", "--window", "300", "x"] },
			{ cmd: "xdotool", args: ["keyup", "--window", "300", "x"] },
		]);
	});

	it("returns 503 when no DeSmuME window is found", async () => {
		const runner = new MockRunner([
			{ stdout: textBytes(""), stderr: "", code: 1 },
			{ stdout: textBytes(""), stderr: "", code: 1 },
			{ stdout: textBytes(""), stderr: "", code: 1 },
		]);
		const { app } = setup(runner, async () => {});

		const response = await app.request("/button", {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ button: "A" }),
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({ ok: false, error: "desmume window not found" });
	});
});
