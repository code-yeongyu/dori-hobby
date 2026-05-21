import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@code-yeongyu/senpi", () => ({
	defineTool: <T>(tool: T): T => tool,
}));

import { pressSequenceTool } from "../extensions/tools/press-sequence.js";

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

describe("nds_press_sequence collision abort surface", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		fetchMock.mockReset();
	});

	it("passes abort parameters and returns abort metadata with the final screenshot", async () => {
		fetchMock.mockImplementation(async (input, init) => {
			const url = asText(input);
			if (url.endsWith("/sequence")) {
				expect(init?.method).toBe("POST");
				return makeResponse({
					ok: true,
					aborted: true,
					stepsExecuted: 5,
					stepsRemaining: 5,
					abortReason: "collision_stuck",
					stuckStreak: 5,
				});
			}
			if (url.endsWith("/screenshot")) {
				return makeResponse({ image: "AAA", width: 256, height: 384 });
			}
			return makeResponse({}, 404);
		});
		vi.stubGlobal("fetch", fetchMock);
		const steps = Array.from({ length: 10 }, () => ({
			kind: "button",
			button: "Up",
		}));

		const result = await Reflect.apply(pressSequenceTool.execute, undefined, [
			"tool-id",
			{ steps, abort_on_stuck: true, stuck_threshold: 5 },
		]);

		const sequenceCall = fetchMock.mock.calls.find((call) =>
			asText(call[0]).endsWith("/sequence"),
		);
		expect(sequenceCall?.[1]?.body).toBe(
			JSON.stringify({ steps, abort_on_stuck: true, stuck_threshold: 5 }),
		);
		expect(result.content).toHaveLength(2);
		expect(result.details).toEqual({
			steps: 10,
			aborted: true,
			stepsExecuted: 5,
			stepsRemaining: 5,
			abortReason: "collision_stuck",
			stuckStreak: 5,
			screenshot: "post-action",
		});
	});
});
