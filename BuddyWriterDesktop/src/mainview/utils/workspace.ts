import type { WorkspaceTreeEntry } from "../../shared/models/workspace";

export function getPathLeaf(path: string): string {
	const parts = path.split(/[\\/]/).filter(Boolean);
	return parts[parts.length - 1] ?? path;
}

export function getParentRelativePath(path?: string | null): string {
	if (!path) return "";
	const parts = path.split("/").filter(Boolean);
	parts.pop();
	return parts.join("/");
}

export function parseLabelsInput(value: string): string[] {
	return Array.from(new Set(value
		.split(",")
		.map((label) => label.trim().replace(/\s+/g, " "))
		.filter(Boolean)))
		.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

export function getDirectoryEntries(entries: WorkspaceTreeEntry[], directories = new Set<string>()): Set<string> {
	for (const entry of entries) {
		if (entry.kind !== "directory") continue;
		directories.add(entry.relativePath);
		getDirectoryEntries(entry.children ?? [], directories);
	}
	return directories;
}

export function formatDirectoryOption(relativePath: string): string {
	if (relativePath === "Inbox") return "Inbox";
	if (relativePath === "Archive") return "Archive";
	if (relativePath === "Projects") return "Projects";
	if (relativePath.startsWith("Projects/")) {
		return `Project: ${relativePath.slice("Projects/".length)}`;
	}
	return relativePath || "Workspace";
}

export function getSortedDirectoryEntries(entries: WorkspaceTreeEntry[]): string[] {
	return Array.from(getDirectoryEntries(entries)).sort((left, right) => {
		const preferredOrder = ["Inbox", "Projects", "Archive"];
		const leftIndex = preferredOrder.indexOf(left);
		const rightIndex = preferredOrder.indexOf(right);
		if (leftIndex !== -1 || rightIndex !== -1) {
			return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
		}
		return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
	});
}
