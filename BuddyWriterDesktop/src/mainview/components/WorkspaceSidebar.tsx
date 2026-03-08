import type { WorkspaceDocument, WorkspaceTreeEntry } from "../../shared/models/workspace";
import {
	formatDirectoryOption,
	getPathLeaf,
	getSortedDirectoryEntries,
	parseLabelsInput,
} from "../utils/workspace";

type WorkspaceSidebarProps = {
	activeDocument: WorkspaceDocument | null;
	directoryOptions?: string[];
	onArchiveToggle: () => void;
	onCreateDocument: () => void;
	onCreateFolder: () => void;
	onLabelsSave: (labels: string[]) => void;
	onMoveDocument: (targetParentRelativePath: string) => void;
	onOpenDocument: (relativePath: string) => void;
	onRenameDocument: (nextTitle: string) => void;
	openNoteSettingsPath: string | null;
	setOpenNoteSettingsPath: (relativePath: string | null) => void;
	tree: WorkspaceTreeEntry[];
	workspacePath: string;
};

type WorkspaceTreeProps = WorkspaceSidebarProps;

function WorkspaceTree(props: WorkspaceTreeProps): React.ReactElement {
	const {
		activeDocument,
		directoryOptions = getSortedDirectoryEntries(props.tree),
		onArchiveToggle,
		onLabelsSave,
		onMoveDocument,
		onOpenDocument,
		onRenameDocument,
		openNoteSettingsPath,
		setOpenNoteSettingsPath,
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
								<WorkspaceTree {...props} directoryOptions={directoryOptions} tree={entry.children ?? []} />
							</div>
						</div>
					);
				}

				const settingsOpen = entry.relativePath === openNoteSettingsPath && activeDocument?.relativePath === entry.relativePath;
				return (
					<div key={entry.relativePath}>
						<div className={`workspace-tree__file-row ${entry.relativePath === openNoteSettingsPath ? "menu-open" : ""}`}>
							<button
								type="button"
								className={`workspace-tree__file ${entry.relativePath === activeDocument?.relativePath ? "active" : ""}`}
								onClick={() => {
									setOpenNoteSettingsPath(null);
									onOpenDocument(entry.relativePath);
								}}
							>
								<span className="workspace-tree__icon">MD</span>
								<span className="workspace-tree__file-label">{entry.name.replace(/\.md$/i, "")}</span>
							</button>
							<button
								type="button"
								className="workspace-tree__file-menu"
								aria-label={`Note settings for ${entry.name.replace(/\.md$/i, "")}`}
								onClick={() => {
									if (openNoteSettingsPath === entry.relativePath) {
										setOpenNoteSettingsPath(null);
										return;
									}
									setOpenNoteSettingsPath(entry.relativePath);
									onOpenDocument(entry.relativePath);
								}}
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
									<circle cx="12" cy="12" r="3" />
									<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
								</svg>
							</button>
						</div>
						{settingsOpen ? (
							<div className="workspace-tree__file-settings">
								<input
									type="text"
									defaultValue={activeDocument?.title}
									placeholder="Untitled"
									spellCheck={false}
									onBlur={(event) => {
										onRenameDocument(event.currentTarget.value);
									}}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											onRenameDocument(event.currentTarget.value);
										}
									}}
								/>
								<input
									type="text"
									defaultValue={activeDocument?.labels.join(", ")}
									placeholder="Labels: draft, ideas"
									spellCheck={false}
									onBlur={(event) => {
										onLabelsSave(parseLabelsInput(event.currentTarget.value));
									}}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											onLabelsSave(parseLabelsInput(event.currentTarget.value));
										}
									}}
								/>
								<div className="workspace-tree__file-settings-row">
									<select
										defaultValue={activeDocument?.parentRelativePath || directoryOptions[0] || ""}
										onChange={(event) => {
											onMoveDocument(event.currentTarget.value);
										}}
									>
										{directoryOptions.map((relativePath) => (
											<option key={relativePath} value={relativePath}>
												{formatDirectoryOption(relativePath)}
											</option>
										))}
									</select>
									<button type="button" onClick={(event) => {
										const select = event.currentTarget.parentElement?.querySelector("select");
										if (select instanceof HTMLSelectElement) {
											onMoveDocument(select.value);
										}
									}}
									>
										Move
									</button>
								</div>
								<button type="button" onClick={onArchiveToggle}>
									{activeDocument?.isArchived ? "Unarchive" : "Archive"}
								</button>
							</div>
						) : null}
					</div>
				);
			})}
		</>
	);
}

export function WorkspaceSidebar(props: WorkspaceSidebarProps): React.ReactElement {
	const {
		onCreateDocument,
		onCreateFolder,
		tree,
		workspacePath,
	} = props;
	const directoryOptions = getSortedDirectoryEntries(tree);

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
			<div className="workspace-tree">
				{tree.length === 0 ? (
					<div className="workspace-tree__empty">No notes yet. Create one from the sidebar.</div>
				) : (
					<WorkspaceTree {...props} directoryOptions={directoryOptions} />
				)}
			</div>
		</aside>
	);
}
