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
});
