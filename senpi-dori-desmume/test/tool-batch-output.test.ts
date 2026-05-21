import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@code-yeongyu/senpi", () => ({
	defineTool: <T>(tool: T): T => tool,
}));

import { captureScreenTool } from "../extensions/tools/capture-screen.js";
import { pressSequenceTool } from "../extensions/tools/press-sequence.js";
import { captureScreenshot } from "../extensions/tools/shared.js";

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

describe("batched tool output", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		fetchMock.mockReset();
	});

	it("captureScreenshot returns image+text with touch constraints", async () => {
		fetchMock.mockResolvedValue(
			makeResponse({ image: "x", width: 256, height: 384 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await captureScreenshot();

		expect(result.raw).toEqual({ image: "x", width: 256, height: 384 });
		expect(result.contentBlocks[0]).toEqual({
			type: "image",
			data: "x",
			mimeType: "image/png",
		});
		expect(result.contentBlocks[1]?.type).toBe("text");
		if (result.contentBlocks[1]?.type === "text") {
			expect(result.contentBlocks[1].text).toContain("256x384");
			expect(result.contentBlocks[1].text).toContain(
				"Top screen (view-only): y=0..191",
			);
			expect(result.contentBlocks[1].text).toContain(
				"Bottom screen (TOUCH-CAPABLE): y=192..383",
			);
			expect(result.contentBlocks[1].text).toContain("touch_y = image_y - 192");
			expect(result.contentBlocks[1].text).toContain(
				"Only the bottom screen accepts touch input",
			);
		}
	});

	it("nds_capture_screen returns image+text with coordinate offsets", async () => {
		fetchMock.mockResolvedValue(
			makeResponse({ image: "AAA", width: 512, height: 768 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await Reflect.apply(captureScreenTool.execute, undefined, [
			"tool-id",
			{},
		]);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(asText(fetchMock.mock.calls[0]?.[0])).toContain("/screenshot");
		expect(result.content).toHaveLength(2);
		expect(result.content[0]).toEqual({
			type: "image",
			data: "AAA",
			mimeType: "image/png",
		});
		expect(result.content[1]?.type).toBe("text");
		if (result.content[1]?.type === "text") {
			expect(result.content[1].text).toContain("512x768");
			expect(result.content[1].text).toContain(
				"Top screen (view-only): y=0..383",
			);
			expect(result.content[1].text).toContain(
				"Bottom screen (TOUCH-CAPABLE): y=384..767",
			);
			expect(result.content[1].text).toContain(
				"Only the bottom screen accepts touch input",
			);
		}
	});

	it("nds_press_sequence posts one batch then auto-screenshots", async () => {
		fetchMock.mockImplementation(async (input, init) => {
			const url = asText(input);
			if (url.endsWith("/sequence")) {
				expect(init?.method).toBe("POST");
				return makeResponse({ ok: true });
			}
			if (url.endsWith("/screenshot")) {
				return makeResponse({ image: "AAA", width: 256, height: 384 });
			}
			return makeResponse({}, 404);
		});
		vi.stubGlobal("fetch", fetchMock);

		const steps = [
			{ kind: "button", button: "Up", repeat_count: 3, repeat_interval_ms: 80 },
			{ kind: "wait", ms: 100 },
			{ kind: "button", button: "A", hold_ms: 200 },
		];
		const result = await Reflect.apply(pressSequenceTool.execute, undefined, [
			"tool-id",
			{ steps },
		]);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const sequenceCall = fetchMock.mock.calls.find((call) =>
			asText(call[0]).endsWith("/sequence"),
		);
		expect(sequenceCall?.[1]?.body).toBe(JSON.stringify({ steps }));
		expect(result.content).toHaveLength(2);
		expect(result.details).toEqual({ steps: 3, screenshot: "post-action" });
	});
});
