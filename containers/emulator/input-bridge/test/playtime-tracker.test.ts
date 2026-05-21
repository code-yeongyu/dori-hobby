import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	appendPlaytimeEvent,
	EpochMs,
	formatPlaytimeDetailed,
	PlaytimeTracker,
	readPlaytimeState,
	Seconds,
	startPlaytimeTickLoop,
	TickMilliseconds,
	writePlaytimeState,
} from "../src/playtime-tracker.js";

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

describe("playtime tracker", () => {
	let dir: string;
	let statePath: string;
	let eventsPath: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "dori-playtime-"));
		statePath = join(dir, "playtime.json");
		eventsPath = join(dir, "playtime-events.json");
		installBunFileStub();
	});

	afterEach(async () => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		await rm(dir, { recursive: true, force: true });
	});

	it("writes playtime atomically and ignores a stale partial tmp file", async () => {
		await writePlaytimeState(statePath, {
			total_seconds: 42,
			last_tick_epoch_ms: 1_748_169_600_000,
			started_at_ms: 1_748_100_000_000,
		});
		await writeFile(`${statePath}.partial.tmp`, "{ broken");

		const saved = await readPlaytimeState(statePath);
		const raw = await readFile(statePath, "utf8");

		expect(saved).toEqual({
			total_seconds: 42,
			last_tick_epoch_ms: 1_748_169_600_000,
			started_at_ms: 1_748_100_000_000,
		});
		expect(raw).toContain('"total_seconds": 42');
	});

	it("cold-starts a missing file without advancing downtime", async () => {
		const tracker = new PlaytimeTracker({
			clock: () => EpochMs.from(1_748_169_600_000),
			statePath,
			eventsPath,
			tickIntervalMs: TickMilliseconds.from(30_000),
		});

		const next = await tracker.tick();

		expect(next).toEqual({
			total_seconds: 0,
			last_tick_epoch_ms: 1_748_169_600_000,
			started_at_ms: 1_748_169_600_000,
		});
	});

	it("advances by the rounded warm delta when the previous tick is within the gap guard", () => {
		const next = PlaytimeTracker.advance(
			{
				total_seconds: 10,
				last_tick_epoch_ms: 1_000,
				started_at_ms: 500,
			},
			EpochMs.from(31_400),
			TickMilliseconds.from(30_000),
		);

		expect(next).toEqual({
			total_seconds: 40,
			last_tick_epoch_ms: 31_400,
			started_at_ms: 500,
		});
	});

	it("refreshes last_tick_epoch_ms without advancing after a long downtime gap", () => {
		const next = PlaytimeTracker.advance(
			{
				total_seconds: 10,
				last_tick_epoch_ms: 1_000,
				started_at_ms: 500,
			},
			EpochMs.from(91_000),
			TickMilliseconds.from(30_000),
		);

		expect(next).toEqual({
			total_seconds: 10,
			last_tick_epoch_ms: 91_000,
			started_at_ms: 500,
		});
	});

	it("rejects malformed JSON and out-of-range playtime fields", async () => {
		await writeFile(statePath, "{ not json");
		await expect(readPlaytimeState(statePath)).rejects.toThrow("invalid playtime.json");

		await writeFile(
			statePath,
			JSON.stringify({
				total_seconds: -1,
				last_tick_epoch_ms: 1,
				started_at_ms: 1,
			}),
		);
		await expect(readPlaytimeState(statePath)).rejects.toThrow("invalid playtime.json");
	});

	it("appends events in order with the current total_seconds snapshot", async () => {
		await appendPlaytimeEvent(eventsPath, {
			event: "starter_selected",
			at_iso: "2026-05-21T00:00:00.000Z",
			total_seconds: 12,
		});
		await appendPlaytimeEvent(eventsPath, {
			event: "trio_badge",
			at_iso: "2026-05-21T00:01:00.000Z",
			total_seconds: 72,
		});

		const raw = await readFile(eventsPath, "utf8");
		expect(JSON.parse(raw)).toEqual([
			{
				event: "starter_selected",
				at_iso: "2026-05-21T00:00:00.000Z",
				total_seconds: 12,
			},
			{
				event: "trio_badge",
				at_iso: "2026-05-21T00:01:00.000Z",
				total_seconds: 72,
			},
		]);
	});

	it("rejects event names outside the 1..64 character range", async () => {
		await expect(
			appendPlaytimeEvent(eventsPath, {
				event: "",
				at_iso: "2026-05-21T00:00:00.000Z",
				total_seconds: 0,
			}),
		).rejects.toThrow("invalid playtime event");
	});

	it("runs the tick loop on fake timers and stops cleanly when aborted", async () => {
		vi.useFakeTimers();
		const ticks: number[] = [];
		const abortController = new AbortController();

		startPlaytimeTickLoop({
			signal: abortController.signal,
			tickIntervalMs: TickMilliseconds.from(30_000),
			tick: async () => {
				ticks.push(Date.now());
			},
		});

		expect(ticks).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(90_000);
		expect(ticks).toHaveLength(3);
		abortController.abort();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(ticks).toHaveLength(3);
	});

	it("formats detailed playtime with padded minutes and seconds", () => {
		expect(formatPlaytimeDetailed(Seconds.from(3_725))).toBe("1h 02m 05s");
	});
});
