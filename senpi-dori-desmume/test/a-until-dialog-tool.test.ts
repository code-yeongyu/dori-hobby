import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@code-yeongyu/senpi", () => ({
	defineTool: <T>(tool: T): T => tool,
}));

import { aUntilDialogTool } from "../extensions/tools/a-until-dialog.js";

const fetchMock = vi.fn<typeof fetch>();

function asText(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	return String(value);
}

function makeResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("nds_a_until_dialog tool", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		fetchMock.mockReset();
	});

	it("posts dialog-loop parameters then auto-screenshots", async () => {
		fetchMock.mockImplementation(async (input, init) => {
			const url = asText(input);
			if (url.endsWith("/a-until-dialog")) {
				expect(init?.method).toBe("POST");
				return makeResponse({
					ok: true,
					stop_reason: "stable",
					press_count: 6,
					duration_ms: 1200,
				});
			}
			if (url.endsWith("/screenshot")) {
				return makeResponse({ image: "AAA", width: 256, height: 384 });
			}
			return makeResponse({}, 404);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await Reflect.apply(aUntilDialogTool.execute, undefined, [
			"tool-id",
			{ max_presses: 30, press_interval_ms: 200, stable_threshold: 3 },
		]);

		const dialogCall = fetchMock.mock.calls.find((call) =>
			asText(call[0]).endsWith("/a-until-dialog"),
		);
		expect(dialogCall?.[1]?.body).toBe(
			JSON.stringify({
				max_presses: 30,
				press_interval_ms: 200,
				stable_threshold: 3,
			}),
		);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(result.content).toHaveLength(2);
		expect(result.details).toEqual({
			stop_reason: "stable",
			press_count: 6,
			duration_ms: 1200,
			screenshot: "post-action",
		});
	});
});
