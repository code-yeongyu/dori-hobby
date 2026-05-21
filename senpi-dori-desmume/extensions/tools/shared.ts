import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

export const BRIDGE_URL = process.env.BRIDGE_URL ?? "http://localhost:7878";

interface ScreenshotResponse {
	readonly image: string;
	readonly width: number;
	readonly height: number;
}

type ContentBlock = TextContent | ImageContent;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== "string") {
		throw new Error(`bridge payload missing string field: ${key}`);
	}
	return value;
}

function readNumber(record: Record<string, unknown>, key: string): number {
	const value = record[key];
	if (typeof value !== "number") {
		throw new Error(`bridge payload missing number field: ${key}`);
	}
	return value;
}

async function parseJsonObject(
	response: Response,
): Promise<Record<string, unknown>> {
	const parsed: unknown = await response.json();
	if (!isRecord(parsed)) {
		throw new Error("bridge response is not an object");
	}
	return parsed;
}

export async function captureScreenshot(): Promise<{
	readonly contentBlocks: ContentBlock[];
	readonly raw: ScreenshotResponse;
}> {
	const response = await fetch(`${BRIDGE_URL}/screenshot`);
	if (!response.ok) {
		throw new Error(`bridge /screenshot failed: ${response.status}`);
	}

	const payload = await parseJsonObject(response);
	const raw: ScreenshotResponse = {
		image: readString(payload, "image"),
		width: readNumber(payload, "width"),
		height: readNumber(payload, "height"),
	};

	const bottomMinY = Math.floor(raw.height / 2);
	const topMaxY = bottomMinY - 1;
	const bottomMaxY = raw.height - 1;
	const text = `Screenshot ${raw.width}x${raw.height} (full DS frame). Top screen (view-only): y=0..${topMaxY}. Bottom screen (TOUCH-CAPABLE): y=${bottomMinY}..${bottomMaxY} in the image; touch_y = image_y - ${bottomMinY}. Only the bottom screen accepts touch input — top screen is view-only.`;

	return {
		raw,
		contentBlocks: [
			{ type: "image", data: raw.image, mimeType: "image/png" },
			{ type: "text", text },
		],
	};
}

export async function postJson(path: string, body: unknown): Promise<unknown> {
	const response = await fetch(`${BRIDGE_URL}${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		throw new Error(`bridge ${path} failed: ${response.status}`);
	}
	return response.json();
}
