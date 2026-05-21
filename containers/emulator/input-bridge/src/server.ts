import { buildApp } from "./app.js";
import { type CommandResult, type CommandRunner, DesmumeDriver } from "./desmume-driver.js";
import { createPlaytimeFileStorage, PlaytimeTracker } from "./playtime.js";

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
	const playtime = new PlaytimeTracker({
		clock: () => Date.now(),
		storage: createPlaytimeFileStorage("/root/.config/desmume/playtime.json"),
		tickIntervalMs: 30_000,
	});
	await playtime.start();
	const app = buildApp(driver, playtime);
	const port = 7878;
	console.log(`[input-bridge] listening on :${port}`);

	const shutdown = (): void => {
		void playtime.stop().finally(() => process.exit(0));
	};
	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);

	Bun.serve({ port, fetch: app.fetch });
}
