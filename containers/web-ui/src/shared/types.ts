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

export const ServerToClientSchema = Type.Union([
  ChatAckSchema,
  ChatErrorSchema,
  SystemStatusSchema,
]);

export type ChatMessage = Static<typeof ChatMessageSchema>;
export type ChatAck = Static<typeof ChatAckSchema>;
export type ChatError = Static<typeof ChatErrorSchema>;
export type SystemStatus = Static<typeof SystemStatusSchema>;
export type ServerToClient = Static<typeof ServerToClientSchema>;
