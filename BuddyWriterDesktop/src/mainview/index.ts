import Electrobun, { Electroview } from "electrobun/view";

type Hotkey = {
	mod: boolean;
	shift: boolean;
	key: string;
};

type HotkeyMap = {
	zenMode: Hotkey;
	fixGrammar: Hotkey;
	aiChat: Hotkey;
	toggleMarkdown: Hotkey;
	bold: Hotkey;
	italic: Hotkey;
	link: Hotkey;
	code: Hotkey;
};

type Settings = {
	provider: "openrouter" | "mlx";
	openrouterKey: string;
	openrouterModel: string;
	mlxModel: string;
	mlxPythonPath: string;
	whisperModel: string;
	hotkeys: HotkeyMap;
};

const defaultHotkeys: HotkeyMap = {
	zenMode: { mod: true, shift: true, key: "f" },
	fixGrammar: { mod: true, shift: false, key: "g" },
	aiChat: { mod: true, shift: true, key: "a" },
	toggleMarkdown: { mod: true, shift: true, key: "m" },
	bold: { mod: true, shift: false, key: "b" },
	italic: { mod: true, shift: false, key: "i" },
	link: { mod: true, shift: false, key: "k" },
	code: { mod: true, shift: false, key: "e" },
};

const hotkeyLabels: Record<keyof HotkeyMap, string> = {
	zenMode: "Zen Mode",
	fixGrammar: "Fix Grammar",
	aiChat: "AI Chat",
	toggleMarkdown: "Toggle Markdown",
	bold: "Bold",
	italic: "Italic",
	link: "Insert Link",
	code: "Inline Code",
};

type WriterRPC = {
	bun: {
		requests: {
			aiComplete: {
				params: { text: string; instruction: string };
				response: { result: string };
			};
			grammarFix: {
				params: { text: string };
				response: { result: string };
			};
			renderMarkdown: {
				params: { text: string };
				response: { html: string };
			};
				getSettings: {
					params: {};
					response: Settings;
				};
				saveSettings: {
					params: Settings;
					response: { success: boolean; error?: string };
				};
			startMLXServer: {
				params: { model: string; pythonPath: string };
				response: { success: boolean; error?: string };
			};
			stopMLXServer: {
				params: {};
				response: { success: boolean };
			};
			getMLXStatus: {
				params: {};
				response: { running: boolean };
			};
			startWhisperServer: {
				params: { model: string; pythonPath: string };
				response: { success: boolean; error?: string };
			};
			stopWhisperServer: {
				params: {};
				response: { success: boolean };
			};
			getWhisperStatus: {
				params: {};
				response: { running: boolean };
			};
			transcribeAudio: {
				params: { audioPath: string; language?: string };
				response: { text: string };
			};
		};
		messages: {};
	};
	webview: {
		requests: {};
		messages: {
			toggleZenMode: {};
			fixGrammar: {};
			toggleAIChat: {};
			toggleMarkdown: {};
		};
	};
};

const rpc = Electroview.defineRPC<WriterRPC>({
	maxRequestTime: 120000,
	handlers: {
		requests: {},
		messages: {
			toggleZenMode: () => toggleZen(),
			fixGrammar: () => handleGrammarFix(),
			toggleAIChat: () => toggleChat(),
			toggleMarkdown: () => toggleMarkdownMode(),
		},
	},
});

const electrobun = new Electrobun.Electroview({ rpc });

// ─── DOM Elements ───
const app = document.getElementById("app")!;
const editor = document.getElementById("editor") as HTMLDivElement;
const wordCount = document.getElementById("word-count")!;
const aiStatus = document.getElementById("ai-status")!;
const chatPanel = document.getElementById("chat-panel")!;
const chatClose = document.getElementById("chat-close")!;
const chatMessages = document.getElementById("chat-messages")!;
const chatInput = document.getElementById("chat-input") as HTMLTextAreaElement;
const chatSend = document.getElementById("chat-send")!;
const chatContext = document.getElementById("chat-context")!;
const clearContext = document.getElementById("clear-context")!;
const grammarOverlay = document.getElementById("grammar-overlay")!;

// Settings DOM
const settingsBtn = document.getElementById("settings-btn")!;
const settingsPanel = document.getElementById("settings-panel")!;
const settingsClose = document.getElementById("settings-close")!;
const openrouterSettings = document.getElementById("openrouter-settings")!;
const mlxSettings = document.getElementById("mlx-settings")!;
const openrouterKey = document.getElementById("openrouter-key") as HTMLInputElement;
const openrouterModel = document.getElementById("openrouter-model") as HTMLSelectElement;
const mlxModel = document.getElementById("mlx-model") as HTMLSelectElement;
const mlxPython = document.getElementById("mlx-python") as HTMLInputElement;
const mlxStatusDot = document.getElementById("mlx-status-dot")!;
const mlxStatusText = document.getElementById("mlx-status-text")!;
const mlxStart = document.getElementById("mlx-start") as HTMLButtonElement;
const mlxStop = document.getElementById("mlx-stop") as HTMLButtonElement;
const providerToggles = document.querySelectorAll<HTMLButtonElement>(".settings-toggle");

// Whisper DOM
const whisperModel = document.getElementById("whisper-model") as HTMLSelectElement;
const whisperStatusDot = document.getElementById("whisper-status-dot")!;
const whisperStatusText = document.getElementById("whisper-status-text")!;
const whisperStart = document.getElementById("whisper-start") as HTMLButtonElement;
const whisperStop = document.getElementById("whisper-stop") as HTMLButtonElement;

// ─── State ───
let selectedText = "";
let selectedRange: Range | null = null;
let isZen = false;
let isMarkdownMode = false;
let editorRawText = "";
let currentSettings: Settings | null = null;

function ensureSelectValue(select: HTMLSelectElement, value: string, labelPrefix: string) {
	if (!value) return;

	const hasOption = Array.from(select.options).some((option) => option.value === value);
	if (!hasOption) {
		const option = document.createElement("option");
		option.value = value;
		option.textContent = `${labelPrefix}: ${value}`;
		select.prepend(option);
	}

	select.value = value;
}

// ─── Word Count ───
function updateWordCount() {
	const text = editor.innerText.trim();
	const count = text ? text.split(/\s+/).length : 0;
	wordCount.textContent = `${count} word${count !== 1 ? "s" : ""}`;
}

editor.addEventListener("input", updateWordCount);
updateWordCount();

// ─── Zen Mode ───
function toggleZen() {
	isZen = !isZen;
	app.classList.toggle("zen", isZen);
	if (isZen) {
		editor.innerHTML = "";
		editor.focus();
	}
}

// ─── Grammar Fix ───
async function handleGrammarFix() {
	const text = editor.innerText.trim();
	if (!text) return;

	grammarOverlay.style.display = "flex";
	showAIStatus("fixing grammar...");

	try {
		const { result } = await electrobun.rpc!.request.grammarFix({ text });
		if (result) {
			editor.innerText = result;
			updateWordCount();
		}
	} catch (err) {
		console.error("Grammar fix failed:", err);
	} finally {
		grammarOverlay.style.display = "none";
		hideAIStatus();
	}
}

// ─── Chat Panel ───
function toggleChat() {
	const isOpen = chatPanel.classList.toggle("open");
	if (isOpen) {
		captureSelection();
		chatInput.focus();
	}
}

chatClose.addEventListener("click", () => {
	chatPanel.classList.remove("open");
});

clearContext.addEventListener("click", () => {
	selectedText = "";
	chatContext.style.display = "none";
});

function captureSelection() {
	const sel = window.getSelection();
	if (sel && sel.rangeCount > 0 && sel.toString().trim() && editor.contains(sel.anchorNode)) {
		selectedText = sel.toString().trim();
		selectedRange = sel.getRangeAt(0).cloneRange();
		chatContext.style.display = "flex";
	} else {
		selectedText = "";
		selectedRange = null;
		chatContext.style.display = "none";
	}
}

// ─── Chat Send ───
async function sendChatMessage() {
	const userMsg = chatInput.value.trim();
	if (!userMsg) return;

	const contextText = selectedText;
	chatInput.value = "";

	addChatBubble("user", userMsg);

	let instruction = userMsg;
	let text = editor.innerText;

	if (contextText) {
		instruction = `The user has selected the following text from their document:\n\n"${contextText}"\n\nTheir request: ${userMsg}\n\nRespond with the rewritten/improved text. If they ask to add content, provide the addition. Be concise and direct.`;
		text = contextText;
	} else {
		instruction = `The user is writing a document. Here is the full text:\n\n"${editor.innerText}"\n\nTheir request: ${userMsg}\n\nRespond helpfully and concisely.`;
	}

	showAIStatus("thinking...");

	try {
		const { result } = await electrobun.rpc!.request.aiComplete({
			text,
			instruction,
		});
		addChatBubble("assistant", result, !!contextText);
	} catch (err) {
		addChatBubble("assistant", "Something went wrong. Please try again.");
	} finally {
		hideAIStatus();
	}
}

chatSend.addEventListener("click", sendChatMessage);
chatInput.addEventListener("keydown", (e) => {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		sendChatMessage();
	}
});

async function addChatBubble(role: "user" | "assistant", text: string, showApply = false) {
	const bubble = document.createElement("div");
	bubble.className = `chat-msg ${role}`;

	if (role === "assistant") {
		bubble.dataset.rawText = text;
		await renderBubbleContent(bubble);
	} else {
		bubble.textContent = text;
	}

	if (role === "assistant" && showApply) {
		const btn = document.createElement("button");
		btn.className = "apply-btn";
		btn.textContent = "↳ Apply to selection";
		btn.addEventListener("click", () => {
			replaceSelection(text);
			chatPanel.classList.remove("open");
		});
		bubble.appendChild(btn);
	}

	chatMessages.appendChild(bubble);
	chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function renderBubbleContent(bubble: HTMLElement) {
	const raw = bubble.dataset.rawText ?? "";
	const applyBtn = bubble.querySelector(".apply-btn");

	// Clear existing content except apply button
	while (bubble.firstChild && bubble.firstChild !== applyBtn) {
		bubble.removeChild(bubble.firstChild);
	}

	if (isMarkdownMode) {
		bubble.classList.remove("plain-text");
		const { html } = await electrobun.rpc!.request.renderMarkdown({ text: raw });
		const content = document.createElement("div");
		content.className = "markdown-content";
		content.innerHTML = html;
		bubble.insertBefore(content, applyBtn || null);
	} else {
		bubble.classList.add("plain-text");
		const textNode = document.createTextNode(raw);
		bubble.insertBefore(textNode, applyBtn || null);
	}
}

async function toggleMarkdownMode() {
	isMarkdownMode = !isMarkdownMode;

	// Toggle editor preview
	if (isMarkdownMode) {
		editorRawText = editor.innerText;
		const { html } = await electrobun.rpc!.request.renderMarkdown({ text: editorRawText });
		editor.innerHTML = html;
		editor.contentEditable = "false";
		editor.classList.add("markdown-preview");
	} else {
		editor.innerText = editorRawText;
		editor.contentEditable = "true";
		editor.classList.remove("markdown-preview");
		editor.focus();
	}

	// Toggle chat bubbles
	const bubbles = chatMessages.querySelectorAll<HTMLElement>(".chat-msg.assistant");
	for (const bubble of bubbles) {
		await renderBubbleContent(bubble);
	}
}

function replaceSelection(newText: string) {
	if (!selectedRange) return;

	const range = selectedRange.cloneRange();
	range.deleteContents();
	range.insertNode(document.createTextNode(newText));
	range.collapse(false);

	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);

	selectedText = "";
	selectedRange = null;
	chatContext.style.display = "none";
	updateWordCount();
}

// ─── AI Status ───
function showAIStatus(text: string) {
	aiStatus.textContent = text;
	aiStatus.classList.add("visible");
}

function hideAIStatus() {
	aiStatus.classList.remove("visible");
}

// ─── Settings Panel ───
settingsBtn.addEventListener("click", async (e) => {
	e.stopPropagation();
	settingsPanel.classList.toggle("open");
	if (settingsPanel.classList.contains("open")) {
		await loadSettingsUI();
	}
});

settingsClose.addEventListener("click", () => {
	settingsPanel.classList.remove("open");
	persistSettings();
});

async function loadSettingsUI() {
	const s = await electrobun.rpc!.request.getSettings({});
	currentSettings = s;

	openrouterKey.value = s.openrouterKey;
	openrouterModel.value = s.openrouterModel;
	ensureSelectValue(mlxModel, s.mlxModel, "Custom model");
	mlxPython.value = s.mlxPythonPath || "python3";
	ensureSelectValue(whisperModel, s.whisperModel || "mlx-community/whisper-large-v3-turbo", "Custom voice model");

	setProviderUI(s.provider);
	loadHotkeysUI();
	await refreshMLXStatus();
	await refreshWhisperStatus();
}

function setProviderUI(provider: "openrouter" | "mlx") {
	providerToggles.forEach((btn) => {
		btn.classList.toggle("active", btn.dataset.provider === provider);
	});
	openrouterSettings.style.display = provider === "openrouter" ? "flex" : "none";
	mlxSettings.style.display = provider === "mlx" ? "flex" : "none";
}

providerToggles.forEach((btn) => {
	btn.addEventListener("click", () => {
		const provider = btn.dataset.provider as "openrouter" | "mlx";
		setProviderUI(provider);
		if (currentSettings) {
			currentSettings.provider = provider;
			persistSettings();
		}
	});
});

// Auto-save on input changes
openrouterKey.addEventListener("change", persistSettings);
openrouterModel.addEventListener("change", persistSettings);
mlxModel.addEventListener("change", persistSettings);
mlxPython.addEventListener("change", persistSettings);
whisperModel.addEventListener("change", persistSettings);

async function persistSettings() {
	if (!currentSettings) return;
	currentSettings.openrouterKey = openrouterKey.value;
	currentSettings.openrouterModel = openrouterModel.value;
	currentSettings.mlxModel = mlxModel.value;
	currentSettings.mlxPythonPath = mlxPython.value.trim() || "python3";
	mlxPython.value = currentSettings.mlxPythonPath;
	currentSettings.whisperModel = whisperModel.value;

	const result = await electrobun.rpc!.request.saveSettings(currentSettings);
	if (!result.success && result.error) {
		console.error(result.error);
		showAIStatus(result.error);
		setTimeout(() => {
			hideAIStatus();
		}, 4000);
	}
}

// ─── Hotkeys UI ───
function formatHotkey(h: Hotkey): string {
	let label = "";
	if (h.mod) label += "⌘";
	if (h.shift) label += "⇧";
	label += h.key.toUpperCase();
	return label;
}

function loadHotkeysUI() {
	const list = document.getElementById("hotkeys-list")!;
	list.innerHTML = "";

	const hotkeys = currentSettings?.hotkeys ?? defaultHotkeys;

	for (const actionId of Object.keys(hotkeyLabels) as (keyof HotkeyMap)[]) {
		const row = document.createElement("div");
		row.className = "hotkey-row";

		const label = document.createElement("span");
		label.className = "hotkey-action";
		label.textContent = hotkeyLabels[actionId];

		const btn = document.createElement("button");
		btn.className = "hotkey-btn";
		btn.textContent = formatHotkey(hotkeys[actionId]);
		btn.addEventListener("click", () => recordHotkey(actionId, btn));

		row.appendChild(label);
		row.appendChild(btn);
		list.appendChild(row);
	}
}

function recordHotkey(actionId: keyof HotkeyMap, btn: HTMLButtonElement) {
	btn.classList.add("recording");
	btn.textContent = "Press keys...";

	const handler = (e: KeyboardEvent) => {
		e.preventDefault();
		e.stopPropagation();

		const key = e.key.toLowerCase();
		if (key === "meta" || key === "control" || key === "shift" || key === "alt") return;

		const hotkey: Hotkey = {
			mod: e.metaKey || e.ctrlKey,
			shift: e.shiftKey,
			key,
		};

		btn.classList.remove("recording");
		btn.textContent = formatHotkey(hotkey);

		if (currentSettings) {
			currentSettings.hotkeys[actionId] = hotkey;
			persistSettings();
		}

		document.removeEventListener("keydown", handler, true);
	};

	document.addEventListener("keydown", handler, true);
}

// ─── MLX Controls ───
mlxStart.addEventListener("click", async () => {
	mlxStart.disabled = true;
	mlxStart.textContent = "Starting...";
	mlxStatusDot.className = "mlx-dot loading";
	mlxStatusText.textContent = "Starting server (downloading model if needed)...";

	const res = await electrobun.rpc!.request.startMLXServer({
		model: mlxModel.value,
		pythonPath: mlxPython.value.trim() || "python3",
	});

	if (res.success) {
		setMLXOnline();
	} else {
		mlxStatusDot.className = "mlx-dot offline";
		mlxStatusText.textContent = res.error ?? "Failed to start";
		mlxStart.disabled = false;
		mlxStart.textContent = "Start Server";
	}
});

mlxStop.addEventListener("click", async () => {
	await electrobun.rpc!.request.stopMLXServer({});
	setMLXOffline();
});

function setMLXOnline() {
	mlxStatusDot.className = "mlx-dot online";
	mlxStatusText.textContent = "Server running";
	mlxStart.style.display = "none";
	mlxStop.style.display = "inline-flex";
	mlxStart.disabled = false;
	mlxStart.textContent = "Start Server";
}

function setMLXOffline() {
	mlxStatusDot.className = "mlx-dot offline";
	mlxStatusText.textContent = "Server not running";
	mlxStart.style.display = "inline-flex";
	mlxStop.style.display = "none";
}

async function refreshMLXStatus() {
	const { running } = await electrobun.rpc!.request.getMLXStatus({});
	if (running) setMLXOnline();
	else setMLXOffline();
}

// ─── Whisper Controls ───
whisperStart.addEventListener("click", async () => {
	whisperStart.disabled = true;
	whisperStart.textContent = "Starting...";
	whisperStatusDot.className = "mlx-dot loading";
	whisperStatusText.textContent = "Loading model (downloading if needed)...";

	const res = await electrobun.rpc!.request.startWhisperServer({
		model: whisperModel.value,
		pythonPath: mlxPython.value.trim() || "python3",
	});

	if (res.success) {
		setWhisperOnline();
	} else {
		whisperStatusDot.className = "mlx-dot offline";
		whisperStatusText.textContent = res.error ?? "Failed to start";
		whisperStart.disabled = false;
		whisperStart.textContent = "Start Server";
	}
});

whisperStop.addEventListener("click", async () => {
	await electrobun.rpc!.request.stopWhisperServer({});
	setWhisperOffline();
});

function setWhisperOnline() {
	whisperStatusDot.className = "mlx-dot online";
	whisperStatusText.textContent = "Server running";
	whisperStart.style.display = "none";
	whisperStop.style.display = "inline-flex";
	whisperStart.disabled = false;
	whisperStart.textContent = "Start Server";
}

function setWhisperOffline() {
	whisperStatusDot.className = "mlx-dot offline";
	whisperStatusText.textContent = "Server not running";
	whisperStart.style.display = "inline-flex";
	whisperStop.style.display = "none";
}

async function refreshWhisperStatus() {
	const { running } = await electrobun.rpc!.request.getWhisperStatus({});
	if (running) setWhisperOnline();
	else setWhisperOffline();
}

// ─── Markdown formatting helpers ───
function wrapSelection(before: string, after: string) {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return;
	const range = sel.getRangeAt(0);
	const text = range.toString();
	if (!text) return;

	range.deleteContents();
	const node = document.createTextNode(`${before}${text}${after}`);
	range.insertNode(node);

	// Place cursor after the inserted text
	const newRange = document.createRange();
	newRange.setStartAfter(node);
	newRange.collapse(true);
	sel.removeAllRanges();
	sel.addRange(newRange);
	updateWordCount();
}

// ─── Keyboard shortcuts ───
document.addEventListener("keydown", (e) => {
	const mod = e.metaKey || e.ctrlKey;

	const inEditor = document.activeElement === editor || editor.contains(document.activeElement);
	const key = e.key.toLowerCase();

	// ─── Standard editing (WKWebView needs explicit DOM handling) ───
	if (mod && !e.shiftKey && key === "a" && inEditor) {
		e.preventDefault();
		const sel = window.getSelection();
		if (sel) {
			const range = document.createRange();
			range.selectNodeContents(editor);
			sel.removeAllRanges();
			sel.addRange(range);
		}
	} else if (mod && !e.shiftKey && key === "c") {
		const sel = window.getSelection();
		if (sel && sel.toString()) {
			e.preventDefault();
			navigator.clipboard.writeText(sel.toString());
		}
	} else if (mod && !e.shiftKey && key === "x") {
		const sel = window.getSelection();
		if (sel && sel.toString() && inEditor) {
			e.preventDefault();
			navigator.clipboard.writeText(sel.toString());
			sel.deleteFromDocument();
			updateWordCount();
		}
	} else if (mod && !e.shiftKey && key === "v" && inEditor) {
		e.preventDefault();
		navigator.clipboard.readText().then((text) => {
			const sel = window.getSelection();
			if (!sel || !sel.rangeCount) return;
			const range = sel.getRangeAt(0);
			range.deleteContents();
			range.insertNode(document.createTextNode(text));
			range.collapse(false);
			sel.removeAllRanges();
			sel.addRange(range);
			updateWordCount();
		});
	} else if (mod && !e.shiftKey && key === "z" && inEditor) {
		e.preventDefault();
		document.execCommand("undo");
	} else if (mod && e.shiftKey && key === "z" && inEditor) {
		e.preventDefault();
		document.execCommand("redo");

	// ─── App shortcuts (driven by hotkey map) ───
	} else {
		const hk = currentSettings?.hotkeys ?? defaultHotkeys;
		const matchesHotkey = (h: Hotkey) => h.mod === mod && h.shift === e.shiftKey && h.key === key;

		if (matchesHotkey(hk.zenMode)) {
			e.preventDefault();
			toggleZen();
		} else if (matchesHotkey(hk.fixGrammar)) {
			e.preventDefault();
			handleGrammarFix();
		} else if (matchesHotkey(hk.aiChat)) {
			e.preventDefault();
			toggleChat();
		} else if (matchesHotkey(hk.toggleMarkdown)) {
			e.preventDefault();
			toggleMarkdownMode();
		} else if (matchesHotkey(hk.bold)) {
			e.preventDefault();
			wrapSelection("**", "**");
		} else if (matchesHotkey(hk.italic)) {
			e.preventDefault();
			wrapSelection("*", "*");
		} else if (matchesHotkey(hk.link)) {
			e.preventDefault();
			wrapSelection("[", "](url)");
		} else if (matchesHotkey(hk.code)) {
			e.preventDefault();
			wrapSelection("`", "`");
		} else if (e.key === "Escape") {
			if (settingsPanel.classList.contains("open")) {
				settingsPanel.classList.remove("open");
				persistSettings();
			} else if (chatPanel.classList.contains("open")) {
				chatPanel.classList.remove("open");
			} else if (isZen) {
				toggleZen();
			}
		}
	}
});

// ─── Voice Mic Bar ───
const micBtn = document.getElementById("mic-btn")!;
const micHint = document.getElementById("mic-hint")!;
const micStatus = document.getElementById("mic-status")!;

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let isRecording = false;
let holdMode = false;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let voiceClipboard = "";
let lastCursorRange: Range | null = null;

function saveCursorPosition() {
	const sel = window.getSelection();
	if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
		lastCursorRange = sel.getRangeAt(0).cloneRange();
	}
}

function insertTextAtCursor(text: string) {
	editor.focus();
	const sel = window.getSelection();
	if (!sel) return;

	if (lastCursorRange) {
		sel.removeAllRanges();
		sel.addRange(lastCursorRange);
	}

	const range = sel.getRangeAt(0);
	range.deleteContents();
	const node = document.createTextNode(text);
	range.insertNode(node);
	range.setStartAfter(node);
	range.collapse(true);
	sel.removeAllRanges();
	sel.addRange(range);
	lastCursorRange = range.cloneRange();
	updateWordCount();
}

async function startRecording() {
	if (isRecording) return;
	saveCursorPosition();

	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		audioChunks = [];
		mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

		mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) audioChunks.push(e.data);
		};

		mediaRecorder.onstop = async () => {
			stream.getTracks().forEach((t) => t.stop());
			if (audioChunks.length === 0) return;

			micBtn.classList.remove("recording");
			micBtn.classList.add("transcribing");
			micStatus.textContent = "transcribing...";
			showAIStatus("transcribing voice...");

			try {
				const blob = new Blob(audioChunks, { type: "audio/webm" });
				const buffer = await blob.arrayBuffer();
				const base64 = btoa(
					new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
				);

				const { text } = await electrobun.rpc!.request.transcribeAudio({
					audioPath: `base64:${base64}`,
				});

				if (text.trim()) {
					voiceClipboard = text;
					insertTextAtCursor(text);
					micHint.textContent = "⌘⌥V to re-paste";
					setTimeout(() => { micHint.textContent = "click or hold to record"; }, 3000);
				}
			} catch (err) {
				console.error("Transcription failed:", err);
				micStatus.textContent = "error";
				setTimeout(() => { micStatus.textContent = ""; }, 2000);
			} finally {
				micBtn.classList.remove("transcribing");
				micStatus.textContent = "";
				hideAIStatus();
				isRecording = false;
				holdMode = false;
			}
		};

		mediaRecorder.start();
		isRecording = true;
		micBtn.classList.add("recording");
		micStatus.textContent = "● recording";
		micHint.textContent = "release or click to stop";
	} catch (err) {
		console.error("Mic access failed:", err);
		micStatus.textContent = "mic denied";
		setTimeout(() => { micStatus.textContent = ""; }, 2000);
	}
}

function stopRecording() {
	if (!isRecording || !mediaRecorder) return;
	mediaRecorder.stop();
	isRecording = false;
}

// Mode 1 & 2: Click to toggle record, OR hold to record + release to stop
micBtn.addEventListener("mousedown", (e) => {
	e.preventDefault();
	if (isRecording) {
		stopRecording();
		return;
	}
	holdMode = false;
	holdTimer = setTimeout(() => { holdMode = true; }, 200);
	startRecording();
});

micBtn.addEventListener("mouseup", () => {
	if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
	if (holdMode && isRecording) stopRecording();
});

micBtn.addEventListener("mouseleave", () => {
	if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
	if (holdMode && isRecording) stopRecording();
});

// Mode 3: ⌘⌥V to paste from voice clipboard
document.addEventListener("keydown", (e) => {
	if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === "v") {
		e.preventDefault();
		if (voiceClipboard) insertTextAtCursor(voiceClipboard);
	}
}, true);

// Track cursor position
editor.addEventListener("mouseup", saveCursorPosition);
editor.addEventListener("keyup", saveCursorPosition);

editor.focus();
