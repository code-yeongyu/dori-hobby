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
type BridgeApp = ReturnType<typeof buildApp>;

const postJsonRequest = async (app: BridgeApp, path: string, body: unknown): Promise<Response> => {
	return await app.request(path, {
		method: "POST",
		headers: jsonHeaders,
		body: JSON.stringify(body),
	});
};

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

// Default geometry mock for xwininfo — canvas at absolute (10, 10) 256x490.
// Canvas center = (138, 255), bottom half-height = 245.
const geometryResult = {
	stdout: new TextEncoder().encode(
		[
			'xwininfo: Window id: 0x123 "DeSmuME - 60fps, 0 skipped, draw: 60fps"',
			"",
			"  Absolute upper-left X:  10",
			"  Absolute upper-left Y:  10",
			"  Width: 256",
			"  Height: 490",
			"  Map State: IsViewable",
			"",
		].join("\n"),
	),
	stderr: "",
	code: 0,
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
			const runner = new MockRunner([{ stdout: textBytes("9001\n"), stderr: "", code: 0 }, geometryResult]);
			const { app } = setup(runner, async () => {});

			const response = await postJsonRequest(app, "/button", { button });

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({ ok: true });
			expect(runner.calls).toEqual([
				{ cmd: "xdotool", args: ["search", "--onlyvisible", "--name", "fps"] },
				{
					cmd: "xwininfo",
					args: ["-id", "9001"],
				},
				{ cmd: "xdotool", args: ["mousemove", "138", "287"] },
				{ cmd: "xdotool", args: ["windowactivate", "--sync", "9001"] },
				{ cmd: "xdotool", args: ["key", BUTTON_KEY_MAP[button]] },
			]);
		}
	});

	it("rejects invalid button payloads", async () => {
		const runner = new MockRunner([]);
		const { app } = setup(runner, async () => {});

		const response = await postJsonRequest(app, "/button", { button: "Invalid" });

		expect(response.status).toBe(400);
	});

	it("accepts in-range touch coordinates", async () => {
		for (const point of [
			{ x: 0, y: 0 },
			{ x: 128, y: 96 },
			{ x: 255, y: 191 },
		]) {
			const runner = new MockRunner([{ stdout: textBytes("300\n"), stderr: "", code: 0 }, geometryResult]);
			const { app } = setup(runner, async () => {});

			const response = await postJsonRequest(app, "/touch", point);

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
			const response = await postJsonRequest(app, "/touch", payload);

			expect(response.status).toBe(400);
		}
	});

	it("captures the cropped game canvas via /screenshot", async () => {
		const runner = new MockRunner([
			{ stdout: textBytes("300\n"), stderr: "", code: 0 },
			geometryResult,
			{ stdout: Uint8Array.of(137, 80, 78, 71), stderr: "", code: 0 },
		]);
		const { app } = setup(runner, async () => {});

		const response = await app.request("/screenshot");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			image: "iVBORw==",
			width: 256,
			height: 384,
		});
	});

	it("uses hold_ms as keydown + keyup flow", async () => {
		const runner = new MockRunner([{ stdout: textBytes("300\n"), stderr: "", code: 0 }, geometryResult]);
		const sleeps: number[] = [];
		const { app } = setup(runner, async (ms: number) => {
			sleeps.push(ms);
		});

		const response = await postJsonRequest(app, "/button", { button: "A", hold_ms: 500 });

		expect(response.status).toBe(200);
		// First sleep (50ms) is the focus settle after windowactivate; second is the hold.
		expect(sleeps).toEqual([50, 500]);
		expect(runner.calls).toEqual([
			{ cmd: "xdotool", args: ["search", "--onlyvisible", "--name", "fps"] },
			{ cmd: "xwininfo", args: ["-id", "300"] },
			{ cmd: "xdotool", args: ["mousemove", "138", "287"] },
			{ cmd: "xdotool", args: ["windowactivate", "--sync", "300"] },
			{ cmd: "xdotool", args: ["keydown", "x"] },
			{ cmd: "xdotool", args: ["keyup", "x"] },
		]);
	});

	it("repeats button presses via /button", async () => {
		const runner = new MockRunner([{ stdout: textBytes("300\n"), stderr: "", code: 0 }, geometryResult]);
		const { app } = setup(runner, async () => {});

		const response = await postJsonRequest(app, "/button", {
			button: "A",
			repeat_count: 3,
			repeat_interval_ms: 50,
		});

		expect(response.status).toBe(200);
		expect(runner.calls.filter((call) => call.args[0] === "key")).toHaveLength(3);
	});

	it("rejects hold plus repeat via /button", async () => {
		const runner = new MockRunner([]);
		const { app } = setup(runner, async () => {});

		const response = await postJsonRequest(app, "/button", { button: "A", hold_ms: 100, repeat_count: 3 });

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			ok: false,
			error: "hold_ms and repeat_count are mutually exclusive",
		});
	});

	it("handles valid and invalid /touch-drag payloads", async () => {
		const runner = new MockRunner([{ stdout: textBytes("300\n"), stderr: "", code: 0 }, geometryResult]);
		const { app } = setup(runner, async () => {});

		const valid = await postJsonRequest(app, "/touch-drag", {
			from: { x: 10, y: 10 },
			to: { x: 200, y: 150 },
			duration_ms: 200,
		});
		expect(valid.status).toBe(200);

		for (const payload of [
			{ from: { x: 10, y: 10 }, to: { x: 200, y: 150 }, duration_ms: 49 },
			{ from: { x: 256, y: 10 }, to: { x: 200, y: 150 }, duration_ms: 200 },
		]) {
			const response = await postJsonRequest(app, "/touch-drag", payload);
			expect(response.status).toBe(400);
		}
	});

	it("runs mixed /sequence steps and rejects over-cap batches", async () => {
		const runner = new MockRunner([{ stdout: textBytes("300\n"), stderr: "", code: 0 }, geometryResult]);
		const sleeps: number[] = [];
		const { app } = setup(runner, async (ms: number) => {
			sleeps.push(ms);
		});

		const response = await postJsonRequest(app, "/sequence", {
			steps: [
				{ kind: "button", button: "A" },
				{ kind: "wait", ms: 100 },
				{ kind: "touch", x: 50, y: 50 },
			],
		});

		expect(response.status).toBe(200);
		expect(sleeps).toEqual([50, 100, 80, 160]);

		const tooMany = Array.from({ length: 50 }, () => ({ kind: "button", button: "A" }));
		const rejected = await postJsonRequest(app, "/sequence", { steps: tooMany });
		expect(rejected.status).toBe(400);
	});

	it("saves state via /save-state -> Shift+F<slot>", async () => {
		const runner = new MockRunner([{ stdout: textBytes("400\n"), stderr: "", code: 0 }, geometryResult]);
		const { app } = setup(runner, async () => {});

		const response = await postJsonRequest(app, "/save-state", { slot: 1 });

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true, slot: 1 });
		// The save hotkey is xdotool key "shift+F1" — same syntax DeSmuME
		// listens for via its GTK accelerator group.
		expect(runner.calls.at(-1)).toEqual({
			cmd: "xdotool",
			args: ["key", "shift+F1"],
		});
	});

	it("loads state via /load-state -> F<slot>", async () => {
		const runner = new MockRunner([{ stdout: textBytes("400\n"), stderr: "", code: 0 }, geometryResult]);
		const { app } = setup(runner, async () => {});

		const response = await postJsonRequest(app, "/load-state", { slot: 3 });

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true, slot: 3 });
		expect(runner.calls.at(-1)).toEqual({
			cmd: "xdotool",
			args: ["key", "F3"],
		});
	});

	it("rejects out-of-range save-state slots", async () => {
		const runner = new MockRunner([]);
		const { app } = setup(runner, async () => {});

		for (const slot of [0, 11, -1]) {
			const response = await postJsonRequest(app, "/save-state", { slot });
			expect(response.status).toBe(400);
		}
	});

	it("returns 503 when no DeSmuME window is found", async () => {
		const runner = new MockRunner([
			{ stdout: textBytes(""), stderr: "", code: 1 },
			{ stdout: textBytes(""), stderr: "", code: 1 },
			{ stdout: textBytes(""), stderr: "", code: 1 },
		]);
		const { app } = setup(runner, async () => {});

		const response = await postJsonRequest(app, "/button", { button: "A" });

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({ ok: false, error: "desmume window not found" });
	});
});
