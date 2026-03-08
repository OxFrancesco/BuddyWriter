import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import {
	type LocalAICatalog,
	type LocalAIProfileId,
	type LocalAISettings,
} from "../../shared/models/local-ai";
import {
	defaultHotkeys,
	type LegacySettings,
	type SaveSettingsResult,
	type Settings,
} from "../../shared/models/settings";
import { defaultWorkspaceRoot, localAIRoot, settingsDir, settingsPath } from "../config";
import type { OpenRouterSecretStore } from "./openrouter-secret-store";

export type SettingsRepository = ReturnType<typeof createSettingsRepository>;

function getProfile(catalog: LocalAICatalog, profileId: LocalAIProfileId) {
	return catalog.profiles.find((profile) => profile.id === profileId) ?? catalog.profiles[0];
}

function createDefaultLocalAISettings(catalog: LocalAICatalog): LocalAISettings {
	const profile = getProfile(catalog, catalog.defaultProfileId);
	return {
		enabled: false,
		installState: "not_installed",
		selectedProfileId: profile.id,
		textModelId: profile.textModelId,
		grammarModelId: profile.grammarModelId,
		sttModelId: profile.sttModelId,
		ttsModelId: profile.ttsModelId,
		catalogVersion: catalog.version,
		installBundleVersion: null,
		installRoot: localAIRoot,
		lastError: null,
	};
}

function normalizeLocalAISettings(catalog: LocalAICatalog, value?: Partial<LocalAISettings>): LocalAISettings {
	const defaults = createDefaultLocalAISettings(catalog);
	const profileId = value?.selectedProfileId ?? defaults.selectedProfileId;
	const profile = getProfile(catalog, profileId);
	return {
		enabled: value?.enabled ?? defaults.enabled,
		installState: value?.installState ?? defaults.installState,
		selectedProfileId: profile.id,
		textModelId: value?.textModelId ?? profile.textModelId,
		grammarModelId: value?.grammarModelId ?? profile.grammarModelId,
		sttModelId: value?.sttModelId ?? profile.sttModelId,
		ttsModelId: value?.ttsModelId ?? profile.ttsModelId,
		catalogVersion: value?.catalogVersion ?? catalog.version,
		installBundleVersion: value?.installBundleVersion ?? null,
		installRoot: value?.installRoot ?? localAIRoot,
		lastError: value?.lastError ?? null,
	};
}

function createDefaultSettings(catalog: LocalAICatalog): Settings {
	return {
		provider: "openrouter",
		openrouterKey: Bun.env.OPENROUTER_API_KEY ?? "",
		openrouterModel: "google/gemini-2.5-flash",
		workspacePath: defaultWorkspaceRoot,
		localAI: createDefaultLocalAISettings(catalog),
		hotkeys: defaultHotkeys,
	};
}

function migrateSettings(catalog: LocalAICatalog, raw: LegacySettings): Settings {
	const defaultSettings = createDefaultSettings(catalog);
	const localAI = normalizeLocalAISettings(catalog, raw.localAI);
	if (raw.mlxModel) localAI.textModelId = raw.mlxModel;
	if (raw.whisperModel) localAI.sttModelId = raw.whisperModel;
	if (raw.provider === "mlx") localAI.enabled = true;
	return {
		provider: raw.provider === "mlx" ? "local" : (raw.provider ?? defaultSettings.provider),
		openrouterKey: defaultSettings.openrouterKey,
		openrouterModel: raw.openrouterModel ?? defaultSettings.openrouterModel,
		workspacePath: raw.workspacePath?.trim() || defaultWorkspaceRoot,
		localAI,
		hotkeys: raw.hotkeys ?? defaultHotkeys,
	};
}

function loadSettings(catalog: LocalAICatalog): Settings {
	const defaultSettings = createDefaultSettings(catalog);
	try {
		if (existsSync(settingsPath)) {
			const persisted = JSON.parse(readFileSync(settingsPath, "utf-8")) as LegacySettings;
			return migrateSettings(catalog, persisted);
		}
	} catch {}

	return {
		...defaultSettings,
		localAI: normalizeLocalAISettings(catalog, defaultSettings.localAI),
	};
}

export function createSettingsRepository(options: {
	getCatalog: () => LocalAICatalog;
	secretStore: OpenRouterSecretStore;
}) {
	const { getCatalog, secretStore } = options;
	if (!existsSync(settingsDir)) mkdirSync(settingsDir, { recursive: true });

	let settings = loadSettings(getCatalog());
	settings.workspacePath = normalizeWorkspaceRootPath(settings.workspacePath);

	function getSettings(): Settings {
		return settings;
	}

	function setSettings(nextSettings: Settings): Settings {
		settings = nextSettings;
		return settings;
	}

	function normalizeWorkspaceRootPath(workspacePath?: string): string {
		return resolve((workspacePath ?? "").trim() || defaultWorkspaceRoot);
	}

	function normalizeCurrentLocalAISettings(value?: Partial<LocalAISettings>): LocalAISettings {
		return normalizeLocalAISettings(getCatalog(), value);
	}

	function saveSettingsToDisk(target = settings): void {
		const persisted = {
			provider: target.provider,
			openrouterModel: target.openrouterModel,
			workspacePath: target.workspacePath,
			localAI: target.localAI,
			hotkeys: target.hotkeys,
		};
		writeFileSync(settingsPath, JSON.stringify(persisted, null, 2));
	}

	function syncOpenRouterKeyFromSecureStorage(): void {
		const envKey = Bun.env.OPENROUTER_API_KEY?.trim();
		if (envKey) {
			settings.openrouterKey = envKey;
			return;
		}

		const result = secretStore.load();
		if (result.ok) {
			settings.openrouterKey = result.value ?? "";
		}
	}

	function saveSettingsWithSecureStorage(nextSettings: Settings): SaveSettingsResult {
		settings = {
			...settings,
			...nextSettings,
			localAI: normalizeCurrentLocalAISettings(nextSettings.localAI),
		};
		settings.workspacePath = normalizeWorkspaceRootPath(settings.workspacePath);
		const secureStoreResult = secretStore.save(settings.openrouterKey);
		saveSettingsToDisk(settings);

		if (!secureStoreResult.ok) {
			return {
				success: false,
				error: secureStoreResult.error ?? "Unable to persist the OpenRouter API key securely.",
			};
		}

		syncOpenRouterKeyFromSecureStorage();
		return { success: true };
	}

	function applyProfileToSettings(profileId: LocalAIProfileId): void {
		const profile = getProfile(getCatalog(), profileId);
		settings.localAI.selectedProfileId = profile.id;
		settings.localAI.textModelId = profile.textModelId;
		settings.localAI.grammarModelId = profile.grammarModelId;
		settings.localAI.sttModelId = profile.sttModelId;
		settings.localAI.ttsModelId = profile.ttsModelId;
		settings.localAI.catalogVersion = getCatalog().version;
		settings.localAI.installRoot = localAIRoot;
		saveSettingsToDisk(settings);
	}

	function syncLocalAIWithCatalog(): void {
		settings.localAI = normalizeCurrentLocalAISettings(settings.localAI);
		settings.localAI.catalogVersion = getCatalog().version;
		settings.workspacePath = normalizeWorkspaceRootPath(settings.workspacePath);
		saveSettingsToDisk(settings);
	}

	syncOpenRouterKeyFromSecureStorage();
	syncLocalAIWithCatalog();

	return {
		applyProfileToSettings,
		createDefaultLocalAISettings,
		getSettings,
		normalizeLocalAISettings: normalizeCurrentLocalAISettings,
		normalizeWorkspaceRootPath,
		saveSettingsToDisk,
		saveSettingsWithSecureStorage,
		setSettings,
		syncLocalAIWithCatalog,
		syncOpenRouterKeyFromSecureStorage,
	};
}
