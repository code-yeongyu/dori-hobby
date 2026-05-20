import { BUTTON_KEY_MAP, type NdsButton, TOUCH_MAX_X, TOUCH_MAX_Y } from "./types.js";

export type CommandResult = {
	readonly stdout: Uint8Array;
	readonly stderr: string;
	readonly code: number;
};

export interface CommandRunner {
	run(cmd: string, args: readonly string[], opts?: { readonly input?: string }): Promise<CommandResult>;
}

type SleepFunction = (ms: number) => Promise<void>;

const defaultSleep: SleepFunction = async (ms: number): Promise<void> => {
	await new Promise<void>((resolve) => {
		setTimeout(() => {
			resolve();
		}, ms);
	});
};

const firstLine = (value: Uint8Array): string | undefined => {
	const text = new TextDecoder().decode(value).trim();
	const lines = text.split("\n");
	const candidate = lines[0];
	if (candidate === undefined || candidate.length === 0) {
		return undefined;
	}
	return candidate;
};

export class DesmumeDriver {
	private windowId: string | undefined;
	private readonly runner: CommandRunner;
	private readonly sleep: SleepFunction;

	public constructor(runner: CommandRunner, sleep: SleepFunction = defaultSleep) {
		this.runner = runner;
		this.sleep = sleep;
	}

	public async findWindow(): Promise<string> {
		if (this.windowId !== undefined) {
			return this.windowId;
		}

		for (let attempt = 0; attempt < 3; attempt += 1) {
			const result = await this.runner.run("xdotool", ["search", "--class", "desmume"]);
			if (result.code === 0) {
				const id = firstLine(result.stdout);
				if (id !== undefined) {
					this.windowId = id;
					return id;
				}
			}
			await this.sleep(500);
		}

		throw new Error("desmume window not found");
	}

	public async pressButton(button: NdsButton, holdMs?: number): Promise<void> {
		const windowId = await this.findWindow();
		const key = BUTTON_KEY_MAP[button];

		await this.runner.run("xdotool", ["windowfocus", "--sync", windowId]);

		if (holdMs === undefined || holdMs <= 0) {
			await this.runner.run("xdotool", ["key", "--window", windowId, key]);
			return;
		}

		await this.runner.run("xdotool", ["keydown", "--window", windowId, key]);
		await this.sleep(holdMs);
		await this.runner.run("xdotool", ["keyup", "--window", windowId, key]);
	}

	public async touch(x: number, y: number): Promise<void> {
		if (x < 0 || x > TOUCH_MAX_X) {
			throw new Error(`x out of range: ${x}`);
		}
		if (y < 0 || y > TOUCH_MAX_Y) {
			throw new Error(`y out of range: ${y}`);
		}

		const windowId = await this.findWindow();
		const windowX = x * 2;
		const windowY = 384 + y * 2;

		await this.runner.run("xdotool", [
			"mousemove",
			"--window",
			windowId,
			String(windowX),
			String(windowY),
			"click",
			"--window",
			windowId,
			"1",
		]);
	}

	public async captureScreen(): Promise<{ readonly base64: string; readonly width: number; readonly height: number }> {
		const windowId = await this.findWindow();
		const result = await this.runner.run("import", ["-window", windowId, "png:-"]);
		if (result.code !== 0) {
			throw new Error("screen capture failed");
		}

		return {
			base64: Buffer.from(result.stdout).toString("base64"),
			width: 512,
			height: 768,
		};
	}
}
