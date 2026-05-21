import { describe, expect, it } from "vitest";

import { type PlaytimeState, type PlaytimeStorage, PlaytimeTracker } from "../src/playtime.js";

class MemoryStorage implements PlaytimeStorage {
	public state: PlaytimeState | undefined;
	public writes = 0;

	public constructor(seed?: PlaytimeState) {
		this.state = seed;
	}

	public async read(): Promise<PlaytimeState | undefined> {
		return this.state;
	}

	public async write(state: PlaytimeState): Promise<void> {
		this.state = state;
		this.writes += 1;
	}
}

describe("PlaytimeTracker", () => {
	it("Given a fresh state, when the tracker starts and 90 seconds pass, then totalSeconds increments by 90", async () => {
		const storage = new MemoryStorage();
		let now = 1_700_000_000_000;
		const tracker = new PlaytimeTracker({
			clock: () => now,
			storage,
			tickIntervalMs: 30_000,
		});

		await tracker.start();
		now += 90_000;
		const snapshot = tracker.snapshot();

		expect(snapshot.totalSeconds).toBe(90);
		await tracker.stop();
	});

	it("Given a stored state of 100 seconds, when the tracker starts and ticks 30 more, then snapshot reports 130 seconds", async () => {
		const storage = new MemoryStorage({
			totalSeconds: 100,
			lastTickEpoch: 1_700_000_000_000,
		});
		let now = 1_700_000_100_000;
		const tracker = new PlaytimeTracker({
			clock: () => now,
			storage,
			tickIntervalMs: 30_000,
		});

		await tracker.start();
		now += 30_000;
		const snapshot = tracker.snapshot();

		expect(snapshot.totalSeconds).toBe(130);
		await tracker.stop();
	});

	it("Given the tracker is running, when stop() is called, then the file is persisted one last time", async () => {
		const storage = new MemoryStorage();
		let now = 1_700_000_000_000;
		const tracker = new PlaytimeTracker({
			clock: () => now,
			storage,
			tickIntervalMs: 30_000,
		});

		await tracker.start();
		const writesBeforeStop = storage.writes;
		now += 12_000;
		await tracker.stop();

		expect(storage.writes).toBeGreaterThan(writesBeforeStop);
	});
});
