import { buildApp } from "./app.js";
import { type CommandResult, type CommandRunner, DesmumeDriver } from "./desmume-driver.js";
import { EpochMs, PlaytimeTracker, startPlaytimeTickLoop, TickMilliseconds } from "./playtime-tracker.js";

const readBytes = async (stream: ReadableStream<Uint8Array> | null): Promise<Uint8Array> => {
	if (stream === null) {
		return new Uint8Array();
	}
	const buffer = await new Response(stream).arrayBuffer();
	return new Uint8Array(buffer);
};

const readText = async (stream: ReadableStream<Uint8Array> | null): Promise<string> => {
	const bytes = await readBytes(stream);
	return new TextDecoder().decode(bytes);
};

export const createBunRunner = (): CommandRunner => {
	const runner: CommandRunner = {
		async run(cmd: string, args: readonly string[], opts?: { readonly input?: string }): Promise<CommandResult> {
			const spawn = Bun.spawn([cmd, ...args], {
				stdin: opts?.input === undefined ? "ignore" : "pipe",
				stdout: "pipe",
				stderr: "pipe",
			});

			const stdin = spawn.stdin;
			if (opts?.input !== undefined && stdin !== undefined && stdin !== null) {
				const payload = new TextEncoder().encode(opts.input);
				await stdin.write(payload);
				await stdin.end();
			}

			const stdout = await readBytes(spawn.stdout);
			const stderr = await readText(spawn.stderr);
			const code = await spawn.exited;

			return { stdout, stderr, code };
		},
	};
	return runner;
};

export { buildApp } from "./app.js";

if (import.meta.main) {
	const driver = new DesmumeDriver(createBunRunner());
	const tickIntervalMs = TickMilliseconds.from(Number(process.env.PLAYTIME_TICK_MS ?? 30_000));
	const playtime = new PlaytimeTracker({
		clock: EpochMs.now,
		statePath: "/root/.config/desmume/playtime.json",
		eventsPath: "/root/.config/desmume/playtime-events.json",
		tickIntervalMs,
	});
	const playtimeAbort = new AbortController();
	if (process.env.NODE_ENV !== "test" && process.env.PLAYTIME_DISABLE_TICK !== "1") {
		startPlaytimeTickLoop({
			signal: playtimeAbort.signal,
			tickIntervalMs,
			tick: async () => {
				await playtime.tick();
			},
		});
	}
	const app = buildApp(driver, playtime);
	const port = Number(process.env.INPUT_BRIDGE_PORT ?? 8787);
	console.log(`[input-bridge] listening on :${port}`);
	const server = Bun.serve({ port, fetch: app.fetch });

	const shutdown = (): void => {
		playtimeAbort.abort();
		void playtime
			.tick()
			.catch((error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`[playtime] final tick failed: ${message}`);
			})
			.finally(() => {
				server.stop(true);
				process.exit(0);
			});
	};
	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
}
