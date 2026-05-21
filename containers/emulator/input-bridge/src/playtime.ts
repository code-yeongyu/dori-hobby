import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type PlaytimeState = {
	readonly totalSeconds: number;
	readonly lastTickEpoch: number;
};

export type PlaytimeSnapshot = {
	readonly totalSeconds: number;
	readonly startedAt: Date;
};

export interface PlaytimeSnapshotProvider {
	snapshot(): PlaytimeSnapshot;
}

export interface PlaytimeStorage {
	read(): Promise<PlaytimeState | undefined>;
	write(state: PlaytimeState): Promise<void>;
}

export type PlaytimeTrackerOptions = {
	readonly clock: () => number;
	readonly storage: PlaytimeStorage;
	readonly tickIntervalMs: number;
};

const initialState = (now: number): PlaytimeState => ({
	totalSeconds: 0,
	lastTickEpoch: now,
});

const normalizeElapsed = (startEpoch: number, endEpoch: number): number => {
	if (endEpoch <= startEpoch) {
		return 0;
	}
	return Math.floor((endEpoch - startEpoch) / 1000);
};

export class PlaytimeTracker implements PlaytimeSnapshotProvider {
	private readonly clock: () => number;
	private readonly storage: PlaytimeStorage;
	private readonly tickIntervalMs: number;
	private state: PlaytimeState = initialState(0);
	private interval: ReturnType<typeof setInterval> | undefined;

	public constructor(options: PlaytimeTrackerOptions) {
		this.clock = options.clock;
		this.storage = options.storage;
		this.tickIntervalMs = options.tickIntervalMs;
	}

	public async start(): Promise<void> {
		const now = this.clock();
		const saved = await this.storage.read();
		const totalSeconds = saved?.totalSeconds ?? 0;
		this.state = { totalSeconds, lastTickEpoch: now };
		await this.storage.write(this.state);
		this.interval = setInterval(() => {
			void this.tick();
		}, this.tickIntervalMs);
	}

	public snapshot(): PlaytimeSnapshot {
		const now = this.clock();
		const totalSeconds = this.state.totalSeconds + normalizeElapsed(this.state.lastTickEpoch, now);
		const startedAt = new Date(now - totalSeconds * 1000);
		return { totalSeconds, startedAt };
	}

	public async stop(): Promise<void> {
		if (this.interval !== undefined) {
			clearInterval(this.interval);
			this.interval = undefined;
		}
		await this.tick();
	}

	private async tick(): Promise<void> {
		const now = this.clock();
		const increment = normalizeElapsed(this.state.lastTickEpoch, now);
		this.state = {
			totalSeconds: this.state.totalSeconds + increment,
			lastTickEpoch: now,
		};
		await this.storage.write(this.state);
	}
}

export const createPlaytimeFileStorage = (path: string): PlaytimeStorage => {
	return {
		async read(): Promise<PlaytimeState | undefined> {
			try {
				const raw = await readFile(path, "utf8");
				const parsed: unknown = JSON.parse(raw);
				if (typeof parsed !== "object" || parsed === null) {
					return undefined;
				}
				const totalSeconds = Reflect.get(parsed, "totalSeconds");
				const lastTickEpoch = Reflect.get(parsed, "lastTickEpoch");
				if (typeof totalSeconds !== "number" || typeof lastTickEpoch !== "number") {
					return undefined;
				}
				return { totalSeconds, lastTickEpoch };
			} catch (error) {
				if (error instanceof Error) {
					return undefined;
				}
				throw error;
			}
		},
		async write(state: PlaytimeState): Promise<void> {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, JSON.stringify(state, null, 2));
		},
	};
};

export const formatPlaytimeHuman = (totalSeconds: number): string => {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const paddedMinutes = String(minutes).padStart(2, "0");
	const paddedSeconds = String(seconds).padStart(2, "0");
	return `${hours}h ${paddedMinutes}m ${paddedSeconds}s`;
};
