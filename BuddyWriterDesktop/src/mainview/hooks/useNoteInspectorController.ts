import { useEffect, useMemo, useReducer, useRef } from "react";
import type { WorkspaceDocument } from "../../shared/models/workspace";
import { normalizeDocumentTitle } from "../../shared/utils/note-metadata";
import { parseLabelsInput } from "../utils/workspace";
import { useEventCallback } from "./useEventCallback";

export type NoteInspectorDraft = {
	title: string;
	labelsInput: string;
	targetParentRelativePath: string;
};

export type DiscardIntent =
	| { kind: "closeInspector" }
	| { kind: "continueAction" }
	| { kind: "selectDocument"; relativePath: string; reopenInspector: boolean }
	| { kind: "openInspectorForDocument"; relativePath: string };

export type NoteInspectorState = {
	isOpen: boolean;
	draftRelativePath: string | null;
	draft: NoteInspectorDraft | null;
	cleanSnapshot: NoteInspectorDraft | null;
	isDirty: boolean;
	isSaving: boolean;
	discardIntent: DiscardIntent | null;
};

type NoteInspectorAction =
	| { type: "clear" }
	| { type: "syncFromDocument"; document: WorkspaceDocument }
	| { type: "openInspector" }
	| { type: "closeInspector" }
	| { type: "requestDiscard"; discardIntent: DiscardIntent }
	| { type: "dismissDiscard" }
	| { type: "updateDraft"; field: keyof NoteInspectorDraft; value: string }
	| { type: "resetDraft" }
	| { type: "discardChanges" }
	| { type: "discardAndClose" }
	| { type: "startSaving" }
	| { type: "finishSaving" };

type SaveDocumentMetadataParams = {
	relativePath: string;
	title: string;
	labels: string[];
	targetParentRelativePath: string;
};

type ArchiveDocumentParams = {
	relativePath: string;
	archived: boolean;
};

type UseNoteInspectorControllerOptions = {
	activeDocument: WorkspaceDocument | null;
	onArchiveDocument: (params: ArchiveDocumentParams) => Promise<void>;
	onOpenDocument: (relativePath: string) => Promise<void>;
	onSaveDocumentMetadata: (params: SaveDocumentMetadataParams) => Promise<void>;
};

type UseNoteInspectorControllerResult = {
	canSave: boolean;
	closeInspector: () => void;
	confirmDiscard: () => Promise<void>;
	dismissDiscard: () => void;
	handleArchiveToggle: () => Promise<void>;
	handleEscape: () => boolean;
	inspectorDocumentRelativePath: string | null;
	openInspectorForDocument: (relativePath: string) => Promise<void>;
	resetDraft: () => void;
	runWithDirtyGuard: (task: () => Promise<void>) => Promise<void>;
	saveDraft: () => Promise<void>;
	selectDocument: (relativePath: string) => Promise<void>;
	state: NoteInspectorState;
	updateLabelsInput: (value: string) => void;
	updateTargetParentRelativePath: (value: string) => void;
	updateTitle: (value: string) => void;
};

const initialState: NoteInspectorState = {
	isOpen: false,
	draftRelativePath: null,
	draft: null,
	cleanSnapshot: null,
	isDirty: false,
	isSaving: false,
	discardIntent: null,
};

function createDraft(document: WorkspaceDocument): NoteInspectorDraft {
	return {
		title: document.title,
		labelsInput: document.labels.join(", "),
		targetParentRelativePath: document.parentRelativePath,
	};
}

function normalizeDraft(draft: NoteInspectorDraft) {
	return {
		title: normalizeDocumentTitle(draft.title),
		labels: parseLabelsInput(draft.labelsInput),
		targetParentRelativePath: draft.targetParentRelativePath.trim(),
	};
}

function draftsEqual(left: NoteInspectorDraft | null, right: NoteInspectorDraft | null): boolean {
	if (!left || !right) return left === right;
	const normalizedLeft = normalizeDraft(left);
	const normalizedRight = normalizeDraft(right);

	return normalizedLeft.title === normalizedRight.title
		&& normalizedLeft.targetParentRelativePath === normalizedRight.targetParentRelativePath
		&& normalizedLeft.labels.length === normalizedRight.labels.length
		&& normalizedLeft.labels.every((label, index) => label === normalizedRight.labels[index]);
}

function noteInspectorReducer(state: NoteInspectorState, action: NoteInspectorAction): NoteInspectorState {
	switch (action.type) {
		case "clear":
			return initialState;
		case "syncFromDocument": {
			const nextDraft = createDraft(action.document);
			return {
				...state,
				draftRelativePath: action.document.relativePath,
				draft: nextDraft,
				cleanSnapshot: nextDraft,
				isDirty: false,
				isSaving: false,
				discardIntent: null,
			};
		}
		case "openInspector":
			if (!state.draft) return state;
			return {
				...state,
				isOpen: true,
				discardIntent: null,
			};
		case "closeInspector":
			return {
				...state,
				isOpen: false,
				discardIntent: null,
			};
		case "requestDiscard":
			return {
				...state,
				discardIntent: action.discardIntent,
			};
		case "dismissDiscard":
			return {
				...state,
				discardIntent: null,
			};
		case "updateDraft": {
			if (!state.draft) return state;
			const nextDraft = {
				...state.draft,
				[action.field]: action.value,
			};
			return {
				...state,
				draft: nextDraft,
				discardIntent: null,
				isDirty: !draftsEqual(nextDraft, state.cleanSnapshot),
			};
		}
		case "resetDraft":
			if (!state.cleanSnapshot) return state;
			return {
				...state,
				draft: { ...state.cleanSnapshot },
				isDirty: false,
				discardIntent: null,
			};
		case "discardChanges":
			if (!state.cleanSnapshot) {
				return {
					...state,
					discardIntent: null,
					isDirty: false,
				};
			}
			return {
				...state,
				draft: { ...state.cleanSnapshot },
				discardIntent: null,
				isDirty: false,
			};
		case "discardAndClose":
			if (!state.cleanSnapshot) {
				return {
					...state,
					isOpen: false,
					discardIntent: null,
					isDirty: false,
				};
			}
			return {
				...state,
				draft: { ...state.cleanSnapshot },
				isOpen: false,
				discardIntent: null,
				isDirty: false,
			};
		case "startSaving":
			return {
				...state,
				isSaving: true,
				discardIntent: null,
			};
		case "finishSaving":
			return {
				...state,
				isSaving: false,
			};
		default:
			return state;
	}
}

export function useNoteInspectorController(options: UseNoteInspectorControllerOptions): UseNoteInspectorControllerResult {
	const { activeDocument, onArchiveDocument, onOpenDocument, onSaveDocumentMetadata } = options;
	const [state, dispatch] = useReducer(noteInspectorReducer, initialState);
	const pendingAfterDiscardRef = useRef<null | (() => Promise<void>)>(null);
	const activeDocumentLabelsKey = activeDocument?.labels.join("\u0000") ?? "";

	useEffect(() => {
		if (!activeDocument) {
			pendingAfterDiscardRef.current = null;
			dispatch({ type: "clear" });
			return;
		}

		if (
			state.draftRelativePath === activeDocument.relativePath
			&& state.isDirty
			&& !state.isSaving
		) {
			return;
		}

		dispatch({ type: "syncFromDocument", document: activeDocument });
	}, [
		activeDocument?.isArchived,
		activeDocumentLabelsKey,
		activeDocument?.parentRelativePath,
		activeDocument?.relativePath,
		activeDocument?.title,
		state.draftRelativePath,
		state.isDirty,
		state.isSaving,
	]);

	const queueDiscardIntent = useEventCallback((discardIntent: DiscardIntent, pendingAfterDiscard?: () => Promise<void>) => {
		pendingAfterDiscardRef.current = pendingAfterDiscard ?? null;
		dispatch({ type: "requestDiscard", discardIntent });
	});

	const selectDocument = useEventCallback(async (relativePath: string) => {
		if (state.isSaving || activeDocument?.relativePath === relativePath) return;

		const selectNextDocument = async () => {
			await onOpenDocument(relativePath);
		};

		if (state.isDirty) {
			queueDiscardIntent({
				kind: "selectDocument",
				relativePath,
				reopenInspector: state.isOpen,
			}, selectNextDocument);
			return;
		}

		await selectNextDocument();
	});

	const openInspectorForDocument = useEventCallback(async (relativePath: string) => {
		if (state.isSaving) return;

		if (activeDocument?.relativePath === relativePath) {
			if (!state.isOpen) {
				dispatch({ type: "openInspector" });
			}
			return;
		}

		const openInspectorAfterSelection = async () => {
			await onOpenDocument(relativePath);
			dispatch({ type: "openInspector" });
		};

		if (state.isDirty) {
			queueDiscardIntent({ kind: "openInspectorForDocument", relativePath }, openInspectorAfterSelection);
			return;
		}

		await openInspectorAfterSelection();
	});

	const closeInspector = useEventCallback(() => {
		if (!state.isOpen) return;

		if (state.isDirty) {
			queueDiscardIntent({ kind: "closeInspector" });
			return;
		}

		dispatch({ type: "closeInspector" });
	});

	const confirmDiscard = useEventCallback(async () => {
		const discardIntent = state.discardIntent;
		if (!discardIntent) return;

		const pendingAfterDiscard = pendingAfterDiscardRef.current;
		pendingAfterDiscardRef.current = null;

		if (discardIntent.kind === "closeInspector") {
			dispatch({ type: "discardAndClose" });
			return;
		}

		dispatch({ type: "discardChanges" });
		if (!pendingAfterDiscard) return;
		await pendingAfterDiscard();
	});

	const dismissDiscard = useEventCallback(() => {
		pendingAfterDiscardRef.current = null;
		dispatch({ type: "dismissDiscard" });
	});

	const resetDraft = useEventCallback(() => {
		dispatch({ type: "resetDraft" });
	});

	const runWithDirtyGuard = useEventCallback(async (task: () => Promise<void>) => {
		if (state.isSaving) return;

		if (state.isDirty) {
			queueDiscardIntent({ kind: "continueAction" }, task);
			return;
		}

		await task();
	});

	const saveDraft = useEventCallback(async () => {
		if (!activeDocument || !state.draft || state.isSaving) return;

		const normalizedTitle = normalizeDocumentTitle(state.draft.title);
		if (!normalizedTitle || !state.isDirty) return;

		dispatch({ type: "startSaving" });

		try {
			await onSaveDocumentMetadata({
				relativePath: activeDocument.relativePath,
				title: normalizedTitle,
				labels: parseLabelsInput(state.draft.labelsInput),
				targetParentRelativePath: state.draft.targetParentRelativePath,
			});
		} catch (error) {
			dispatch({ type: "finishSaving" });
			throw error;
		}
	});

	const handleArchiveToggle = useEventCallback(async () => {
		if (!activeDocument || state.isSaving) return;

		const nextArchived = !activeDocument.isArchived;
		const archiveDocument = async () => {
			await onArchiveDocument({
				relativePath: activeDocument.relativePath,
				archived: nextArchived,
			});
		};

		if (state.isDirty) {
			queueDiscardIntent({
				kind: "openInspectorForDocument",
				relativePath: activeDocument.relativePath,
			}, archiveDocument);
			return;
		}

		await archiveDocument();
	});

	const handleEscape = useEventCallback(() => {
		if (state.discardIntent) {
			dismissDiscard();
			return true;
		}

		if (!state.isOpen) {
			return false;
		}

		if (state.isDirty) {
			queueDiscardIntent({ kind: "closeInspector" });
			return true;
		}

		dispatch({ type: "closeInspector" });
		return true;
	});

	const canSave = useMemo(() => {
		if (!state.draft || !activeDocument || state.isSaving) return false;
		return state.draft.title.trim().length > 0 && state.isDirty;
	}, [activeDocument, state.draft, state.isDirty, state.isSaving]);

	const inspectorDocumentRelativePath = state.isOpen ? activeDocument?.relativePath ?? state.draftRelativePath : null;

	return {
		canSave,
		closeInspector,
		confirmDiscard,
		dismissDiscard,
		handleArchiveToggle,
		handleEscape,
		inspectorDocumentRelativePath,
		openInspectorForDocument,
		resetDraft,
		runWithDirtyGuard,
		saveDraft,
		selectDocument,
		state,
		updateLabelsInput: (value) => {
			dispatch({ type: "updateDraft", field: "labelsInput", value });
		},
		updateTargetParentRelativePath: (value) => {
			dispatch({ type: "updateDraft", field: "targetParentRelativePath", value });
		},
		updateTitle: (value) => {
			dispatch({ type: "updateDraft", field: "title", value });
		},
	};
}
