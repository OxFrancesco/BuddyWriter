import {
	BrowserView,
	BrowserWindow,
	ApplicationMenu,
	Utils,
	type RPCSchema,
} from "electrobun/bun";
import { dirname, join } from "path";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "fs";
import { homedir } from "os";
import { type Subprocess, spawn } from "bun";
import bundledCatalog from "./local_ai_catalog.json";

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
type LocalAIInstallStep =
	| "uv"
	| "python"
	| "venv"
	| "packages"
	| "cache"
	| "text_model"
	| "stt_model"
	| "tts_model"
	| "verify";
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

type PersistedSettings = Omit<Settings, "openrouterKey">;
type SaveSettingsResult = { success: boolean; error?: string };

type LocalAIStatusResponse = {
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

type LocalAIRuntimeStatus = {
	installState: LocalAIInstallState;
	currentPhase: string | null;
	progressPct: number | null;
	lastError: string | null;
	installBundleVersion: string | null;
	catalogVersion: string | null;
	installPlan: {
		profileId: LocalAIProfileId;
		textModelId: string;
		sttModelId: string;
		ttsModelId: string;
		bundleVersion: string;
		completedSteps: LocalAIInstallStep[];
		startedAt: string;
		updatedAt: string;
	} | null;
};

type LocalAIDiagnostics = {
	capturedAt: string;
	reason: string;
	installState: LocalAIInstallState;
	currentPhase: string | null;
	lastError: string | null;
	installBundleVersion: string | null;
	catalogVersion: string | null;
	installRoot: string;
	logsDir: string;
	profileId: LocalAIProfileId;
	models: {
		text: string;
		stt: string;
		tts: string;
	};
	paths: {
		uv: string;
		python: string;
		venv: string;
	};
	artifacts: {
		uvInstalled: boolean;
		venvReady: boolean;
		packagesReady: boolean;
		textModelCached: boolean;
		sttModelCached: boolean;
		ttsModelCached: boolean;
	};
	sidecars: {
		text: { pid: number | null; healthy: boolean; modelId: string | null };
		stt: { pid: number | null; healthy: boolean; modelId: string | null };
		tts: { pid: number | null; healthy: boolean; modelId: string | null };
	};
	installPlan: LocalAIRuntimeStatus["installPlan"];
};

type LocalAIRequestResult = {
	accepted: boolean;
	error?: string;
};

type SidecarState = {
	proc: Subprocess | null;
	modelId: string | null;
	logs: string[];
};

type LocalAIProfileSummary = {
	id: LocalAIProfileId;
	label: string;
	approxBundleGB: number;
};

type LegacySettings = Partial<{
	provider: "openrouter" | "mlx" | "local";
	openrouterModel: string;
	mlxModel: string;
	mlxPythonPath: string;
	whisperModel: string;
	localAI: Partial<LocalAISettings>;
	hotkeys: HotkeyMap;
}>;

const OPENROUTER_KEYCHAIN_SERVICE = "com.buddywriter.openrouter";
const OPENROUTER_KEYCHAIN_ACCOUNT = "default";
const MAX_SIDECAR_LOG_LINES = 80;
const LOCAL_AI_REMOTE_CATALOG_URL = Bun.env.BUDDYWRITER_LOCAL_AI_CATALOG_URL?.trim() ?? "";
const UV_INSTALL_SCRIPT_URL = "https://astral.sh/uv/install.sh";
const DEFAULT_UV_PYTHON = "3.12.7";
const MLX_PORT = 8079;
const STT_PORT = 8765;
const TTS_PORT = 8766;
const settingsDir = Utils.paths.userData;
const settingsPath = join(settingsDir, "settings.json");
const localAIRoot = join(Utils.paths.userData, "local-ai");
const localAIBinDir = join(localAIRoot, "bin");
const localAIPythonDir = join(localAIRoot, "python");
const localAIVenvDir = join(localAIRoot, "venv");
const localAIManifestsDir = join(localAIRoot, "manifests");
const localAIModelsDir = join(localAIRoot, "models");
const localAILogsDir = join(localAIRoot, "logs");
const localAIHomeDir = join(localAIRoot, "home");
const localAICacheDir = join(localAIRoot, "cache");
const localAIHFDir = join(localAIRoot, "hf");
const localAIHFHubDir = join(localAIHFDir, "hub");
const localAIInstallStatePath = join(localAIManifestsDir, "install-state.json");
const localAICachedCatalogPath = join(localAIManifestsDir, "catalog.json");
const localAIDiagnosticsPath = join(localAIManifestsDir, "diagnostics.json");
const localAIUVInstallerPath = join(localAIManifestsDir, "uv-install.sh");
const defaultCatalog = bundledCatalog as LocalAICatalog;

if (!existsSync(settingsDir)) mkdirSync(settingsDir, { recursive: true });

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

function getProfile(catalog: LocalAICatalog, profileId: LocalAIProfileId) {
	return catalog.profiles.find((profile) => profile.id === profileId) ?? catalog.profiles[0];
}

function getModelEntry(catalog: LocalAICatalog, modelId: string) {
	return catalog.models.find((model) => model.id === modelId);
}

function createDefaultLocalAISettings(catalog: LocalAICatalog): LocalAISettings {
	const profile = getProfile(catalog, catalog.defaultProfileId);
	return {
		enabled: false,
		installState: "not_installed",
		selectedProfileId: profile.id,
		textModelId: profile.textModelId,
		sttModelId: profile.sttModelId,
		ttsModelId: profile.ttsModelId,
		catalogVersion: catalog.version,
		installBundleVersion: null,
		installRoot: localAIRoot,
		lastError: null,
	};
}

const defaultSettings: Settings = {
	provider: "openrouter",
	openrouterKey: Bun.env.OPENROUTER_API_KEY ?? "",
	openrouterModel: "google/gemini-2.5-flash",
	localAI: createDefaultLocalAISettings(defaultCatalog),
	hotkeys: defaultHotkeys,
};

function decodeCommandOutput(output: string | Uint8Array | null | undefined) {
	if (!output) return "";
	if (typeof output === "string") return output.trim();
	return new TextDecoder().decode(output).trim();
}

function hasCommand(command: string) {
	const result = Bun.spawnSync({
		cmd: ["which", command],
		stdout: "pipe",
		stderr: "pipe",
	});

	return result.exitCode === 0;
}

function loadOpenRouterKeyFromSecureStorage() {
	switch (process.platform) {
		case "darwin": {
			const result = Bun.spawnSync({
				cmd: [
					"security",
					"find-generic-password",
					"-s",
					OPENROUTER_KEYCHAIN_SERVICE,
					"-a",
					OPENROUTER_KEYCHAIN_ACCOUNT,
					"-w",
				],
				stdout: "pipe",
				stderr: "pipe",
			});
			const stderr = decodeCommandOutput(result.stderr);

			if (result.exitCode === 0) {
				return { ok: true, supported: true, value: decodeCommandOutput(result.stdout) };
			}

			if (stderr.includes("could not be found")) {
				return { ok: true, supported: true, value: "" };
			}

			return {
				ok: false,
				supported: true,
				value: "",
				error: stderr || "Unable to read the OpenRouter API key from macOS Keychain.",
			};
		}
		case "linux": {
			if (!hasCommand("secret-tool")) {
				return { ok: false, supported: false, value: "" };
			}

			const result = Bun.spawnSync({
				cmd: [
					"secret-tool",
					"lookup",
					"service",
					OPENROUTER_KEYCHAIN_SERVICE,
					"account",
					OPENROUTER_KEYCHAIN_ACCOUNT,
				],
				stdout: "pipe",
				stderr: "pipe",
			});
			const stderr = decodeCommandOutput(result.stderr);

			if (result.exitCode === 0) {
				return { ok: true, supported: true, value: decodeCommandOutput(result.stdout) };
			}

			if (result.exitCode === 1 && !stderr) {
				return { ok: true, supported: true, value: "" };
			}

			return {
				ok: false,
				supported: true,
				value: "",
				error: stderr || "Unable to read the OpenRouter API key from the system secret store.",
			};
		}
		default:
			return { ok: false, supported: false, value: "" };
	}
}

function saveOpenRouterKeyToSecureStorage(value: string) {
	switch (process.platform) {
		case "darwin": {
			if (!value.trim()) {
				const deleteResult = Bun.spawnSync({
					cmd: [
						"security",
						"delete-generic-password",
						"-s",
						OPENROUTER_KEYCHAIN_SERVICE,
						"-a",
						OPENROUTER_KEYCHAIN_ACCOUNT,
					],
					stdout: "pipe",
					stderr: "pipe",
				});
				const stderr = decodeCommandOutput(deleteResult.stderr);
				if (deleteResult.exitCode === 0 || stderr.includes("could not be found")) {
					return { ok: true, supported: true };
				}

				return {
					ok: false,
					supported: true,
					error: stderr || "Unable to clear the OpenRouter API key from macOS Keychain.",
				};
			}

			const saveResult = Bun.spawnSync({
				cmd: [
					"security",
					"add-generic-password",
					"-U",
					"-s",
					OPENROUTER_KEYCHAIN_SERVICE,
					"-a",
					OPENROUTER_KEYCHAIN_ACCOUNT,
					"-w",
					value,
				],
				stdout: "pipe",
				stderr: "pipe",
			});
			const stderr = decodeCommandOutput(saveResult.stderr);

			if (saveResult.exitCode === 0) {
				return { ok: true, supported: true };
			}

			return {
				ok: false,
				supported: true,
				error: stderr || "Unable to store the OpenRouter API key in macOS Keychain.",
			};
		}
		case "linux": {
			if (!hasCommand("secret-tool")) {
				return { ok: false, supported: false, error: "Install `secret-tool` to persist the OpenRouter API key securely." };
			}

			if (!value.trim()) {
				const clearResult = Bun.spawnSync({
					cmd: [
						"secret-tool",
						"clear",
						"service",
						OPENROUTER_KEYCHAIN_SERVICE,
						"account",
						OPENROUTER_KEYCHAIN_ACCOUNT,
					],
					stdout: "pipe",
					stderr: "pipe",
				});
				const stderr = decodeCommandOutput(clearResult.stderr);

				if (clearResult.exitCode === 0 || clearResult.exitCode === 1) {
					return { ok: true, supported: true };
				}

				return {
					ok: false,
					supported: true,
					error: stderr || "Unable to clear the OpenRouter API key from the system secret store.",
				};
			}

			const saveResult = Bun.spawnSync({
				cmd: [
					"secret-tool",
					"store",
					"--label=BuddyWriter OpenRouter API Key",
					"service",
					OPENROUTER_KEYCHAIN_SERVICE,
					"account",
					OPENROUTER_KEYCHAIN_ACCOUNT,
				],
				stdin: new TextEncoder().encode(value),
				stdout: "pipe",
				stderr: "pipe",
			});
			const stderr = decodeCommandOutput(saveResult.stderr);

			if (saveResult.exitCode === 0) {
				return { ok: true, supported: true };
			}

			return {
				ok: false,
				supported: true,
				error: stderr || "Unable to store the OpenRouter API key in the system secret store.",
			};
		}
		default:
			if (!value.trim()) {
				return { ok: true, supported: false };
			}

			return {
				ok: false,
				supported: false,
				error: "Secure API key persistence is not implemented on this platform yet.",
			};
	}
}

let currentCatalog: LocalAICatalog = defaultCatalog;

function normalizeLocalAISettings(value?: Partial<LocalAISettings>): LocalAISettings {
	const defaults = createDefaultLocalAISettings(currentCatalog);
	const profileId = value?.selectedProfileId ?? defaults.selectedProfileId;
	const profile = getProfile(currentCatalog, profileId);
	return {
		enabled: value?.enabled ?? defaults.enabled,
		installState: value?.installState ?? defaults.installState,
		selectedProfileId: profile.id,
		textModelId: value?.textModelId ?? profile.textModelId,
		sttModelId: value?.sttModelId ?? profile.sttModelId,
		ttsModelId: value?.ttsModelId ?? profile.ttsModelId,
		catalogVersion: value?.catalogVersion ?? currentCatalog.version,
		installBundleVersion: value?.installBundleVersion ?? null,
		installRoot: value?.installRoot ?? localAIRoot,
		lastError: value?.lastError ?? null,
	};
}

function migrateSettings(raw: LegacySettings): Settings {
	const localAI = normalizeLocalAISettings(raw.localAI);
	if (raw.mlxModel) localAI.textModelId = raw.mlxModel;
	if (raw.whisperModel) localAI.sttModelId = raw.whisperModel;
	if (raw.provider === "mlx") localAI.enabled = true;
	return {
		provider: raw.provider === "mlx" ? "local" : (raw.provider ?? defaultSettings.provider),
		openrouterKey: defaultSettings.openrouterKey,
		openrouterModel: raw.openrouterModel ?? defaultSettings.openrouterModel,
		localAI,
		hotkeys: raw.hotkeys ?? defaultHotkeys,
	};
}

function loadSettings(): Settings {
	try {
		if (existsSync(settingsPath)) {
			const persisted = JSON.parse(readFileSync(settingsPath, "utf-8")) as LegacySettings;
			return migrateSettings(persisted);
		}
	} catch {}
	return { ...defaultSettings, localAI: normalizeLocalAISettings(defaultSettings.localAI) };
}

function saveSettingsToDisk(settings: Settings) {
	const persisted: PersistedSettings = {
		provider: settings.provider,
		openrouterModel: settings.openrouterModel,
		localAI: settings.localAI,
		hotkeys: settings.hotkeys,
	};
	writeFileSync(settingsPath, JSON.stringify(persisted, null, 2));
}

let settings = loadSettings();

function syncOpenRouterKeyFromSecureStorage() {
	const envKey = Bun.env.OPENROUTER_API_KEY?.trim();
	if (envKey) {
		settings.openrouterKey = envKey;
		return;
	}

	const result = loadOpenRouterKeyFromSecureStorage();
	if (result.ok) {
		settings.openrouterKey = result.value ?? "";
	}
}

syncOpenRouterKeyFromSecureStorage();

function ensureDir(path: string) {
	if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function ensureLocalAIDirectories() {
	[
		localAIRoot,
		localAIBinDir,
		localAIPythonDir,
		localAIManifestsDir,
		localAIModelsDir,
		localAILogsDir,
		localAIHomeDir,
		localAICacheDir,
		localAIHFDir,
		localAIHFHubDir,
	].forEach(ensureDir);
}

function getModelCacheFolderName(modelId: string) {
	return `models--${modelId.replaceAll("/", "--")}`;
}

function getModelCachePath(cacheRoot: string, modelId: string) {
	return join(cacheRoot, getModelCacheFolderName(modelId));
}

function hasCachedModelSnapshot(modelPath: string) {
	if (!existsSync(modelPath)) return false;
	const snapshotsPath = join(modelPath, "snapshots");
	if (!existsSync(snapshotsPath)) return false;

	try {
		return readdirSync(snapshotsPath).length > 0;
	} catch {
		return false;
	}
}

function getExternalHFHubCandidates() {
	const home = homedir();
	return [
		Bun.env.HUGGINGFACE_HUB_CACHE?.trim(),
		Bun.env.HF_HOME?.trim() ? join(Bun.env.HF_HOME.trim(), "hub") : "",
		join(home, ".cache", "huggingface", "hub"),
		join(home, "Library", "Caches", "huggingface", "hub"),
	].filter((path, index, values): path is string => Boolean(path) && values.indexOf(path) === index);
}

function findReusableModelCache(modelId: string) {
	for (const cacheRoot of getExternalHFHubCandidates()) {
		const candidate = getModelCachePath(cacheRoot, modelId);
		if (hasCachedModelSnapshot(candidate)) {
			return candidate;
		}
	}

	return null;
}

function reuseExistingModelCache(modelId: string) {
	const managedCachePath = getModelCachePath(localAIHFHubDir, modelId);
	if (hasCachedModelSnapshot(managedCachePath)) {
		return false;
	}

	if (existsSync(managedCachePath)) {
		try {
			if (lstatSync(managedCachePath).isSymbolicLink()) {
				rmSync(managedCachePath, { force: true, recursive: true });
			}
		} catch {}
	}

	const reusableCachePath = findReusableModelCache(modelId);
	if (!reusableCachePath) {
		return false;
	}

	try {
		ensureDir(localAIHFHubDir);
		symlinkSync(reusableCachePath, managedCachePath, "dir");
		appendLog("install.log", `Reusing cached model ${modelId} from ${reusableCachePath}`);
		return true;
	} catch (error) {
		appendLog(
			"install.log",
			`Found cached model ${modelId} at ${reusableCachePath}, but could not link it: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

function reuseExistingSelectedModelCaches() {
	setRuntimeStatus({ currentPhase: "Checking for existing model files", progressPct: 46 });
	reuseExistingModelCache(settings.localAI.textModelId);
	reuseExistingModelCache(settings.localAI.sttModelId);
	reuseExistingModelCache(settings.localAI.ttsModelId);
}

function getLocalAIModelCachePath(modelId: string) {
	return getModelCachePath(localAIHFHubDir, modelId);
}

function hasManagedModelCache(modelId: string) {
	return hasCachedModelSnapshot(getLocalAIModelCachePath(modelId));
}

function readJsonFile<T>(path: string): T | null {
	try {
		if (!existsSync(path)) return null;
		return JSON.parse(readFileSync(path, "utf-8")) as T;
	} catch {
		return null;
	}
}

function writeJsonFile(path: string, value: unknown) {
	ensureDir(dirname(path));
	writeFileSync(path, JSON.stringify(value, null, 2));
}

function loadCatalog(): LocalAICatalog {
	ensureLocalAIDirectories();
	const cached = readJsonFile<LocalAICatalog>(localAICachedCatalogPath);
	currentCatalog = cached ?? defaultCatalog;
	return currentCatalog;
}

loadCatalog();
settings.localAI = normalizeLocalAISettings(settings.localAI);
settings.localAI.catalogVersion = currentCatalog.version;
saveSettingsToDisk(settings);

async function refreshCatalogFromRemote() {
	if (!LOCAL_AI_REMOTE_CATALOG_URL) return;
	try {
		const response = await fetch(LOCAL_AI_REMOTE_CATALOG_URL);
		if (!response.ok) return;
		const remoteCatalog = await response.json() as LocalAICatalog;
		currentCatalog = remoteCatalog;
		writeJsonFile(localAICachedCatalogPath, remoteCatalog);
		settings.localAI.catalogVersion = remoteCatalog.version;
		settings.localAI = normalizeLocalAISettings(settings.localAI);
		saveSettingsToDisk(settings);
	} catch {}
}

void refreshCatalogFromRemote();

const defaultRuntimeStatus: LocalAIRuntimeStatus = {
	installState: settings.localAI.installState,
	currentPhase: null,
	progressPct: null,
	lastError: settings.localAI.lastError,
	installBundleVersion: settings.localAI.installBundleVersion,
	catalogVersion: settings.localAI.catalogVersion,
	installPlan: null,
};

let runtimeStatus = readJsonFile<LocalAIRuntimeStatus>(localAIInstallStatePath) ?? defaultRuntimeStatus;

if (runtimeStatus.installState === "installing") {
	runtimeStatus = {
		...runtimeStatus,
		installState: "error",
		currentPhase: null,
		progressPct: null,
		lastError: runtimeStatus.installPlan
			? "Local AI install was interrupted. Retry to resume or remove Local AI to start over."
			: "Local AI install was interrupted. Retry to continue.",
	};
}

function persistRuntimeStatus() {
	ensureLocalAIDirectories();
	writeJsonFile(localAIInstallStatePath, runtimeStatus);
}

function syncSettingsFromRuntimeStatus() {
	settings.localAI.installState = runtimeStatus.installState;
	settings.localAI.lastError = runtimeStatus.lastError;
	settings.localAI.installBundleVersion = runtimeStatus.installBundleVersion;
	settings.localAI.catalogVersion = runtimeStatus.catalogVersion ?? currentCatalog.version;
	saveSettingsToDisk(settings);
	persistRuntimeStatus();
}

syncSettingsFromRuntimeStatus();

function setRuntimeStatus(patch: Partial<LocalAIRuntimeStatus>) {
	runtimeStatus = { ...runtimeStatus, ...patch };
	syncSettingsFromRuntimeStatus();
}

function createInstallPlan(profileId: LocalAIProfileId) {
	const startedAt = new Date().toISOString();
	return {
		profileId,
		textModelId: settings.localAI.textModelId,
		sttModelId: settings.localAI.sttModelId,
		ttsModelId: settings.localAI.ttsModelId,
		bundleVersion: formatLocalAIBundleVersion(profileId),
		completedSteps: [] as LocalAIInstallStep[],
		startedAt,
		updatedAt: startedAt,
	};
}

function updateInstallPlan(mutator: (plan: NonNullable<LocalAIRuntimeStatus["installPlan"]>) => NonNullable<LocalAIRuntimeStatus["installPlan"]>) {
	if (!runtimeStatus.installPlan) return;
	setRuntimeStatus({
		installPlan: mutator(runtimeStatus.installPlan),
	});
}

function markInstallStepComplete(step: LocalAIInstallStep) {
	updateInstallPlan((plan) => ({
		...plan,
		completedSteps: plan.completedSteps.includes(step)
			? plan.completedSteps
			: [...plan.completedSteps, step],
		updatedAt: new Date().toISOString(),
	}));
}

function isInstallStepComplete(step: LocalAIInstallStep) {
	return runtimeStatus.installPlan?.completedSteps.includes(step) ?? false;
}

function canResumeInstall(profileId: LocalAIProfileId) {
	const bundleVersion = formatLocalAIBundleVersion(profileId);
	const plan = runtimeStatus.installPlan;
	if (!plan) return false;
	return plan.bundleVersion === bundleVersion
		&& plan.profileId === profileId
		&& plan.textModelId === settings.localAI.textModelId
		&& plan.sttModelId === settings.localAI.sttModelId
		&& plan.ttsModelId === settings.localAI.ttsModelId;
}

function isManagedVenvReady() {
	return existsSync(join(localAIVenvDir, "pyvenv.cfg")) && existsSync(getVenvPythonPath());
}

function clearManagedVenv(reason: string) {
	if (!existsSync(localAIVenvDir)) return;
	appendLog("install.log", `Clearing managed venv: ${reason}`);
	rmSync(localAIVenvDir, { recursive: true, force: true });
}

function commandSucceeds(cmd: string[], env: Record<string, string> = {}) {
	const result = Bun.spawnSync({
		cmd,
		env: getLocalAIEnv(env),
		stdout: "pipe",
		stderr: "pipe",
	});
	return result.exitCode === 0;
}

function hasRequiredLocalAIPackages() {
	if (!isManagedVenvReady()) return false;
	return commandSucceeds([
		getVenvPythonPath(),
		"-c",
		"import mlx_lm, mlx_audio, mlx_whisper, soundfile; print('ready')",
	]);
}

function formatLocalAIBundleVersion(profileId: LocalAIProfileId) {
	return `${currentCatalog.version}:${profileId}`;
}

function getLocalAIStatus(): LocalAIStatusResponse {
	return {
		enabled: settings.localAI.enabled,
		installState: runtimeStatus.installState,
		currentPhase: runtimeStatus.currentPhase ?? undefined,
		progressPct: runtimeStatus.progressPct ?? undefined,
		lastError: runtimeStatus.lastError,
		storageUsedGB: getDirectorySizeGB(localAIRoot),
		selectedProfileId: settings.localAI.selectedProfileId,
		installRoot: settings.localAI.installRoot,
		catalogVersion: settings.localAI.catalogVersion,
		installBundleVersion: settings.localAI.installBundleVersion,
		textModelId: settings.localAI.textModelId,
		sttModelId: settings.localAI.sttModelId,
		ttsModelId: settings.localAI.ttsModelId,
	};
}

function getDirectorySizeGB(path: string) {
	try {
		if (!existsSync(path)) return 0;
		const bytes = getDirectorySizeBytes(path);
		return Math.round((bytes / (1024 ** 3)) * 10) / 10;
	} catch {
		return 0;
	}
}

function getDirectorySizeBytes(path: string): number {
	const stat = statSync(path);
	if (stat.isFile()) return stat.size;
	if (!stat.isDirectory()) return 0;
	return readdirSync(path).reduce((sum, entry) => sum + getDirectorySizeBytes(join(path, entry)), 0);
}

function appendLog(logName: string, text: string) {
	if (!text.trim()) return;
	ensureLocalAIDirectories();
	const path = join(localAILogsDir, logName);
	writeFileSync(path, `${new Date().toISOString()} ${text}\n`, { flag: "a" });
}

function appendHealthLog(text: string) {
	appendLog("health.log", text);
}

function writeLocalAIDiagnostics(value: LocalAIDiagnostics) {
	writeJsonFile(localAIDiagnosticsPath, value);
}

async function captureLocalAIDiagnostics(reason: string) {
	const diagnostics: LocalAIDiagnostics = {
		capturedAt: new Date().toISOString(),
		reason,
		installState: runtimeStatus.installState,
		currentPhase: runtimeStatus.currentPhase,
		lastError: runtimeStatus.lastError,
		installBundleVersion: runtimeStatus.installBundleVersion,
		catalogVersion: runtimeStatus.catalogVersion,
		installRoot: localAIRoot,
		logsDir: localAILogsDir,
		profileId: settings.localAI.selectedProfileId,
		models: {
			text: settings.localAI.textModelId,
			stt: settings.localAI.sttModelId,
			tts: settings.localAI.ttsModelId,
		},
		paths: {
			uv: getUvPath(),
			python: getVenvPythonPath(),
			venv: localAIVenvDir,
		},
		artifacts: {
			uvInstalled: existsSync(getUvPath()),
			venvReady: isManagedVenvReady(),
			packagesReady: hasRequiredLocalAIPackages(),
			textModelCached: hasManagedModelCache(settings.localAI.textModelId),
			sttModelCached: hasManagedModelCache(settings.localAI.sttModelId),
			ttsModelCached: hasManagedModelCache(settings.localAI.ttsModelId),
		},
		sidecars: {
			text: {
				pid: textSidecar.proc?.pid ?? null,
				healthy: await isSidecarHealthy(MLX_PORT),
				modelId: textSidecar.modelId,
			},
			stt: {
				pid: sttSidecar.proc?.pid ?? null,
				healthy: await isSidecarHealthy(STT_PORT),
				modelId: sttSidecar.modelId,
			},
			tts: {
				pid: ttsSidecar.proc?.pid ?? null,
				healthy: await isSidecarHealthy(TTS_PORT),
				modelId: ttsSidecar.modelId,
			},
		},
		installPlan: runtimeStatus.installPlan,
	};

	writeLocalAIDiagnostics(diagnostics);
	appendHealthLog(
		[
			`Diagnostics captured (${reason})`,
			`state=${diagnostics.installState}`,
			`bundle=${diagnostics.installBundleVersion ?? "none"}`,
			`venvReady=${diagnostics.artifacts.venvReady}`,
			`packagesReady=${diagnostics.artifacts.packagesReady}`,
			`textHealthy=${diagnostics.sidecars.text.healthy}`,
			`sttHealthy=${diagnostics.sidecars.stt.healthy}`,
			`ttsHealthy=${diagnostics.sidecars.tts.healthy}`,
		].join(" "),
	);
}

function pushLogLines(buffer: string[], text: string, logName: string) {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	if (lines.length === 0) return;

	buffer.push(...lines);
	if (buffer.length > MAX_SIDECAR_LOG_LINES) {
		buffer.splice(0, buffer.length - MAX_SIDECAR_LOG_LINES);
	}
	appendLog(logName, lines.join("\n"));
}

async function captureProcessStream(stream: ReadableStream<Uint8Array> | null | undefined, buffer: string[], logName: string) {
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
				pushLogLines(buffer, chunk, logName);
			}
		}
		pending += decoder.decode();
		pushLogLines(buffer, pending, logName);
	} catch {}
}

function trackProcessLogs(proc: Subprocess, buffer: string[], logName: string) {
	buffer.length = 0;
	void captureProcessStream(proc.stdout as ReadableStream<Uint8Array> | null, buffer, logName);
	void captureProcessStream(proc.stderr as ReadableStream<Uint8Array> | null, buffer, logName);
}

function recentLogs(buffer: string[], fallback: string) {
	if (buffer.length === 0) return fallback;
	return buffer.slice(-6).join(" | ");
}

function getLocalAIEnv(extra: Record<string, string> = {}) {
	return {
		...process.env,
		HOME: localAIHomeDir,
		XDG_CACHE_HOME: localAICacheDir,
		HF_HOME: localAIHFDir,
		HUGGINGFACE_HUB_CACHE: join(localAIHFDir, "hub"),
		TRANSFORMERS_CACHE: join(localAIHFDir, "hub"),
		UV_PYTHON_INSTALL_DIR: localAIPythonDir,
		UV_CACHE_DIR: localAICacheDir,
		PATH: [localAIBinDir, join(localAIVenvDir, "bin"), process.env.PATH ?? ""].filter(Boolean).join(":"),
		...extra,
	};
}

function getVenvPythonPath() {
	const python3Path = join(localAIVenvDir, "bin", "python3");
	if (existsSync(python3Path)) return python3Path;
	return join(localAIVenvDir, "bin", "python");
}

function getUvPath() {
	return join(localAIBinDir, "uv");
}

async function readStreamText(stream: ReadableStream<Uint8Array> | null | undefined) {
	if (!stream) return "";
	return new Response(stream).text();
}

let activeInstallProc: Subprocess | null = null;
let installRunId = 0;

async function runCommand(cmd: string[], logName: string, env: Record<string, string> = {}) {
	appendLog(logName, `$ ${cmd.join(" ")}`);
	const proc = spawn({
		cmd,
		env: getLocalAIEnv(env),
		stdout: "pipe",
		stderr: "pipe",
	});
	activeInstallProc = proc;
	const [stdout, stderr, exitCode] = await Promise.all([
		readStreamText(proc.stdout as ReadableStream<Uint8Array> | null),
		readStreamText(proc.stderr as ReadableStream<Uint8Array> | null),
		proc.exited,
	]);
	if (activeInstallProc === proc) activeInstallProc = null;
	if (stdout.trim()) appendLog(logName, stdout.trim());
	if (stderr.trim()) appendLog(logName, stderr.trim());
	if (exitCode !== 0) {
		throw new Error(stderr.trim() || stdout.trim() || `Command failed: ${cmd.join(" ")}`);
	}
	return { stdout, stderr };
}

async function ensureUvInstalled() {
	const uvPath = getUvPath();
	if (existsSync(uvPath)) {
		appendLog("install.log", `Using existing uv binary at ${uvPath}`);
		markInstallStepComplete("uv");
		return uvPath;
	}

	setRuntimeStatus({ currentPhase: "Downloading runtime", progressPct: 8 });
	const response = await fetch(UV_INSTALL_SCRIPT_URL);
	if (!response.ok) {
		throw new Error("Unable to download the uv installer.");
	}
	writeFileSync(localAIUVInstallerPath, await response.text());
	await runCommand(
		["sh", localAIUVInstallerPath, "--quiet"],
		"install.log",
		{
			UV_UNMANAGED_INSTALL: localAIBinDir,
			UV_NO_MODIFY_PATH: "1",
		},
	);

	if (!existsSync(uvPath)) {
		throw new Error("uv finished installing, but the binary was not found.");
	}
	appendLog("install.log", `Installed uv at ${uvPath}`);
	markInstallStepComplete("uv");
	return uvPath;
}

async function ensureManagedPythonInstalled() {
	const uvPath = await ensureUvInstalled();
	setRuntimeStatus({ currentPhase: "Installing managed Python", progressPct: 14 });
	await runCommand(
		[uvPath, "python", "install", "--managed-python", DEFAULT_UV_PYTHON],
		"install.log",
	);
	appendLog("install.log", `Managed CPython ${DEFAULT_UV_PYTHON} is ready`);
	markInstallStepComplete("python");
}

async function ensureManagedVenv(repair: boolean) {
	const uvPath = await ensureUvInstalled();
	await ensureManagedPythonInstalled();

	if (repair) {
		clearManagedVenv("repair requested");
	}

	if (isManagedVenvReady()) {
		appendLog("install.log", `Reusing existing managed venv at ${localAIVenvDir}`);
		markInstallStepComplete("venv");
		return getVenvPythonPath();
	}

	if (existsSync(localAIVenvDir)) {
		clearManagedVenv("existing venv was incomplete or invalid");
	}

	setRuntimeStatus({ currentPhase: "Preparing Python", progressPct: 18 });
	await runCommand(
		[uvPath, "venv", localAIVenvDir, "--python", DEFAULT_UV_PYTHON, "--managed-python", "--clear"],
		"install.log",
	);

	appendLog("install.log", `Managed venv ready at ${localAIVenvDir}`);
	markInstallStepComplete("venv");
	return getVenvPythonPath();
}

async function installPackages(repair: boolean) {
	const uvPath = await ensureUvInstalled();
	const pythonPath = await ensureManagedVenv(repair);
	if (!repair && isInstallStepComplete("packages") && hasRequiredLocalAIPackages()) {
		appendLog("install.log", "Python packages already installed; skipping package install");
		return pythonPath;
	}

	setRuntimeStatus({ currentPhase: "Installing local AI packages", progressPct: 34 });
	await runCommand(
		[
			uvPath,
			"pip",
			"install",
			"--python",
			pythonPath,
			"--prerelease=allow",
			"mlx-lm",
			"mlx-audio",
			"mlx-whisper",
			"soundfile",
		],
		"install.log",
	);
	appendLog("install.log", "Core Python packages installed successfully");
	markInstallStepComplete("packages");
	return pythonPath;
}

async function preloadTextModel(modelId: string) {
	if (isInstallStepComplete("text_model") && hasManagedModelCache(modelId)) {
		appendLog("install.log", `Text model cache already present for ${modelId}; skipping preload`);
		return;
	}

	setRuntimeStatus({ currentPhase: "Downloading text model", progressPct: 52 });
	await runCommand(
		[
			getVenvPythonPath(),
			"-c",
			`from mlx_lm import load; load(${JSON.stringify(modelId)}); print("ready")`,
		],
		"install.log",
	);
	appendLog("install.log", `Text model ready: ${modelId}`);
	markInstallStepComplete("text_model");
}

async function preloadSttModel(modelId: string, provider: LocalAIModelProvider) {
	if (isInstallStepComplete("stt_model") && hasManagedModelCache(modelId)) {
		appendLog("install.log", `STT model cache already present for ${modelId}; skipping preload`);
		return;
	}

	setRuntimeStatus({ currentPhase: "Downloading voice input model", progressPct: 68 });
	if (provider === "mlx-whisper") {
		await runCommand(
			[
				getVenvPythonPath(),
				"-c",
				`import numpy as np, mlx_whisper; mlx_whisper.transcribe(np.zeros(16000, dtype=np.float32), path_or_hf_repo=${JSON.stringify(modelId)}, verbose=False); print("ready")`,
			],
			"install.log",
		);
		appendLog("install.log", `STT model ready via mlx-whisper: ${modelId}`);
		markInstallStepComplete("stt_model");
		return;
	}

	await runCommand(
		[
			getVenvPythonPath(),
			"-c",
			`from mlx_audio.stt import load; load(${JSON.stringify(modelId)}); print("ready")`,
		],
		"install.log",
	);
	appendLog("install.log", `STT model ready via mlx-audio: ${modelId}`);
	markInstallStepComplete("stt_model");
}

async function preloadTtsModel(modelId: string) {
	if (isInstallStepComplete("tts_model") && hasManagedModelCache(modelId)) {
		appendLog("install.log", `TTS model cache already present for ${modelId}; skipping preload`);
		return;
	}

	setRuntimeStatus({ currentPhase: "Downloading voice output model", progressPct: 82 });
	await runCommand(
		[
			getVenvPythonPath(),
			"-c",
			`from mlx_audio.tts import load; load(${JSON.stringify(modelId)}); print("ready")`,
		],
		"install.log",
	);
	appendLog("install.log", `TTS model ready: ${modelId}`);
	markInstallStepComplete("tts_model");
}

async function isSidecarHealthy(port: number) {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/health`);
		return response.ok;
	} catch {
		return false;
	}
}

const textSidecar: SidecarState = { proc: null, modelId: null, logs: [] };
const sttSidecar: SidecarState = { proc: null, modelId: null, logs: [] };
const ttsSidecar: SidecarState = { proc: null, modelId: null, logs: [] };

function stopSidecar(sidecar: SidecarState) {
	if (sidecar.proc) {
		sidecar.proc.kill();
		sidecar.proc = null;
	}
	sidecar.modelId = null;
}

async function startProcessSidecar(
	sidecar: SidecarState,
	cmd: string[],
	port: number,
	modelId: string,
	logName: string,
	env: Record<string, string> = {},
) {
	if (sidecar.proc) {
		sidecar.proc.kill();
		sidecar.proc = null;
	}

	appendHealthLog(`Starting ${logName} for ${modelId} on port ${port}`);
	sidecar.proc = spawn({
		cmd,
		env: getLocalAIEnv(env),
		stdout: "pipe",
		stderr: "pipe",
	});
	sidecar.modelId = modelId;
	trackProcessLogs(sidecar.proc, sidecar.logs, logName);

	const startedAt = Date.now();
	while (Date.now() - startedAt < 180_000) {
		if (await isSidecarHealthy(port)) {
			appendHealthLog(`${logName} healthy for ${modelId} on port ${port}`);
			return;
		}
		await Bun.sleep(800);
	}

	stopSidecar(sidecar);
	appendHealthLog(`${logName} failed to become healthy for ${modelId} on port ${port}`);
	throw new Error(recentLogs(sidecar.logs, `Timed out starting ${modelId}.`));
}

function getLocalAIModelProvider(modelId: string, fallbackKind?: LocalAIModelKind): LocalAIModelProvider {
	return getModelEntry(currentCatalog, modelId)?.provider ?? (fallbackKind === "stt" ? "mlx-whisper" : "mlx-audio");
}

function canStartLocalAISidecars() {
	return settings.localAI.enabled
		&& (runtimeStatus.installState === "ready" || runtimeStatus.installState === "installing");
}

async function ensureTextServerReady(modelId: string) {
	if (!canStartLocalAISidecars()) {
		throw new Error("Enable Local AI in Settings first.");
	}

	if (textSidecar.proc && textSidecar.modelId === modelId && await isSidecarHealthy(MLX_PORT)) {
		appendHealthLog(`Text server already healthy for ${modelId}`);
		return;
	}

	await startProcessSidecar(
		textSidecar,
		[
			getVenvPythonPath(),
			"-m",
			"mlx_lm.server",
			"--model",
			modelId,
			"--host",
			"127.0.0.1",
			"--port",
			String(MLX_PORT),
			"--max-tokens",
			"2048",
		],
		MLX_PORT,
		modelId,
		"text-server.log",
	);
}

async function ensureSttServerReady(modelId: string) {
	if (!canStartLocalAISidecars()) {
		throw new Error("Enable Local AI in Settings first.");
	}

	if (sttSidecar.proc && sttSidecar.modelId === modelId && await isSidecarHealthy(STT_PORT)) {
		appendHealthLog(`STT server already healthy for ${modelId}`);
		return;
	}

	const provider = getLocalAIModelProvider(modelId, "stt");
	const scriptPath = provider === "mlx-whisper"
		? join(import.meta.dir, "whisper_server.py")
		: join(import.meta.dir, "audio_stt_server.py");

	await startProcessSidecar(
		sttSidecar,
		[getVenvPythonPath(), scriptPath],
		STT_PORT,
		modelId,
		"stt-server.log",
		provider === "mlx-whisper"
			? { WHISPER_MODEL: modelId, WHISPER_PORT: String(STT_PORT) }
			: { STT_MODEL: modelId, STT_PORT: String(STT_PORT) },
	);
}

async function ensureTtsServerReady(modelId: string) {
	if (!canStartLocalAISidecars()) {
		throw new Error("Enable Local AI in Settings first.");
	}

	if (ttsSidecar.proc && ttsSidecar.modelId === modelId && await isSidecarHealthy(TTS_PORT)) {
		appendHealthLog(`TTS server already healthy for ${modelId}`);
		return;
	}

	const entry = getModelEntry(currentCatalog, modelId);
	const scriptPath = join(import.meta.dir, "audio_tts_server.py");
	await startProcessSidecar(
		ttsSidecar,
		[getVenvPythonPath(), scriptPath],
		TTS_PORT,
		modelId,
		"tts-server.log",
		{
			TTS_MODEL: modelId,
			TTS_PORT: String(TTS_PORT),
			TTS_DEFAULT_VOICE: entry?.defaultVoice ?? "Chelsie",
			TTS_DEFAULT_LANGUAGE: entry?.defaultLanguage ?? "English",
			TTS_DEFAULT_LANG_CODE: entry?.defaultLangCode ?? "",
		},
	);
}

async function ensureLocalAIRuntimeReady() {
	if (!settings.localAI.enabled || runtimeStatus.installState === "not_installed") {
		throw new Error("Enable Local AI in Settings first.");
	}
	if (runtimeStatus.installState === "installing") {
		throw new Error("Local AI is still installing. Wait for setup to finish.");
	}
	if (runtimeStatus.installState !== "ready") {
		throw new Error(settings.localAI.lastError ?? "Local AI is unavailable. Repair the install in Settings.");
	}
}

async function verifyLocalAIRuntime() {
	if (isInstallStepComplete("verify")
		&& await isSidecarHealthy(MLX_PORT)
		&& await isSidecarHealthy(STT_PORT)
		&& await isSidecarHealthy(TTS_PORT)) {
		appendHealthLog("Runtime verification skipped because all sidecars are already healthy");
		await captureLocalAIDiagnostics("verify-skipped-healthy");
		return;
	}

	setRuntimeStatus({ currentPhase: "Verifying local AI", progressPct: 92 });
	await ensureTextServerReady(settings.localAI.textModelId);
	await ensureSttServerReady(settings.localAI.sttModelId);
	await ensureTtsServerReady(settings.localAI.ttsModelId);
	appendHealthLog("Runtime verification succeeded for text, STT, and TTS sidecars");
	markInstallStepComplete("verify");
	await captureLocalAIDiagnostics("verify-success");
}

let installJob: Promise<void> | null = null;

function applyProfileToSettings(profileId: LocalAIProfileId) {
	const profile = getProfile(currentCatalog, profileId);
	settings.localAI.selectedProfileId = profile.id;
	settings.localAI.textModelId = profile.textModelId;
	settings.localAI.sttModelId = profile.sttModelId;
	settings.localAI.ttsModelId = profile.ttsModelId;
	settings.localAI.catalogVersion = currentCatalog.version;
	settings.localAI.installRoot = localAIRoot;
	saveSettingsToDisk(settings);
}

async function performLocalAIInstall(profileId: LocalAIProfileId, repair: boolean) {
	applyProfileToSettings(profileId);
	settings.localAI.enabled = true;
	saveSettingsToDisk(settings);

	const installPlan = !repair && canResumeInstall(profileId)
		? runtimeStatus.installPlan
		: createInstallPlan(profileId);
	appendLog(
		"install.log",
		repair
			? `Starting repair install for profile=${profileId}`
			: installPlan === runtimeStatus.installPlan
				? `Resuming install for profile=${profileId}`
				: `Starting fresh install for profile=${profileId}`,
	);
	setRuntimeStatus({
		installState: "installing",
		currentPhase: "Preparing local AI workspace",
		progressPct: 2,
		lastError: null,
		installPlan,
		installBundleVersion: installPlan?.bundleVersion ?? formatLocalAIBundleVersion(profileId),
		catalogVersion: currentCatalog.version,
	});

	ensureLocalAIDirectories();
	await installPackages(repair);
	reuseExistingSelectedModelCaches();
	markInstallStepComplete("cache");

	const sttProvider = getLocalAIModelProvider(settings.localAI.sttModelId, "stt");
	await preloadTextModel(settings.localAI.textModelId);
	await preloadSttModel(settings.localAI.sttModelId, sttProvider);
	await preloadTtsModel(settings.localAI.ttsModelId);
	await verifyLocalAIRuntime();

	appendLog("install.log", "Local AI install completed successfully");
	setRuntimeStatus({
		installState: "ready",
		currentPhase: null,
		progressPct: 100,
		lastError: null,
		installBundleVersion: formatLocalAIBundleVersion(profileId),
		catalogVersion: currentCatalog.version,
		installPlan: null,
	});
}

function beginLocalAIInstall(profileId: LocalAIProfileId, repair = false): LocalAIRequestResult {
	if (installJob) return { accepted: true };

	const runId = ++installRunId;
	installJob = performLocalAIInstall(profileId, repair)
		.catch(async (error: unknown) => {
			if (runId !== installRunId) return;
			const errorMessage = error instanceof Error ? error.message : "Local AI install failed.";
			appendLog("install.log", `Local AI install failed: ${errorMessage}`);
			setRuntimeStatus({
				installState: "error",
				currentPhase: null,
				progressPct: null,
				lastError: errorMessage,
			});
			await captureLocalAIDiagnostics("install-error");
		})
		.finally(() => {
			if (runId !== installRunId) return;
			installJob = null;
			activeInstallProc = null;
		});

	return { accepted: true };
}

function cancelLocalAIInstall() {
	installRunId += 1;
	if (activeInstallProc) {
		activeInstallProc.kill();
		activeInstallProc = null;
	}
	installJob = null;
	appendLog("install.log", "Local AI install cancelled by user");
	setRuntimeStatus({
		installState: "error",
		currentPhase: null,
		progressPct: null,
		lastError: "Local AI install cancelled. Retry to resume or remove Local AI to clear partial files.",
	});
	void captureLocalAIDiagnostics("install-cancelled");
	return { success: true };
}

function removeLocalAI() {
	installRunId += 1;
	if (activeInstallProc) {
		activeInstallProc.kill();
		activeInstallProc = null;
	}
	installJob = null;
	stopSidecar(textSidecar);
	stopSidecar(sttSidecar);
	stopSidecar(ttsSidecar);
	appendLog("install.log", "Removing Local AI files and resetting runtime state");
	rmSync(localAIRoot, { recursive: true, force: true });
	settings.provider = "openrouter";
	settings.localAI = createDefaultLocalAISettings(currentCatalog);
	settings.localAI.installRoot = localAIRoot;
	saveSettingsToDisk(settings);
	runtimeStatus = {
		installState: "not_installed",
		currentPhase: null,
		progressPct: null,
		lastError: null,
		installBundleVersion: null,
		catalogVersion: currentCatalog.version,
		installPlan: null,
	};
	syncSettingsFromRuntimeStatus();
	return { success: true };
}

async function callOpenRouter(systemPrompt: string, userMessage: string): Promise<string> {
	syncOpenRouterKeyFromSecureStorage();
	if (!settings.openrouterKey.trim()) {
		throw new Error("OpenRouter API key is missing. Set OPENROUTER_API_KEY or enter a key in Settings.");
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

async function callLocalAI(systemPrompt: string, userMessage: string) {
	await ensureLocalAIRuntimeReady();
	await ensureTextServerReady(settings.localAI.textModelId);
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

async function callAI(systemPrompt: string, userMessage: string): Promise<string> {
	if (settings.provider === "local") {
		return callLocalAI(systemPrompt, userMessage);
	}
	return callOpenRouter(systemPrompt, userMessage);
}

function extensionForAudioMimeType(audioMimeType?: string): string {
	switch (audioMimeType) {
		case "audio/mp4":
		case "audio/m4a":
			return "m4a";
		case "audio/ogg":
		case "audio/ogg;codecs=opus":
			return "ogg";
		case "audio/wav":
		case "audio/wave":
		case "audio/x-wav":
			return "wav";
		case "audio/webm":
		case "audio/webm;codecs=opus":
		default:
			return "webm";
	}
}

async function transcribeAudio(audioPath: string, language?: string, audioMimeType?: string): Promise<string> {
	let filePath = audioPath;

	if (audioPath.startsWith("base64:")) {
		const base64Data = audioPath.slice(7);
		const buffer = Buffer.from(base64Data, "base64");
		const extension = extensionForAudioMimeType(audioMimeType);
		filePath = join("/tmp", `buddywriter_voice_${Date.now()}.${extension}`);
		writeFileSync(filePath, buffer);
	}

	try {
		await ensureLocalAIRuntimeReady();
		await ensureSttServerReady(settings.localAI.sttModelId);
		const response = await fetch(`http://127.0.0.1:${STT_PORT}/transcribe`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ audio_path: filePath, language }),
		});
		if (!response.ok) {
			const error = await response.json() as { error?: string };
			throw new Error(error.error ?? "Transcription failed.");
		}
		const data = await response.json() as { text: string };
		return data.text;
	} finally {
		if (filePath !== audioPath) {
			try { unlinkSync(filePath); } catch {}
		}
	}
}

async function speakText(text: string) {
	await ensureLocalAIRuntimeReady();
	await ensureTtsServerReady(settings.localAI.ttsModelId);
	const entry = getModelEntry(currentCatalog, settings.localAI.ttsModelId);
	const response = await fetch(`http://127.0.0.1:${TTS_PORT}/speak`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			text,
			voice: entry?.defaultVoice,
			language: entry?.defaultLanguage,
			langCode: entry?.defaultLangCode,
		}),
	});
	if (!response.ok) {
		const error = await response.json() as { error?: string };
		throw new Error(error.error ?? "Speech generation failed.");
	}
	return response.json() as Promise<{ audioPath: string }>;
}

function escapeMarkdownHtml(text: string) {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

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
				response: SaveSettingsResult;
			};
			getLocalAICatalog: {
				params: {};
				response: { catalog: LocalAICatalog; profiles: LocalAIProfileSummary[] };
			};
			getLocalAIStatus: {
				params: {};
				response: LocalAIStatusResponse;
			};
			installLocalAI: {
				params: { profileId?: LocalAIProfileId };
				response: LocalAIRequestResult;
			};
			cancelLocalAIInstall: {
				params: {};
				response: { success: boolean };
			};
			repairLocalAI: {
				params: {};
				response: LocalAIRequestResult;
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
				params: { audioPath: string; audioMimeType?: string; language?: string };
				response: { text: string };
			};
			speakText: {
				params: { text: string };
				response: { accepted: boolean; audioPath?: string };
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
	maxRequestTime: 180000,
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
			getSettings: async () => {
				syncOpenRouterKeyFromSecureStorage();
				settings.localAI = normalizeLocalAISettings(settings.localAI);
				return settings;
			},
			saveSettings: (newSettings: Settings) => {
				settings = {
					...settings,
					...newSettings,
					localAI: normalizeLocalAISettings(newSettings.localAI),
				};
				const secureStoreResult = saveOpenRouterKeyToSecureStorage(settings.openrouterKey);
				saveSettingsToDisk(settings);

				if (!secureStoreResult.ok) {
					return {
						success: false,
						error: secureStoreResult.error ?? "Unable to persist the OpenRouter API key securely.",
					};
				}

				syncOpenRouterKeyFromSecureStorage();
				return { success: true };
			},
			getLocalAICatalog: () => {
				return {
					catalog: currentCatalog,
					profiles: currentCatalog.profiles.map((profile) => ({
						id: profile.id,
						label: profile.label,
						approxBundleGB: profile.approxBundleGB,
					})),
				};
			},
			getLocalAIStatus: () => getLocalAIStatus(),
			installLocalAI: ({ profileId }: { profileId?: LocalAIProfileId }) => {
				return beginLocalAIInstall(profileId ?? settings.localAI.selectedProfileId);
			},
			cancelLocalAIInstall: () => cancelLocalAIInstall(),
			repairLocalAI: () => beginLocalAIInstall(settings.localAI.selectedProfileId, true),
			removeLocalAI: () => removeLocalAI(),
			setLocalAIProfile: ({ profileId }: { profileId: LocalAIProfileId }) => {
				applyProfileToSettings(profileId);
				if (settings.localAI.enabled && runtimeStatus.installState === "ready") {
					beginLocalAIInstall(profileId);
				}
				return { success: true };
			},
			transcribeAudio: async ({ audioPath, audioMimeType, language }: { audioPath: string; audioMimeType?: string; language?: string }) => {
				const text = await transcribeAudio(audioPath, language, audioMimeType);
				return { text };
			},
			speakText: async ({ text }: { text: string }) => {
				const result = await speakText(text);
				return { accepted: true, audioPath: result.audioPath };
			},
		},
		messages: {},
	},
});

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

win.webview.setNavigationRules([
	"^*",
	"views://mainview/*",
	"views://internal/*",
]);

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
	switch (event.data.action) {
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

function cleanupLocalAI() {
	stopSidecar(textSidecar);
	stopSidecar(sttSidecar);
	stopSidecar(ttsSidecar);
}

process.on("beforeExit", cleanupLocalAI);
process.on("SIGINT", () => {
	cleanupLocalAI();
	process.exit();
});

console.log("BuddyWriter started!");
