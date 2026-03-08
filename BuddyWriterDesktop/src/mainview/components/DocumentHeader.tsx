import type { WorkspaceDocument } from "../../shared/models/workspace";

type DocumentHeaderProps = {
	activeDocument: WorkspaceDocument | null;
	currentWorkspacePath: string;
	saveStatusLabel: string;
	saveStatusState: "saved" | "saving" | "unsaved";
};

export function DocumentHeader(props: DocumentHeaderProps): React.ReactElement {
	const { activeDocument, currentWorkspacePath, saveStatusLabel, saveStatusState } = props;

	return (
		<div className="document-header">
			<div className="document-header__text">
				<h1 className="document-title">{activeDocument?.title ?? "No document"}</h1>
				<div className="document-badges">
					{activeDocument?.projectRelativePath ? (
						<div className="document-badge project">
							{activeDocument.projectRelativePath === "Projects"
								? "Projects"
								: activeDocument.projectRelativePath.replace(/^Projects\//, "Project: ")}
						</div>
					) : null}
					{activeDocument?.isArchived ? (
						<div className="document-badge archive">Archived</div>
					) : null}
					{activeDocument?.labels.map((label) => (
						<div key={label} className="document-badge">
							{label}
						</div>
					))}
				</div>
				<div className="document-meta">{activeDocument?.relativePath ?? currentWorkspacePath}</div>
			</div>
			<div className={`save-status ${saveStatusState}`}>{saveStatusLabel}</div>
		</div>
	);
}
