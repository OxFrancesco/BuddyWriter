import { useEffect } from "react";
import type { HotkeyMap } from "../../shared/models/settings";
import type { EditorSurfaceHandle } from "../components/EditorSurface";

type UseGlobalShortcutsOptions = {
	editorRef: React.RefObject<EditorSurfaceHandle | null>;
	hotkeys: HotkeyMap;
	onEscape: () => void;
	onGrammarFix: () => void;
	onToggleChat: () => void;
	onToggleMarkdown: () => void;
	onToggleZen: () => void;
};

export function useGlobalShortcuts(options: UseGlobalShortcutsOptions): void {
	const { editorRef, hotkeys, onEscape, onGrammarFix, onToggleChat, onToggleMarkdown, onToggleZen } = options;

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			const mod = event.metaKey || event.ctrlKey;
			const key = event.key.toLowerCase();
			const editor = editorRef.current;
			const inEditor = Boolean(editor?.isFocused() || editor?.containsTarget(event.target));
			const matchesHotkey = (hotkey: HotkeyMap[keyof HotkeyMap]) => hotkey.mod === mod && hotkey.shift === event.shiftKey && hotkey.key === key;

			if (mod && !event.shiftKey && key === "a" && inEditor) {
				event.preventDefault();
				editor?.selectAll();
				return;
			}

			if (mod && !event.shiftKey && key === "c") {
				const selection = window.getSelection();
				if (selection?.toString()) {
					event.preventDefault();
					void navigator.clipboard.writeText(selection.toString());
				}
				return;
			}

			if (mod && !event.shiftKey && key === "x" && inEditor) {
				const selection = window.getSelection();
				if (selection?.toString()) {
					event.preventDefault();
					void navigator.clipboard.writeText(selection.toString());
					editor?.cutSelection();
				}
				return;
			}

			if (mod && !event.shiftKey && key === "v" && inEditor) {
				event.preventDefault();
				void navigator.clipboard.readText().then((text) => {
					editor?.pasteText(text);
				});
				return;
			}

			if (mod && !event.shiftKey && key === "z" && inEditor) {
				event.preventDefault();
				editor?.undo();
				return;
			}

			if (mod && event.shiftKey && key === "z" && inEditor) {
				event.preventDefault();
				editor?.redo();
				return;
			}

			if (matchesHotkey(hotkeys.zenMode)) {
				event.preventDefault();
				onToggleZen();
				return;
			}

			if (matchesHotkey(hotkeys.fixGrammar)) {
				event.preventDefault();
				onGrammarFix();
				return;
			}

			if (matchesHotkey(hotkeys.aiChat)) {
				event.preventDefault();
				onToggleChat();
				return;
			}

			if (matchesHotkey(hotkeys.toggleMarkdown)) {
				event.preventDefault();
				onToggleMarkdown();
				return;
			}

			if (matchesHotkey(hotkeys.bold)) {
				event.preventDefault();
				editor?.wrapSelection("**", "**");
				return;
			}

			if (matchesHotkey(hotkeys.italic)) {
				event.preventDefault();
				editor?.wrapSelection("*", "*");
				return;
			}

			if (matchesHotkey(hotkeys.link)) {
				event.preventDefault();
				editor?.wrapSelection("[", "](url)");
				return;
			}

			if (matchesHotkey(hotkeys.code)) {
				event.preventDefault();
				editor?.wrapSelection("`", "`");
				return;
			}

			if (event.key === "Escape") {
				onEscape();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [editorRef, hotkeys, onEscape, onGrammarFix, onToggleChat, onToggleMarkdown, onToggleZen]);
}
