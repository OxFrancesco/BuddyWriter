import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentHeader } from "./DocumentHeader";

describe("DocumentHeader", () => {
	it("starts editing the title on double click", () => {
		render(
			<DocumentHeader
				activeDocument={{
					content: "Plan",
					isArchived: false,
					labels: [],
					name: "Plan.md",
					parentRelativePath: "Inbox",
					projectRelativePath: null,
					relativePath: "Inbox/Plan.md",
					title: "Plan",
				}}
				currentWorkspacePath="/tmp/BuddyWriter"
				onRenameDocument={vi.fn()}
				saveStatusLabel="Saved"
				saveStatusState="saved"
			/>
		);

		fireEvent.doubleClick(screen.getByText("Plan"));

		expect(screen.getByDisplayValue("Plan")).not.toBeNull();
	});

	it("allows creating the first note from the title field", () => {
		const onRenameDocument = vi.fn();

		render(
			<DocumentHeader
				activeDocument={null}
				currentWorkspacePath="/tmp/BuddyWriter"
				onRenameDocument={onRenameDocument}
				saveStatusLabel="Saved"
				saveStatusState="saved"
			/>
		);

		fireEvent.doubleClick(screen.getByText("Untitled"));
		fireEvent.change(screen.getByPlaceholderText("Untitled"), {
			target: { value: "First Note" },
		});
		fireEvent.blur(screen.getByDisplayValue("First Note"));

		expect(onRenameDocument).toHaveBeenCalledWith("First Note");
	});
});
