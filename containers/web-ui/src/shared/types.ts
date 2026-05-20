import { type Static, Type } from "@sinclair/typebox";

export const ChatMessageSchema = Type.Object({
  type: Type.Literal("message"),
  text: Type.String({ minLength: 1, maxLength: 4000 }),
  id: Type.String({ minLength: 1, maxLength: 128 }),
});

export const ChatAckSchema = Type.Object({
  type: Type.Literal("ack"),
  id: Type.String(),
});

export const ChatErrorSchema = Type.Object({
  type: Type.Literal("error"),
  message: Type.String(),
});

export const SystemStatusSchema = Type.Object({
  type: Type.Literal("status"),
  emulator: Type.Union([
    Type.Literal("connected"),
    Type.Literal("disconnected"),
  ]),
  stream: Type.Union([
    Type.Literal("live"),
    Type.Literal("connecting"),
    Type.Literal("disconnected"),
  ]),
  agent: Type.Union([
    Type.Literal("running"),
    Type.Literal("idle"),
    Type.Literal("disconnected"),
  ]),
});

// One row in the activity log: an action the agent took on the emulator.
// Surfaced to the UI so the human watching the stream can see WHAT Dori is
// doing as she does it.
export const AgentActionSchema = Type.Object({
  type: Type.Literal("agent-action"),
  id: Type.String({ minLength: 1, maxLength: 128 }),
  timestamp: Type.Number(),
  action: Type.Union([
    Type.Literal("button"),
    Type.Literal("touch"),
    Type.Literal("screenshot"),
  ]),
  detail: Type.String({ maxLength: 256 }),
});

// One row in the activity log: a chunk of the agent's reasoning. Stream this
// while the model is thinking so the human can SEE the plan, not just the
// outcome.
export const AgentThinkingSchema = Type.Object({
  type: Type.Literal("agent-thinking"),
  id: Type.String({ minLength: 1, maxLength: 128 }),
  timestamp: Type.Number(),
  text: Type.String({ maxLength: 4000 }),
});

export const ServerToClientSchema = Type.Union([
  ChatAckSchema,
  ChatErrorSchema,
  SystemStatusSchema,
  AgentActionSchema,
  AgentThinkingSchema,
]);

export type ChatMessage = Static<typeof ChatMessageSchema>;
export type ChatAck = Static<typeof ChatAckSchema>;
export type ChatError = Static<typeof ChatErrorSchema>;
export type SystemStatus = Static<typeof SystemStatusSchema>;
export type AgentAction = Static<typeof AgentActionSchema>;
export type AgentThinking = Static<typeof AgentThinkingSchema>;
export type ServerToClient = Static<typeof ServerToClientSchema>;
