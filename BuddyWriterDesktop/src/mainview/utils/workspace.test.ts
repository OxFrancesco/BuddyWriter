import { describe, expect, it } from "vitest";
import { formatDirectoryOption, getParentRelativePath, getSortedDirectoryEntries, parseLabelsInput } from "./workspace";

describe("workspace utils", () => {
	it("normalizes labels by trimming, deduplicating, and sorting", () => {
		expect(parseLabelsInput(" draft,Ideas, draft ,  in progress  ,ideas ")).toEqual([
			"draft",
			"Ideas",
			"ideas",
			"in progress",
		]);
	});

	it("returns the parent relative path for documents", () => {
		expect(getParentRelativePath("Projects/Roadmap/Plan.md")).toBe("Projects/Roadmap");
		expect(getParentRelativePath("Inbox/Note.md")).toBe("Inbox");
		expect(getParentRelativePath("")).toBe("");
	});

	it("sorts workspace directories with the preferred root order", () => {
		const entries = [
			{
				kind: "directory" as const,
				name: "Archive",
				relativePath: "Archive",
				children: [],
			},
			{
				kind: "directory" as const,
				name: "Projects",
				relativePath: "Projects",
				children: [
					{
						kind: "directory" as const,
						name: "Roadmap",
						relativePath: "Projects/Roadmap",
						children: [],
					},
				],
			},
			{
				kind: "directory" as const,
				name: "Inbox",
				relativePath: "Inbox",
				children: [],
			},
		];

		expect(getSortedDirectoryEntries(entries)).toEqual([
			"Inbox",
			"Projects",
			"Archive",
			"Projects/Roadmap",
		]);
	});

	it("formats project directories for move targets", () => {
		expect(formatDirectoryOption("Projects")).toBe("Projects");
		expect(formatDirectoryOption("Projects/Roadmap")).toBe("Project: Roadmap");
	});
});
