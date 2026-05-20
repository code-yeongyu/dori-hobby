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

// Standard mock for xwininfo output. The driver parses
// `Absolute upper-left X/Y` and `Width/Height` and ignores the rest.
// NOTE: the driver TRIMS 85px from the top and 21px from the bottom of
// the returned height to skip the GTK menu/toolbar/status bar, so a
// 256x490 toplevel becomes a 256x384 reported canvas (192+192 DS screens).
const geometryOutput = (x: number, y: number, w: number, h: number): string => {
	return [
		`xwininfo: Window id: 0x123 "DeSmuME - 60fps, 0 skipped, draw: 60fps"`,
		``,
		`  Absolute upper-left X:  ${x}`,
		`  Absolute upper-left Y:  ${y}`,
		`  Relative upper-left X:  0`,
		`  Relative upper-left Y:  0`,
		`  Width: ${w}`,
		`  Height: ${h}`,
		`  Depth: 24`,
		`  Map State: IsViewable`,
		``,
	].join("\n");
};

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

	// xwininfo input (10, 10, 256, 490) → after driver chrome trim:
	//   canvas at (10, 10+85=95), 256x(490-85-21=384)
	// Canvas center: (10 + 128, 95 + 192) = (138, 287)
	// Bottom half (within trimmed canvas) starts at canvas_y + 192 = 287.
	it("presses a button with tap semantics (XTEST + sloppy focus)", async () => {
		const runner = new MockRunner([
			{ stdout: textBytes("100\n"), stderr: "", code: 0 },
			{
				stdout: textBytes(geometryOutput(10, 10, 256, 490)),
				stderr: "",
				code: 0,
			},
		]);
		const sleeps: number[] = [];
		const driver = new DesmumeDriver(runner, async (ms: number) => {
			sleeps.push(ms);
		});

		await driver.pressButton("A");

		expect(runner.calls).toEqual([
			{ cmd: "xdotool", args: [...SEARCH_ARGS], input: undefined },
			{
				cmd: "xwininfo",
				args: ["-id", "100"],
				input: undefined,
			},
			{ cmd: "xdotool", args: ["mousemove", "138", "287"], input: undefined },
			{ cmd: "xdotool", args: ["windowactivate", "--sync", "100"], input: undefined },
			{ cmd: "xdotool", args: ["key", "x"], input: undefined },
		]);
		expect(sleeps).toEqual([50]);
	});

	it("presses a button with hold semantics", async () => {
		const runner = new MockRunner([
			{ stdout: textBytes("100\n"), stderr: "", code: 0 },
			{
				stdout: textBytes(geometryOutput(10, 10, 256, 490)),
				stderr: "",
				code: 0,
			},
		]);
		const sleeps: number[] = [];
		const driver = new DesmumeDriver(runner, async (ms: number) => {
			sleeps.push(ms);
		});

		await driver.pressButton("B", 500);

		expect(sleeps).toEqual([50, 500]);
		expect(runner.calls).toEqual([
			{ cmd: "xdotool", args: [...SEARCH_ARGS], input: undefined },
			{
				cmd: "xwininfo",
				args: ["-id", "100"],
				input: undefined,
			},
			{ cmd: "xdotool", args: ["mousemove", "138", "287"], input: undefined },
			{ cmd: "xdotool", args: ["windowactivate", "--sync", "100"], input: undefined },
			{ cmd: "xdotool", args: ["keydown", "z"], input: undefined },
			{ cmd: "xdotool", args: ["keyup", "z"], input: undefined },
		]);
	});

	it("maps touch coordinates into root coordinates via XTEST", async () => {
		const runner = new MockRunner([
			{ stdout: textBytes("777\n"), stderr: "", code: 0 },
			{
				stdout: textBytes(geometryOutput(10, 10, 256, 490)),
				stderr: "",
				code: 0,
			},
		]);
		const sleeps: number[] = [];
		const driver = new DesmumeDriver(runner, async (ms: number) => {
			sleeps.push(ms);
		});

		await driver.touch(255, 191);

		// Trimmed canvas at (10, 95), 256x384. Half-height = 192.
		// Touch (255, 191): rootX = 10+255 = 265, rootY = 95+192+191 = 478.
		// Mouse hover center: (10+128, 95+192) = (138, 287).
		// Touch uses mousedown + 80ms hold + mouseup so the DS registers a
		// real tap instead of an instantaneous click.
		expect(runner.calls).toEqual([
			{ cmd: "xdotool", args: [...SEARCH_ARGS], input: undefined },
			{ cmd: "xwininfo", args: ["-id", "777"], input: undefined },
			{ cmd: "xdotool", args: ["mousemove", "138", "287"], input: undefined },
			{
				cmd: "xdotool",
				args: ["windowactivate", "--sync", "777"],
				input: undefined,
			},
			{ cmd: "xdotool", args: ["mousemove", "265", "478"], input: undefined },
			{ cmd: "xdotool", args: ["mousedown", "1"], input: undefined },
			{ cmd: "xdotool", args: ["mouseup", "1"], input: undefined },
		]);
		expect(sleeps).toEqual([50, 80]);
	});

	it("rejects touch coordinates outside DS bounds", async () => {
		const runner = new MockRunner([{ stdout: textBytes("777\n"), stderr: "", code: 0 }]);
		const driver = new DesmumeDriver(runner, async () => {});

		await expect(driver.touch(-1, 0)).rejects.toThrow("x out of range");
		await expect(driver.touch(256, 0)).rejects.toThrow("x out of range");
		await expect(driver.touch(0, 192)).rejects.toThrow("y out of range");
	});

	it("captures the cropped game canvas as base64 PNG", async () => {
		const runner = new MockRunner([
			{ stdout: textBytes("555\n"), stderr: "", code: 0 },
			{
				stdout: textBytes(geometryOutput(10, 10, 256, 490)),
				stderr: "",
				code: 0,
			},
			{ stdout: Uint8Array.of(137, 80, 78, 71), stderr: "", code: 0 },
		]);
		const driver = new DesmumeDriver(runner, async () => {});

		// Trimmed canvas: x=10, y=10+85=95, w=256, h=490-85-21=384.
		await expect(driver.captureScreen()).resolves.toEqual({
			base64: "iVBORw==",
			width: 256,
			height: 384,
		});
		expect(runner.calls).toEqual([
			{ cmd: "xdotool", args: [...SEARCH_ARGS], input: undefined },
			{
				cmd: "xwininfo",
				args: ["-id", "555"],
				input: undefined,
			},
			{
				cmd: "sh",
				args: ["-c", "import -window root miff:- | convert miff:- -crop 256x384+10+95 +repage png:-"],
				input: undefined,
			},
		]);
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
