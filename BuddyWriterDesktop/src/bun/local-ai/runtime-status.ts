import type { LocalAIInstallPlan, LocalAIInstallStep, LocalAIRuntimeStatus, LocalAIStatus } from "../../shared/models/local-ai";
import { localAIInstallStatePath, localAIRoot } from "../config";
import type { SettingsRepository } from "../services/settings-repository";
import type { CatalogService } from "./catalog-service";
import { ensureLocalAIDirectories, getDirectorySizeGB, readJsonFile, writeJsonFile } from "./fs-utils";

export type RuntimeStatusService = ReturnType<typeof createRuntimeStatusService>;

export function createRuntimeStatusService(options: {
	catalogService: CatalogService;
	settingsRepository: SettingsRepository;
}) {
	const { catalogService, settingsRepository } = options;
	const settings = settingsRepository.getSettings();

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

	function persistRuntimeStatus(): void {
		ensureLocalAIDirectories();
		writeJsonFile(localAIInstallStatePath, runtimeStatus);
	}

	function syncSettingsFromRuntimeStatus(): void {
		const settings = settingsRepository.getSettings();
		settings.localAI.installState = runtimeStatus.installState;
		settings.localAI.lastError = runtimeStatus.lastError;
		settings.localAI.installBundleVersion = runtimeStatus.installBundleVersion;
		settings.localAI.catalogVersion = runtimeStatus.catalogVersion ?? catalogService.getCatalog().version;
		settingsRepository.saveSettingsToDisk(settings);
		persistRuntimeStatus();
	}

	function getRuntimeStatus(): LocalAIRuntimeStatus {
		return runtimeStatus;
	}

	function setRuntimeStatus(patch: Partial<LocalAIRuntimeStatus>): void {
		runtimeStatus = { ...runtimeStatus, ...patch };
		syncSettingsFromRuntimeStatus();
	}

	function formatLocalAIBundleVersion(profileId: string): string {
		return `${catalogService.getCatalog().version}:${profileId}`;
	}

	function createInstallPlan(profileId: LocalAIInstallPlan["profileId"]): LocalAIInstallPlan {
		const settings = settingsRepository.getSettings();
		const startedAt = new Date().toISOString();
		return {
			profileId,
			textModelId: settings.localAI.textModelId,
			grammarModelId: settings.localAI.grammarModelId,
			sttModelId: settings.localAI.sttModelId,
			ttsModelId: settings.localAI.ttsModelId,
			bundleVersion: formatLocalAIBundleVersion(profileId),
			completedSteps: [],
			startedAt,
			updatedAt: startedAt,
		};
	}

	function updateInstallPlan(mutator: (plan: LocalAIInstallPlan) => LocalAIInstallPlan): void {
		if (!runtimeStatus.installPlan) return;
		setRuntimeStatus({
			installPlan: mutator(runtimeStatus.installPlan),
		});
	}

	function markInstallStepComplete(step: LocalAIInstallStep): void {
		updateInstallPlan((plan) => ({
			...plan,
			completedSteps: plan.completedSteps.includes(step)
				? plan.completedSteps
				: [...plan.completedSteps, step],
			updatedAt: new Date().toISOString(),
		}));
	}

	function isInstallStepComplete(step: LocalAIInstallStep): boolean {
		return runtimeStatus.installPlan?.completedSteps.includes(step) ?? false;
	}

	function canResumeInstall(profileId: LocalAIInstallPlan["profileId"]): boolean {
		const settings = settingsRepository.getSettings();
		const bundleVersion = formatLocalAIBundleVersion(profileId);
		const plan = runtimeStatus.installPlan;
		if (!plan) return false;
		return plan.bundleVersion === bundleVersion
			&& plan.profileId === profileId
			&& plan.textModelId === settings.localAI.textModelId
			&& plan.grammarModelId === settings.localAI.grammarModelId
			&& plan.sttModelId === settings.localAI.sttModelId
			&& plan.ttsModelId === settings.localAI.ttsModelId;
	}

	function getLocalAIStatus(): LocalAIStatus {
		const settings = settingsRepository.getSettings();
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
			grammarModelId: settings.localAI.grammarModelId,
			sttModelId: settings.localAI.sttModelId,
			ttsModelId: settings.localAI.ttsModelId,
		};
	}

	syncSettingsFromRuntimeStatus();

	return {
		canResumeInstall,
		createInstallPlan,
		formatLocalAIBundleVersion,
		getLocalAIStatus,
		getRuntimeStatus,
		isInstallStepComplete,
		markInstallStepComplete,
		persistRuntimeStatus,
		setRuntimeStatus,
		syncSettingsFromRuntimeStatus,
		updateInstallPlan,
	};
}
