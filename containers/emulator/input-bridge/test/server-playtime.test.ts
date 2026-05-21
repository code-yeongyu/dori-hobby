import { describe, expect, it } from "vitest";

import type { BridgeDriver } from "../src/app.js";
import type { PlaytimeSnapshotProvider } from "../src/playtime.js";
import { buildApp } from "../src/server.js";

class StubPlaytime implements PlaytimeSnapshotProvider {
	public snapshot() {
		return {
			totalSeconds: 3725,
			startedAt: new Date("2026-05-21T00:00:00.000Z"),
		};
	}
}

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

describe("input-bridge /playtime", () => {
	it("Given the tracker reports 3725 seconds, when GET /playtime is called, then the response includes padded total_human and start time", async () => {
		const driver = new StubDriver();
		const app = buildApp(driver, new StubPlaytime());

		const response = await app.request("/playtime");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			ok: true,
			total_seconds: 3725,
			total_human: "1h 02m 05s",
			started_at: "2026-05-21T00:00:00.000Z",
			ticking: true,
		});
	});
});
