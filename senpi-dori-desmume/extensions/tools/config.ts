import type { BridgeClientConfig } from "./bridge-client.js";

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:8088";

export function getBridgeConfig(): BridgeClientConfig {
	const fromEnv = process.env.DORI_DESMUME_BRIDGE_URL;
	const baseUrl = fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_BRIDGE_URL;
	return { baseUrl };
}
