import type { WorkspaceDocument } from "../../shared/models/workspace";
import { formatDirectoryOption } from "../utils/workspace";
import type { NoteInspectorDraft } from "../hooks/useNoteInspectorController";

type SidebarNoteInspectorProps = {
	activeDocument: WorkspaceDocument;
	canSave: boolean;
	directoryOptions: string[];
	draft: NoteInspectorDraft;
	isDirty: boolean;
	isSaving: boolean;
	onArchiveToggle: () => void;
	onCancel: () => void;
	onClose: () => void;
	onConfirmDiscard: () => void;
	onDismissDiscard: () => void;
	onFolderChange: (value: string) => void;
	onLabelsChange: (value: string) => void;
	onSave: () => void;
	onTitleChange: (value: string) => void;
	showDiscardConfirm: boolean;
};

export function SidebarNoteInspector(props: SidebarNoteInspectorProps): React.ReactElement {
	const {
		activeDocument,
		canSave,
		directoryOptions,
		draft,
		isDirty,
		isSaving,
		onArchiveToggle,
		onCancel,
		onClose,
		onConfirmDiscard,
		onDismissDiscard,
		onFolderChange,
		onLabelsChange,
		onSave,
		onTitleChange,
		showDiscardConfirm,
	} = props;

	return (
		<section className="workspace-note-inspector" aria-label="Note settings inspector">
			<div className="workspace-note-inspector__header">
				<div className="workspace-note-inspector__heading">
					<div className="workspace-note-inspector__eyebrow">Note Settings</div>
					<div className="workspace-note-inspector__path">{activeDocument.relativePath}</div>
				</div>
				<button
					type="button"
					className="workspace-note-inspector__close"
					aria-label="Close note settings"
					disabled={isSaving}
					onClick={onClose}
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
						<path d="M18 6 6 18" />
						<path d="m6 6 12 12" />
					</svg>
				</button>
			</div>

			<form
				className="workspace-note-inspector__form"
				onSubmit={(event) => {
					event.preventDefault();
					void onSave();
				}}
			>
				<label className="workspace-note-inspector__field">
					<span className="workspace-note-inspector__label">Title</span>
					<input
						type="text"
						value={draft.title}
						placeholder="Untitled"
						spellCheck={false}
						disabled={isSaving}
						onChange={(event) => {
							onTitleChange(event.currentTarget.value);
						}}
					/>
				</label>

				<label className="workspace-note-inspector__field">
					<span className="workspace-note-inspector__label">Labels</span>
					<input
						type="text"
						value={draft.labelsInput}
						placeholder="draft, ideas"
						spellCheck={false}
						disabled={isSaving}
						onChange={(event) => {
							onLabelsChange(event.currentTarget.value);
						}}
					/>
				</label>

				{activeDocument.isArchived ? null : (
					<label className="workspace-note-inspector__field">
						<span className="workspace-note-inspector__label">Folder</span>
						<select
							value={draft.targetParentRelativePath}
							disabled={isSaving}
							onChange={(event) => {
								onFolderChange(event.currentTarget.value);
							}}
						>
							{directoryOptions.map((relativePath) => (
								<option key={relativePath} value={relativePath}>
									{formatDirectoryOption(relativePath)}
								</option>
							))}
						</select>
					</label>
				)}

				<div className="workspace-note-inspector__actions">
					<button type="submit" className="workspace-note-inspector__button primary" disabled={!canSave}>
						{isSaving ? "Saving..." : "Save"}
					</button>
					<button type="button" className="workspace-note-inspector__button" disabled={isSaving || !isDirty} onClick={onCancel}>
						Cancel
					</button>
				</div>
			</form>

			{showDiscardConfirm ? (
				<div className="workspace-note-inspector__discard">
					<p className="workspace-note-inspector__discard-text">You have unsaved note settings. Discard them before continuing?</p>
					<div className="workspace-note-inspector__discard-actions">
						<button type="button" className="workspace-note-inspector__button" disabled={isSaving} onClick={onDismissDiscard}>
							Keep editing
						</button>
						<button type="button" className="workspace-note-inspector__button danger" disabled={isSaving} onClick={() => {
							void onConfirmDiscard();
						}}
						>
							Discard changes
						</button>
					</div>
				</div>
			) : null}

			<div className="workspace-note-inspector__archive">
				<div className="workspace-note-inspector__archive-copy">
					<div className="workspace-note-inspector__label">{activeDocument.isArchived ? "Archived note" : "Archive"}</div>
					<p className="workspace-note-inspector__hint">
						{activeDocument.isArchived
							? "Restore this note back into Inbox."
							: "Move this note into Archive without changing the draft in the editor."}
					</p>
				</div>
				<button
					type="button"
					className={`workspace-note-inspector__button ${activeDocument.isArchived ? "" : "danger"}`}
					disabled={isSaving}
					onClick={() => {
						void onArchiveToggle();
					}}
				>
					{activeDocument.isArchived ? "Restore to Inbox" : "Archive note"}
				</button>
			</div>
		</section>
	);
}
