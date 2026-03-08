export type LocalAIProfileId = "starter" | "quality";
export type LocalAIInstallState = "not_installed" | "installing" | "ready" | "error";
export type LocalAIInstallStep =
	| "uv"
	| "python"
	| "venv"
	| "packages"
	| "cache"
	| "text_model"
	| "grammar_model"
	| "stt_model"
	| "tts_model"
	| "verify";
export type LocalAIModelKind = "text" | "stt" | "tts";
export type LocalAIModelProvider = "mlx-lm" | "mlx-audio" | "mlx-whisper";

export type LocalAIModelEntry = {
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

export type LocalAIProfile = {
	id: LocalAIProfileId;
	label: string;
	textModelId: string;
	grammarModelId: string;
	sttModelId: string;
	ttsModelId: string;
	approxBundleGB: number;
};

export type LocalAICatalog = {
	version: string;
	generatedAt: string;
	models: LocalAIModelEntry[];
	profiles: LocalAIProfile[];
	defaultProfileId: LocalAIProfileId;
};

export type LocalAISettings = {
	enabled: boolean;
	installState: LocalAIInstallState;
	selectedProfileId: LocalAIProfileId;
	textModelId: string;
	grammarModelId: string;
	sttModelId: string;
	ttsModelId: string;
	catalogVersion: string | null;
	installBundleVersion: string | null;
	installRoot: string;
	lastError: string | null;
};

export type LocalAIStatus = {
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
	grammarModelId: string;
	sttModelId: string;
	ttsModelId: string;
};

export type LocalAIInstallPlan = {
	profileId: LocalAIProfileId;
	textModelId: string;
	grammarModelId: string;
	sttModelId: string;
	ttsModelId: string;
	bundleVersion: string;
	completedSteps: LocalAIInstallStep[];
	startedAt: string;
	updatedAt: string;
};

export type LocalAIRuntimeStatus = {
	installState: LocalAIInstallState;
	currentPhase: string | null;
	progressPct: number | null;
	lastError: string | null;
	installBundleVersion: string | null;
	catalogVersion: string | null;
	installPlan: LocalAIInstallPlan | null;
};

export type LocalAIDiagnostics = {
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
		grammar: string;
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
		grammarModelCached: boolean;
		sttModelCached: boolean;
		ttsModelCached: boolean;
	};
	sidecars: {
		text: { pid: number | null; healthy: boolean; modelId: string | null };
		grammar: { pid: number | null; healthy: boolean; modelId: string | null };
		stt: { pid: number | null; healthy: boolean; modelId: string | null };
		tts: { pid: number | null; healthy: boolean; modelId: string | null };
	};
	installPlan: LocalAIInstallPlan | null;
};

export type LocalAIRequestResult = {
	accepted: boolean;
	error?: string;
};

export type LocalAIProfileSummary = {
	id: LocalAIProfileId;
	label: string;
	approxBundleGB: number;
};
