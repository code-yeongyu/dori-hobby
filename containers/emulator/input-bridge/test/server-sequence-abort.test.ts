import { describe, expect, it } from "vitest";

import { type CommandResult, type CommandRunner, DesmumeDriver } from "../src/desmume-driver.js";
import { buildApp } from "../src/server.js";

type RunCall = {
	readonly cmd: string;
	readonly args: readonly string[];
	readonly input?: string;
};

const jsonHeaders = { "content-type": "application/json" };
const textBytes = (value: string): Uint8Array => new TextEncoder().encode(value);

class MockRunner implements CommandRunner {
	public readonly calls: RunCall[] = [];
	private readonly captures: CommandResult[];

	public constructor(captures: readonly CommandResult[]) {
		this.captures = [...captures];
	}

	public async run(cmd: string, args: readonly string[], opts?: { readonly input?: string }): Promise<CommandResult> {
		const call: RunCall = opts?.input === undefined ? { cmd, args } : { cmd, args, input: opts.input };
		this.calls.push(call);
		if (cmd === "xdotool" && args.join(" ") === "search --onlyvisible --name fps") {
			return { stdout: textBytes("9001\n"), stderr: "", code: 0 };
		}
		if (cmd === "xwininfo") {
			return geometryResult;
		}
		if (cmd === "sh") {
			const next = this.captures.shift();
			if (next !== undefined) {
				return next;
			}
		}
		return { stdout: new Uint8Array(), stderr: "", code: 0 };
	}
}

const geometryResult: CommandResult = {
	stdout: textBytes(
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

const captureResult = (value: string): CommandResult => ({ stdout: textBytes(value), stderr: "", code: 0 });
const postJsonRequest = async (app: ReturnType<typeof buildApp>, body: unknown): Promise<Response> => {
	return await app.request("/sequence", {
		method: "POST",
		headers: jsonHeaders,
		body: JSON.stringify(body),
	});
};

describe("input-bridge /sequence collision abort", () => {
	it("returns abort metadata when a movement batch is stuck", async () => {
		const runner = new MockRunner(Array.from({ length: 6 }, () => captureResult("wall")));
		const app = buildApp(new DesmumeDriver(runner, async () => {}));
		const steps = Array.from({ length: 10 }, () => ({ kind: "button", button: "Up" }));

		const response = await postJsonRequest(app, { steps, stuck_threshold: 5 });

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			ok: true,
			aborted: true,
			stepsExecuted: 5,
			stepsRemaining: 5,
			abortReason: "collision_stuck",
			stuckStreak: 5,
		});
	});

	it("runs every step when collision abort is disabled", async () => {
		const runner = new MockRunner(Array.from({ length: 10 }, () => captureResult("wall")));
		const app = buildApp(new DesmumeDriver(runner, async () => {}));
		const steps = Array.from({ length: 10 }, () => ({ kind: "button", button: "Up" }));

		const response = await postJsonRequest(app, { steps, abort_on_stuck: false, stuck_threshold: 5 });

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			ok: true,
			aborted: false,
			stepsExecuted: 10,
			stepsRemaining: 0,
			abortReason: null,
			stuckStreak: 10,
		});
	});

	it("rejects out-of-range stuck thresholds", async () => {
		const app = buildApp(new DesmumeDriver(new MockRunner([]), async () => {}));

		const response = await postJsonRequest(app, { steps: [{ kind: "button", button: "Up" }], stuck_threshold: 1 });

		expect(response.status).toBe(400);
	});
});
