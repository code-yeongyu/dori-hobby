import { describe, expect, it } from "vitest";

import type { BridgeDriver } from "../src/app.js";
import { buildApp } from "../src/server.js";

class StubDriver implements BridgeDriver {
	public async pressButton(): Promise<void> {
		throw new Error("unused");
	}
	public async touch(): Promise<void> {
		throw new Error("unused");
	}
	public async touchDrag(): Promise<void> {
		throw new Error("unused");
	}
	public async aUntilDialog(): ReturnType<BridgeDriver["aUntilDialog"]> {
		throw new Error("unused");
	}
	public async runSequence(): ReturnType<BridgeDriver["runSequence"]> {
		throw new Error("unused");
	}
	public async saveState(): Promise<void> {
		throw new Error("unused");
	}
	public async loadState(): Promise<void> {
		throw new Error("unused");
	}
	public async captureScreen(): ReturnType<BridgeDriver["captureScreen"]> {
		throw new Error("unused");
	}
}

const playtimeStub = {
	async snapshot() {
		return { total_seconds: 3725, last_tick_epoch_ms: 1000, started_at_ms: 2000 };
	},
	async snapshotLive() {
		return {
			totalSeconds: 3725,
			totalHuman: "1h 2m 5s",
			startedAtIso: "2026-05-21T00:00:00.000Z",
		};
	},
	async recordEvent(event: string) {
		return { event, at_iso: "2026-05-21T00:00:00.000Z", total_seconds: 3725 };
	},
};

describe("input-bridge /playtime", () => {
	it('Given the tracker reports 3725 seconds, when GET /playtime is called, then the response is 200 with total_human "1h 2m 5s"', async () => {
		const app = buildApp(new StubDriver(), playtimeStub);

		const response = await app.request("/playtime");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			ok: true,
			total_seconds: 3725,
			total_human: "1h 2m 5s",
			ticking: true,
		});
	});
});
