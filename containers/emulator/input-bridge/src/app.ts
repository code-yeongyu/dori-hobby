import { Value } from "@sinclair/typebox/value";
import { Hono } from "hono";

import type { DesmumeDriver } from "./desmume-driver.js";
import { resolveButtonPressOptions } from "./input-options.js";
import {
	type AUntilDialogRequest,
	AUntilDialogSchema,
	type ButtonRequest,
	ButtonSchema,
	type SaveStateRequest,
	SaveStateSchema,
	type SequenceRequest,
	SequenceSchema,
	type TouchDragRequest,
	TouchDragSchema,
	type TouchRequest,
	TouchSchema,
} from "./types.js";

export type BridgeDriver = Pick<
	DesmumeDriver,
	"pressButton" | "touch" | "touchDrag" | "aUntilDialog" | "runSequence" | "saveState" | "loadState" | "captureScreen"
>;

const toErrorMessage = (error: unknown): string => {
	if (error instanceof Error) {
		return error.message;
	}
	return "unknown";
};

export const buildApp = (driver: BridgeDriver) => {
	const app = new Hono();

	app.get("/health", (context) => context.json({ status: "ok" }));

	app.post("/button", async (context) => {
		const body = await context.req.json();
		let payload: ButtonRequest;
		try {
			payload = Value.Parse(ButtonSchema, body);
			resolveButtonPressOptions(payload);
		} catch (error) {
			return context.json({ ok: false, error: toErrorMessage(error) }, 400);
		}
		try {
			await driver.pressButton(payload.button, payload);
			return context.json({ ok: true });
		} catch (error) {
			return context.json({ ok: false, error: toErrorMessage(error) }, 503);
		}
	});

	app.post("/touch", async (context) => {
		const body = await context.req.json();
		let payload: TouchRequest;
		try {
			payload = Value.Parse(TouchSchema, body);
		} catch {
			return context.json({ ok: false, error: "invalid touch payload" }, 400);
		}
		try {
			await driver.touch(payload.x, payload.y, payload.hold_ms);
			return context.json({ ok: true });
		} catch (error) {
			return context.json({ ok: false, error: toErrorMessage(error) }, 503);
		}
	});

	app.post("/touch-drag", async (context) => {
		const body = await context.req.json();
		let payload: TouchDragRequest;
		try {
			payload = Value.Parse(TouchDragSchema, body);
		} catch {
			return context.json({ ok: false, error: "invalid touch-drag payload" }, 400);
		}
		try {
			await driver.touchDrag(payload.from, payload.to, payload.duration_ms);
			return context.json({ ok: true });
		} catch (error) {
			return context.json({ ok: false, error: toErrorMessage(error) }, 503);
		}
	});

	app.post("/a-until-dialog", async (context) => {
		const body = await context.req.json();
		let payload: AUntilDialogRequest;
		try {
			payload = Value.Parse(AUntilDialogSchema, body);
		} catch {
			return context.json({ ok: false, error: "invalid a-until-dialog payload" }, 400);
		}
		try {
			const result = await driver.aUntilDialog(payload);
			return context.json({
				ok: true,
				stop_reason: result.stopReason,
				press_count: result.pressCount,
				duration_ms: result.durationMs,
			});
		} catch (error) {
			return context.json({ ok: false, error: toErrorMessage(error) }, 503);
		}
	});

	app.post("/sequence", async (context) => {
		const body = await context.req.json();
		let payload: SequenceRequest;
		try {
			payload = Value.Parse(SequenceSchema, body);
		} catch {
			return context.json({ ok: false, error: "invalid sequence payload" }, 400);
		}
		try {
			const result = await driver.runSequence(payload.steps, payload);
			return result.aborted
				? context.json({
						ok: true,
						aborted: true,
						stepsExecuted: result.stepsExecuted,
						stepsRemaining: result.stepsRemaining,
						abortReason: result.abortReason,
						stuckStreak: result.stuckStreak,
					})
				: context.json({
						ok: true,
						aborted: false,
						stepsExecuted: result.stepsExecuted,
						stepsRemaining: result.stepsRemaining,
						abortReason: null,
						stuckStreak: result.stuckStreak,
					});
		} catch (error) {
			return context.json({ ok: false, error: toErrorMessage(error) }, 503);
		}
	});

	const readSlot = (body: unknown): SaveStateRequest | undefined => {
		try {
			return Value.Parse(SaveStateSchema, body);
		} catch {
			return undefined;
		}
	};

	app.post("/save-state", async (context) => {
		const payload = readSlot(await context.req.json());
		if (payload === undefined) {
			return context.json({ ok: false, error: "invalid save-state payload" }, 400);
		}
		try {
			await driver.saveState(payload.slot);
			return context.json({ ok: true, slot: payload.slot });
		} catch (error) {
			return context.json({ ok: false, error: toErrorMessage(error) }, 503);
		}
	});

	app.post("/load-state", async (context) => {
		const payload = readSlot(await context.req.json());
		if (payload === undefined) {
			return context.json({ ok: false, error: "invalid load-state payload" }, 400);
		}
		try {
			await driver.loadState(payload.slot);
			return context.json({ ok: true, slot: payload.slot });
		} catch (error) {
			return context.json({ ok: false, error: toErrorMessage(error) }, 503);
		}
	});

	app.get("/screenshot", async (context) => {
		try {
			const screenshot = await driver.captureScreen();
			return context.json({
				image: screenshot.base64,
				width: screenshot.width,
				height: screenshot.height,
			});
		} catch (error) {
			return context.json({ ok: false, error: toErrorMessage(error) }, 503);
		}
	});

	return app;
};
