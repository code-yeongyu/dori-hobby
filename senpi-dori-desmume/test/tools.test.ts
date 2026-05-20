import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@code-yeongyu/senpi", () => ({
	defineTool: <T>(tool: T): T => tool,
}));

import { captureScreenTool } from "../extensions/tools/capture-screen.js";
import { pressButtonTool } from "../extensions/tools/press-button.js";
import { touchTool } from "../extensions/tools/touch.js";

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

describe("nds tools", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		fetchMock.mockReset();
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
			expect(result.content[1].text).toContain("Top screen at y=0..383");
			expect(result.content[1].text).toContain(
				"bottom (touch) screen at y=384..767",
			);
		}
	});

	const buttons = [
		"A",
		"B",
		"X",
		"Y",
		"L",
		"R",
		"Start",
		"Select",
		"Up",
		"Down",
		"Left",
		"Right",
	] as const;

	it("nds_press_button posts all 12 buttons then auto-screenshots", async () => {
		fetchMock.mockImplementation(async (input, init) => {
			const url = asText(input);
			if (url.endsWith("/button")) {
				expect(init?.method).toBe("POST");
				return makeResponse({ ok: true });
			}
			if (url.endsWith("/screenshot")) {
				return makeResponse({ image: "AAA", width: 512, height: 768 });
			}
			return makeResponse({}, 404);
		});
		vi.stubGlobal("fetch", fetchMock);

		for (const button of buttons) {
			await Reflect.apply(pressButtonTool.execute, undefined, [
				"tool-id",
				{ button },
			]);
		}

		expect(fetchMock).toHaveBeenCalledTimes(buttons.length * 2);
		const calledBodies = fetchMock.mock.calls
			.filter((call) => asText(call[0]).endsWith("/button"))
			.map((call) => call[1]?.body);
		expect(calledBodies).toHaveLength(12);
		for (const button of buttons) {
			expect(calledBodies).toContain(JSON.stringify({ button }));
		}
	});

	it("nds_press_button sends hold_ms when provided", async () => {
		fetchMock.mockImplementation(async (input) => {
			const url = asText(input);
			if (url.endsWith("/button")) {
				return makeResponse({ ok: true });
			}
			return makeResponse({ image: "AAA", width: 512, height: 768 });
		});
		vi.stubGlobal("fetch", fetchMock);

		await Reflect.apply(pressButtonTool.execute, undefined, [
			"tool-id",
			{ button: "A", hold_ms: 500 },
		]);

		const pressCall = fetchMock.mock.calls.find((call) =>
			asText(call[0]).endsWith("/button"),
		);
		expect(pressCall?.[1]?.body).toBe(
			JSON.stringify({ button: "A", hold_ms: 500 }),
		);
	});

	it("nds_touch accepts lower boundary (0,0)", async () => {
		fetchMock.mockImplementation(async (input) => {
			const url = asText(input);
			if (url.endsWith("/touch")) {
				return makeResponse({ ok: true });
			}
			return makeResponse({ image: "AAA", width: 512, height: 768 });
		});
		vi.stubGlobal("fetch", fetchMock);

		await Reflect.apply(touchTool.execute, undefined, [
			"tool-id",
			{ x: 0, y: 0 },
		]);

		const touchCall = fetchMock.mock.calls.find((call) =>
			asText(call[0]).endsWith("/touch"),
		);
		expect(touchCall?.[1]?.body).toBe(JSON.stringify({ x: 0, y: 0 }));
	});

	it("nds_touch accepts upper boundary (255,191)", async () => {
		fetchMock.mockImplementation(async (input) => {
			const url = asText(input);
			if (url.endsWith("/touch")) {
				return makeResponse({ ok: true });
			}
			return makeResponse({ image: "AAA", width: 512, height: 768 });
		});
		vi.stubGlobal("fetch", fetchMock);

		await Reflect.apply(touchTool.execute, undefined, [
			"tool-id",
			{ x: 255, y: 191 },
		]);

		const touchCall = fetchMock.mock.calls.find((call) =>
			asText(call[0]).endsWith("/touch"),
		);
		expect(touchCall?.[1]?.body).toBe(JSON.stringify({ x: 255, y: 191 }));
	});

	it("nds_touch rejects x=256 with isError and no POST", async () => {
		vi.stubGlobal("fetch", fetchMock);

		const result = await Reflect.apply(touchTool.execute, undefined, [
			"tool-id",
			{ x: 256, y: 0 },
		]);

		expect(result.isError).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("nds_touch rejects y=192 with isError and no POST", async () => {
		vi.stubGlobal("fetch", fetchMock);

		const result = await Reflect.apply(touchTool.execute, undefined, [
			"tool-id",
			{ x: 0, y: 192 },
		]);

		expect(result.isError).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("nds_touch rejects x=-1 with isError and no POST", async () => {
		vi.stubGlobal("fetch", fetchMock);

		const result = await Reflect.apply(touchTool.execute, undefined, [
			"tool-id",
			{ x: -1, y: 0 },
		]);

		expect(result.isError).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("bridge failure throws descriptive error", async () => {
		fetchMock.mockResolvedValue(makeResponse({}, 503));
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			Reflect.apply(captureScreenTool.execute, undefined, ["tool-id", {}]),
		).rejects.toThrow("bridge /screenshot failed: 503");
	});
});
