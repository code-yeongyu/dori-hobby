import { defineTool } from "@code-yeongyu/senpi";
import { Type } from "typebox";
import { broadcastAction } from "../intervention/ws-server.js";
import { BUTTONS } from "./press-button.js";
import { captureScreenshot, postJson } from "./shared.js";

const TOUCH_MAX_X = 255;
const TOUCH_MAX_Y = 191;
const SEQUENCE_MAX_STEPS = 32;

const TouchPointSchema = Type.Object({
	x: Type.Integer({ minimum: 0, maximum: TOUCH_MAX_X }),
	y: Type.Integer({ minimum: 0, maximum: TOUCH_MAX_Y }),
});

const ButtonStepSchema = Type.Object({
	kind: Type.Literal("button"),
	button: Type.Union(BUTTONS.map((button) => Type.Literal(button))),
	hold_ms: Type.Optional(Type.Integer({ minimum: 0, maximum: 5000 })),
	repeat_count: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
	repeat_interval_ms: Type.Optional(
		Type.Integer({ minimum: 10, maximum: 2000 }),
	),
});

const TouchStepSchema = Type.Object({
	kind: Type.Literal("touch"),
	x: Type.Integer({ minimum: 0, maximum: TOUCH_MAX_X }),
	y: Type.Integer({ minimum: 0, maximum: TOUCH_MAX_Y }),
	hold_ms: Type.Optional(Type.Integer({ minimum: 50, maximum: 5000 })),
});

const TouchDragStepSchema = Type.Object({
	kind: Type.Literal("touch_drag"),
	from: TouchPointSchema,
	to: TouchPointSchema,
	duration_ms: Type.Integer({ minimum: 50, maximum: 3000 }),
});

const WaitStepSchema = Type.Object({
	kind: Type.Literal("wait"),
	ms: Type.Integer({ minimum: 0, maximum: 10000 }),
});

const SequenceStepSchema = Type.Union([
	ButtonStepSchema,
	TouchStepSchema,
	TouchDragStepSchema,
	WaitStepSchema,
]);

const describeStep = (step: {
	readonly kind: string;
	readonly button?: string;
	readonly repeat_count?: number;
	readonly hold_ms?: number;
	readonly x?: number;
	readonly y?: number;
	readonly from?: { readonly x: number; readonly y: number };
	readonly to?: { readonly x: number; readonly y: number };
	readonly duration_ms?: number;
	readonly ms?: number;
}): string => {
	switch (step.kind) {
		case "button": {
			const repeat =
				step.repeat_count !== undefined && step.repeat_count > 1
					? `x${step.repeat_count}`
					: "";
			const hold =
				step.hold_ms !== undefined && step.hold_ms > 0
					? `hold ${step.hold_ms}ms`
					: "";
			return [step.button ?? "button", repeat, hold]
				.filter((part) => part.length > 0)
				.join(" ");
		}
		case "touch":
			return `touch (${step.x ?? "?"}, ${step.y ?? "?"})`;
		case "touch_drag":
			return `drag (${step.from?.x ?? "?"}, ${step.from?.y ?? "?"}) -> (${step.to?.x ?? "?"}, ${step.to?.y ?? "?"})`;
		case "wait":
			return `wait ${step.ms ?? "?"}ms`;
		default:
			return step.kind;
	}
};

export const pressSequenceTool = defineTool({
	name: "nds_press_sequence",
	label: "NDS Press Sequence",
	description:
		"Run up to 32 NDS button, touch, touch-drag, and wait steps in one batch. Always auto-returns one fresh post-sequence screenshot.",
	promptSnippet:
		"nds_press_sequence({ steps: [{ kind: 'button', button, repeat_count?, hold_ms? } | { kind: 'touch', x, y, hold_ms? } | { kind: 'touch_drag', from, to, duration_ms } | { kind: 'wait', ms }] }): batch actions, then returns the screenshot.",
	promptGuidelines: [
		"Use this for multi-step intent: walk several tiles, wait, then press A; save-menu flows; repeated menu navigation.",
		"Max 32 steps. Prefer one sequence over many single-action tool calls when the next few actions are obvious.",
		"Touch coordinates are relative to the bottom screen only. Top screen is view-only.",
		"Every call returns the resulting screenshot; do not call nds_capture_screen after it unless you missed something.",
	],
	parameters: Type.Object({
		steps: Type.Array(SequenceStepSchema, {
			minItems: 1,
			maxItems: SEQUENCE_MAX_STEPS,
		}),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		await postJson("/sequence", { steps: params.steps });
		const preview = params.steps.slice(0, 6).map(describeStep).join(" -> ");
		const suffix =
			params.steps.length > 6 ? ` -> +${params.steps.length - 6} more` : "";
		broadcastAction(
			"button",
			`sequence ${params.steps.length} steps: ${preview}${suffix}`,
		);
		const { contentBlocks } = await captureScreenshot();
		return {
			content: contentBlocks,
			details: { steps: params.steps.length, screenshot: "post-action" },
		};
	},
});
