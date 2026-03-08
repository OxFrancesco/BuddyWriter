import { mkdirSync, writeFileSync } from "fs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
	ensureUniquePath,
	getDocumentProjectRelativePath,
	isArchivedDocumentPath,
	normalizeWorkspaceDocumentLabels,
	resolveWorkspaceRelativePath,
	workspaceRelativePath,
} from "./workspace-service";

describe("workspace-service helpers", () => {
	it("rejects path traversal outside the workspace", () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "buddywriter-workspace-"));

		expect(() => resolveWorkspaceRelativePath(workspacePath, "../outside.md")).toThrow("outside the current workspace");
		expect(() => workspaceRelativePath(workspacePath, join(workspacePath, "../outside.md"))).toThrow("outside the current workspace");
	});

	it("normalizes workspace document labels", () => {
		expect(normalizeWorkspaceDocumentLabels([" draft ", "ideas", "draft", "in progress "])).toEqual([
			"draft",
			"ideas",
			"in progress",
		]);
	});

	it("detects project and archive locations", () => {
		expect(isArchivedDocumentPath("Archive/Old Note.md")).toBe(true);
		expect(isArchivedDocumentPath("Inbox/Current Note.md")).toBe(false);
		expect(getDocumentProjectRelativePath("Projects/Roadmap/Plan.md")).toBe("Projects/Roadmap");
		expect(getDocumentProjectRelativePath("Inbox/Note.md")).toBeNull();
	});

	it("generates unique file names when the requested path already exists", () => {
		const parentDir = mkdtempSync(join(tmpdir(), "buddywriter-unique-"));
		mkdirSync(join(parentDir, "Folder"), { recursive: true });
		writeFileSync(join(parentDir, "Note.md"), "");

		expect(ensureUniquePath(parentDir, "Note.md", "file")).toBe("Note 2.md");
		expect(ensureUniquePath(parentDir, "Folder", "directory")).toBe("Folder 2");
	});
});
