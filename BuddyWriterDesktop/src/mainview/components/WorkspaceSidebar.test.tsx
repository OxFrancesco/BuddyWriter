import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceDocument, WorkspaceTreeEntry } from "../../shared/models/workspace";
import { WorkspaceSidebar, type SaveDocumentMetadataParams } from "./WorkspaceSidebar";

afterEach(() => {
	cleanup();
});

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
				{
					kind: "file",
					name: "Untitled.md",
					relativePath: "Inbox/Untitled.md",
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

function createDocuments(): Record<string, WorkspaceDocument> {
	return {
		"Inbox/Idea.md": {
			content: "Idea",
			isArchived: false,
			labels: ["draft"],
			name: "Idea.md",
			parentRelativePath: "Inbox",
			projectRelativePath: null,
			relativePath: "Inbox/Idea.md",
			title: "Idea",
		},
		"Inbox/Untitled.md": {
			content: "Untitled",
			isArchived: false,
			labels: [],
			name: "Untitled.md",
			parentRelativePath: "Inbox",
			projectRelativePath: null,
			relativePath: "Inbox/Untitled.md",
			title: "Untitled",
		},
		"Projects/Roadmap/Plan.md": {
			content: "Plan",
			isArchived: false,
			labels: ["planning"],
			name: "Plan.md",
			parentRelativePath: "Projects/Roadmap",
			projectRelativePath: "Projects/Roadmap",
			relativePath: "Projects/Roadmap/Plan.md",
			title: "Plan",
		},
	};
}

function renderSidebar(overrides?: Partial<React.ComponentProps<typeof WorkspaceSidebar>>) {
	return render(
		<WorkspaceSidebar
			activeDocument={createDocuments()["Projects/Roadmap/Plan.md"]}
			onArchiveDocument={vi.fn().mockResolvedValue(undefined)}
			onCreateDocument={vi.fn()}
			onCreateFolder={vi.fn()}
			onOpenDocument={vi.fn().mockResolvedValue(undefined)}
			onSaveDocumentMetadata={vi.fn().mockResolvedValue(undefined)}
			tree={createTree()}
			workspacePath="/tmp/BuddyWriter"
			{...overrides}
		/>
	);
}

function WorkspaceSidebarHarness(props: {
	initialActivePath?: string;
	onArchiveDocumentSpy?: (params: { relativePath: string; archived: boolean }) => void;
	onOpenDocumentSpy?: (relativePath: string) => void;
	onSaveDocumentMetadataSpy?: (params: SaveDocumentMetadataParams) => void;
}) {
	const {
		initialActivePath = "Projects/Roadmap/Plan.md",
		onArchiveDocumentSpy = vi.fn(),
		onOpenDocumentSpy = vi.fn(),
		onSaveDocumentMetadataSpy = vi.fn(),
	} = props;
	const [documents, setDocuments] = useState(createDocuments());
	const [activePath, setActivePath] = useState(initialActivePath);

	return (
		<WorkspaceSidebar
			activeDocument={documents[activePath] ?? null}
			onArchiveDocument={async (params) => {
				onArchiveDocumentSpy(params);
				const currentDocument = documents[params.relativePath];
				if (!currentDocument) return;

				const nextRelativePath = params.archived
					? `Archive/${currentDocument.name}`
					: `Inbox/${currentDocument.name}`;
				const nextDocument: WorkspaceDocument = {
					...currentDocument,
					isArchived: params.archived,
					parentRelativePath: params.archived ? "Archive" : "Inbox",
					projectRelativePath: params.archived ? null : currentDocument.projectRelativePath,
					relativePath: nextRelativePath,
				};
				setDocuments((previousDocuments) => ({
					...previousDocuments,
					[nextRelativePath]: nextDocument,
				}));
				setActivePath(nextRelativePath);
			}}
			onCreateDocument={vi.fn()}
			onCreateFolder={vi.fn()}
			onOpenDocument={async (relativePath) => {
				onOpenDocumentSpy(relativePath);
				setActivePath(relativePath);
			}}
			onSaveDocumentMetadata={async (params) => {
				onSaveDocumentMetadataSpy(params);
				const currentDocument = documents[params.relativePath];
				if (!currentDocument) return;

				const title = params.title.trim();
				const nextName = `${title}.md`;
				const nextRelativePath = `${params.targetParentRelativePath}/${nextName}`;
				const nextDocument: WorkspaceDocument = {
					...currentDocument,
					labels: params.labels,
					name: nextName,
					parentRelativePath: params.targetParentRelativePath,
					projectRelativePath: params.targetParentRelativePath.startsWith("Projects")
						? params.targetParentRelativePath
						: null,
					relativePath: nextRelativePath,
					title,
				};
				setDocuments((previousDocuments) => ({
					...previousDocuments,
					[nextRelativePath]: nextDocument,
				}));
				setActivePath(nextRelativePath);
			}}
			tree={createTree()}
			workspacePath="/tmp/BuddyWriter"
		/>
	);
}

describe("WorkspaceSidebar", () => {
	it("opens a docked inspector for the active note and excludes Archive from folder options", () => {
		renderSidebar();

		fireEvent.click(screen.getByRole("button", { name: "Note settings for Plan" }));

		expect(screen.getByText("Note Settings")).not.toBeNull();
		const options = screen.getAllByRole("option").map((option) => option.textContent);
		expect(options).toEqual([
			"Inbox",
			"Projects",
			"Project: Roadmap",
		]);
	});

	it("shows discard confirmation before switching notes when the inspector is dirty", () => {
		const onOpenDocument = vi.fn().mockResolvedValue(undefined);
		renderSidebar({ onOpenDocument });

		fireEvent.click(screen.getByRole("button", { name: "Note settings for Plan" }));
		fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Plan Updated" } });
		fireEvent.click(screen.getByRole("button", { name: "Open note Idea" }));

		expect(onOpenDocument).not.toHaveBeenCalled();
		expect(screen.getByText(/Discard them before continuing/i)).not.toBeNull();
	});

	it("keeps the inspector open and rebinds to the next active note when switching cleanly", async () => {
		render(<WorkspaceSidebarHarness />);

		fireEvent.click(screen.getByRole("button", { name: "Note settings for Plan" }));
		expect(screen.getByDisplayValue("Plan")).not.toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Open note Idea" }));

		await waitFor(() => {
			expect(screen.getByDisplayValue("Idea")).not.toBeNull();
		});
		expect(screen.getByText("Inbox/Idea.md")).not.toBeNull();
	});

	it("does not close the inspector on outside click", () => {
		renderSidebar();

		fireEvent.click(screen.getByRole("button", { name: "Note settings for Plan" }));
		fireEvent.click(document.body);

		expect(screen.getByText("Note Settings")).not.toBeNull();
	});

	it("saves metadata in a single call", async () => {
		const onSaveDocumentMetadata = vi.fn().mockResolvedValue(undefined);
		renderSidebar({ onSaveDocumentMetadata });

		fireEvent.click(screen.getByRole("button", { name: "Note settings for Plan" }));
		fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Plan Updated" } });
		fireEvent.change(screen.getByLabelText("Labels"), { target: { value: "roadmap, draft, roadmap" } });
		fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "Inbox" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => {
			expect(onSaveDocumentMetadata).toHaveBeenCalledWith({
				relativePath: "Projects/Roadmap/Plan.md",
				title: "Plan Updated",
				labels: ["draft", "roadmap"],
				targetParentRelativePath: "Inbox",
			});
		});
		expect(onSaveDocumentMetadata).toHaveBeenCalledTimes(1);
	});
});
