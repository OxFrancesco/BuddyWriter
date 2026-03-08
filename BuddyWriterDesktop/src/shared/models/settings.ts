import type { LocalAISettings } from "./local-ai";

export type Hotkey = {
	mod: boolean;
	shift: boolean;
	key: string;
};

export type HotkeyMap = {
	zenMode: Hotkey;
	fixGrammar: Hotkey;
	aiChat: Hotkey;
	toggleMarkdown: Hotkey;
	bold: Hotkey;
	italic: Hotkey;
	link: Hotkey;
	code: Hotkey;
};

export type Settings = {
	provider: "openrouter" | "local";
	openrouterKey: string;
	openrouterModel: string;
	workspacePath: string;
	localAI: LocalAISettings;
	hotkeys: HotkeyMap;
};

export type PersistedSettings = Omit<Settings, "openrouterKey">;

export type SaveSettingsResult = {
	success: boolean;
	error?: string;
};

export type LegacySettings = Partial<{
	provider: "openrouter" | "mlx" | "local";
	openrouterModel: string;
	workspacePath: string;
	mlxModel: string;
	mlxPythonPath: string;
	whisperModel: string;
	localAI: Partial<LocalAISettings>;
	hotkeys: HotkeyMap;
}>;

export const defaultHotkeys: HotkeyMap = {
	zenMode: { mod: true, shift: true, key: "f" },
	fixGrammar: { mod: true, shift: false, key: "g" },
	aiChat: { mod: true, shift: true, key: "a" },
	toggleMarkdown: { mod: true, shift: true, key: "m" },
	bold: { mod: true, shift: false, key: "b" },
	italic: { mod: true, shift: false, key: "i" },
	link: { mod: true, shift: false, key: "k" },
	code: { mod: true, shift: false, key: "e" },
};

export const hotkeyLabels: Record<keyof HotkeyMap, string> = {
	zenMode: "Zen Mode",
	fixGrammar: "Fix Grammar",
	aiChat: "AI Chat",
	toggleMarkdown: "Toggle Markdown",
	bold: "Bold",
	italic: "Italic",
	link: "Insert Link",
	code: "Inline Code",
};
