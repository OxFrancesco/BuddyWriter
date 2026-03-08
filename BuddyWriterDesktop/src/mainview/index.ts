import Electrobun, { Electroview } from "electrobun/view";
import lottie from "lottie-web";
import microphoneAnimation from "../../public/microphone.json";

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

type LocalAIProfileId = "starter" | "quality";
type LocalAIInstallState = "not_installed" | "installing" | "ready" | "error";
type LocalAIModelKind = "text" | "stt" | "tts";
type LocalAIModelProvider = "mlx-lm" | "mlx-audio" | "mlx-whisper";

type LocalAIModelEntry = {
	id: string;
	kind: LocalAIModelKind;
	label: string;
	provider: LocalAIModelProvider;
	quantization: string;
	approxDownloadGB: number;
	recommendedFor: "starter" | "quality" | "power" | "legacy";
	hidden?: boolean;
	deprecated?: boolean;
	defaultVoice?: string;
	defaultLanguage?: string;
	defaultLangCode?: string;
};

type LocalAIProfile = {
	id: LocalAIProfileId;
	label: string;
	textModelId: string;
	sttModelId: string;
	ttsModelId: string;
	approxBundleGB: number;
};

type LocalAICatalog = {
	version: string;
	generatedAt: string;
	models: LocalAIModelEntry[];
	profiles: LocalAIProfile[];
	defaultProfileId: LocalAIProfileId;
};

type LocalAISettings = {
	enabled: boolean;
	installState: LocalAIInstallState;
	selectedProfileId: LocalAIProfileId;
	textModelId: string;
	sttModelId: string;
	ttsModelId: string;
	catalogVersion: string | null;
	installBundleVersion: string | null;
	installRoot: string;
	lastError: string | null;
};

type Settings = {
	provider: "openrouter" | "local";
	openrouterKey: string;
	openrouterModel: string;
	localAI: LocalAISettings;
	hotkeys: HotkeyMap;
};

type LocalAIStatus = {
	enabled: boolean;
	installState: LocalAIInstallState;
	currentPhase?: string;
	progressPct?: number;
	lastError?: string | null;
	storageUsedGB?: number;
	selectedProfileId: LocalAIProfileId;
	installRoot: string;
	catalogVersion: string | null;
	installBundleVersion: string | null;
	textModelId: string;
	sttModelId: string;
	ttsModelId: string;
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
			getLocalAICatalog: {
				params: {};
				response: { catalog: LocalAICatalog };
			};
			getLocalAIStatus: {
				params: {};
				response: LocalAIStatus;
			};
			installLocalAI: {
				params: { profileId?: LocalAIProfileId };
				response: { accepted: boolean; error?: string };
			};
			cancelLocalAIInstall: {
				params: {};
				response: { success: boolean };
			};
			repairLocalAI: {
				params: {};
				response: { accepted: boolean; error?: string };
			};
			removeLocalAI: {
				params: {};
				response: { success: boolean };
			};
			setLocalAIProfile: {
				params: { profileId: LocalAIProfileId };
				response: { success: boolean };
			};
			transcribeAudio: {
				params: { audioPath: string; language?: string };
				response: { text: string };
			};
			speakText: {
				params: { text: string };
				response: { accepted: boolean; audioPath?: string };
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
	maxRequestTime: 180000,
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
const settingsBtn = document.getElementById("settings-btn")!;
const settingsPanel = document.getElementById("settings-panel")!;
const settingsClose = document.getElementById("settings-close")!;
const openrouterSettings = document.getElementById("openrouter-settings")!;
const localSettings = document.getElementById("local-settings")!;
const openrouterKey = document.getElementById("openrouter-key") as HTMLInputElement;
const openrouterModel = document.getElementById("openrouter-model") as HTMLSelectElement;
const providerToggles = document.querySelectorAll<HTMLButtonElement>(".settings-toggle");
const localAIHeadline = document.getElementById("local-ai-headline")!;
const localAISummary = document.getElementById("local-ai-summary")!;
const localAIStatePill = document.getElementById("local-ai-state-pill")!;
const localAIProgressShell = document.getElementById("local-ai-progress-shell")!;
const localAIProgressFill = document.getElementById("local-ai-progress-fill")!;
const localAIPhase = document.getElementById("local-ai-phase")!;
const localAIProgressText = document.getElementById("local-ai-progress-text")!;
const localAIError = document.getElementById("local-ai-error")!;
const localAIErrorSummary = document.getElementById("local-ai-error-summary")!;
const localAIErrorBody = document.getElementById("local-ai-error-body")!;
const localAIEnable = document.getElementById("local-ai-enable") as HTMLButtonElement;
const localAIManage = document.getElementById("local-ai-manage") as HTMLButtonElement;
const localAIRetry = document.getElementById("local-ai-retry") as HTMLButtonElement;
const localAICancel = document.getElementById("local-ai-cancel") as HTMLButtonElement;
const localAIManagePanel = document.getElementById("local-ai-manage-panel")!;
const localAIProfileStarter = document.getElementById("local-ai-profile-starter") as HTMLButtonElement;
const localAIProfileQuality = document.getElementById("local-ai-profile-quality") as HTMLButtonElement;
const localAIInstallRoot = document.getElementById("local-ai-install-root")!;
const localAIStorage = document.getElementById("local-ai-storage")!;
const localAITextLabel = document.getElementById("local-ai-text-label")!;
const localAISttLabel = document.getElementById("local-ai-stt-label")!;
const localAITtsLabel = document.getElementById("local-ai-tts-label")!;
const localAIBundle = document.getElementById("local-ai-bundle")!;
const localAIAdvancedToggle = document.getElementById("local-ai-advanced-toggle") as HTMLButtonElement;
const localAIAdvanced = document.getElementById("local-ai-advanced")!;
const localAITextModel = document.getElementById("local-ai-text-model") as HTMLSelectElement;
const localAISttModel = document.getElementById("local-ai-stt-model") as HTMLSelectElement;
const localAITtsModel = document.getElementById("local-ai-tts-model") as HTMLSelectElement;
const localAIRepair = document.getElementById("local-ai-repair") as HTMLButtonElement;
const localAIRemove = document.getElementById("local-ai-remove") as HTMLButtonElement;
const micBtn = document.getElementById("mic-btn") as HTMLButtonElement;
const micStatus = document.getElementById("mic-status")!;
const micLottie = document.getElementById("mic-lottie") as HTMLDivElement;
const ttsAudio = document.getElementById("tts-audio") as HTMLAudioElement;

let selectedText = "";
let selectedRange: Range | null = null;
let isZen = false;
let isMarkdownMode = false;
let editorRawText = "";
let currentSettings: Settings | null = null;
let currentCatalog: LocalAICatalog | null = null;
let localAIStatus: LocalAIStatus | null = null;
let localAIManageOpen = false;
let localAIAdvancedOpen = false;
let localAIStatusPoll: ReturnType<typeof setInterval> | null = null;
let voiceClipboard = "";
let lastCursorRange: Range | null = null;
let isRecording = false;
let holdMode = false;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let recordingContext: AudioContext | null = null;
let recordingStream: MediaStream | null = null;
let recordingSource: MediaStreamAudioSourceNode | null = null;
let recordingProcessor: ScriptProcessorNode | null = null;
let recordingSilence: GainNode | null = null;
let recordedChunks: Float32Array[] = [];
let recordedSampleRate = 44100;

const micAnimation = lottie.loadAnimation({
	container: micLottie,
	renderer: "svg",
	loop: true,
	autoplay: false,
	animationData: microphoneAnimation,
	rendererSettings: {
		preserveAspectRatio: "xMidYMid meet",
	},
});

micAnimation.goToAndStop(0, true);

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

function getModelEntry(modelId: string) {
	return currentCatalog?.models.find((model) => model.id === modelId) ?? null;
}

function getProfile(profileId: LocalAIProfileId) {
	return currentCatalog?.profiles.find((profile) => profile.id === profileId) ?? null;
}

function getModelLabel(modelId: string) {
	return getModelEntry(modelId)?.label ?? modelId;
}

function updateWordCount() {
	const text = editor.innerText.trim();
	const count = text ? text.split(/\s+/).length : 0;
	wordCount.textContent = `${count} word${count !== 1 ? "s" : ""}`;
}

function showAIStatus(text: string) {
	aiStatus.textContent = text;
	aiStatus.classList.add("visible");
}

function hideAIStatus() {
	aiStatus.classList.remove("visible");
}

function toggleZen() {
	isZen = !isZen;
	app.classList.toggle("zen", isZen);
	if (isZen) {
		editor.innerHTML = "";
		editor.focus();
	}
}

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
	} catch (error) {
		console.error("Grammar fix failed:", error);
	} finally {
		grammarOverlay.style.display = "none";
		hideAIStatus();
	}
}

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
	selectedRange = null;
	chatContext.style.display = "none";
});

function captureSelection() {
	const selection = window.getSelection();
	if (selection && selection.rangeCount > 0 && selection.toString().trim() && editor.contains(selection.anchorNode)) {
		selectedText = selection.toString().trim();
		selectedRange = selection.getRangeAt(0).cloneRange();
		chatContext.style.display = "flex";
		return;
	}

	selectedText = "";
	selectedRange = null;
	chatContext.style.display = "none";
}

async function renderBubbleContent(bubble: HTMLElement) {
	const raw = bubble.dataset.rawText ?? "";
	const actions = bubble.querySelector(".chat-msg-actions");

	while (bubble.firstChild && bubble.firstChild !== actions) {
		bubble.removeChild(bubble.firstChild);
	}

	if (isMarkdownMode) {
		bubble.classList.remove("plain-text");
		const { html } = await electrobun.rpc!.request.renderMarkdown({ text: raw });
		const content = document.createElement("div");
		content.className = "markdown-content";
		content.innerHTML = html;
		bubble.insertBefore(content, actions || null);
		return;
	}

	bubble.classList.add("plain-text");
	bubble.insertBefore(document.createTextNode(raw), actions || null);
}

async function speakAssistantText(text: string) {
	showAIStatus("speaking...");
	try {
		const result = await electrobun.rpc!.request.speakText({ text });
		if (result.accepted && result.audioPath) {
			ttsAudio.src = `file://${result.audioPath}`;
			await ttsAudio.play();
		}
	} catch (error) {
		console.error("Speech playback failed:", error);
	} finally {
		hideAIStatus();
	}
}

function buildAssistantActions(text: string, showApply: boolean) {
	const actions = document.createElement("div");
	actions.className = "chat-msg-actions";

	if (showApply) {
		const applyButton = document.createElement("button");
		applyButton.className = "apply-btn";
		applyButton.textContent = "↳ Apply to selection";
		applyButton.addEventListener("click", () => {
			replaceSelection(text);
			chatPanel.classList.remove("open");
		});
		actions.appendChild(applyButton);
	}

	if (localAIStatus?.installState === "ready") {
		const speakButton = document.createElement("button");
		speakButton.className = "apply-btn";
		speakButton.textContent = "Read aloud";
		speakButton.addEventListener("click", () => {
			void speakAssistantText(text);
		});
		actions.appendChild(speakButton);
	}

	return actions.childElementCount > 0 ? actions : null;
}

async function addChatBubble(role: "user" | "assistant", text: string, showApply = false) {
	const bubble = document.createElement("div");
	bubble.className = `chat-msg ${role}`;

	if (role === "assistant") {
		bubble.dataset.rawText = text;
		const actions = buildAssistantActions(text, showApply);
		if (actions) bubble.appendChild(actions);
		await renderBubbleContent(bubble);
	} else {
		bubble.textContent = text;
	}

	chatMessages.appendChild(bubble);
	chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendChatMessage() {
	const userMsg = chatInput.value.trim();
	if (!userMsg) return;

	const contextText = selectedText;
	chatInput.value = "";
	await addChatBubble("user", userMsg);

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
		const { result } = await electrobun.rpc!.request.aiComplete({ text, instruction });
		await addChatBubble("assistant", result, Boolean(contextText));
	} catch (error) {
		console.error("Chat failed:", error);
		await addChatBubble("assistant", "Something went wrong. Please try again.");
	} finally {
		hideAIStatus();
	}
}

chatSend.addEventListener("click", () => {
	void sendChatMessage();
});

chatInput.addEventListener("keydown", (event) => {
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		void sendChatMessage();
	}
});

async function toggleMarkdownMode() {
	isMarkdownMode = !isMarkdownMode;

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

function setProviderUI(provider: Settings["provider"]) {
	providerToggles.forEach((button) => {
		button.classList.toggle("active", button.dataset.provider === provider);
	});
	openrouterSettings.style.display = provider === "openrouter" ? "flex" : "none";
	localSettings.style.display = provider === "local" ? "flex" : "none";
}

function renderModelOptions(select: HTMLSelectElement, kind: LocalAIModelKind, selectedId: string) {
	if (!currentCatalog) return;
	select.innerHTML = "";
	const models = currentCatalog.models.filter((model) => model.kind === kind && (!model.hidden || model.id === selectedId));
	for (const model of models) {
		const option = document.createElement("option");
		option.value = model.id;
		option.textContent = `${model.label} • ${model.quantization} • ${model.approxDownloadGB.toFixed(1)} GB`;
		select.appendChild(option);
	}
	ensureSelectValue(select, selectedId, "Custom model");
}

function setActiveProfileButton(profileId: LocalAIProfileId) {
	localAIProfileStarter.classList.toggle("active", profileId === "starter");
	localAIProfileQuality.classList.toggle("active", profileId === "quality");
}

function renderLocalAIUI() {
	if (!currentSettings || !localAIStatus) return;

	const profile = getProfile(currentSettings.localAI.selectedProfileId);
	const state = localAIStatus.installState;
	const progress = localAIStatus.progressPct ?? 0;

	localAIHeadline.textContent = state === "ready" ? "Local AI Ready" : "Enable Local AI";
	localAIStatePill.textContent =
		state === "ready" ? "Ready" :
		state === "installing" ? "Installing" :
		state === "error" ? "Needs attention" :
		"Not installed";
	localAIStatePill.className = `local-ai-pill ${state}`;
	localAISummary.textContent =
		state === "ready"
			? `${profile?.label ?? "Starter"} bundle installed. Local writing help, dictation, and speech are available offline.`
			: state === "installing"
				? "BuddyWriter is downloading and preparing the local runtime for you."
				: "One button installs the managed runtime, text model, voice input model, and voice output model.";

	localAIProgressShell.style.display = state === "installing" ? "flex" : "none";
	localAIProgressFill.style.width = `${progress}%`;
	localAIPhase.textContent = localAIStatus.currentPhase ?? "Preparing local AI workspace";
	localAIProgressText.textContent = `${progress}%`;

	const hasError = state === "error" && Boolean(localAIStatus.lastError);
	localAIError.style.display = hasError ? "block" : "none";
	localAIErrorSummary.textContent = localAIStatus.lastError ?? "";
	localAIErrorBody.textContent = localAIStatus.lastError ?? "";

	localAIEnable.style.display = state === "ready" ? "none" : "inline-flex";
	localAIEnable.textContent = state === "installing" ? "Installing..." : "Enable Local AI";
	localAIEnable.disabled = state === "installing";
	localAIManage.style.display = (state === "ready" || hasError) ? "inline-flex" : "none";
	localAIRetry.style.display = hasError ? "inline-flex" : "none";
	localAICancel.style.display = state === "installing" ? "inline-flex" : "none";

	localAIManagePanel.style.display = localAIManageOpen && state !== "installing" && state !== "not_installed" ? "flex" : "none";
	localAIInstallRoot.textContent = localAIStatus.installRoot;
	localAIStorage.textContent = `${(localAIStatus.storageUsedGB ?? 0).toFixed(1)} GB`;
	localAITextLabel.textContent = getModelLabel(currentSettings.localAI.textModelId);
	localAISttLabel.textContent = getModelLabel(currentSettings.localAI.sttModelId);
	localAITtsLabel.textContent = getModelLabel(currentSettings.localAI.ttsModelId);
	localAIBundle.textContent = localAIStatus.installBundleVersion ?? "Not installed";
	setActiveProfileButton(currentSettings.localAI.selectedProfileId);

	renderModelOptions(localAITextModel, "text", currentSettings.localAI.textModelId);
	renderModelOptions(localAISttModel, "stt", currentSettings.localAI.sttModelId);
	renderModelOptions(localAITtsModel, "tts", currentSettings.localAI.ttsModelId);
	localAIAdvanced.style.display = localAIAdvancedOpen ? "flex" : "none";
	localAIAdvancedToggle.textContent = localAIAdvancedOpen ? "Hide Advanced" : "Advanced";
}

function startLocalAIStatusPolling() {
	if (localAIStatusPoll) return;
	localAIStatusPoll = setInterval(() => {
		void refreshLocalAIStatus();
	}, 1200);
}

function stopLocalAIStatusPolling() {
	if (!localAIStatusPoll) return;
	clearInterval(localAIStatusPoll);
	localAIStatusPoll = null;
}

async function refreshLocalAIStatus() {
	localAIStatus = await electrobun.rpc!.request.getLocalAIStatus({});
	renderLocalAIUI();

	if (localAIStatus.installState === "installing" || settingsPanel.classList.contains("open")) {
		startLocalAIStatusPolling();
	} else {
		stopLocalAIStatusPolling();
	}
}

async function loadSettingsUI() {
	const [{ catalog }, settingsResponse] = await Promise.all([
		electrobun.rpc!.request.getLocalAICatalog({}),
		electrobun.rpc!.request.getSettings({}),
	]);
	currentCatalog = catalog;
	currentSettings = settingsResponse;

	openrouterKey.value = currentSettings.openrouterKey;
	openrouterModel.value = currentSettings.openrouterModel;
	setProviderUI(currentSettings.provider);
	loadHotkeysUI();
	await refreshLocalAIStatus();
	renderLocalAIUI();
}

async function openSettingsForLocalAI(message?: string) {
	if (!settingsPanel.classList.contains("open")) {
		settingsPanel.classList.add("open");
	}

	await loadSettingsUI();
	startLocalAIStatusPolling();
	setProviderUI("local");
	localSettings.scrollIntoView({ block: "start", behavior: "smooth" });

	if (message) {
		showAIStatus(message);
		setTimeout(() => {
			if (aiStatus.textContent === message) hideAIStatus();
		}, 3500);
	}
}

async function ensureVoiceInputReady() {
	if (!currentSettings || !localAIStatus) {
		await loadSettingsUI();
	} else {
		await refreshLocalAIStatus();
	}

	if (localAIStatus?.installState === "ready") {
		return true;
	}

	await openSettingsForLocalAI("Set up Local AI voice input before using dictation.");
	return false;
}

settingsBtn.addEventListener("click", async (event) => {
	event.stopPropagation();
	settingsPanel.classList.toggle("open");
	if (settingsPanel.classList.contains("open")) {
		await loadSettingsUI();
		startLocalAIStatusPolling();
	} else {
		stopLocalAIStatusPolling();
	}
});

settingsClose.addEventListener("click", () => {
	settingsPanel.classList.remove("open");
	stopLocalAIStatusPolling();
	void persistSettings();
});

providerToggles.forEach((button) => {
	button.addEventListener("click", () => {
		if (!currentSettings) return;
		const provider = button.dataset.provider as Settings["provider"];
		currentSettings.provider = provider;
		setProviderUI(provider);
		void persistSettings();
	});
});

openrouterKey.addEventListener("change", () => void persistSettings());
openrouterModel.addEventListener("change", () => void persistSettings());

function populateHotkeysList() {
	const list = document.getElementById("hotkeys-list")!;
	list.innerHTML = "";
	const hotkeys = currentSettings?.hotkeys ?? defaultHotkeys;

	for (const actionId of Object.keys(hotkeyLabels) as (keyof HotkeyMap)[]) {
		const row = document.createElement("div");
		row.className = "hotkey-row";

		const label = document.createElement("span");
		label.className = "hotkey-action";
		label.textContent = hotkeyLabels[actionId];

		const button = document.createElement("button");
		button.className = "hotkey-btn";
		button.textContent = formatHotkey(hotkeys[actionId]);
		button.addEventListener("click", () => recordHotkey(actionId, button));

		row.appendChild(label);
		row.appendChild(button);
		list.appendChild(row);
	}
}

function loadHotkeysUI() {
	populateHotkeysList();
}

function formatHotkey(hotkey: Hotkey) {
	let label = "";
	if (hotkey.mod) label += "⌘";
	if (hotkey.shift) label += "⇧";
	label += hotkey.key.toUpperCase();
	return label;
}

function recordHotkey(actionId: keyof HotkeyMap, button: HTMLButtonElement) {
	button.classList.add("recording");
	button.textContent = "Press keys...";

	const handler = (event: KeyboardEvent) => {
		event.preventDefault();
		event.stopPropagation();
		const key = event.key.toLowerCase();
		if (["meta", "control", "shift", "alt"].includes(key)) return;

		const hotkey: Hotkey = {
			mod: event.metaKey || event.ctrlKey,
			shift: event.shiftKey,
			key,
		};

		button.classList.remove("recording");
		button.textContent = formatHotkey(hotkey);

		if (currentSettings) {
			currentSettings.hotkeys[actionId] = hotkey;
			void persistSettings();
		}

		document.removeEventListener("keydown", handler, true);
	};

	document.addEventListener("keydown", handler, true);
}

async function persistSettings() {
	if (!currentSettings) return;
	currentSettings.openrouterKey = openrouterKey.value;
	currentSettings.openrouterModel = openrouterModel.value;
	const result = await electrobun.rpc!.request.saveSettings(currentSettings);
	if (!result.success && result.error) {
		console.error(result.error);
		showAIStatus(result.error);
		setTimeout(() => hideAIStatus(), 4000);
	}
}

async function beginLocalAIInstall(profileId?: LocalAIProfileId) {
	if (!currentSettings) return;
	currentSettings.provider = "local";
	setProviderUI("local");
	await persistSettings();
	const result = await electrobun.rpc!.request.installLocalAI({
		profileId: profileId ?? currentSettings.localAI.selectedProfileId,
	});
	if (!result.accepted && result.error) {
		localAIError.style.display = "block";
		localAIErrorSummary.textContent = result.error;
		localAIErrorBody.textContent = result.error;
	}
	await refreshLocalAIStatus();
}

localAIEnable.addEventListener("click", () => {
	void beginLocalAIInstall();
});

localAIRetry.addEventListener("click", () => {
	void beginLocalAIInstall();
});

localAICancel.addEventListener("click", async () => {
	await electrobun.rpc!.request.cancelLocalAIInstall({});
	await refreshLocalAIStatus();
});

localAIManage.addEventListener("click", () => {
	localAIManageOpen = !localAIManageOpen;
	renderLocalAIUI();
});

localAIAdvancedToggle.addEventListener("click", () => {
	localAIAdvancedOpen = !localAIAdvancedOpen;
	renderLocalAIUI();
});

async function setLocalAIProfile(profileId: LocalAIProfileId) {
	if (!currentSettings) return;
	currentSettings.localAI.selectedProfileId = profileId;
	await electrobun.rpc!.request.setLocalAIProfile({ profileId });
	const profile = getProfile(profileId);
	if (profile) {
		currentSettings.localAI.textModelId = profile.textModelId;
		currentSettings.localAI.sttModelId = profile.sttModelId;
		currentSettings.localAI.ttsModelId = profile.ttsModelId;
	}
	await persistSettings();
	await refreshLocalAIStatus();
}

localAIProfileStarter.addEventListener("click", () => {
	void setLocalAIProfile("starter");
});

localAIProfileQuality.addEventListener("click", () => {
	void setLocalAIProfile("quality");
});

function wireAdvancedModelSelect(select: HTMLSelectElement, key: keyof LocalAISettings) {
	select.addEventListener("change", () => {
		if (!currentSettings) return;
		currentSettings.localAI[key] = select.value as never;
		void persistSettings();
		renderLocalAIUI();
	});
}

wireAdvancedModelSelect(localAITextModel, "textModelId");
wireAdvancedModelSelect(localAISttModel, "sttModelId");
wireAdvancedModelSelect(localAITtsModel, "ttsModelId");

localAIRepair.addEventListener("click", async () => {
	await electrobun.rpc!.request.repairLocalAI({});
	await refreshLocalAIStatus();
});

localAIRemove.addEventListener("click", async () => {
	await electrobun.rpc!.request.removeLocalAI({});
	if (currentSettings) {
		currentSettings.provider = "openrouter";
	}
	localAIManageOpen = false;
	localAIAdvancedOpen = false;
	await loadSettingsUI();
});

function wrapSelection(before: string, after: string) {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) return;
	const range = selection.getRangeAt(0);
	const text = range.toString();
	if (!text) return;

	range.deleteContents();
	const node = document.createTextNode(`${before}${text}${after}`);
	range.insertNode(node);

	const nextRange = document.createRange();
	nextRange.setStartAfter(node);
	nextRange.collapse(true);
	selection.removeAllRanges();
	selection.addRange(nextRange);
	updateWordCount();
}

document.addEventListener("keydown", (event) => {
	const mod = event.metaKey || event.ctrlKey;
	const inEditor = document.activeElement === editor || editor.contains(document.activeElement);
	const key = event.key.toLowerCase();

	if (mod && !event.shiftKey && key === "a" && inEditor) {
		event.preventDefault();
		const selection = window.getSelection();
		if (selection) {
			const range = document.createRange();
			range.selectNodeContents(editor);
			selection.removeAllRanges();
			selection.addRange(range);
		}
	} else if (mod && !event.shiftKey && key === "c") {
		const selection = window.getSelection();
		if (selection && selection.toString()) {
			event.preventDefault();
			void navigator.clipboard.writeText(selection.toString());
		}
	} else if (mod && !event.shiftKey && key === "x") {
		const selection = window.getSelection();
		if (selection && selection.toString() && inEditor) {
			event.preventDefault();
			void navigator.clipboard.writeText(selection.toString());
			selection.deleteFromDocument();
			updateWordCount();
		}
	} else if (mod && !event.shiftKey && key === "v" && inEditor) {
		event.preventDefault();
		void navigator.clipboard.readText().then((text) => {
			const selection = window.getSelection();
			if (!selection || !selection.rangeCount) return;
			const range = selection.getRangeAt(0);
			range.deleteContents();
			range.insertNode(document.createTextNode(text));
			range.collapse(false);
			selection.removeAllRanges();
			selection.addRange(range);
			updateWordCount();
		});
	} else if (mod && !event.shiftKey && key === "z" && inEditor) {
		event.preventDefault();
		document.execCommand("undo");
	} else if (mod && event.shiftKey && key === "z" && inEditor) {
		event.preventDefault();
		document.execCommand("redo");
	} else {
		const hotkeys = currentSettings?.hotkeys ?? defaultHotkeys;
		const matchesHotkey = (hotkey: Hotkey) => hotkey.mod === mod && hotkey.shift === event.shiftKey && hotkey.key === key;

		if (matchesHotkey(hotkeys.zenMode)) {
			event.preventDefault();
			toggleZen();
		} else if (matchesHotkey(hotkeys.fixGrammar)) {
			event.preventDefault();
			void handleGrammarFix();
		} else if (matchesHotkey(hotkeys.aiChat)) {
			event.preventDefault();
			toggleChat();
		} else if (matchesHotkey(hotkeys.toggleMarkdown)) {
			event.preventDefault();
			void toggleMarkdownMode();
		} else if (matchesHotkey(hotkeys.bold)) {
			event.preventDefault();
			wrapSelection("**", "**");
		} else if (matchesHotkey(hotkeys.italic)) {
			event.preventDefault();
			wrapSelection("*", "*");
		} else if (matchesHotkey(hotkeys.link)) {
			event.preventDefault();
			wrapSelection("[", "](url)");
		} else if (matchesHotkey(hotkeys.code)) {
			event.preventDefault();
			wrapSelection("`", "`");
		} else if (event.key === "Escape") {
			if (settingsPanel.classList.contains("open")) {
				settingsPanel.classList.remove("open");
				stopLocalAIStatusPolling();
				void persistSettings();
			} else if (chatPanel.classList.contains("open")) {
				chatPanel.classList.remove("open");
			} else if (isZen) {
				toggleZen();
			}
		}
	}
});

function syncMicAnimation() {
	if (micBtn.classList.contains("recording")) {
		micAnimation.setSpeed(1.35);
		micAnimation.play();
		return;
	}

	if (micBtn.classList.contains("transcribing")) {
		micAnimation.setSpeed(1);
		micAnimation.play();
		return;
	}

	micAnimation.stop();
}

function saveCursorPosition() {
	const selection = window.getSelection();
	if (selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
		lastCursorRange = selection.getRangeAt(0).cloneRange();
		positionMicAtCursor();
	}
}

function positionMicAtCursor() {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) {
		micBtn.classList.remove("visible");
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
	micBtn.style.left = `${x + 8}px`;
	micBtn.style.top = `${y + lineHeight / 2 - 14}px`;

	if (!micBtn.classList.contains("recording") && !micBtn.classList.contains("transcribing")) {
		micBtn.classList.add("visible");
	}
}

function insertTextAtCursor(text: string) {
	editor.focus();
	const selection = window.getSelection();
	if (!selection) return;

	if (lastCursorRange) {
		selection.removeAllRanges();
		selection.addRange(lastCursorRange);
	}

	const range = selection.getRangeAt(0);
	range.deleteContents();
	const node = document.createTextNode(text);
	range.insertNode(node);
	range.setStartAfter(node);
	range.collapse(true);
	selection.removeAllRanges();
	selection.addRange(range);
	lastCursorRange = range.cloneRange();
	updateWordCount();
}

function encodeWav(chunks: Float32Array[], sampleRate: number) {
	const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const buffer = new ArrayBuffer(44 + length * 2);
	const view = new DataView(buffer);

	function writeString(offset: number, value: string) {
		for (let index = 0; index < value.length; index += 1) {
			view.setUint8(offset + index, value.charCodeAt(index));
		}
	}

	writeString(0, "RIFF");
	view.setUint32(4, 36 + length * 2, true);
	writeString(8, "WAVE");
	writeString(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeString(36, "data");
	view.setUint32(40, length * 2, true);

	let offset = 44;
	for (const chunk of chunks) {
		for (let index = 0; index < chunk.length; index += 1) {
			const sample = Math.max(-1, Math.min(1, chunk[index]));
			view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
			offset += 2;
		}
	}

	return buffer;
}

async function finishRecording() {
	if (recordedChunks.length === 0) return;

	micBtn.classList.remove("recording");
	micBtn.classList.add("transcribing");
	micBtn.classList.add("visible");
	micStatus.textContent = "transcribing...";
	showAIStatus("transcribing voice...");
	syncMicAnimation();

	try {
		const wavBuffer = encodeWav(recordedChunks, recordedSampleRate);
		const base64 = btoa(String.fromCharCode(...new Uint8Array(wavBuffer)));
		const { text } = await electrobun.rpc!.request.transcribeAudio({
			audioPath: `base64:${base64}`,
		});

		if (text.trim()) {
			voiceClipboard = text;
			insertTextAtCursor(text);
		}
	} catch (error) {
		console.error("Transcription failed:", error);
		micStatus.textContent = "error";
		setTimeout(() => {
			micStatus.textContent = "";
		}, 2000);
	} finally {
		micBtn.classList.remove("transcribing");
		micStatus.textContent = "";
		hideAIStatus();
		syncMicAnimation();
	}
}

async function startRecording() {
	if (isRecording) return;
	saveCursorPosition();

	try {
		recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
		recordingContext = new AudioContext();
		recordedSampleRate = recordingContext.sampleRate;
		recordedChunks = [];

		recordingSource = recordingContext.createMediaStreamSource(recordingStream);
		recordingProcessor = recordingContext.createScriptProcessor(4096, 1, 1);
		recordingSilence = recordingContext.createGain();
		recordingSilence.gain.value = 0;

		recordingProcessor.onaudioprocess = (event) => {
			if (!isRecording) return;
			recordedChunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
		};

		recordingSource.connect(recordingProcessor);
		recordingProcessor.connect(recordingSilence);
		recordingSilence.connect(recordingContext.destination);

		isRecording = true;
		micBtn.classList.add("recording");
		micBtn.classList.add("visible");
		micStatus.textContent = "● rec";
		syncMicAnimation();
	} catch (error) {
		console.error("Mic access failed:", error);
		micStatus.textContent = "mic denied";
		setTimeout(() => {
			micStatus.textContent = "";
		}, 2000);
		syncMicAnimation();
	}
}

function stopRecording() {
	if (!isRecording) return;
	isRecording = false;
	recordingSource?.disconnect();
	recordingProcessor?.disconnect();
	recordingSilence?.disconnect();
	recordingStream?.getTracks().forEach((track) => track.stop());
	void recordingContext?.close();
	recordingSource = null;
	recordingProcessor = null;
	recordingSilence = null;
	recordingStream = null;
	recordingContext = null;
	void finishRecording();
}

micBtn.addEventListener("mousedown", (event) => {
	event.preventDefault();
	if (isRecording) {
		stopRecording();
		return;
	}

	holdMode = false;
	void (async () => {
		const voiceInputReady = await ensureVoiceInputReady();
		if (!voiceInputReady) return;

		holdTimer = setTimeout(() => {
			holdMode = true;
		}, 200);
		await startRecording();
	})();
});

micBtn.addEventListener("mouseup", () => {
	if (holdTimer) {
		clearTimeout(holdTimer);
		holdTimer = null;
	}
	if (holdMode && isRecording) stopRecording();
});

micBtn.addEventListener("mouseleave", () => {
	if (holdTimer) {
		clearTimeout(holdTimer);
		holdTimer = null;
	}
	if (holdMode && isRecording) stopRecording();
});

document.addEventListener("keydown", (event) => {
	if ((event.metaKey || event.ctrlKey) && event.altKey && event.key.toLowerCase() === "v") {
		event.preventDefault();
		if (voiceClipboard) insertTextAtCursor(voiceClipboard);
	}
}, true);

editor.addEventListener("mouseup", saveCursorPosition);
editor.addEventListener("keyup", saveCursorPosition);
editor.addEventListener("input", positionMicAtCursor);
editor.addEventListener("focus", () => {
	setTimeout(positionMicAtCursor, 0);
});
editor.addEventListener("blur", () => {
	setTimeout(() => {
		if (document.activeElement !== micBtn && !isRecording && !micBtn.classList.contains("transcribing")) {
			micBtn.classList.remove("visible");
		}
	}, 150);
});

editor.addEventListener("input", updateWordCount);
updateWordCount();
editor.focus();
