import { describe, expect, it } from "vitest";
import { shouldIgnoreWorkspaceWatcherPath } from "./workspace-watcher";

describe("shouldIgnoreWorkspaceWatcherPath", () => {
	it("ignores BuddyWriter metadata paths", () => {
		expect(shouldIgnoreWorkspaceWatcherPath(".buddywriter")).toBe(true);
		expect(shouldIgnoreWorkspaceWatcherPath(".buddywriter/workspace.json")).toBe(true);
		expect(shouldIgnoreWorkspaceWatcherPath(".buddywriter\\workspace.json")).toBe(true);
	});

	it("ignores temporary file writes", () => {
		expect(shouldIgnoreWorkspaceWatcherPath("Inbox/Note.md.tmp-12345")).toBe(true);
	});

	it("keeps normal document changes visible", () => {
		expect(shouldIgnoreWorkspaceWatcherPath("Inbox/Note.md")).toBe(false);
		expect(shouldIgnoreWorkspaceWatcherPath("Projects/Roadmap/Plan.md")).toBe(false);
	});
});
