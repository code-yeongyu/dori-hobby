import { describe, expect, it } from "vitest";

import { type CommandResult, type CommandRunner, DesmumeDriver } from "../src/desmume-driver.js";

type RunCall = {
	readonly cmd: string;
	readonly args: readonly string[];
	readonly input?: string;
};

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

const setupCaptures = (captures: readonly string[]): readonly CommandResult[] => captures.map(captureResult);

describe("DesmumeDriver aUntilDialog", () => {
	it("stops after three identical post-press screenshots", async () => {
		const runner = new MockRunner(setupCaptures(["one", "two", "three", "same", "same", "same"]));
		const driver = new DesmumeDriver(runner, async () => {});

		const result = await driver.aUntilDialog({ max_presses: 80, press_interval_ms: 250, stable_threshold: 3 });

		expect(result.stopReason).toBe("stable");
		expect(result.pressCount).toBe(6);
		expect(runner.calls.filter((call) => call.cmd === "xdotool" && call.args.join(" ") === "key x")).toHaveLength(6);
	});

	it("runs until max_presses when screenshots keep changing", async () => {
		const captures = Array.from({ length: 80 }, (_value, index) => `unique-${index}`);
		const runner = new MockRunner(setupCaptures(captures));
		const driver = new DesmumeDriver(runner, async () => {});

		const result = await driver.aUntilDialog({ max_presses: 80, press_interval_ms: 250, stable_threshold: 3 });

		expect(result.stopReason).toBe("max_presses");
		expect(result.pressCount).toBe(80);
		expect(runner.calls.filter((call) => call.cmd === "xdotool" && call.args.join(" ") === "key x")).toHaveLength(80);
	});

	it("rejects out-of-range dialog loop parameters before focusing the window", async () => {
		const runner = new MockRunner([]);
		const driver = new DesmumeDriver(runner, async () => {});

		await expect(driver.aUntilDialog({ max_presses: 0 })).rejects.toThrow("max_presses out of range");
		await expect(driver.aUntilDialog({ press_interval_ms: 49 })).rejects.toThrow("press_interval_ms out of range");
		await expect(driver.aUntilDialog({ stable_threshold: 11 })).rejects.toThrow("stable_threshold out of range");
		expect(runner.calls).toEqual([]);
	});
});
