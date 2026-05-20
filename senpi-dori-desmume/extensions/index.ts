import type { ExtensionAPI } from "@code-yeongyu/senpi";
import {
	captureScreenTool,
	pressButtonTool,
	touchTool,
} from "./tools/index.js";

export default function extension(pi: ExtensionAPI): void {
	pi.registerTool(captureScreenTool);
	pi.registerTool(pressButtonTool);
	pi.registerTool(touchTool);
	// T10 will add the intervention WS server wiring here.
}
