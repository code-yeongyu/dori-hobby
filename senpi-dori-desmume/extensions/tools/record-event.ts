import { defineTool } from "@code-yeongyu/senpi";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { broadcastAction } from "../intervention/ws-server.js";
import {
	captureScreenshot,
	postJson,
	readNumber,
	readString,
} from "./shared.js";

const RecordEventSchema = Type.Object({
	event: Type.String({ minLength: 1, maxLength: 64 }),
});

type RecordEventPayload = Static<typeof RecordEventSchema>;

const parseRecordEventPayload = (
	params: unknown,
): RecordEventPayload | undefined => {
	try {
		return Value.Parse(RecordEventSchema, params);
	} catch (error) {
		if (error instanceof Error) {
			return undefined;
		}
		throw error;
	}
};

export const recordEventTool = defineTool({
	name: "nds_record_event",
	label: "NDS Record Event",
	description:
		"Record a named milestone in the persistent playtime event log. Always auto-returns a fresh post-action screenshot.",
	promptSnippet:
		"nds_record_event({ event: string }): record a milestone such as trio_badge with the current playtime snapshot, then returns the screenshot.",
	promptGuidelines: [
		"Use this once for durable milestones: starter_selected, gym_entered, trio_badge.",
		"Keep event names lowercase snake_case, 1..64 characters.",
		"Every call returns the resulting screenshot; do not call nds_capture_screen after it unless you missed something.",
	],
	parameters: RecordEventSchema,
	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		const payload = parseRecordEventPayload(params);
		if (payload === undefined) {
			return {
				isError: true,
				content: [
					{ type: "text", text: "Error: event must be 1..64 characters." },
				],
				details: { error: "validation" },
			};
		}

		const response = await postJson("/playtime/event", {
			event: payload.event,
		});
		const recordedEvent = readString(response, "event");
		const atIso = readString(response, "at_iso");
		const totalSeconds = readNumber(response, "total_seconds");
		broadcastAction(
			"screenshot",
			`event: ${recordedEvent} at ${totalSeconds}s`,
		);
		const { contentBlocks } = await captureScreenshot();
		return {
			content: [
				{
					type: "text",
					text: `recorded ${recordedEvent} at ${totalSeconds}s (${atIso})`,
				},
				...contentBlocks,
			],
			details: {
				event: recordedEvent,
				at_iso: atIso,
				total_seconds: totalSeconds,
				screenshot: "post-action",
			},
		};
	},
});
