import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceDocument } from "../../shared/models/workspace";
import { useNoteInspectorController } from "./useNoteInspectorController";

afterEach(() => {
	cleanup();
});

function createActiveDocument(): WorkspaceDocument {
	return {
		content: "Plan",
		isArchived: false,
		labels: ["planning"],
		name: "Plan.md",
		parentRelativePath: "Projects/Roadmap",
		projectRelativePath: "Projects/Roadmap",
		relativePath: "Projects/Roadmap/Plan.md",
		title: "Plan",
	};
}

describe("useNoteInspectorController", () => {
	it("opens the inspector and uses escape to request discard for dirty drafts", async () => {
		const onArchiveDocument = vi.fn().mockResolvedValue(undefined);
		const onOpenDocument = vi.fn().mockResolvedValue(undefined);
		const onSaveDocumentMetadata = vi.fn().mockResolvedValue(undefined);
		const { result } = renderHook(() => useNoteInspectorController({
			activeDocument: createActiveDocument(),
			onArchiveDocument,
			onOpenDocument,
			onSaveDocumentMetadata,
		}));

		await act(async () => {
			await result.current.openInspectorForDocument("Projects/Roadmap/Plan.md");
		});

		expect(result.current.state.isOpen).toBe(true);

		act(() => {
			result.current.updateTitle("Plan Updated");
		});

		expect(result.current.state.isDirty).toBe(true);

		act(() => {
			expect(result.current.handleEscape()).toBe(true);
		});

		expect(result.current.state.discardIntent).toEqual({ kind: "closeInspector" });

		await act(async () => {
			await result.current.confirmDiscard();
		});

		expect(result.current.state.isOpen).toBe(false);
	});

	it("normalizes metadata into a single save call", async () => {
		const onArchiveDocument = vi.fn().mockResolvedValue(undefined);
		const onOpenDocument = vi.fn().mockResolvedValue(undefined);
		const onSaveDocumentMetadata = vi.fn().mockResolvedValue(undefined);
		const { result } = renderHook(() => useNoteInspectorController({
			activeDocument: createActiveDocument(),
			onArchiveDocument,
			onOpenDocument,
			onSaveDocumentMetadata,
		}));

		await act(async () => {
			await result.current.openInspectorForDocument("Projects/Roadmap/Plan.md");
		});

		act(() => {
			result.current.updateTitle("  Plan Updated  ");
			result.current.updateLabelsInput("roadmap, draft, roadmap");
			result.current.updateTargetParentRelativePath("Inbox");
		});

		await act(async () => {
			await result.current.saveDraft();
		});

		expect(onSaveDocumentMetadata).toHaveBeenCalledWith({
			relativePath: "Projects/Roadmap/Plan.md",
			title: "Plan Updated",
			labels: ["draft", "roadmap"],
			targetParentRelativePath: "Inbox",
		});
	});

	it("queues selection behind discard confirmation while dirty", async () => {
		const onArchiveDocument = vi.fn().mockResolvedValue(undefined);
		const onOpenDocument = vi.fn().mockResolvedValue(undefined);
		const onSaveDocumentMetadata = vi.fn().mockResolvedValue(undefined);
		const { result } = renderHook(() => useNoteInspectorController({
			activeDocument: createActiveDocument(),
			onArchiveDocument,
			onOpenDocument,
			onSaveDocumentMetadata,
		}));

		await act(async () => {
			await result.current.openInspectorForDocument("Projects/Roadmap/Plan.md");
		});

		act(() => {
			result.current.updateTitle("Plan Updated");
		});

		await act(async () => {
			await result.current.selectDocument("Inbox/Idea.md");
		});

		expect(onOpenDocument).not.toHaveBeenCalled();
		expect(result.current.state.discardIntent).toEqual({
			kind: "selectDocument",
			relativePath: "Inbox/Idea.md",
			reopenInspector: true,
		});

		await act(async () => {
			await result.current.confirmDiscard();
		});

		expect(onOpenDocument).toHaveBeenCalledWith("Inbox/Idea.md");
	});
});
