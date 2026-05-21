import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BridgeDriver } from "../src/app.js";
import { EpochMs, PlaytimeTracker, TickMilliseconds } from "../src/playtime-tracker.js";
import { buildApp } from "../src/server.js";

class StubDriver implements BridgeDriver {
	public async pressButton(): Promise<void> {
		throw new Error("unused stub method");
	}

	public async touch(): Promise<void> {
		throw new Error("unused stub method");
	}

	public async touchDrag(): Promise<void> {
		throw new Error("unused stub method");
	}

	public async aUntilDialog(): ReturnType<BridgeDriver["aUntilDialog"]> {
		throw new Error("unused stub method");
	}

	public async runSequence(): ReturnType<BridgeDriver["runSequence"]> {
		throw new Error("unused stub method");
	}

	public async saveState(): Promise<void> {
		throw new Error("unused stub method");
	}

	public async loadState(): Promise<void> {
		throw new Error("unused stub method");
	}

	public async captureScreen(): ReturnType<BridgeDriver["captureScreen"]> {
		throw new Error("unused stub method");
	}
}

const installBunFileStub = (): void => {
	vi.stubGlobal("Bun", {
		file: (path: string) => ({
			exists: async () => {
				try {
					await readFile(path, "utf8");
					return true;
				} catch (error) {
					if (error instanceof Error) {
						return false;
					}
					throw error;
				}
			},
			text: async () => await readFile(path, "utf8"),
		}),
		write: async (path: string, contents: string) => {
			await writeFile(path, contents);
			return contents.length;
		},
	});
};

const jsonHeaders = { "content-type": "application/json" };

describe("input-bridge playtime routes", () => {
	let dir: string;
	let statePath: string;
	let eventsPath: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "dori-playtime-routes-"));
		statePath = join(dir, "playtime.json");
		eventsPath = join(dir, "playtime-events.json");
		installBunFileStub();
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
		await rm(dir, { recursive: true, force: true });
	});

	it("GET /playtime returns the persisted total, formatted string, and timestamps", async () => {
		await writeFile(
			statePath,
			JSON.stringify({
				total_seconds: 3_725,
				last_tick_epoch_ms: 1_748_169_600_000,
				started_at_ms: 1_748_100_000_000,
			}),
		);
		const tracker = new PlaytimeTracker({
			clock: () => EpochMs.from(1_748_169_600_000),
			statePath,
			eventsPath,
			tickIntervalMs: TickMilliseconds.from(30_000),
		});
		const app = buildApp(new StubDriver(), tracker);

		const response = await app.request("/playtime");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			total_seconds: 3_725,
			formatted: "1h 02m 05s",
			started_at_ms: 1_748_100_000_000,
			last_tick_epoch_ms: 1_748_169_600_000,
		});
	});

	it("POST /playtime/event records an event with the current playtime snapshot", async () => {
		await writeFile(
			statePath,
			JSON.stringify({
				total_seconds: 60,
				last_tick_epoch_ms: 1_000,
				started_at_ms: 500,
			}),
		);
		const tracker = new PlaytimeTracker({
			clock: () => EpochMs.from(31_000),
			statePath,
			eventsPath,
			tickIntervalMs: TickMilliseconds.from(30_000),
		});
		const app = buildApp(new StubDriver(), tracker);

		const response = await app.request("/playtime/event", {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ event: "trio_badge" }),
		});

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toEqual({
			event: "trio_badge",
			at_iso: "1970-01-01T00:00:31.000Z",
			total_seconds: 90,
		});
		await expect(readFile(eventsPath, "utf8")).resolves.toContain("trio_badge");
	});

	it("POST /playtime/event rejects invalid event payloads", async () => {
		const tracker = new PlaytimeTracker({
			clock: () => EpochMs.from(1_000),
			statePath,
			eventsPath,
			tickIntervalMs: TickMilliseconds.from(30_000),
		});
		const app = buildApp(new StubDriver(), tracker);

		const response = await app.request("/playtime/event", {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ event: "" }),
		});

		expect(response.status).toBe(400);
	});
});
