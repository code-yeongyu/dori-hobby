import { access, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineTool } from "@code-yeongyu/senpi";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { broadcastAction } from "../intervention/ws-server.js";

type BunFile = {
	readonly exists: () => Promise<boolean>;
	readonly text: () => Promise<string>;
};

type BunRuntime = {
	readonly file: (path: string) => BunFile;
	readonly write: (path: string, contents: string) => Promise<number>;
};

declare global {
	var Bun: BunRuntime | undefined;
}

export const NOTEPAD_SEED = `# Dori notepad

Persistent work log. Append after every meaningful action or insight using
\`nds_notepad_append({ entry, tag })\`. Read at the start of every reasoning
turn with \`nds_notepad_read()\`.

Tags (use exactly one):
- plan       — multi-step intention for the current goal
- observation — fact you just saw on screen
- hypothesis — guess you're about to test
- attempt     — what you tried + outcome (worked / didn't / partial)
- learning    — durable lesson, applies across screens
- location    — coordinate/landmark you discovered (e.g. "Juniper trigger at lab y=center")
- battle      — Pokemon team status, type matchup result, switch decision
- todo        — pending action for later

## Log
`;

const TAGS = [
	"plan",
	"observation",
	"hypothesis",
	"attempt",
	"learning",
	"location",
	"battle",
	"todo",
] as const;

const NotepadTagSchema = Type.Union(TAGS.map((tag) => Type.Literal(tag)));
const NotepadAppendSchema = Type.Object({
	entry: Type.String({ minLength: 1, maxLength: 4000 }),
	tag: Type.Optional(NotepadTagSchema),
});

type AppendPayload = Static<typeof NotepadAppendSchema>;

export function notepadPath(): string {
	return fileURLToPath(new URL("../../../.dori-notepad.md", import.meta.url));
}

const lineCount = (content: string): number => {
	return content.length === 0 ? 0 : content.split("\n").length;
};

const extractEntries = (content: string): readonly string[] => {
	const marker = "## Log";
	const markerIndex = content.indexOf(marker);
	if (markerIndex < 0) {
		return [];
	}
	const logText = content.slice(markerIndex + marker.length).trim();
	if (logText.length === 0) {
		return [];
	}
	return logText
		.split(/\n\n(?=\d{4}-\d{2}-\d{2}T)/)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
};

const lastAppendedTimestamp = (content: string): string => {
	const lastEntry = extractEntries(content).at(-1);
	if (lastEntry === undefined) {
		return "never";
	}
	const firstSpace = lastEntry.indexOf(" ");
	return firstSpace < 0 ? "unknown" : lastEntry.slice(0, firstSpace);
};

const hostFileExists = async (path: string): Promise<boolean> => {
	const bun = globalThis.Bun;
	if (bun !== undefined) {
		return await bun.file(path).exists();
	}
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
};

const readHostFile = async (path: string): Promise<string> => {
	const bun = globalThis.Bun;
	return bun === undefined
		? await readFile(path, "utf8")
		: await bun.file(path).text();
};

const writeHostFile = async (path: string, content: string): Promise<void> => {
	const bun = globalThis.Bun;
	if (bun === undefined) {
		await writeFile(path, content);
		return;
	}
	await bun.write(path, content);
};

const ensureNotepad = async (): Promise<{
	readonly content: string;
	readonly created: boolean;
}> => {
	const path = notepadPath();
	if (!(await hostFileExists(path))) {
		await writeHostFile(path, NOTEPAD_SEED);
		return { content: NOTEPAD_SEED, created: true };
	}
	return { content: await readHostFile(path), created: false };
};

const latestEntriesText = (content: string): string => {
	const entries = extractEntries(content).slice(-3);
	return entries.length === 0
		? "No notepad entries yet."
		: entries.join("\n\n");
};

const shortEntry = (entry: string): string => {
	return entry.length > 60 ? `${entry.slice(0, 57)}...` : entry;
};

const parseAppendPayload = (params: unknown): AppendPayload | undefined => {
	try {
		return Value.Parse(NotepadAppendSchema, params);
	} catch {
		return undefined;
	}
};

export const notepadReadTool = defineTool({
	name: "nds_notepad_read",
	label: "NDS Notepad Read",
	description:
		"Read Dori's persistent project-root work log. Does not touch game state or capture a screenshot.",
	promptSnippet:
		"nds_notepad_read(): read the persistent .dori-notepad.md work log before reasoning.",
	promptGuidelines: [
		"Call at the start of every reasoning turn unless you just appended a note.",
		"Use the notes as durable facts; do not re-derive known layouts from scratch.",
	],
	parameters: Type.Object({}),
	async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
		const { content, created } = await ensureNotepad();
		const path = notepadPath();
		const lines = lineCount(content);
		broadcastAction("screenshot", `notepad: read ${lines} lines`);
		return {
			content: [
				{ type: "text", text: content },
				{
					type: "text",
					text: `Notepad ${path}, ${lines} lines, last appended ${lastAppendedTimestamp(content)}${created ? " (notepad created)" : ""}`,
				},
			],
			details: { path, lines, created },
		};
	},
});

export const notepadAppendTool = defineTool({
	name: "nds_notepad_append",
	label: "NDS Notepad Append",
	description:
		"Append one terse tagged note to Dori's persistent work log. Does not touch game state or capture a screenshot.",
	promptSnippet:
		"nds_notepad_append({ entry: string, tag?: 'plan'|'observation'|'hypothesis'|'attempt'|'learning'|'location'|'battle'|'todo' }): append a work-log note.",
	promptGuidelines: [
		"Append after every meaningful action or insight: new location, hypothesis, attempt, battle result, layout lesson, or stuck state.",
		"Keep entries terse: one sentence, one fact, one tag.",
	],
	parameters: NotepadAppendSchema,
	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		const payload = parseAppendPayload(params);
		if (payload === undefined) {
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: "Error: entry must be 1..4000 characters and tag must be valid.",
					},
				],
				details: { error: "validation" },
			};
		}

		const tag = payload.tag ?? "observation";
		const { content } = await ensureNotepad();
		const timestamp = new Date().toISOString();
		const nextContent = `${content.trimEnd()}\n\n${timestamp} [${tag}] ${payload.entry}`;
		await writeHostFile(notepadPath(), nextContent);
		broadcastAction(
			"screenshot",
			`notepad: appended [${tag}] ${shortEntry(payload.entry)}`,
		);
		return {
			content: [
				{ type: "text", text: `notepad appended [${tag}]` },
				{ type: "text", text: latestEntriesText(nextContent) },
			],
			details: { tag, path: notepadPath() },
		};
	},
});
