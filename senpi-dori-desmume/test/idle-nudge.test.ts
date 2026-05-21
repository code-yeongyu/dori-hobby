import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installIdleNudge } from "../extensions/idle-nudge.js";

type EventHandler = (event: unknown) => void;

function makeMockPi(): {
	pi: Parameters<typeof installIdleNudge>[0];
	handlers: Map<string, EventHandler[]>;
	sendUserMessage: ReturnType<typeof vi.fn>;
} {
	const handlers = new Map<string, EventHandler[]>();
	const on = vi.fn((event: string, handler: EventHandler) => {
		const list = handlers.get(event) ?? [];
		list.push(handler);
		handlers.set(event, list);
	});
	const sendUserMessage = vi.fn();
	const pi = { on, sendUserMessage } as unknown as Parameters<
		typeof installIdleNudge
	>[0];
	return { pi, handlers, sendUserMessage };
}

function fire(handlers: Map<string, EventHandler[]>, event: string): void {
	for (const handler of handlers.get(event) ?? []) {
		handler({});
	}
}

describe("installIdleNudge", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("fires sendUserMessage with deliverAs=steer after idleTimeoutMs", () => {
		const { pi, handlers, sendUserMessage } = makeMockPi();
		installIdleNudge(pi, { idleTimeoutMs: 1000, nudgeText: "wake up" });

		fire(handlers, "agent_end");
		expect(sendUserMessage).not.toHaveBeenCalled();

		vi.advanceTimersByTime(999);
		expect(sendUserMessage).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(sendUserMessage).toHaveBeenCalledTimes(1);
		expect(sendUserMessage).toHaveBeenCalledWith("wake up", {
			deliverAs: "steer",
		});
	});

	it("cancels pending nudge when agent_start arrives before timeout", () => {
		const { pi, handlers, sendUserMessage } = makeMockPi();
		installIdleNudge(pi, { idleTimeoutMs: 1000, nudgeText: "wake up" });

		fire(handlers, "agent_end");
		vi.advanceTimersByTime(500);
		fire(handlers, "agent_start");
		vi.advanceTimersByTime(10_000);

		expect(sendUserMessage).not.toHaveBeenCalled();
	});

	it("resets the timer when consecutive agent_end events arrive", () => {
		const { pi, handlers, sendUserMessage } = makeMockPi();
		installIdleNudge(pi, { idleTimeoutMs: 1000, nudgeText: "wake up" });

		fire(handlers, "agent_end");
		vi.advanceTimersByTime(800);
		fire(handlers, "agent_end");
		vi.advanceTimersByTime(800);

		expect(sendUserMessage).not.toHaveBeenCalled();

		vi.advanceTimersByTime(200);
		expect(sendUserMessage).toHaveBeenCalledTimes(1);
	});

	it("does not schedule when idleTimeoutMs is zero", () => {
		const { pi, handlers, sendUserMessage } = makeMockPi();
		installIdleNudge(pi, { idleTimeoutMs: 0, nudgeText: "wake up" });

		fire(handlers, "agent_end");
		vi.advanceTimersByTime(60_000);

		expect(sendUserMessage).not.toHaveBeenCalled();
	});

	it("stop() cancels any pending nudge", () => {
		const { pi, handlers, sendUserMessage } = makeMockPi();
		const handle = installIdleNudge(pi, {
			idleTimeoutMs: 1000,
			nudgeText: "wake up",
		});

		fire(handlers, "agent_end");
		handle.stop();
		vi.advanceTimersByTime(10_000);

		expect(sendUserMessage).not.toHaveBeenCalled();
	});

	it("swallows sendUserMessage errors so the timer can fire next round", () => {
		const { pi, handlers, sendUserMessage } = makeMockPi();
		sendUserMessage.mockImplementationOnce(() => {
			throw new Error("simulated senpi crash");
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		installIdleNudge(pi, { idleTimeoutMs: 100, nudgeText: "wake up" });

		fire(handlers, "agent_end");
		vi.advanceTimersByTime(100);

		expect(sendUserMessage).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});
});
