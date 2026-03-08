import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceTreeEntry } from "../../shared/models/workspace";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

function createTree(): WorkspaceTreeEntry[] {
	return [
		{
			kind: "directory",
			name: "Inbox",
			relativePath: "Inbox",
			children: [
				{
					kind: "file",
					name: "Idea.md",
					relativePath: "Inbox/Idea.md",
				},
			],
		},
		{
			kind: "directory",
			name: "Projects",
			relativePath: "Projects",
			children: [
				{
					kind: "directory",
					name: "Roadmap",
					relativePath: "Projects/Roadmap",
					children: [
						{
							kind: "file",
							name: "Plan.md",
							relativePath: "Projects/Roadmap/Plan.md",
						},
					],
				},
			],
		},
		{
			kind: "directory",
			name: "Archive",
			relativePath: "Archive",
			children: [],
		},
	];
}

describe("WorkspaceSidebar", () => {
	it("keeps root directory move targets visible for nested documents", () => {
		render(
			<WorkspaceSidebar
				activeDocument={{
					content: "Plan",
					isArchived: false,
					labels: ["planning"],
					name: "Plan.md",
					parentRelativePath: "Projects/Roadmap",
					projectRelativePath: "Projects/Roadmap",
					relativePath: "Projects/Roadmap/Plan.md",
					title: "Plan",
				}}
				onArchiveToggle={vi.fn()}
				onCreateDocument={vi.fn()}
				onCreateFolder={vi.fn()}
				onLabelsSave={vi.fn()}
				onMoveDocument={vi.fn()}
				onOpenDocument={vi.fn()}
				onRenameDocument={vi.fn()}
				openNoteSettingsPath="Projects/Roadmap/Plan.md"
				setOpenNoteSettingsPath={vi.fn()}
				tree={createTree()}
				workspacePath="/tmp/BuddyWriter"
			/>
		);

		const options = screen.getAllByRole("option").map((option) => option.textContent);
		expect(options).toEqual([
			"Inbox",
			"Projects",
			"Archive",
			"Project: Roadmap",
		]);
	});
});
