import { useEffect, useRef, useState } from "react";
import type { WorkspaceDocument } from "../../shared/models/workspace";
import { useEventCallback } from "./useEventCallback";

type SaveState = "saved" | "saving" | "unsaved";

type SaveStatus = {
	state: SaveState;
	label: string;
};

function formatSaveLabel(state: SaveState, detail?: string): string {
	if (state === "saved") return detail ?? "Saved";
	if (state === "saving") return detail ?? "Saving...";
	return detail ?? "Unsaved";
}

export function useAutosave(options: {
	activeDocument: WorkspaceDocument | null;
	editorText: string;
	onSave: (relativePath: string, content: string) => Promise<void>;
	onSaveError: (error: unknown) => void;
	onSaveSuccess: (content: string) => void;
}) {
	const { activeDocument, editorText, onSave, onSaveError, onSaveSuccess } = options;
	const autosaveTimerRef = useRef<number | null>(null);
	const saveInFlightRef = useRef<Promise<void> | null>(null);
	const [saveStatus, setSaveStatusState] = useState<SaveStatus>({
		state: "saved",
		label: "Saved",
	});

	const setSaveStatus = useEventCallback((state: SaveState, detail?: string) => {
		setSaveStatusState({
			state,
			label: formatSaveLabel(state, detail),
		});
	});

	const saveActiveDocument = useEventCallback(async () => {
		if (!activeDocument) return;
		if (saveInFlightRef.current) {
			await saveInFlightRef.current;
			if (!activeDocument || activeDocument.content === editorText) {
				return;
			}
		}

		const relativePath = activeDocument.relativePath;
		const content = editorText;
		setSaveStatus("saving");

		saveInFlightRef.current = (async () => {
			try {
				await onSave(relativePath, content);
				onSaveSuccess(content);
				setSaveStatus("saved", "Saved");
			} catch (error) {
				onSaveError(error);
				setSaveStatus("unsaved", "Refresh needed");
			}
		})().finally(() => {
			saveInFlightRef.current = null;
		});

		await saveInFlightRef.current;
	});

	useEffect(() => {
		if (!activeDocument) {
			setSaveStatus("saved", "Saved");
			return;
		}

		if (editorText === activeDocument.content) {
			setSaveStatus("saved", "Saved");
			return;
		}

		setSaveStatus("unsaved");
		if (autosaveTimerRef.current) {
			window.clearTimeout(autosaveTimerRef.current);
		}

		autosaveTimerRef.current = window.setTimeout(() => {
			autosaveTimerRef.current = null;
			void saveActiveDocument();
		}, 450);

		return () => {
			if (autosaveTimerRef.current) {
				window.clearTimeout(autosaveTimerRef.current);
				autosaveTimerRef.current = null;
			}
		};
	}, [activeDocument, editorText, saveActiveDocument, setSaveStatus]);

	useEffect(() => {
		return () => {
			if (autosaveTimerRef.current) {
				window.clearTimeout(autosaveTimerRef.current);
				autosaveTimerRef.current = null;
			}
		};
	}, []);

	const flushAutosave = useEventCallback(async (force = false) => {
		if (autosaveTimerRef.current) {
			window.clearTimeout(autosaveTimerRef.current);
			autosaveTimerRef.current = null;
			await saveActiveDocument();
			return;
		}

		if (force && activeDocument && activeDocument.content !== editorText) {
			await saveActiveDocument();
			return;
		}

		if (saveInFlightRef.current) {
			await saveInFlightRef.current;
		}
	});

	return {
		flushAutosave,
		hasPendingChanges: Boolean(
			autosaveTimerRef.current
			|| saveInFlightRef.current
			|| (activeDocument && activeDocument.content !== editorText),
		),
		saveInFlightRef,
		saveStatus,
		setSaveStatus,
	};
}
