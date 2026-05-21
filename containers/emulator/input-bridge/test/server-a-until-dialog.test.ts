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

const captureResult = (value: string): CommandResult => ({
	stdout: textBytes(value),
	stderr: "",
	code: 0,
});

const postJsonRequest = async (app: ReturnType<typeof buildApp>, path: string, body: unknown): Promise<Response> => {
	return await app.request(path, {
		method: "POST",
		headers: jsonHeaders,
		body: JSON.stringify(body),
	});
};

describe("input-bridge /a-until-dialog", () => {
	it("returns stable stop metadata for a valid request", async () => {
		const runner = new MockRunner([captureResult("same"), captureResult("same"), captureResult("same")]);
		const app = buildApp(new DesmumeDriver(runner, async () => {}));

		const response = await postJsonRequest(app, "/a-until-dialog", {
			max_presses: 30,
			press_interval_ms: 200,
			stable_threshold: 3,
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			ok: true,
			stop_reason: "stable",
			press_count: 3,
		});
	});

	it("rejects invalid request payloads", async () => {
		const app = buildApp(new DesmumeDriver(new MockRunner([]), async () => {}));

		const response = await postJsonRequest(app, "/a-until-dialog", { max_presses: 201 });

		expect(response.status).toBe(400);
	});
});
