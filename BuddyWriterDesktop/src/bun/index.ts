import {
	BrowserView,
	BrowserWindow,
	ApplicationMenu,
	Utils,
	type RPCSchema,
} from "electrobun/bun";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { type Subprocess, spawn } from "bun";

type StartResult = {
	ok: boolean;
	error?: string;
};

// ─── Settings persistence ───
const settingsDir = Utils.paths.userData;
if (!existsSync(settingsDir)) mkdirSync(settingsDir, { recursive: true });
const settingsPath = join(settingsDir, "settings.json");

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

type PersistedSettings = Omit<Settings, "openrouterKey">;

const defaultSettings: Settings = {
	provider: "openrouter",
	openrouterKey: Bun.env.OPENROUTER_API_KEY ?? "",
	openrouterModel: "google/gemini-2.5-flash",
	mlxModel: "mlx-community/Qwen3-4B-Instruct-2507-4bit",
	mlxPythonPath: "python3",
	whisperModel: "mlx-community/whisper-large-v3-turbo",
	hotkeys: {
		zenMode: { mod: true, shift: true, key: "f" },
		fixGrammar: { mod: true, shift: false, key: "g" },
		aiChat: { mod: true, shift: true, key: "a" },
		toggleMarkdown: { mod: true, shift: true, key: "m" },
		bold: { mod: true, shift: false, key: "b" },
		italic: { mod: true, shift: false, key: "i" },
		link: { mod: true, shift: false, key: "k" },
		code: { mod: true, shift: false, key: "e" },
	},
};

function loadSettings(): Settings {
	try {
		if (existsSync(settingsPath)) {
			const persisted = JSON.parse(readFileSync(settingsPath, "utf-8")) as Partial<PersistedSettings>;
			return { ...defaultSettings, ...persisted, openrouterKey: defaultSettings.openrouterKey };
		}
	} catch {}
	return { ...defaultSettings };
}

function saveSettings(s: Settings) {
	const persisted: PersistedSettings = {
		provider: s.provider,
		openrouterModel: s.openrouterModel,
		mlxModel: s.mlxModel,
		mlxPythonPath: s.mlxPythonPath,
		whisperModel: s.whisperModel,
		hotkeys: s.hotkeys,
	};

	writeFileSync(settingsPath, JSON.stringify(persisted, null, 2));
}

let settings = loadSettings();

// ─── MLX Sidecar ───
const MLX_PORT = 8079;
const MAX_SIDECAR_LOG_LINES = 60;
let mlxProc: Subprocess | null = null;
let mlxProcModel: string | null = null;
const mlxLogs: string[] = [];

function normalizePythonPath(pythonPath: string) {
	return pythonPath.trim() || "python3";
}

function pushLogLines(buffer: string[], text: string) {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	if (lines.length === 0) return;

	buffer.push(...lines);
	if (buffer.length > MAX_SIDECAR_LOG_LINES) {
		buffer.splice(0, buffer.length - MAX_SIDECAR_LOG_LINES);
	}
}

async function captureProcessStream(
	stream: ReadableStream<Uint8Array> | null | undefined,
	buffer: string[],
) {
	if (!stream) return;

	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let pending = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			pending += decoder.decode(value, { stream: true });
			const chunks = pending.split(/\r?\n/);
			pending = chunks.pop() ?? "";

			for (const chunk of chunks) {
				pushLogLines(buffer, chunk);
			}
		}

		pending += decoder.decode();
		pushLogLines(buffer, pending);
	} catch {}
}

function trackProcessLogs(proc: Subprocess, buffer: string[]) {
	buffer.length = 0;
	void captureProcessStream(proc.stdout as ReadableStream<Uint8Array> | null, buffer);
	void captureProcessStream(proc.stderr as ReadableStream<Uint8Array> | null, buffer);
}

function recentLogs(buffer: string[], fallback: string) {
	if (buffer.length === 0) return fallback;
	return buffer.slice(-6).join(" | ");
}

async function isSidecarHealthy(port: number) {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/health`);
		return res.ok;
	} catch {
		return false;
	}
}

async function startMLX(model: string, pythonPath: string): Promise<StartResult> {
	if (mlxProc) {
		mlxProc.kill();
		mlxProc = null;
		mlxProcModel = null;
	}

	try {
		const resolvedPythonPath = normalizePythonPath(pythonPath);
		mlxProc = spawn({
			cmd: [
				resolvedPythonPath, "-m", "mlx_lm.server",
				"--model", model,
				"--port", String(MLX_PORT),
				"--host", "127.0.0.1",
				"--max-tokens", "2048",
			],
			stdout: "pipe",
			stderr: "pipe",
		});
		mlxProcModel = model;
		trackProcessLogs(mlxProc, mlxLogs);

		// Wait for health
		const start = Date.now();
		while (Date.now() - start < 120_000) {
			if (await isSidecarHealthy(MLX_PORT)) return { ok: true };
			await Bun.sleep(800);
		}
		mlxProc.kill();
		mlxProc = null;
		mlxProcModel = null;
		return {
			ok: false,
			error: `MLX server failed to start for ${model}. ${recentLogs(mlxLogs, "Check the python path and run `pip install -U mlx-lm`.")}`,
		};
	} catch {
		mlxProcModel = null;
		return {
			ok: false,
			error: `Unable to launch MLX server. ${recentLogs(mlxLogs, "Check the python path and run `pip install -U mlx-lm`.")}`,
		};
	}
}

function stopMLX() {
	if (mlxProc) {
		mlxProc.kill();
		mlxProc = null;
	}
	mlxProcModel = null;
}

async function ensureMLXRunning(model: string, pythonPath: string): Promise<StartResult> {
	if (mlxProc && mlxProcModel && mlxProcModel !== model) {
		stopMLX();
	}

	if (await isSidecarHealthy(MLX_PORT)) {
		return { ok: true };
	}

	return startMLX(model, pythonPath);
}

// ─── Whisper Sidecar ───
const WHISPER_PORT = 8765;
let whisperProc: Subprocess | null = null;
let whisperProcModel: string | null = null;
const whisperLogs: string[] = [];

async function startWhisper(model: string, pythonPath: string): Promise<StartResult> {
	if (whisperProc) {
		whisperProc.kill();
		whisperProc = null;
		whisperProcModel = null;
	}

	const scriptPath = join(import.meta.dir, "whisper_server.py");

	try {
		const resolvedPythonPath = normalizePythonPath(pythonPath);
		whisperProc = spawn({
			cmd: [resolvedPythonPath, scriptPath],
			env: {
				...process.env,
				WHISPER_MODEL: model,
				WHISPER_PORT: String(WHISPER_PORT),
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		whisperProcModel = model;
		trackProcessLogs(whisperProc, whisperLogs);

		const start = Date.now();
		while (Date.now() - start < 180_000) {
			if (await isSidecarHealthy(WHISPER_PORT)) return { ok: true };
			await Bun.sleep(1000);
		}
		whisperProc.kill();
		whisperProc = null;
		whisperProcModel = null;
		return {
			ok: false,
			error: `Voice server failed to start for ${model}. ${recentLogs(whisperLogs, "Check the python path and run `pip install -U mlx-whisper` plus `brew install ffmpeg`.")}`,
		};
	} catch {
		whisperProcModel = null;
		return {
			ok: false,
			error: `Unable to launch the local voice server. ${recentLogs(whisperLogs, "Check the python path and run `pip install -U mlx-whisper` plus `brew install ffmpeg`.")}`,
		};
	}
}

function stopWhisper() {
	if (whisperProc) {
		whisperProc.kill();
		whisperProc = null;
	}
	whisperProcModel = null;
}

async function ensureWhisperRunning(model: string, pythonPath: string): Promise<StartResult> {
	if (whisperProc && whisperProcModel && whisperProcModel !== model) {
		stopWhisper();
	}

	if (await isSidecarHealthy(WHISPER_PORT)) {
		return { ok: true };
	}

	return startWhisper(model, pythonPath);
}

async function transcribeAudio(audioPath: string, language?: string): Promise<string> {
	let filePath = audioPath;

	// Handle base64-encoded audio from the webview
	if (audioPath.startsWith("base64:")) {
		const base64Data = audioPath.slice(7);
		const buffer = Buffer.from(base64Data, "base64");
		filePath = join("/tmp", `buddywriter_voice_${Date.now()}.webm`);
		writeFileSync(filePath, buffer);
	}

	try {
		const startResult = await ensureWhisperRunning(settings.whisperModel, settings.mlxPythonPath);
		if (!startResult.ok) {
			throw new Error(startResult.error ?? "Voice server is unavailable.");
		}

		const response = await fetch(`http://127.0.0.1:${WHISPER_PORT}/transcribe`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ audio_path: filePath, language }),
		});
		if (!response.ok) {
			const err = await response.json() as { error: string };
			throw new Error(err.error);
		}
		const data = await response.json() as { text: string };
		return data.text;
	} finally {
		// Clean up temp file
		if (filePath !== audioPath) {
			try { unlinkSync(filePath); } catch {}
		}
	}
}

// ─── AI call router ───
async function callAI(systemPrompt: string, userMessage: string): Promise<string> {
	if (settings.provider === "mlx") {
		const startResult = await ensureMLXRunning(settings.mlxModel, settings.mlxPythonPath);
		if (!startResult.ok) {
			throw new Error(startResult.error ?? "MLX server is unavailable.");
		}

		return callMLX(systemPrompt, userMessage);
	}
	return callOpenRouter(systemPrompt, userMessage);
}

async function callOpenRouter(systemPrompt: string, userMessage: string): Promise<string> {
	if (!settings.openrouterKey.trim()) {
		throw new Error("OpenRouter API key is missing. Set OPENROUTER_API_KEY or enter a key in Settings for this session.");
	}

	const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${settings.openrouterKey}`,
		},
		body: JSON.stringify({
			model: settings.openrouterModel,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userMessage },
			],
		}),
	});
	const data = await response.json();
	return data.choices?.[0]?.message?.content ?? "";
}

async function callMLX(systemPrompt: string, userMessage: string): Promise<string> {
	const response = await fetch(`http://127.0.0.1:${MLX_PORT}/v1/chat/completions`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userMessage },
			],
			max_tokens: 2048,
			temperature: 0.7,
		}),
	});
	const data = await response.json();
	return data.choices?.[0]?.message?.content ?? "";
}

function escapeMarkdownHtml(text: string) {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

// ─── RPC ───
type WriterRPC = {
	bun: RPCSchema<{
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
				response: { success: boolean };
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
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {
			toggleZenMode: {};
			fixGrammar: {};
			toggleAIChat: {};
			toggleMarkdown: {};
		};
	}>;
};

const writerRPC = BrowserView.defineRPC<WriterRPC>({
	maxRequestTime: 120000,
	handlers: {
		requests: {
			aiComplete: async ({ text, instruction }: { text: string; instruction: string }) => {
				const result = await callAI(instruction, text);
				return { result };
			},
			grammarFix: async ({ text }: { text: string }) => {
				const result = await callAI(
					"You are a grammar and style editor. Fix grammar, spelling, and punctuation errors in the following text. Return ONLY the corrected text, nothing else. Preserve the original meaning and tone.",
					text,
				);
				return { result };
				},
				renderMarkdown: ({ text }: { text: string }) => {
					return { html: Bun.markdown.html(escapeMarkdownHtml(text)) };
				},
			getSettings: () => {
				return settings;
			},
			saveSettings: (newSettings: Settings) => {
				settings = { ...settings, ...newSettings };
				settings.mlxPythonPath = normalizePythonPath(settings.mlxPythonPath);
				saveSettings(settings);
				return { success: true };
			},
			startMLXServer: async ({ model, pythonPath }: { model: string; pythonPath: string }) => {
				const result = await startMLX(model, pythonPath);
				if (result.ok) {
					settings.mlxModel = model;
					settings.mlxPythonPath = normalizePythonPath(pythonPath);
					saveSettings(settings);
					return { success: true };
				}

				return { success: false, error: result.error };
			},
			stopMLXServer: () => {
				stopMLX();
				return { success: true };
			},
			getMLXStatus: async () => {
				return { running: await isSidecarHealthy(MLX_PORT) };
			},
			startWhisperServer: async ({ model, pythonPath }: { model: string; pythonPath: string }) => {
				const result = await startWhisper(model, pythonPath);
				if (result.ok) {
					settings.whisperModel = model;
					settings.mlxPythonPath = normalizePythonPath(pythonPath);
					saveSettings(settings);
					return { success: true };
				}

				return { success: false, error: result.error };
			},
			stopWhisperServer: () => {
				stopWhisper();
				return { success: true };
			},
			getWhisperStatus: async () => {
				return { running: await isSidecarHealthy(WHISPER_PORT) };
			},
			transcribeAudio: async ({ audioPath, language }: { audioPath: string; language?: string }) => {
				const text = await transcribeAudio(audioPath, language);
				return { text };
			},
		},
		messages: {},
	},
});

// ─── Window ───
const win = new BrowserWindow({
	title: "BuddyWriter",
	url: "views://mainview/index.html",
	rpc: writerRPC,
	titleBarStyle: "hiddenInset",
	frame: {
		x: 200,
		y: 200,
		width: 1000,
		height: 700,
	},
});

// Keep the RPC-enabled renderer on bundled app content only.
win.webview.setNavigationRules([
	"^*",
	"views://mainview/*",
	"views://internal/*",
]);

// ─── Menu ───
ApplicationMenu.setApplicationMenu([
	{
		label: "BuddyWriter",
		submenu: [
			{ role: "about" },
			{ role: "separator" },
			{ role: "hide" },
			{ role: "hideOthers" },
			{ role: "separator" },
			{ role: "quit" },
		],
	},
	{
		label: "File",
		submenu: [],
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo" },
			{ role: "redo" },
			{ role: "separator" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" },
			{ role: "selectAll" },
		],
	},
	{
		label: "View",
		submenu: [
			{
				label: "Zen Mode",
				action: "zen-mode",
				accelerator: "CommandOrControl+Shift+F",
			},
		],
	},
	{
		label: "AI",
		submenu: [
			{
				label: "Fix Grammar",
				action: "fix-grammar",
				accelerator: "CommandOrControl+G",
			},
			{
				label: "AI Chat",
				action: "ai-chat",
				accelerator: "CommandOrControl+Shift+A",
			},
			{
				label: "Toggle Markdown",
				action: "toggle-markdown",
				accelerator: "CommandOrControl+Shift+M",
			},
		],
	},
]);

ApplicationMenu.on("application-menu-clicked", (event) => {
	const e = event as { data?: { action?: string } };

	switch (e.data?.action) {
		case "zen-mode":
			win.webview.rpc?.send.toggleZenMode({});
			break;
		case "fix-grammar":
			win.webview.rpc?.send.fixGrammar({});
			break;
		case "ai-chat":
			win.webview.rpc?.send.toggleAIChat({});
			break;
		case "toggle-markdown":
			win.webview.rpc?.send.toggleMarkdown({});
			break;
	}
});

// Cleanup on exit
process.on("beforeExit", () => { stopMLX(); stopWhisper(); });
process.on("SIGINT", () => { stopMLX(); stopWhisper(); process.exit(); });

console.log("BuddyWriter started!");
