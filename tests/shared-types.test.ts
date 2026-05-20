import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { ChatClientMessageSchema, ChatServerMessageSchema } from "../src/shared/types.js";

describe("shared websocket schemas", () => {
  it("accepts valid client chat payload", () => {
    const payload: unknown = { type: "chat.send", text: "hello", at: Date.now() };
    expect(Value.Check(ChatClientMessageSchema, payload)).toBe(true);
  });

  it("rejects invalid client chat payload", () => {
    const payload: unknown = { type: "chat.send", text: "", at: Date.now() };
    expect(Value.Check(ChatClientMessageSchema, payload)).toBe(false);
  });

  it("accepts server status message", () => {
    const payload: unknown = { type: "status", level: "info", text: "ok", at: Date.now() };
    expect(Value.Check(ChatServerMessageSchema, payload)).toBe(true);
  });
});
