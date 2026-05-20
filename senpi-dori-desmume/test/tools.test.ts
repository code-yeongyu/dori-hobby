import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@code-yeongyu/senpi", () => ({
	defineTool: <T>(tool: T): T => tool,
}));

import { captureScreenTool } from "../extensions/tools/capture-screen";
import { pressButtonTool } from "../extensions/tools/press-button";
import { touchTool } from "../extensions/tools/touch";

const fetchMock = vi.fn<typeof fetch>();

describe("nds tools", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		fetchMock.mockReset();
	});

	it("capture-screen returns ImageContent with png base64", async () => {
		const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ imageBase64: base64 }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await captureScreenTool.execute("tool-1", {});

		expect(result.isError).toBeUndefined();
		expect(result.content).toEqual([
			{ type: "text", text: "Captured NDS combined screenshot (256x384)." },
			{ type: "image", data: base64, mimeType: "image/png" },
		]);
	});

	it("press-button posts button and frames", async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await pressButtonTool.execute("tool-2", { button: "A", frames: 3 });

		expect(result.isError).toBeUndefined();
		expect(result.content).toEqual([{ type: "text", text: "Pressed button A for 3 frame(s)." }]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] ?? [];
		expect(url).toContain("/press-button");
		expect(init?.method).toBe("POST");
		expect(init?.body).toBe(JSON.stringify({ button: "A", frames: 3 }));
	});

	it("touch rejects out-of-range bottom-screen coordinates as isError", async () => {
		vi.stubGlobal("fetch", fetchMock);

		const result = await touchTool.execute("tool-3", { x: 256, y: 12, frames: 1 });

		expect(result.isError).toBe(true);
		expect(result.content).toEqual([
			{ type: "text", text: "Invalid bottom-screen coordinates: x must be 0..255 and y must be 0..191." },
		]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
