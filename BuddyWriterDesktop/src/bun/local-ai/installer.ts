import { existsSync, rmSync, writeFileSync } from "fs";
import { spawn } from "bun";
import { join } from "path";
import type { LocalAIProfileId, LocalAIRequestResult } from "../../shared/models/local-ai";
import {
	DEFAULT_UV_PYTHON,
	localAIBinDir,
	localAIRoot,
	localAIVenvDir,
	UV_INSTALL_SCRIPT_URL,
} from "../config";
import type { SettingsRepository } from "../services/settings-repository";
import type { CatalogService } from "./catalog-service";
import {
	appendLog,
	ensureLocalAIDirectories,
	hasManagedModelCache,
	reuseExistingModelCache,
} from "./fs-utils";
import type { RuntimeStatusService } from "./runtime-status";
import { getLocalAIEnv, getUvPath, getVenvPythonPath, readStreamText } from "./runtime-env";
import type { SidecarManager } from "./sidecar-manager";

export type LocalAIInstaller = ReturnType<typeof createLocalAIInstaller>;

export function createLocalAIInstaller(options: {
	catalogService: CatalogService;
	runtimeStatusService: RuntimeStatusService;
	settingsRepository: SettingsRepository;
	sidecarManager: SidecarManager;
}) {
	const { runtimeStatusService, settingsRepository, sidecarManager } = options;
	let installJob: Promise<void> | null = null;
	let activeInstallProc: ReturnType<typeof spawn> | null = null;
	let installRunId = 0;

	function isManagedVenvReady(): boolean {
		return existsSync(join(localAIVenvDir, "pyvenv.cfg")) && existsSync(getVenvPythonPath());
	}

	function clearManagedVenv(reason: string): void {
		if (!existsSync(localAIVenvDir)) return;
		appendLog("install.log", `Clearing managed venv: ${reason}`);
		rmSync(localAIVenvDir, { recursive: true, force: true });
	}

	function commandSucceeds(cmd: string[], env: Record<string, string> = {}): boolean {
		const result = Bun.spawnSync({
			cmd,
			env: getLocalAIEnv(env),
			stdout: "pipe",
			stderr: "pipe",
		});
		return result.exitCode === 0;
	}

	function hasRequiredLocalAIPackages(): boolean {
		if (!isManagedVenvReady()) return false;
		return commandSucceeds([
			getVenvPythonPath(),
			"-c",
			"import mlx_lm, mlx_audio, mlx_whisper, soundfile; print('ready')",
		]);
	}

	async function runCommand(cmd: string[], logName: string, env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string }> {
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

	async function ensureUvInstalled(): Promise<string> {
		const uvPath = getUvPath();
		if (existsSync(uvPath)) {
			appendLog("install.log", `Using existing uv binary at ${uvPath}`);
			runtimeStatusService.markInstallStepComplete("uv");
			return uvPath;
		}

		runtimeStatusService.setRuntimeStatus({ currentPhase: "Downloading runtime", progressPct: 8 });
		const response = await fetch(UV_INSTALL_SCRIPT_URL);
		if (!response.ok) {
			throw new Error("Unable to download the uv installer.");
		}
		writeFileSync(join(localAIRoot, "manifests", "uv-install.sh"), await response.text());
		await runCommand(
			["sh", join(localAIRoot, "manifests", "uv-install.sh"), "--quiet"],
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
		runtimeStatusService.markInstallStepComplete("uv");
		return uvPath;
	}

	async function ensureManagedPythonInstalled(): Promise<void> {
		const uvPath = await ensureUvInstalled();
		runtimeStatusService.setRuntimeStatus({ currentPhase: "Installing managed Python", progressPct: 14 });
		await runCommand(
			[uvPath, "python", "install", "--managed-python", DEFAULT_UV_PYTHON],
			"install.log",
		);
		appendLog("install.log", `Managed CPython ${DEFAULT_UV_PYTHON} is ready`);
		runtimeStatusService.markInstallStepComplete("python");
	}

	async function ensureManagedVenv(repair: boolean): Promise<string> {
		const uvPath = await ensureUvInstalled();
		await ensureManagedPythonInstalled();

		if (repair) {
			clearManagedVenv("repair requested");
		}

		if (isManagedVenvReady()) {
			appendLog("install.log", `Reusing existing managed venv at ${localAIVenvDir}`);
			runtimeStatusService.markInstallStepComplete("venv");
			return getVenvPythonPath();
		}

		if (existsSync(localAIVenvDir)) {
			clearManagedVenv("existing venv was incomplete or invalid");
		}

		runtimeStatusService.setRuntimeStatus({ currentPhase: "Preparing Python", progressPct: 18 });
		await runCommand(
			[uvPath, "venv", localAIVenvDir, "--python", DEFAULT_UV_PYTHON, "--managed-python", "--clear"],
			"install.log",
		);

		appendLog("install.log", `Managed venv ready at ${localAIVenvDir}`);
		runtimeStatusService.markInstallStepComplete("venv");
		return getVenvPythonPath();
	}

	async function installPackages(repair: boolean): Promise<string> {
		const uvPath = await ensureUvInstalled();
		const pythonPath = await ensureManagedVenv(repair);
		if (!repair && runtimeStatusService.isInstallStepComplete("packages") && hasRequiredLocalAIPackages()) {
			appendLog("install.log", "Python packages already installed; skipping package install");
			return pythonPath;
		}

		runtimeStatusService.setRuntimeStatus({ currentPhase: "Installing local AI packages", progressPct: 34 });
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
		runtimeStatusService.markInstallStepComplete("packages");
		return pythonPath;
	}

	function reuseExistingSelectedModelCaches(): void {
		const settings = settingsRepository.getSettings();
		runtimeStatusService.setRuntimeStatus({ currentPhase: "Checking for existing model files", progressPct: 46 });
		reuseExistingModelCache(settings.localAI.textModelId, appendLog);
		reuseExistingModelCache(settings.localAI.grammarModelId, appendLog);
		reuseExistingModelCache(settings.localAI.sttModelId, appendLog);
		reuseExistingModelCache(settings.localAI.ttsModelId, appendLog);
	}

	async function preloadTextModel(modelId: string): Promise<void> {
		if (runtimeStatusService.isInstallStepComplete("text_model") && hasManagedModelCache(modelId)) {
			appendLog("install.log", `Text model cache already present for ${modelId}; skipping preload`);
			return;
		}

		runtimeStatusService.setRuntimeStatus({ currentPhase: "Downloading text model", progressPct: 52 });
		await runCommand(
			[
				getVenvPythonPath(),
				"-c",
				`from mlx_lm import load; load(${JSON.stringify(modelId)}); print("ready")`,
			],
			"install.log",
		);
		appendLog("install.log", `Text model ready: ${modelId}`);
		runtimeStatusService.markInstallStepComplete("text_model");
	}

	async function preloadGrammarModel(modelId: string): Promise<void> {
		if (runtimeStatusService.isInstallStepComplete("grammar_model") && hasManagedModelCache(modelId)) {
			appendLog("install.log", `Grammar model cache already present for ${modelId}; skipping preload`);
			return;
		}

		runtimeStatusService.setRuntimeStatus({ currentPhase: "Downloading grammar model", progressPct: 60 });
		await runCommand(
			[
				getVenvPythonPath(),
				"-c",
				`from mlx_lm import load; load(${JSON.stringify(modelId)}); print("ready")`,
			],
			"install.log",
		);
		appendLog("install.log", `Grammar model ready: ${modelId}`);
		runtimeStatusService.markInstallStepComplete("grammar_model");
	}

	async function preloadSttModel(modelId: string, provider: string): Promise<void> {
		if (runtimeStatusService.isInstallStepComplete("stt_model") && hasManagedModelCache(modelId)) {
			appendLog("install.log", `STT model cache already present for ${modelId}; skipping preload`);
			return;
		}

		runtimeStatusService.setRuntimeStatus({ currentPhase: "Downloading voice input model", progressPct: 68 });
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
			runtimeStatusService.markInstallStepComplete("stt_model");
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
		runtimeStatusService.markInstallStepComplete("stt_model");
	}

	async function preloadTtsModel(modelId: string): Promise<void> {
		if (runtimeStatusService.isInstallStepComplete("tts_model") && hasManagedModelCache(modelId)) {
			appendLog("install.log", `TTS model cache already present for ${modelId}; skipping preload`);
			return;
		}

		runtimeStatusService.setRuntimeStatus({ currentPhase: "Downloading voice output model", progressPct: 82 });
		await runCommand(
			[
				getVenvPythonPath(),
				"-c",
				`from mlx_audio.tts import load; load(${JSON.stringify(modelId)}); print("ready")`,
			],
			"install.log",
		);
		appendLog("install.log", `TTS model ready: ${modelId}`);
		runtimeStatusService.markInstallStepComplete("tts_model");
	}

	async function performLocalAIInstall(profileId: LocalAIProfileId, repair: boolean): Promise<void> {
		settingsRepository.applyProfileToSettings(profileId);
		settingsRepository.getSettings().localAI.enabled = true;
		settingsRepository.saveSettingsToDisk();

		const installPlan = !repair && runtimeStatusService.canResumeInstall(profileId)
			? runtimeStatusService.getRuntimeStatus().installPlan
			: runtimeStatusService.createInstallPlan(profileId);
		appendLog(
			"install.log",
			repair
				? `Starting repair install for profile=${profileId}`
				: installPlan === runtimeStatusService.getRuntimeStatus().installPlan
					? `Resuming install for profile=${profileId}`
					: `Starting fresh install for profile=${profileId}`,
		);
		runtimeStatusService.setRuntimeStatus({
			installState: "installing",
			currentPhase: "Preparing local AI workspace",
			progressPct: 2,
			lastError: null,
			installPlan,
			installBundleVersion: installPlan?.bundleVersion ?? runtimeStatusService.formatLocalAIBundleVersion(profileId),
			catalogVersion: settingsRepository.getSettings().localAI.catalogVersion,
		});

		ensureLocalAIDirectories();
		await installPackages(repair);
		reuseExistingSelectedModelCaches();
		runtimeStatusService.markInstallStepComplete("cache");

		const settings = settingsRepository.getSettings();
		const sttProvider = sidecarManager.getModelProvider(settings.localAI.sttModelId, "stt");
		await preloadTextModel(settings.localAI.textModelId);
		await preloadGrammarModel(settings.localAI.grammarModelId);
		await preloadSttModel(settings.localAI.sttModelId, sttProvider);
		await preloadTtsModel(settings.localAI.ttsModelId);
		await sidecarManager.verifyLocalAIRuntime();

		appendLog("install.log", "Local AI install completed successfully");
		runtimeStatusService.setRuntimeStatus({
			installState: "ready",
			currentPhase: null,
			progressPct: 100,
			lastError: null,
			installBundleVersion: runtimeStatusService.formatLocalAIBundleVersion(profileId),
			catalogVersion: settingsRepository.getSettings().localAI.catalogVersion,
			installPlan: null,
		});
		sidecarManager.refreshKeepWarmState("install-complete");
	}

	function beginLocalAIInstall(profileId: LocalAIProfileId, repair = false): LocalAIRequestResult {
		if (installJob) return { accepted: true };

		const runId = ++installRunId;
		installJob = performLocalAIInstall(profileId, repair)
			.catch(async (error: unknown) => {
				if (runId !== installRunId) return;
				const errorMessage = error instanceof Error ? error.message : "Local AI install failed.";
				appendLog("install.log", `Local AI install failed: ${errorMessage}`);
				runtimeStatusService.setRuntimeStatus({
					installState: "error",
					currentPhase: null,
					progressPct: null,
					lastError: errorMessage,
				});
				await sidecarManager.captureLocalAIDiagnostics("install-error");
			})
			.finally(() => {
				if (runId !== installRunId) return;
				installJob = null;
				activeInstallProc = null;
			});

		return { accepted: true };
	}

	function cancelLocalAIInstall(): { success: boolean } {
		installRunId += 1;
		if (activeInstallProc) {
			activeInstallProc.kill();
			activeInstallProc = null;
		}
		installJob = null;
		appendLog("install.log", "Local AI install cancelled by user");
		runtimeStatusService.setRuntimeStatus({
			installState: "error",
			currentPhase: null,
			progressPct: null,
			lastError: "Local AI install cancelled. Retry to resume or remove Local AI to clear partial files.",
		});
		sidecarManager.refreshKeepWarmState("install-cancelled");
		void sidecarManager.captureLocalAIDiagnostics("install-cancelled");
		return { success: true };
	}

	function removeLocalAI(): { success: boolean } {
		installRunId += 1;
		if (activeInstallProc) {
			activeInstallProc.kill();
			activeInstallProc = null;
		}
		installJob = null;
		sidecarManager.flush();
		appendLog("install.log", "Removing Local AI files and resetting runtime state");
		rmSync(localAIRoot, { recursive: true, force: true });
		settingsRepository.getSettings().provider = "openrouter";
		settingsRepository.getSettings().localAI = settingsRepository.createDefaultLocalAISettings(options.catalogService.getCatalog());
		settingsRepository.getSettings().localAI.installRoot = localAIRoot;
		settingsRepository.saveSettingsToDisk();
		runtimeStatusService.setRuntimeStatus({
			installState: "not_installed",
			currentPhase: null,
			progressPct: null,
			lastError: null,
			installBundleVersion: null,
			catalogVersion: options.catalogService.getCatalog().version,
			installPlan: null,
		});
		return { success: true };
	}

	return {
		beginLocalAIInstall,
		cancelLocalAIInstall,
		removeLocalAI,
	};
}
