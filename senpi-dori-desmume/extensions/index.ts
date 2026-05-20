import type { ExtensionAPI } from "@code-yeongyu/senpi";
import { startInterventionServer } from "./intervention/ws-server.js";
import {
	captureScreenTool,
	pressButtonTool,
	touchTool,
} from "./tools/index.js";

export default async function extension(pi: ExtensionAPI): Promise<void> {
	pi.registerTool(captureScreenTool);
	pi.registerTool(pressButtonTool);
	pi.registerTool(touchTool);

	const interventionPort = Number(process.env.INTERVENTION_PORT ?? 7979);
	const server = startInterventionServer(pi, interventionPort);
	console.log(
		`[senpi-dori-desmume] registered 3 tools + intervention WS on :${server.port}`,
	);

	process.once("SIGINT", () => {
		void server.stop();
	});
	process.once("SIGTERM", () => {
		void server.stop();
	});
}
