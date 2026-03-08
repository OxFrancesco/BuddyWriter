import { forwardRef, useImperativeHandle, useMemo } from "react";
import type { WorkspaceDocument, WorkspaceTreeEntry } from "../../shared/models/workspace";
import { useNoteInspectorController } from "../hooks/useNoteInspectorController";
import { getPathLeaf, getSortedDirectoryEntries } from "../utils/workspace";
import { SidebarNoteInspector } from "./SidebarNoteInspector";

export type SaveDocumentMetadataParams = {
	relativePath: string;
	title: string;
	labels: string[];
	targetParentRelativePath: string;
};

type ArchiveDocumentParams = {
	relativePath: string;
	archived: boolean;
};

export type WorkspaceSidebarHandle = {
	handleEscape: () => boolean;
};

type WorkspaceSidebarProps = {
	activeDocument: WorkspaceDocument | null;
	onArchiveDocument: (params: ArchiveDocumentParams) => Promise<void>;
	onCreateDocument: () => void;
	onCreateFolder: () => void;
	onOpenDocument: (relativePath: string) => Promise<void>;
	onSaveDocumentMetadata: (params: SaveDocumentMetadataParams) => Promise<void>;
	tree: WorkspaceTreeEntry[];
	workspacePath: string;
};

type WorkspaceTreeProps = {
	activeDocumentRelativePath: string | null;
	inspectorDocumentRelativePath: string | null;
	onOpenInspector: (relativePath: string) => Promise<void>;
	onSelectDocument: (relativePath: string) => Promise<void>;
	tree: WorkspaceTreeEntry[];
};

function WorkspaceTree(props: WorkspaceTreeProps): React.ReactElement {
	const {
		activeDocumentRelativePath,
		inspectorDocumentRelativePath,
		onOpenInspector,
		onSelectDocument,
		tree,
	} = props;

	return (
		<>
			{tree.map((entry) => {
				if (entry.kind === "directory") {
					return (
						<div key={entry.relativePath} className="workspace-tree__group">
							<div className="workspace-tree__directory">
								<span className="workspace-tree__icon">DIR</span>
								<span>{entry.name}</span>
							</div>
							<div className="workspace-tree__children">
								<WorkspaceTree
									activeDocumentRelativePath={activeDocumentRelativePath}
									inspectorDocumentRelativePath={inspectorDocumentRelativePath}
									onOpenInspector={onOpenInspector}
									onSelectDocument={onSelectDocument}
									tree={entry.children ?? []}
								/>
							</div>
						</div>
					);
				}

				const isActive = entry.relativePath === activeDocumentRelativePath;
				const isInspectorOpen = entry.relativePath === inspectorDocumentRelativePath;

					return (
						<div key={entry.relativePath}>
							<div className={`workspace-tree__file-row ${isInspectorOpen ? "menu-open" : ""}`}>
								<button
									type="button"
									className={`workspace-tree__file ${isActive ? "active" : ""}`}
									aria-label={`Open note ${entry.name.replace(/\.md$/i, "")}`}
									onClick={() => {
										void onSelectDocument(entry.relativePath);
									}}
								>
									<span className="workspace-tree__icon">MD</span>
									<span className="workspace-tree__file-label">{entry.name.replace(/\.md$/i, "")}</span>
								</button>
								<button
								type="button"
								className="workspace-tree__file-menu"
								aria-label={`Note settings for ${entry.name.replace(/\.md$/i, "")}`}
								onMouseDown={(event) => {
									event.preventDefault();
								}}
								onClick={() => {
									void onOpenInspector(entry.relativePath);
								}}
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
									<circle cx="12" cy="12" r="3" />
									<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
								</svg>
							</button>
						</div>
					</div>
				);
			})}
		</>
	);
}

export const WorkspaceSidebar = forwardRef<WorkspaceSidebarHandle, WorkspaceSidebarProps>(function WorkspaceSidebar(props, ref) {
	const {
		activeDocument,
		onArchiveDocument,
		onCreateDocument,
		onCreateFolder,
		onOpenDocument,
		onSaveDocumentMetadata,
		tree,
		workspacePath,
	} = props;
	const directoryOptions = useMemo(
		() => getSortedDirectoryEntries(tree).filter((relativePath) => relativePath !== "Archive"),
		[tree],
	);
	const inspector = useNoteInspectorController({
		activeDocument,
		onArchiveDocument,
		onOpenDocument,
		onSaveDocumentMetadata,
	});

	useImperativeHandle(ref, () => ({
		handleEscape: inspector.handleEscape,
	}), [inspector.handleEscape]);

	return (
		<aside className="workspace-sidebar">
			<div className="workspace-sidebar__header">
				<div className="workspace-sidebar__eyebrow">Workspace</div>
				<div className="workspace-sidebar__name">{getPathLeaf(workspacePath)}</div>
				<div className="workspace-sidebar__path">{workspacePath}</div>
			</div>

			<div className="workspace-sidebar__actions">
				<button type="button" className="workspace-sidebar__action" onClick={onCreateDocument}>
					New Note
				</button>
				<button type="button" className="workspace-sidebar__action" onClick={onCreateFolder}>
					New Folder
				</button>
			</div>

			{activeDocument && inspector.state.isOpen && inspector.state.draft ? (
				<SidebarNoteInspector
					activeDocument={activeDocument}
					canSave={inspector.canSave}
					directoryOptions={directoryOptions}
					draft={inspector.state.draft}
					isDirty={inspector.state.isDirty}
					isSaving={inspector.state.isSaving}
					onArchiveToggle={inspector.handleArchiveToggle}
					onCancel={inspector.resetDraft}
					onClose={inspector.closeInspector}
					onConfirmDiscard={inspector.confirmDiscard}
					onDismissDiscard={inspector.dismissDiscard}
					onFolderChange={inspector.updateTargetParentRelativePath}
					onLabelsChange={inspector.updateLabelsInput}
					onSave={inspector.saveDraft}
					onTitleChange={inspector.updateTitle}
					showDiscardConfirm={Boolean(inspector.state.discardIntent)}
				/>
			) : null}

			<div className="workspace-tree">
				{tree.length === 0 ? (
					<div className="workspace-tree__empty">No notes yet. Create one from the sidebar.</div>
				) : (
					<WorkspaceTree
						activeDocumentRelativePath={activeDocument?.relativePath ?? null}
						inspectorDocumentRelativePath={inspector.inspectorDocumentRelativePath}
						onOpenInspector={inspector.openInspectorForDocument}
						onSelectDocument={inspector.selectDocument}
						tree={tree}
					/>
				)}
			</div>
		</aside>
	);
});
