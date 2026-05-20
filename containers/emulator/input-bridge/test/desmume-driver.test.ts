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

const SEARCH_ARGS = ["search", "--onlyvisible", "--name", "fps"] as const;

describe("DesmumeDriver", () => {
	it("retries window lookup and caches window id", async () => {
		const runner = new MockRunner([
			{ stdout: textBytes(""), stderr: "not found", code: 1 },
			{ stdout: textBytes("4242\n"), stderr: "", code: 0 },
		]);
		const sleeps: number[] = [];
		const sleep = async (ms: number): Promise<void> => {
			sleeps.push(ms);
		};

		const driver = new DesmumeDriver(runner, sleep);
		await expect(driver.findWindow()).resolves.toBe("4242");
		await expect(driver.findWindow()).resolves.toBe("4242");

		expect(sleeps).toEqual([500]);
		expect(runner.calls).toHaveLength(2);
	});

	it("presses a button with tap semantics (XTEST + sloppy focus)", async () => {
		const runner = new MockRunner([{ stdout: textBytes("100\n"), stderr: "", code: 0 }]);
		const sleeps: number[] = [];
		const driver = new DesmumeDriver(runner, async (ms: number) => {
			sleeps.push(ms);
		});

		await driver.pressButton("A");

		expect(runner.calls).toEqual([
			{ cmd: "xdotool", args: [...SEARCH_ARGS], input: undefined },
			{ cmd: "xdotool", args: ["mousemove", "517", "500"], input: undefined },
			{ cmd: "xdotool", args: ["windowactivate", "--sync", "100"], input: undefined },
			{ cmd: "xdotool", args: ["key", "x"], input: undefined },
		]);
		expect(sleeps).toEqual([50]);
	});

	it("presses a button with hold semantics", async () => {
		const runner = new MockRunner([{ stdout: textBytes("100\n"), stderr: "", code: 0 }]);
		const sleeps: number[] = [];
		const driver = new DesmumeDriver(runner, async (ms: number) => {
			sleeps.push(ms);
		});

		await driver.pressButton("B", 500);

		expect(sleeps).toEqual([50, 500]);
		expect(runner.calls).toEqual([
			{ cmd: "xdotool", args: [...SEARCH_ARGS], input: undefined },
			{ cmd: "xdotool", args: ["mousemove", "517", "500"], input: undefined },
			{ cmd: "xdotool", args: ["windowactivate", "--sync", "100"], input: undefined },
			{ cmd: "xdotool", args: ["keydown", "z"], input: undefined },
			{ cmd: "xdotool", args: ["keyup", "z"], input: undefined },
		]);
	});

	it("maps touch coordinates into root coordinates via XTEST", async () => {
		const runner = new MockRunner([{ stdout: textBytes("777\n"), stderr: "", code: 0 }]);
		const sleeps: number[] = [];
		const driver = new DesmumeDriver(runner, async (ms: number) => {
			sleeps.push(ms);
		});

		await driver.touch(255, 191);

		// Expected mapping:
		//   rootX = 389 + 255 = 644
		//   rootY = 273 + 260 + 191 = 724
		expect(runner.calls).toEqual([
			{ cmd: "xdotool", args: [...SEARCH_ARGS], input: undefined },
			{ cmd: "xdotool", args: ["mousemove", "517", "500"], input: undefined },
			{ cmd: "xdotool", args: ["windowactivate", "--sync", "777"], input: undefined },
			{ cmd: "xdotool", args: ["mousemove", "644", "724"], input: undefined },
			{ cmd: "xdotool", args: ["click", "1"], input: undefined },
		]);
		expect(sleeps).toEqual([50]);
	});

	it("rejects touch coordinates outside DS bounds", async () => {
		const runner = new MockRunner([{ stdout: textBytes("777\n"), stderr: "", code: 0 }]);
		const driver = new DesmumeDriver(runner, async () => {});

		await expect(driver.touch(-1, 0)).rejects.toThrow("x out of range");
		await expect(driver.touch(256, 0)).rejects.toThrow("x out of range");
		await expect(driver.touch(0, 192)).rejects.toThrow("y out of range");
	});

	it("captures the root window as base64 PNG", async () => {
		const runner = new MockRunner([{ stdout: Uint8Array.of(137, 80, 78, 71), stderr: "", code: 0 }]);
		const driver = new DesmumeDriver(runner, async () => {});

		await expect(driver.captureScreen()).resolves.toEqual({
			base64: "iVBORw==",
			width: 1024,
			height: 768,
		});
		expect(runner.calls).toEqual([{ cmd: "import", args: ["-window", "root", "png:-"], input: undefined }]);
	});

	it("throws when the DeSmuME window cannot be found", async () => {
		const runner = new MockRunner([
			{ stdout: textBytes(""), stderr: "", code: 1 },
			{ stdout: textBytes(""), stderr: "", code: 1 },
			{ stdout: textBytes(""), stderr: "", code: 1 },
		]);
		const sleeps: number[] = [];
		const driver = new DesmumeDriver(runner, async (ms: number) => {
			sleeps.push(ms);
		});

		await expect(driver.findWindow()).rejects.toThrow("desmume window not found");
		expect(sleeps).toEqual([500, 500, 500]);
	});
});
