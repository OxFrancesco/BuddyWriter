export type WorkspaceTreeEntry = {
	kind: "file" | "directory";
	name: string;
	relativePath: string;
	children?: WorkspaceTreeEntry[];
};

export type WorkspaceDocumentMetadata = {
	labels: string[];
};

export type WorkspaceMetadata = {
	lastOpenDocument: string | null;
	documents: Record<string, WorkspaceDocumentMetadata>;
};

export type WorkspaceDocument = {
	relativePath: string;
	name: string;
	title: string;
	content: string;
	labels: string[];
	parentRelativePath: string;
	isArchived: boolean;
	projectRelativePath: string | null;
};

export type WorkspaceState = {
	workspacePath: string;
	tree: WorkspaceTreeEntry[];
	activeDocument: WorkspaceDocument | null;
};
