import { useEffect, useState } from "react";
import type { WorkspaceDocument } from "../../shared/models/workspace";

type DocumentHeaderProps = {
	activeDocument: WorkspaceDocument | null;
	currentWorkspacePath: string;
	onRenameDocument: (nextTitle: string) => void;
	saveStatusLabel: string;
	saveStatusState: "saved" | "saving" | "unsaved";
};

function getDisplayedTitle(activeDocument: WorkspaceDocument | null): string {
	return activeDocument?.title ?? "Untitled";
}

export function DocumentHeader(props: DocumentHeaderProps): React.ReactElement {
	const { activeDocument, currentWorkspacePath, onRenameDocument, saveStatusLabel, saveStatusState } = props;
	const [isEditingTitle, setIsEditingTitle] = useState(false);
	const displayedTitle = getDisplayedTitle(activeDocument);
	const [titleDraft, setTitleDraft] = useState(displayedTitle);

	useEffect(() => {
		setIsEditingTitle(false);
		setTitleDraft(displayedTitle);
	}, [activeDocument?.relativePath, displayedTitle]);

	const commitTitleRename = () => {
		if (!activeDocument && titleDraft.trim() === displayedTitle) {
			setIsEditingTitle(false);
			return;
		}

		setIsEditingTitle(false);
		onRenameDocument(titleDraft);
	};

	return (
		<div className="document-header">
			<div className="document-header__text">
				{isEditingTitle ? (
					<input
						type="text"
						className="document-title-input"
						value={titleDraft}
						placeholder="Untitled"
						spellCheck={false}
						autoFocus
						onBlur={commitTitleRename}
						onChange={(event) => {
							setTitleDraft(event.currentTarget.value);
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								commitTitleRename();
								return;
							}
							if (event.key === "Escape") {
								event.preventDefault();
								setTitleDraft(displayedTitle);
								setIsEditingTitle(false);
							}
						}}
					/>
				) : (
					<h1
						className="document-title editable"
						onDoubleClick={() => {
							setTitleDraft(displayedTitle);
							setIsEditingTitle(true);
						}}
					>
						{displayedTitle}
					</h1>
				)}
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
