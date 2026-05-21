import { describe, expect, it } from "vitest";

import { type CommandResult, type CommandRunner, DesmumeDriver } from "../src/desmume-driver.js";
import type { SequenceStep } from "../src/types.js";

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

const captureResult = (value: string): CommandResult => ({ stdout: textBytes(value), stderr: "", code: 0 });
const upStep = (): SequenceStep => ({ kind: "button", button: "Up" });
const upSteps = (count: number): readonly SequenceStep[] => Array.from({ length: count }, upStep);
const keyUpCalls = (calls: readonly RunCall[]): readonly RunCall[] => {
	return calls.filter((call) => call.cmd === "xdotool" && call.args.join(" ") === "key Up");
};

describe("DesmumeDriver sequence collision abort", () => {
	it("aborts a movement sequence after five identical post-step screenshots", async () => {
		const runner = new MockRunner(Array.from({ length: 6 }, () => captureResult("wall")));
		const driver = new DesmumeDriver(runner, async () => {});

		const result = await driver.runSequence(upSteps(10), { stuck_threshold: 5 });

		expect(result).toEqual({
			aborted: true,
			stepsExecuted: 5,
			stepsRemaining: 5,
			abortReason: "collision_stuck",
			stuckStreak: 5,
		});
		expect(keyUpCalls(runner.calls)).toHaveLength(5);
	});

	it("executes every movement step when screenshots keep changing", async () => {
		const runner = new MockRunner(Array.from({ length: 10 }, (_value, index) => captureResult(`open-${index}`)));
		const driver = new DesmumeDriver(runner, async () => {});

		const result = await driver.runSequence(upSteps(10), { stuck_threshold: 5 });

		expect(result).toEqual({ aborted: false, stepsExecuted: 10, stepsRemaining: 0, stuckStreak: 1 });
		expect(keyUpCalls(runner.calls)).toHaveLength(10);
	});

	it("does not abort stuck movement when abort_on_stuck is false", async () => {
		const runner = new MockRunner(Array.from({ length: 10 }, () => captureResult("wall")));
		const driver = new DesmumeDriver(runner, async () => {});

		const result = await driver.runSequence(upSteps(10), { abort_on_stuck: false, stuck_threshold: 5 });

		expect(result).toEqual({ aborted: false, stepsExecuted: 10, stepsRemaining: 0, stuckStreak: 10 });
		expect(keyUpCalls(runner.calls)).toHaveLength(10);
	});
});
