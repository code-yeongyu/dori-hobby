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

export type ChatMessage = Static<typeof ChatMessageSchema>;
export type ChatAck = Static<typeof ChatAckSchema>;
export type ChatError = Static<typeof ChatErrorSchema>;
