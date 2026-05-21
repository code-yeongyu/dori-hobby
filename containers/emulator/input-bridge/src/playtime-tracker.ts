import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export class Seconds {
	private constructor(
		public readonly value: number,
		public readonly unit: "Seconds" = "Seconds",
	) {}

	public static from(value: number): Seconds {
		return new Seconds(Math.max(0, Math.round(value)));
	}
}

export class EpochMs {
	private constructor(
		public readonly value: number,
		public readonly unit: "EpochMs" = "EpochMs",
	) {}

	public static from(value: number): EpochMs {
		return new EpochMs(Math.max(0, Math.round(value)));
	}

	public static now(): EpochMs {
		return EpochMs.from(Date.now());
	}
}

export class TickMilliseconds {
	private constructor(
		public readonly value: number,
		public readonly unit: "TickMilliseconds" = "TickMilliseconds",
	) {}

	public static from(value: number): TickMilliseconds {
		if (!Number.isFinite(value) || value <= 0) {
			throw new RangeError("tick interval must be a positive finite number");
		}
		return new TickMilliseconds(Math.round(value));
	}
}

export class PlaytimeFileError extends Error {
	public override readonly name = "PlaytimeFileError";

	public constructor(
		public readonly path: string,
		message: string,
		cause?: Error,
	) {
		if (cause === undefined) {
			super(`${message}: ${path}`);
			return;
		}
		super(`${message}: ${path}`, { cause });
	}
}

export const PlaytimeStateSchema = Type.Object({
	total_seconds: Type.Integer({ minimum: 0 }),
	last_tick_epoch_ms: Type.Integer({ minimum: 0 }),
	started_at_ms: Type.Integer({ minimum: 0 }),
});

export const PlaytimeEventSchema = Type.Object({
	event: Type.String({ minLength: 1, maxLength: 64 }),
	at_iso: Type.String({ minLength: 1 }),
	total_seconds: Type.Integer({ minimum: 0 }),
});

const PlaytimeEventsSchema = Type.Array(PlaytimeEventSchema);

export type PlaytimeState = Static<typeof PlaytimeStateSchema>;
export type PlaytimeEvent = Static<typeof PlaytimeEventSchema>;

export type PlaytimeTrackerOptions = {
	readonly clock: () => EpochMs;
	readonly statePath: string;
	readonly eventsPath: string;
	readonly tickIntervalMs: TickMilliseconds;
};

export type PlaytimeLiveSnapshot = {
	readonly totalSeconds: number;
	readonly totalHuman: string;
	readonly startedAtIso: string;
};

export type PlaytimeTickLoopOptions = {
	readonly signal: AbortSignal;
	readonly tickIntervalMs: TickMilliseconds;
	readonly tick: () => Promise<void>;
};

const initialState = (now: EpochMs): PlaytimeState => ({
	total_seconds: 0,
	last_tick_epoch_ms: now.value,
	started_at_ms: now.value,
});

const parseJsonFile = async (path: string): Promise<unknown | undefined> => {
	const file = Bun.file(path);
	if (!(await file.exists())) {
		return undefined;
	}
	try {
		return JSON.parse(await file.text());
	} catch (error) {
		if (error instanceof Error) {
			throw new PlaytimeFileError(path, "invalid playtime.json", error);
		}
		throw error;
	}
};

const writeJsonAtomic = async (path: string, payload: unknown): Promise<void> => {
	await fs.mkdir(dirname(path), { recursive: true });
	const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	await Bun.write(tmpPath, `${JSON.stringify(payload, null, 2)}\n`);
	await fs.rename(tmpPath, path);
};

export const readPlaytimeState = async (path: string): Promise<PlaytimeState | undefined> => {
	const parsed = await parseJsonFile(path);
	if (parsed === undefined) {
		return undefined;
	}
	try {
		return Value.Parse(PlaytimeStateSchema, parsed);
	} catch (error) {
		if (error instanceof Error) {
			throw new PlaytimeFileError(path, "invalid playtime.json", error);
		}
		throw error;
	}
};

export const writePlaytimeState = async (path: string, state: PlaytimeState): Promise<void> => {
	try {
		Value.Parse(PlaytimeStateSchema, state);
	} catch (error) {
		if (error instanceof Error) {
			throw new PlaytimeFileError(path, "invalid playtime.json", error);
		}
		throw error;
	}
	await writeJsonAtomic(path, state);
};

export const readPlaytimeEvents = async (path: string): Promise<readonly PlaytimeEvent[]> => {
	const parsed = await parseJsonFile(path);
	if (parsed === undefined) {
		return [];
	}
	try {
		return Value.Parse(PlaytimeEventsSchema, parsed);
	} catch (error) {
		if (error instanceof Error) {
			throw new PlaytimeFileError(path, "invalid playtime event log", error);
		}
		throw error;
	}
};

export const appendPlaytimeEvent = async (path: string, event: PlaytimeEvent): Promise<PlaytimeEvent> => {
	let parsedEvent: PlaytimeEvent;
	try {
		parsedEvent = Value.Parse(PlaytimeEventSchema, event);
	} catch (error) {
		if (error instanceof Error) {
			throw new PlaytimeFileError(path, "invalid playtime event", error);
		}
		throw error;
	}
	const events = await readPlaytimeEvents(path);
	await writeJsonAtomic(path, [...events, parsedEvent]);
	return parsedEvent;
};

export const formatPlaytimeDetailed = (seconds: Seconds): string => {
	const hours = Math.floor(seconds.value / 3600);
	const minutes = Math.floor((seconds.value % 3600) / 60);
	const remainingSeconds = seconds.value % 60;
	return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(remainingSeconds).padStart(2, "0")}s`;
};

const advancePlaytime = (state: PlaytimeState, now: EpochMs, tickIntervalMs: TickMilliseconds): PlaytimeState => {
	const elapsedMs = now.value - state.last_tick_epoch_ms;
	const gapLimitMs = tickIntervalMs.value * 2;
	const shouldAdvance = state.last_tick_epoch_ms > 0 && elapsedMs >= 0 && elapsedMs <= gapLimitMs;
	const increment = shouldAdvance ? Seconds.from(elapsedMs / 1000).value : 0;
	return {
		total_seconds: state.total_seconds + increment,
		last_tick_epoch_ms: now.value,
		started_at_ms: state.started_at_ms,
	};
};

export class PlaytimeTracker {
	public constructor(private readonly options: PlaytimeTrackerOptions) {}

	public static advance(state: PlaytimeState, now: EpochMs, tickIntervalMs: TickMilliseconds): PlaytimeState {
		return advancePlaytime(state, now, tickIntervalMs);
	}

	public async snapshot(): Promise<PlaytimeState> {
		const saved = await readPlaytimeState(this.options.statePath);
		if (saved !== undefined) {
			return saved;
		}
		const state = initialState(this.options.clock());
		await writePlaytimeState(this.options.statePath, state);
		return state;
	}

	public async startSession(): Promise<PlaytimeState> {
		const now = this.options.clock();
		const saved = await readPlaytimeState(this.options.statePath);
		const next: PlaytimeState = {
			total_seconds: saved?.total_seconds ?? 0,
			last_tick_epoch_ms: now.value,
			started_at_ms: saved?.started_at_ms ?? now.value,
		};
		await writePlaytimeState(this.options.statePath, next);
		return next;
	}

	public async snapshotLive(): Promise<PlaytimeLiveSnapshot> {
		const state = await this.snapshot();
		const now = this.options.clock();
		const elapsedSeconds = Seconds.from(Math.max(0, Math.floor((now.value - state.last_tick_epoch_ms) / 1000))).value;
		const totalSeconds = state.total_seconds + elapsedSeconds;
		return {
			totalSeconds,
			totalHuman: formatPlaytimeDetailed(Seconds.from(totalSeconds)),
			startedAtIso: new Date(now.value - totalSeconds * 1000).toISOString(),
		};
	}

	public async tick(): Promise<PlaytimeState> {
		return await this.tickAt(this.options.clock());
	}

	public async recordEvent(event: string): Promise<PlaytimeEvent> {
		const now = this.options.clock();
		const state = await this.tickAt(now);
		return await appendPlaytimeEvent(this.options.eventsPath, {
			event,
			at_iso: new Date(now.value).toISOString(),
			total_seconds: state.total_seconds,
		});
	}

	private async tickAt(now: EpochMs): Promise<PlaytimeState> {
		const saved = await readPlaytimeState(this.options.statePath);
		const current = saved ?? initialState(now);
		const next = saved === undefined ? current : advancePlaytime(current, now, this.options.tickIntervalMs);
		await writePlaytimeState(this.options.statePath, next);
		return next;
	}
}

export const startPlaytimeTickLoop = ({ signal, tick, tickIntervalMs }: PlaytimeTickLoopOptions): void => {
	const runTick = (): void => {
		void tick().catch((error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[playtime] tick failed: ${message}`);
		});
	};
	const interval = setInterval(runTick, tickIntervalMs.value);
	const stop = (): void => {
		clearInterval(interval);
	};
	if (signal.aborted) {
		stop();
		return;
	}
	signal.addEventListener("abort", stop, { once: true });
};
