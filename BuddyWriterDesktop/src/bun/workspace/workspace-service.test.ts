import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import matter from "gray-matter";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
	createWorkspaceService,
	ensureUniquePath,
	getDocumentProjectRelativePath,
	isArchivedDocumentPath,
	normalizeWorkspaceDocumentLabels,
	resolveWorkspaceRelativePath,
	workspaceRelativePath,
} from "./workspace-service";
import type { SettingsRepository } from "../services/settings-repository";

describe("workspace-service helpers", () => {
	it("rejects path traversal outside the workspace", () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "buddywriter-workspace-"));

		expect(() => resolveWorkspaceRelativePath(workspacePath, "../outside.md")).toThrow("outside the current workspace");
		expect(() => workspaceRelativePath(workspacePath, join(workspacePath, "../outside.md"))).toThrow("outside the current workspace");
	});

	it("normalizes workspace document labels", () => {
		expect(normalizeWorkspaceDocumentLabels([" draft ", "Ideas", "draft", "in progress "])).toEqual([
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

function createTestWorkspaceService(workspacePath: string) {
	const settings = { workspacePath };
	const settingsRepository = {
		getSettings: () => settings,
		normalizeWorkspaceRootPath: (path?: string) => path ?? workspacePath,
		saveSettingsToDisk: () => {},
	} as unknown as SettingsRepository;

	return createWorkspaceService({ settingsRepository });
}

function readDocumentFile(workspacePath: string, relativePath: string) {
	return matter(readFileSync(join(workspacePath, relativePath), "utf-8"));
}

describe("createWorkspaceService", () => {
	it("does not recreate Inbox/Untitled.md after the note is renamed", () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "buddywriter-workspace-"));
		const workspaceService = createTestWorkspaceService(workspacePath);

		workspaceService.createWorkspaceDocument();
		const state = workspaceService.renameWorkspaceDocument("Inbox/Untitled.md", "Renamed");

		expect(existsSync(join(workspacePath, "Inbox", "Untitled.md"))).toBe(false);
		expect(existsSync(join(workspacePath, "Inbox", "Renamed.md"))).toBe(true);
		expect(state.tree).toEqual([
			{
				kind: "directory",
				name: "Archive",
				relativePath: "Archive",
				children: [],
			},
			{
				kind: "directory",
				name: "Inbox",
				relativePath: "Inbox",
				children: [
					{
						kind: "file",
						name: "Renamed.md",
						relativePath: "Inbox/Renamed.md",
					},
				],
			},
			{
				kind: "directory",
				name: "Projects",
				relativePath: "Projects",
				children: [],
			},
		]);
		expect(state.activeDocument?.relativePath).toBe("Inbox/Renamed.md");
		expect(readDocumentFile(workspacePath, "Inbox/Renamed.md")).toMatchObject({
			content: "\n",
			data: {
				title: "Renamed",
			},
		});
	});

	it("does not recreate Inbox/Untitled.md after the note is removed", () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "buddywriter-workspace-"));
		const workspaceService = createTestWorkspaceService(workspacePath);

		workspaceService.createWorkspaceDocument();
		rmSync(join(workspacePath, "Inbox", "Untitled.md"));

		const state = workspaceService.getWorkspaceState(workspacePath);

		expect(existsSync(join(workspacePath, "Inbox", "Untitled.md"))).toBe(false);
		expect(state.activeDocument).toBeNull();
		expect(state.tree).toEqual([
			{
				kind: "directory",
				name: "Archive",
				relativePath: "Archive",
				children: [],
			},
			{
				kind: "directory",
				name: "Inbox",
				relativePath: "Inbox",
				children: [],
			},
			{
				kind: "directory",
				name: "Projects",
				relativePath: "Projects",
				children: [],
			},
		]);
		expect(workspaceService.readWorkspaceMetadata(workspacePath).lastOpenDocument).toBeNull();
	});

	it("updates document metadata through a single rename, move, and label operation", () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "buddywriter-workspace-"));
		const workspaceService = createTestWorkspaceService(workspacePath);

		workspaceService.createWorkspaceDocument();
		workspaceService.createWorkspaceFolder("Projects", "Roadmap");

		const state = workspaceService.updateWorkspaceDocumentMetadata(
			"Inbox/Untitled.md",
			"Product Plan",
			[" draft ", "planning", "draft"],
			"Projects/Roadmap",
		);

		expect(existsSync(join(workspacePath, "Inbox", "Untitled.md"))).toBe(false);
		expect(existsSync(join(workspacePath, "Projects", "Roadmap", "Product Plan.md"))).toBe(true);
		expect(state.activeDocument).toMatchObject({
			relativePath: "Projects/Roadmap/Product Plan.md",
			title: "Product Plan",
			parentRelativePath: "Projects/Roadmap",
			projectRelativePath: "Projects/Roadmap",
			labels: ["draft", "planning"],
		});
		expect(readDocumentFile(workspacePath, "Projects/Roadmap/Product Plan.md")).toMatchObject({
			content: "\n",
			data: {
				title: "Product Plan",
				labels: ["draft", "planning"],
			},
		});
		expect(workspaceService.readWorkspaceMetadata(workspacePath)).toEqual({
			lastOpenDocument: "Projects/Roadmap/Product Plan.md",
			documents: {},
		});
	});

	it("updates labels in place when the document path does not change", () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "buddywriter-workspace-"));
		const workspaceService = createTestWorkspaceService(workspacePath);

		workspaceService.createWorkspaceDocument();

		const state = workspaceService.updateWorkspaceDocumentMetadata(
			"Inbox/Untitled.md",
			"Untitled",
			[" ideas ", "ideas", "draft"],
			"Inbox",
		);

		expect(state.activeDocument).toMatchObject({
			relativePath: "Inbox/Untitled.md",
			title: "Untitled",
			parentRelativePath: "Inbox",
			labels: ["draft", "ideas"],
		});
		expect(readDocumentFile(workspacePath, "Inbox/Untitled.md")).toMatchObject({
			content: "\n",
			data: {
				title: "Untitled",
				labels: ["draft", "ideas"],
			},
		});
		expect(workspaceService.readWorkspaceMetadata(workspacePath)).toEqual({
			lastOpenDocument: "Inbox/Untitled.md",
			documents: {},
		});
	});

	it("preserves front matter while saving document content", () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "buddywriter-workspace-"));
		const workspaceService = createTestWorkspaceService(workspacePath);

		workspaceService.createWorkspaceDocument(undefined, "Plan");
		workspaceService.updateWorkspaceDocumentMetadata("Inbox/Plan.md", "Plan", ["Draft", "planning"], "Inbox");

		workspaceService.saveWorkspaceDocument("Inbox/Plan.md", "# Draft\n\nBody copy");

		expect(readDocumentFile(workspacePath, "Inbox/Plan.md")).toMatchObject({
			content: "# Draft\n\nBody copy\n",
			data: {
				title: "Plan",
				labels: ["draft", "planning"],
			},
		});
	});

	it("migrates legacy workspace labels into document front matter", () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "buddywriter-workspace-"));
		const workspaceService = createTestWorkspaceService(workspacePath);

		mkdirSync(join(workspacePath, "Inbox"), { recursive: true });
		mkdirSync(join(workspacePath, ".buddywriter"), { recursive: true });
		writeFileSync(join(workspacePath, "Inbox", "Legacy.md"), "Legacy body", "utf-8");
		writeFileSync(join(workspacePath, ".buddywriter", "workspace.json"), JSON.stringify({
			lastOpenDocument: "Inbox/Legacy.md",
			documents: {
				"Inbox/Legacy.md": {
					labels: ["Draft", "ideas"],
				},
			},
		}, null, 2));

		const state = workspaceService.getWorkspaceState(workspacePath);

		expect(state.activeDocument).toMatchObject({
			relativePath: "Inbox/Legacy.md",
			title: "Legacy",
			labels: ["draft", "ideas"],
			content: "Legacy body\n",
		});
		expect(readDocumentFile(workspacePath, "Inbox/Legacy.md")).toMatchObject({
			content: "Legacy body\n",
			data: {
				title: "Legacy",
				labels: ["draft", "ideas"],
			},
		});
		expect(workspaceService.readWorkspaceMetadata(workspacePath)).toEqual({
			lastOpenDocument: "Inbox/Legacy.md",
			documents: {},
		});
	});

	it("deletes the target note and clears stale metadata", () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "buddywriter-workspace-"));
		const workspaceService = createTestWorkspaceService(workspacePath);

		workspaceService.createWorkspaceDocument(undefined, "First");
		workspaceService.createWorkspaceDocument(undefined, "Second");
		workspaceService.setWorkspaceDocumentLabels("Inbox/Second.md", ["draft"]);
		workspaceService.openWorkspaceDocument("Inbox/Second.md");

		const state = workspaceService.deleteWorkspaceDocument("Inbox/Second.md");

		expect(existsSync(join(workspacePath, "Inbox", "Second.md"))).toBe(false);
		expect(state.activeDocument?.relativePath).toBe("Inbox/First.md");
		expect(workspaceService.readWorkspaceMetadata(workspacePath)).toEqual({
			lastOpenDocument: "Inbox/First.md",
			documents: {},
		});
	});
});
