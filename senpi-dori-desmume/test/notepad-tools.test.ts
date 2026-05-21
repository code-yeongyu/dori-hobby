import { readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@code-yeongyu/senpi", () => ({
	defineTool: <T>(tool: T): T => tool,
}));

import {
	NOTEPAD_SEED,
	notepadAppendTool,
	notepadPath,
	notepadReadTool,
} from "../extensions/tools/notepad.js";

let originalContent: string | undefined;

const readOptional = async (path: string): Promise<string | undefined> => {
	try {
		return await readFile(path, "utf8");
	} catch {
		return undefined;
	}
};

describe("Dori notepad tools", () => {
	beforeEach(async () => {
		originalContent = await readOptional(notepadPath());
		await rm(notepadPath(), { force: true });
		vi.stubGlobal("Bun", {
			file: (path: string) => ({
				exists: async () => (await readOptional(path)) !== undefined,
				text: async () => await readFile(path, "utf8"),
			}),
			write: async (path: string, contents: string) => {
				await writeFile(path, contents);
				return contents.length;
			},
		});
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
		if (originalContent === undefined) {
			await rm(notepadPath(), { force: true });
			return;
		}
		await writeFile(notepadPath(), originalContent);
	});

	it("creates and returns the seed header when read from an empty path", async () => {
		const result = await Reflect.apply(notepadReadTool.execute, undefined, [
			"tool-id",
			{},
		]);
		const saved = await readFile(notepadPath(), "utf8");

		expect(saved).toBe(NOTEPAD_SEED);
		expect(result.content[0]).toEqual({ type: "text", text: NOTEPAD_SEED });
		expect(result.content[1]?.type).toBe("text");
		if (result.content[1]?.type === "text") {
			expect(result.content[1].text).toContain("notepad created");
			expect(result.content[1].text).toContain("Notepad ");
		}
	});

	it("creates and returns the seed header when the host runtime is Node", async () => {
		vi.unstubAllGlobals();

		const result = await Reflect.apply(notepadReadTool.execute, undefined, [
			"tool-id",
			{},
		]);
		const saved = await readFile(notepadPath(), "utf8");

		expect(saved).toBe(NOTEPAD_SEED);
		expect(result.content[0]).toEqual({ type: "text", text: NOTEPAD_SEED });
	});

	it("appends a tagged entry and returns the latest three entries", async () => {
		await writeFile(
			notepadPath(),
			`${NOTEPAD_SEED}\n\n2026-01-01T00:00:00.000Z [plan] first\n\n2026-01-01T00:01:00.000Z [attempt] second\n\n2026-01-01T00:02:00.000Z [learning] third`,
		);

		const result = await Reflect.apply(notepadAppendTool.execute, undefined, [
			"tool-id",
			{ entry: "foo", tag: "observation" },
		]);
		const saved = await readFile(notepadPath(), "utf8");

		expect(saved.trimEnd().endsWith("[observation] foo")).toBe(true);
		expect(result.content[0]).toEqual({
			type: "text",
			text: "notepad appended [observation]",
		});
		expect(result.content[1]?.type).toBe("text");
		if (result.content[1]?.type === "text") {
			expect(result.content[1].text).not.toContain("[plan] first");
			expect(result.content[1].text).toContain("[attempt] second");
			expect(result.content[1].text).toContain("[learning] third");
			expect(result.content[1].text).toContain("[observation] foo");
		}
	});

	it("returns a validation error for an empty entry", async () => {
		const result = await Reflect.apply(notepadAppendTool.execute, undefined, [
			"tool-id",
			{ entry: "", tag: "observation" },
		]);

		expect(result.isError).toBe(true);
		expect(result.content[0]).toEqual({
			type: "text",
			text: "Error: entry must be 1..4000 characters and tag must be valid.",
		});
	});
});
