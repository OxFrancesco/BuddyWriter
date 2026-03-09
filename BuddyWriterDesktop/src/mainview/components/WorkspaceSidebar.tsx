import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
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
	runWithNoteSettingsGuard: (task: () => Promise<void>) => Promise<void>;
};

type WorkspaceSidebarProps = {
	activeDocument: WorkspaceDocument | null;
	onArchiveDocument: (params: ArchiveDocumentParams) => Promise<void>;
	onCreateDocument: () => void;
	onCreateFolder: () => void;
	onDeleteDocument: (relativePath: string) => Promise<void>;
	onOpenDocument: (relativePath: string) => Promise<void>;
	onSaveDocumentMetadata: (params: SaveDocumentMetadataParams) => Promise<void>;
	tree: WorkspaceTreeEntry[];
	workspacePath: string;
};

type WorkspaceTreeProps = {
	activeDocumentRelativePath: string | null;
	inspectorDocumentRelativePath: string | null;
	onArchiveDocument: (relativePath: string, archived: boolean) => Promise<void>;
	onDeleteDocument: (relativePath: string) => Promise<void>;
	onOpenInspector: (relativePath: string) => Promise<void>;
	onSelectDocument: (relativePath: string) => Promise<void>;
	tree: WorkspaceTreeEntry[];
};

function isArchivedDocumentRelativePath(relativePath: string): boolean {
	return relativePath === "Archive" || relativePath.startsWith("Archive/");
}

function FolderIcon(): React.ReactElement {
	return (
		<svg className="workspace-tree__icon-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M2 4.5V12a1 1 0 001 1h10a1 1 0 001-1V6a1 1 0 00-1-1H8L6.5 3.5H3A1 1 0 002 4.5z" />
		</svg>
	);
}

function FileIcon(): React.ReactElement {
	return (
		<svg className="workspace-tree__icon-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M9 1.5H4a1 1 0 00-1 1v11a1 1 0 001 1h8a1 1 0 001-1V5.5L9 1.5z" />
			<path d="M9 1.5V5.5h4" />
		</svg>
	);
}

function WorkspaceTree(props: WorkspaceTreeProps): React.ReactElement {
	const {
		activeDocumentRelativePath,
		inspectorDocumentRelativePath,
		onArchiveDocument,
		onDeleteDocument,
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
								<FolderIcon />
								<span>{entry.name}</span>
							</div>
							<div className="workspace-tree__children">
								<WorkspaceTree
									activeDocumentRelativePath={activeDocumentRelativePath}
									inspectorDocumentRelativePath={inspectorDocumentRelativePath}
									onArchiveDocument={onArchiveDocument}
									onDeleteDocument={onDeleteDocument}
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
				const isArchived = isArchivedDocumentRelativePath(entry.relativePath);

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
								<FileIcon />
								<span className="workspace-tree__file-label">{entry.name.replace(/\.md$/i, "")}</span>
							</button>
							<div className="workspace-tree__file-actions">
								<button
									type="button"
									className="workspace-tree__file-action"
									aria-label={`Move note ${entry.name.replace(/\.md$/i, "")}`}
									onClick={() => {
										void onOpenInspector(entry.relativePath);
									}}
								>
									<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
										<path d="M6 3L2 8l4 5" />
										<path d="M2 8h9a3 3 0 010 6H9" />
									</svg>
								</button>
								<button
									type="button"
									className="workspace-tree__file-action"
									aria-label={`${isArchived ? "Restore" : "Archive"} note ${entry.name.replace(/\.md$/i, "")}`}
									onClick={() => {
										void onArchiveDocument(entry.relativePath, !isArchived);
									}}
								>
									<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
										{isArchived ? (
											<>
												<path d="M2 5h12v8a1 1 0 01-1 1H3a1 1 0 01-1-1V5z" />
												<path d="M1 2.5h14v2.5H1z" />
												<path d="M8 8v4M6 10l2 2 2-2" />
											</>
										) : (
											<>
												<path d="M2 5h12v8a1 1 0 01-1 1H3a1 1 0 01-1-1V5z" />
												<path d="M1 2.5h14v2.5H1z" />
												<path d="M6 9h4" />
											</>
										)}
									</svg>
								</button>
								<button
									type="button"
									className="workspace-tree__file-action danger"
									aria-label={`Delete note ${entry.name.replace(/\.md$/i, "")}`}
									onClick={() => {
										void onDeleteDocument(entry.relativePath);
									}}
								>
									<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
										<path d="M3 4.5h10M6 4.5V3a1 1 0 011-1h2a1 1 0 011 1v1.5" />
										<path d="M4.5 4.5L5 13a1 1 0 001 1h4a1 1 0 001-1l.5-8.5" />
									</svg>
								</button>
							</div>
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
		onDeleteDocument,
		onOpenDocument,
		onSaveDocumentMetadata,
		tree,
		workspacePath,
	} = props;
	const [collapsed, setCollapsed] = useState(true);
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
		runWithNoteSettingsGuard: async (task) => {
			if (inspector.state.isDirty) {
				setCollapsed(false);
			}
			await inspector.runWithDirtyGuard(task);
		},
	}), [inspector.handleEscape, inspector.runWithDirtyGuard, inspector.state.isDirty]);

	return (
		<aside className={`workspace-sidebar ${collapsed ? "workspace-sidebar--collapsed" : ""}`}>
			<div className="workspace-sidebar__toggle-row">
				<button
					type="button"
					className="workspace-sidebar__toggle"
					aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
					onClick={() => setCollapsed((c) => !c)}
				>
					<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
						{collapsed ? (
							<>
								<line x1="2.5" y1="4" x2="13.5" y2="4" />
								<line x1="2.5" y1="8" x2="13.5" y2="8" />
								<line x1="2.5" y1="12" x2="13.5" y2="12" />
							</>
						) : (
							<>
								<line x1="3" y1="8" x2="10" y2="8" />
								<polyline points="6,5 3,8 6,11" />
							</>
						)}
					</svg>
				</button>
				{!collapsed && (
					<span className="workspace-sidebar__title">{getPathLeaf(workspacePath)}</span>
				)}
			</div>

			{!collapsed && (
				<>
					<div className="workspace-sidebar__actions">
						<button type="button" className="workspace-sidebar__action" onClick={onCreateDocument}>
							<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
								<path d="M8 3v10M3 8h10" />
							</svg>
							Note
						</button>
						<button type="button" className="workspace-sidebar__action" onClick={onCreateFolder}>
							<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
								<path d="M2 4.5V12a1 1 0 001 1h10a1 1 0 001-1V6a1 1 0 00-1-1H8L6.5 3.5H3A1 1 0 002 4.5z" />
								<path d="M8 7.5v3M6.5 9h3" />
							</svg>
							Folder
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
								onArchiveDocument={async (relativePath, archived) => {
									if (activeDocument?.relativePath === relativePath) {
										await inspector.handleArchiveToggle();
										return;
									}

									await onArchiveDocument({ relativePath, archived });
								}}
								onDeleteDocument={onDeleteDocument}
								onOpenInspector={inspector.openInspectorForDocument}
								onSelectDocument={inspector.selectDocument}
								tree={tree}
							/>
						)}
					</div>
				</>
			)}

			{collapsed && (
				<div className="workspace-sidebar__collapsed-actions">
					<button
						type="button"
						className="workspace-sidebar__collapsed-btn"
						aria-label="New Note"
						onClick={onCreateDocument}
					>
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
							<path d="M8 3v10M3 8h10" />
						</svg>
					</button>
					<button
						type="button"
						className="workspace-sidebar__collapsed-btn"
						aria-label="New Folder"
						onClick={onCreateFolder}
					>
						<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
							<path d="M2 4.5V12a1 1 0 001 1h10a1 1 0 001-1V6a1 1 0 00-1-1H8L6.5 3.5H3A1 1 0 002 4.5z" />
							<path d="M8 7.5v3M6.5 9h3" />
						</svg>
					</button>
				</div>
			)}
		</aside>
	);
});
