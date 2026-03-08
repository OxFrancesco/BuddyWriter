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

const defaultSettings: Settings = {
	provider: "openrouter",
	openrouterKey: Bun.env.OPENROUTER_API_KEY ?? "",
	openrouterModel: "google/gemini-2.5-flash",
	mlxModel: "mlx-community/Qwen3-4B-4bit",
	mlxPythonPath: "python3",
	whisperModel: "mlx-community/whisper-turbo",
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
			return { ...defaultSettings, ...JSON.parse(readFileSync(settingsPath, "utf-8")) };
		}
	} catch {}
	return { ...defaultSettings };
}

function saveSettings(s: Settings) {
	writeFileSync(settingsPath, JSON.stringify(s, null, 2));
}

let settings = loadSettings();

// ─── MLX Sidecar ───
const MLX_PORT = 8079;
let mlxProc: Subprocess | null = null;

async function startMLX(model: string, pythonPath: string): Promise<boolean> {
	if (mlxProc) {
		mlxProc.kill();
		mlxProc = null;
	}

	try {
		mlxProc = spawn({
			cmd: [
				pythonPath, "-m", "mlx_lm.server",
				"--model", model,
				"--port", String(MLX_PORT),
				"--host", "127.0.0.1",
				"--max-tokens", "2048",
			],
			stdout: "pipe",
			stderr: "pipe",
		});

		// Wait for health
		const start = Date.now();
		while (Date.now() - start < 120_000) {
			try {
				const res = await fetch(`http://127.0.0.1:${MLX_PORT}/health`);
				if (res.ok) return true;
			} catch {}
			await Bun.sleep(800);
		}
		mlxProc.kill();
		mlxProc = null;
		return false;
	} catch {
		return false;
	}
}

function stopMLX() {
	if (mlxProc) {
		mlxProc.kill();
		mlxProc = null;
	}
}

// ─── Whisper Sidecar ───
const WHISPER_PORT = 8765;
let whisperProc: Subprocess | null = null;

async function startWhisper(model: string, pythonPath: string): Promise<boolean> {
	if (whisperProc) {
		whisperProc.kill();
		whisperProc = null;
	}

	const scriptPath = join(import.meta.dir, "whisper_server.py");

	try {
		whisperProc = spawn({
			cmd: [pythonPath, scriptPath],
			env: {
				...process.env,
				WHISPER_MODEL: model,
				WHISPER_PORT: String(WHISPER_PORT),
			},
			stdout: "pipe",
			stderr: "pipe",
		});

		const start = Date.now();
		while (Date.now() - start < 180_000) {
			try {
				const res = await fetch(`http://127.0.0.1:${WHISPER_PORT}/health`);
				if (res.ok) return true;
			} catch {}
			await Bun.sleep(1000);
		}
		whisperProc.kill();
		whisperProc = null;
		return false;
	} catch {
		return false;
	}
}

function stopWhisper() {
	if (whisperProc) {
		whisperProc.kill();
		whisperProc = null;
	}
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
	if (settings.provider === "mlx" && mlxProc) {
		return callMLX(systemPrompt, userMessage);
	}
	return callOpenRouter(systemPrompt, userMessage);
}

async function callOpenRouter(systemPrompt: string, userMessage: string): Promise<string> {
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
					return { html: Bun.markdown.html(text) };
				},
				getSettings: () => {
					return settings;
				},
				saveSettings: (newSettings: Settings) => {
					settings = { ...settings, ...newSettings };
					saveSettings(settings);
					return { success: true };
				},
				startMLXServer: async ({ model, pythonPath }: { model: string; pythonPath: string }) => {
					const ok = await startMLX(model, pythonPath);
					if (ok) {
						settings.mlxModel = model;
						settings.mlxPythonPath = pythonPath;
						saveSettings(settings);
					return { success: true };
				}
				return { success: false, error: "Server failed to start. Check python path and mlx-lm install." };
			},
			stopMLXServer: () => {
				stopMLX();
				return { success: true };
			},
			getMLXStatus: async () => {
				if (!mlxProc) return { running: false };
				try {
					const res = await fetch(`http://127.0.0.1:${MLX_PORT}/health`);
					return { running: res.ok };
				} catch {
					return { running: false };
				}
			},
				startWhisperServer: async ({ model, pythonPath }: { model: string; pythonPath: string }) => {
					const ok = await startWhisper(model, pythonPath);
					if (ok) {
						settings.whisperModel = model;
						saveSettings(settings);
						return { success: true };
				}
				return { success: false, error: "Whisper server failed to start. Check python path and mlx-whisper install." };
			},
			stopWhisperServer: () => {
				stopWhisper();
				return { success: true };
			},
			getWhisperStatus: async () => {
				if (!whisperProc) return { running: false };
				try {
					const res = await fetch(`http://127.0.0.1:${WHISPER_PORT}/health`);
					return { running: res.ok };
				} catch {
					return { running: false };
				}
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
