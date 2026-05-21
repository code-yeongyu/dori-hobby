import { defineTool } from "@code-yeongyu/senpi";
import { Type } from "typebox";
import { broadcastAction } from "../intervention/ws-server.js";
import { getJson, readNumber, readString } from "./shared.js";

export const ndsPlaytimeTool = defineTool({
	name: "nds_playtime",
	label: "NDS Playtime",
	description:
		"Read cumulative pure emulator runtime for milestone logging. Does not affect game state and does not take screenshots.",
	promptSnippet:
		"nds_playtime(): read total pure play time in both human and seconds format.",
	parameters: Type.Object({}),
	async execute() {
		const payload = await getJson("/playtime");
		const totalSeconds = readNumber(payload, "total_seconds");
		const totalHuman = readString(payload, "total_human");
		broadcastAction("screenshot", `playtime: ${totalHuman}`);
		return {
			content: [
				{
					type: "text",
					text: `Total play time: ${totalHuman} (${totalSeconds} seconds).`,
				},
			],
			details: { total_seconds: totalSeconds, total_human: totalHuman },
		};
	},
});
