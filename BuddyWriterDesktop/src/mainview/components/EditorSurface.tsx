import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useRef,
} from "react";
import { useEventCallback } from "../hooks/useEventCallback";
import { rpcClient } from "../rpc/client";

export type MicAnchor = {
	left: number;
	top: number;
	visible: boolean;
};

export type EditorSurfaceHandle = {
	captureSelection: () => string;
	clearCapturedSelection: () => void;
	containsTarget: (target: EventTarget | null) => boolean;
	cutSelection: () => void;
	focus: () => void;
	insertTextAtCursor: (text: string) => void;
	isFocused: () => boolean;
	pasteText: (text: string) => void;
	redo: () => void;
	replaceSelection: (text: string) => void;
	saveCursorPosition: () => void;
	selectAll: () => void;
	undo: () => void;
	wrapSelection: (before: string, after: string) => void;
};

type EditorSurfaceProps = {
	markdownMode: boolean;
	onMicAnchorChange: (anchor: MicAnchor) => void;
	onTextChange: (text: string) => void;
	onWordCountChange: (count: number) => void;
	text: string;
};

function countWords(text: string): number {
	const trimmed = text.trim();
	return trimmed ? trimmed.split(/\s+/).length : 0;
}

export const EditorSurface = forwardRef<EditorSurfaceHandle, EditorSurfaceProps>(function EditorSurface(props, ref) {
	const { markdownMode, onMicAnchorChange, onTextChange, onWordCountChange, text } = props;
	const editorRef = useRef<HTMLDivElement | null>(null);
	const rawTextRef = useRef(text);
	const lastCursorRangeRef = useRef<Range | null>(null);
	const selectedRangeRef = useRef<Range | null>(null);
	const appliedMarkdownModeRef = useRef(markdownMode);

	const emitCurrentText = useEventCallback(() => {
		const editor = editorRef.current;
		if (!editor) return;
		const nextText = markdownMode ? rawTextRef.current : editor.innerText;
		rawTextRef.current = nextText;
		onTextChange(nextText);
		onWordCountChange(countWords(nextText));
	});

	const positionMicAtCursor = useEventCallback(() => {
		const editor = editorRef.current;
		const selection = window.getSelection();
		if (!editor || !selection || selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) {
			onMicAnchorChange({ visible: false, left: 0, top: 0 });
			return;
		}

		const range = selection.getRangeAt(0);
		const rect = range.getBoundingClientRect();
		let x = rect.right;
		let y = rect.top;

		if (rect.width === 0 && rect.height === 0) {
			const editorRect = editor.getBoundingClientRect();
			x = editorRect.left;
			y = editorRect.top;
		}

		const lineHeight = rect.height || 20;
		onMicAnchorChange({
			left: x + 8,
			top: y + lineHeight / 2 - 14,
			visible: true,
		});
	});

	const applyTextToDom = useEventCallback(async () => {
		const editor = editorRef.current;
		if (!editor) return;
		if (text === rawTextRef.current && markdownMode === appliedMarkdownModeRef.current) {
			return;
		}

		rawTextRef.current = text;
		appliedMarkdownModeRef.current = markdownMode;
		if (markdownMode) {
			const { html } = await rpcClient.renderMarkdown({ text });
			editor.innerHTML = html;
			editor.contentEditable = "false";
			editor.classList.add("markdown-preview");
		} else {
			editor.innerText = text;
			editor.contentEditable = "true";
			editor.classList.remove("markdown-preview");
		}

		onWordCountChange(countWords(text));
	});

	useEffect(() => {
		void applyTextToDom();
	}, [applyTextToDom, markdownMode, text]);

	useImperativeHandle(ref, () => ({
		captureSelection() {
			const editor = editorRef.current;
			const selection = window.getSelection();
			if (!editor || !selection || selection.rangeCount === 0 || !selection.toString().trim() || !editor.contains(selection.anchorNode)) {
				selectedRangeRef.current = null;
				return "";
			}

			selectedRangeRef.current = selection.getRangeAt(0).cloneRange();
			return selection.toString().trim();
		},
		clearCapturedSelection() {
			selectedRangeRef.current = null;
		},
		containsTarget(target) {
			const editor = editorRef.current;
			return Boolean(editor && target instanceof Node && editor.contains(target));
		},
		cutSelection() {
			const selection = window.getSelection();
			if (!selection?.toString()) return;
			selection.deleteFromDocument();
			emitCurrentText();
			positionMicAtCursor();
		},
		focus() {
			editorRef.current?.focus();
		},
		insertTextAtCursor(value) {
			const editor = editorRef.current;
			const selection = window.getSelection();
			if (!editor || !selection) return;
			editor.focus();
			if (lastCursorRangeRef.current) {
				selection.removeAllRanges();
				selection.addRange(lastCursorRangeRef.current);
			}
			if (!selection.rangeCount) return;
			const range = selection.getRangeAt(0);
			range.deleteContents();
			const node = document.createTextNode(value);
			range.insertNode(node);
			range.setStartAfter(node);
			range.collapse(true);
			selection.removeAllRanges();
			selection.addRange(range);
			lastCursorRangeRef.current = range.cloneRange();
			emitCurrentText();
			positionMicAtCursor();
		},
		isFocused() {
			const editor = editorRef.current;
			return Boolean(editor && (document.activeElement === editor || editor.contains(document.activeElement)));
		},
		pasteText(value) {
			const selection = window.getSelection();
			if (!selection || !selection.rangeCount) return;
			const range = selection.getRangeAt(0);
			range.deleteContents();
			range.insertNode(document.createTextNode(value));
			range.collapse(false);
			selection.removeAllRanges();
			selection.addRange(range);
			emitCurrentText();
			positionMicAtCursor();
		},
		redo() {
			document.execCommand("redo");
		},
		replaceSelection(value) {
			const selection = window.getSelection();
			const range = selectedRangeRef.current?.cloneRange() ?? selection?.getRangeAt(0);
			if (!range) return;
			range.deleteContents();
			range.insertNode(document.createTextNode(value));
			range.collapse(false);
			selection?.removeAllRanges();
			selection?.addRange(range);
			selectedRangeRef.current = null;
			lastCursorRangeRef.current = range.cloneRange();
			emitCurrentText();
			positionMicAtCursor();
		},
		saveCursorPosition() {
			const editor = editorRef.current;
			const selection = window.getSelection();
			if (editor && selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
				lastCursorRangeRef.current = selection.getRangeAt(0).cloneRange();
				positionMicAtCursor();
			}
		},
		selectAll() {
			const editor = editorRef.current;
			const selection = window.getSelection();
			if (!editor || !selection) return;
			const range = document.createRange();
			range.selectNodeContents(editor);
			selection.removeAllRanges();
			selection.addRange(range);
		},
		undo() {
			document.execCommand("undo");
		},
		wrapSelection(before, after) {
			const selection = window.getSelection();
			if (!selection || selection.rangeCount === 0) return;
			const range = selection.getRangeAt(0);
			const selectedText = range.toString();
			if (!selectedText) return;
			range.deleteContents();
			const node = document.createTextNode(`${before}${selectedText}${after}`);
			range.insertNode(node);
			const nextRange = document.createRange();
			nextRange.setStartAfter(node);
			nextRange.collapse(true);
			selection.removeAllRanges();
			selection.addRange(nextRange);
			emitCurrentText();
			positionMicAtCursor();
		},
	}), [emitCurrentText, positionMicAtCursor]);

	return (
		<div className="editor-container">
			<div
				ref={editorRef}
				className="editor"
				contentEditable={!markdownMode}
				data-placeholder="Begin writing..."
				spellCheck={false}
				onBlur={() => {
					window.setTimeout(() => {
						const editor = editorRef.current;
						if (!editor || document.activeElement !== editor) {
							onMicAnchorChange({ visible: false, left: 0, top: 0 });
						}
					}, 150);
				}}
				onFocus={() => {
					window.setTimeout(() => {
						positionMicAtCursor();
					}, 0);
				}}
				onInput={() => {
					emitCurrentText();
					positionMicAtCursor();
				}}
				onKeyUp={() => {
					positionMicAtCursor();
				}}
				onMouseUp={() => {
					positionMicAtCursor();
				}}
			/>
		</div>
	);
});
