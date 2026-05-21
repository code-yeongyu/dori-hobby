import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@code-yeongyu/senpi", () => ({
	defineTool: <T>(tool: T): T => tool,
}));

import { recordEventTool } from "../extensions/tools/record-event.js";

const fetchMock = vi.fn<typeof fetch>();

const asText = (value: unknown): string => {
	if (typeof value === "string") {
		return value;
	}
	return String(value);
};

const makeResponse = (body: unknown, status = 200): Response => {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
};

describe("nds_record_event", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		fetchMock.mockReset();
	});

	it("posts the event then auto-returns a screenshot", async () => {
		fetchMock.mockImplementation(async (input, init) => {
			const url = asText(input);
			if (url.endsWith("/playtime/event")) {
				expect(init?.method).toBe("POST");
				return makeResponse({
					event: "trio_badge",
					at_iso: "2026-05-21T00:00:00.000Z",
					total_seconds: 120,
				});
			}
			if (url.endsWith("/screenshot")) {
				return makeResponse({ image: "AAA", width: 256, height: 384 });
			}
			return makeResponse({}, 404);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await Reflect.apply(recordEventTool.execute, undefined, [
			"tool-id",
			{ event: "trio_badge" },
		]);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const eventCall = fetchMock.mock.calls.find((call) =>
			asText(call[0]).endsWith("/playtime/event"),
		);
		expect(eventCall?.[1]?.body).toBe(JSON.stringify({ event: "trio_badge" }));
		expect(result.content[0]).toEqual({
			type: "text",
			text: "recorded trio_badge at 120s (2026-05-21T00:00:00.000Z)",
		});
		expect(result.content[1]).toEqual({
			type: "image",
			data: "AAA",
			mimeType: "image/png",
		});
	});

	it("rejects empty event names without posting", async () => {
		vi.stubGlobal("fetch", fetchMock);

		const result = await Reflect.apply(recordEventTool.execute, undefined, [
			"tool-id",
			{ event: "" },
		]);

		expect(result.isError).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
