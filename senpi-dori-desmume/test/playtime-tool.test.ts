import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@code-yeongyu/senpi", () => ({
	defineTool: <T>(tool: T): T => tool,
}));

const { broadcastAction } = vi.hoisted(() => ({
	broadcastAction: vi.fn(),
}));
vi.mock("../extensions/intervention/ws-server.js", () => ({
	broadcastAction,
}));

import { ndsPlaytimeTool } from "../extensions/tools/playtime.js";

const fetchMock = vi.fn<typeof fetch>();

const makeResponse = (body: unknown, status = 200): Response => {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
};

describe("nds_playtime", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		fetchMock.mockReset();
		broadcastAction.mockReset();
	});

	it('Given the bridge returns { ok: true, total_seconds: 60, ... }, when nds_playtime is called, then the tool result text contains "1m 0s" and broadcastAction is invoked with kind "screenshot" detail "playtime: 1m 0s"', async () => {
		fetchMock.mockResolvedValue(
			makeResponse({ ok: true, total_seconds: 60, total_human: "1m 0s" }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await Reflect.apply(ndsPlaytimeTool.execute, undefined, [
			"tool-id",
			{},
		]);

		expect(result.content[0]).toEqual({
			type: "text",
			text: "Total play time: 1m 0s (60 seconds).",
		});
		expect(broadcastAction).toHaveBeenCalledWith(
			"screenshot",
			"playtime: 1m 0s",
		);
	});
});
