import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Hono } from "hono";

import type { PlaytimeEvent, PlaytimeLiveSnapshot, PlaytimeState } from "./playtime-tracker.js";

export interface PlaytimeRouteService {
	snapshot(): Promise<PlaytimeState>;
	snapshotLive(): Promise<PlaytimeLiveSnapshot>;
	recordEvent(event: string): Promise<PlaytimeEvent>;
}

export const PlaytimeEventRequestSchema = Type.Object({
	event: Type.String({ minLength: 1, maxLength: 64 }),
});

type PlaytimeEventRequest = Static<typeof PlaytimeEventRequestSchema>;

const toErrorMessage = (error: unknown): string => {
	if (error instanceof Error) {
		return error.message;
	}
	return "unknown";
};

const parseEventRequest = (body: unknown): PlaytimeEventRequest | undefined => {
	try {
		return Value.Parse(PlaytimeEventRequestSchema, body);
	} catch (error) {
		if (error instanceof Error) {
			return undefined;
		}
		throw error;
	}
};

export const buildPlaytimeRoutes = (service: PlaytimeRouteService): Hono => {
	const app = new Hono();

	app.get("/playtime", async (context) => {
		try {
			const snapshot = await service.snapshotLive();
			return context.json({
				ok: true,
				total_seconds: snapshot.totalSeconds,
				total_human: snapshot.totalHuman,
				started_at: snapshot.startedAtIso,
				ticking: true,
			});
		} catch (error) {
			return context.json({ ok: false, error: toErrorMessage(error) }, 500);
		}
	});

	app.post("/playtime/event", async (context) => {
		let body: unknown;
		try {
			body = await context.req.json();
		} catch (error) {
			if (error instanceof Error) {
				return context.json({ error: "invalid json" }, 400);
			}
			throw error;
		}
		const payload = parseEventRequest(body);
		if (payload === undefined) {
			return context.json({ error: "invalid playtime event" }, 400);
		}
		try {
			const event = await service.recordEvent(payload.event);
			return context.json(event, 201);
		} catch (error) {
			return context.json({ error: toErrorMessage(error) }, 500);
		}
	});

	return app;
};
