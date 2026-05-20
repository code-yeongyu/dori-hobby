export interface BridgeClientConfig {
	readonly baseUrl: string;
}

interface JsonRecord {
	readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null;
}

function readString(record: JsonRecord, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

export interface CaptureResponse {
	readonly imageBase64: string;
}

export async function postBridgeJson(
	config: BridgeClientConfig,
	path: string,
	body: JsonRecord,
): Promise<JsonRecord> {
	const response = await fetch(new URL(path, config.baseUrl), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Bridge request failed (${response.status}): ${errorText}`);
	}

	const parsed: unknown = await response.json();
	if (!isRecord(parsed)) {
		throw new Error("Bridge returned non-object JSON payload");
	}

	return parsed;
}

export function parseCaptureResponse(payload: JsonRecord): CaptureResponse {
	const imageBase64 = readString(payload, "imageBase64");
	if (imageBase64 === undefined || imageBase64.length === 0) {
		throw new Error("Bridge response missing imageBase64");
	}
	return { imageBase64 };
}
