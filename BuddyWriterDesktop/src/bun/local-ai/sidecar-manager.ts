import { existsSync } from "fs";
import { type Subprocess, spawn } from "bun";
import { join } from "path";
import type { LocalAIDiagnostics, LocalAIModelKind, LocalAIModelProvider } from "../../shared/models/local-ai";
import {
	GRAMMAR_PORT,
	GRAMMAR_SIDECAR_IDLE_MS,
	MAX_SIDECAR_LOG_LINES,
	MLX_PORT,
	STT_PORT,
	STT_SIDECAR_IDLE_MS,
	TEXT_SIDECAR_IDLE_MS,
	TTS_PORT,
	TTS_SIDECAR_IDLE_MS,
} from "../config";
import type { SettingsRepository } from "../services/settings-repository";
import type { CatalogService } from "./catalog-service";
import {
	appendLog,
	ensureLocalAIDirectories,
	hasManagedModelCache,
	localAIPaths,
	writeJsonFile,
} from "./fs-utils";
import type { RuntimeStatusService } from "./runtime-status";
import { getLocalAIEnv, getUvPath, getVenvPythonPath } from "./runtime-env";

type SidecarState = {
	proc: Subprocess | null;
	modelId: string | null;
	logs: string[];
	idleTimer: ReturnType<typeof setTimeout> | null;
};

export type SidecarManager = ReturnType<typeof createSidecarManager>;

function pushLogLines(buffer: string[], text: string, logName: string): void {
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

async function captureProcessStream(
	stream: ReadableStream<Uint8Array> | null | undefined,
	buffer: string[],
	logName: string,
): Promise<void> {
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

function trackProcessLogs(proc: Subprocess, buffer: string[], logName: string): void {
	buffer.length = 0;
	void captureProcessStream(proc.stdout as ReadableStream<Uint8Array> | null, buffer, logName);
	void captureProcessStream(proc.stderr as ReadableStream<Uint8Array> | null, buffer, logName);
}

function recentLogs(buffer: string[], fallback: string): string {
	if (buffer.length === 0) return fallback;
	return buffer.slice(-6).join(" | ");
}

export function createSidecarManager(options: {
	catalogService: CatalogService;
	runtimeStatusService: RuntimeStatusService;
	settingsRepository: SettingsRepository;
}) {
	const { catalogService, runtimeStatusService, settingsRepository } = options;
	const textSidecar: SidecarState = { proc: null, modelId: null, logs: [], idleTimer: null };
	const grammarSidecar: SidecarState = { proc: null, modelId: null, logs: [], idleTimer: null };
	const sttSidecar: SidecarState = { proc: null, modelId: null, logs: [], idleTimer: null };
	const ttsSidecar: SidecarState = { proc: null, modelId: null, logs: [], idleTimer: null };

	function appendHealthLog(text: string): void {
		appendLog("health.log", text);
	}

	function isManagedVenvReady(): boolean {
		return existsSync(join(localAIPaths.localAIVenvDir, "pyvenv.cfg")) && existsSync(getVenvPythonPath());
	}

	function hasRequiredLocalAIPackages(): boolean {
		if (!isManagedVenvReady()) return false;

		const result = Bun.spawnSync({
			cmd: [
				getVenvPythonPath(),
				"-c",
				"import mlx_lm, mlx_audio, mlx_whisper, soundfile; print('ready')",
			],
			env: getLocalAIEnv(),
			stdout: "pipe",
			stderr: "pipe",
		});
		return result.exitCode === 0;
	}

	function getModelProvider(modelId: string, fallbackKind?: LocalAIModelKind): LocalAIModelProvider {
		return catalogService.getModelEntry(modelId)?.provider ?? (fallbackKind === "stt" ? "mlx-whisper" : "mlx-audio");
	}

	async function isSidecarHealthy(port: number): Promise<boolean> {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/health`);
			return response.ok;
		} catch {
			return false;
		}
	}

	function clearSidecarIdleTimer(sidecar: SidecarState): void {
		if (!sidecar.idleTimer) return;
		clearTimeout(sidecar.idleTimer);
		sidecar.idleTimer = null;
	}

	function stopSidecar(sidecar: SidecarState): void {
		clearSidecarIdleTimer(sidecar);
		if (sidecar.proc) {
			sidecar.proc.kill();
			sidecar.proc = null;
		}
		sidecar.modelId = null;
	}

	function stopAllSidecars(): void {
		stopSidecar(textSidecar);
		stopSidecar(grammarSidecar);
		stopSidecar(sttSidecar);
		stopSidecar(ttsSidecar);
	}

	function scheduleSidecarIdleShutdown(sidecar: SidecarState, idleMs: number, label: string): void {
		clearSidecarIdleTimer(sidecar);
		sidecar.idleTimer = setTimeout(() => {
			appendHealthLog(`Stopping idle ${label}`);
			stopSidecar(sidecar);
		}, idleMs);
	}

	async function startProcessSidecar(
		sidecar: SidecarState,
		cmd: string[],
		port: number,
		modelId: string,
		logName: string,
		idleMs: number,
		env: Record<string, string> = {},
	): Promise<void> {
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
				scheduleSidecarIdleShutdown(sidecar, idleMs, logName);
				return;
			}
			await Bun.sleep(800);
		}

		stopSidecar(sidecar);
		appendHealthLog(`${logName} failed to become healthy for ${modelId} on port ${port}`);
		throw new Error(recentLogs(sidecar.logs, `Timed out starting ${modelId}.`));
	}

	function canStartLocalAISidecars(): boolean {
		const settings = settingsRepository.getSettings();
		const runtimeStatus = runtimeStatusService.getRuntimeStatus();
		return settings.localAI.enabled
			&& (runtimeStatus.installState === "ready" || runtimeStatus.installState === "installing");
	}

	async function ensureTextServerReady(modelId: string): Promise<void> {
		if (!canStartLocalAISidecars()) {
			throw new Error("Enable Local AI in Settings first.");
		}

		if (textSidecar.proc && textSidecar.modelId === modelId && await isSidecarHealthy(MLX_PORT)) {
			appendHealthLog(`Text server already healthy for ${modelId}`);
			scheduleSidecarIdleShutdown(textSidecar, TEXT_SIDECAR_IDLE_MS, "text-server.log");
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
			TEXT_SIDECAR_IDLE_MS,
		);
	}

	async function ensureGrammarServerReady(modelId: string): Promise<void> {
		if (!canStartLocalAISidecars()) {
			throw new Error("Enable Local AI in Settings first.");
		}

		if (grammarSidecar.proc && grammarSidecar.modelId === modelId && await isSidecarHealthy(GRAMMAR_PORT)) {
			appendHealthLog(`Grammar server already healthy for ${modelId}`);
			scheduleSidecarIdleShutdown(grammarSidecar, GRAMMAR_SIDECAR_IDLE_MS, "grammar-server.log");
			return;
		}

		await startProcessSidecar(
			grammarSidecar,
			[
				getVenvPythonPath(),
				"-m",
				"mlx_lm.server",
				"--model",
				modelId,
				"--host",
				"127.0.0.1",
				"--port",
				String(GRAMMAR_PORT),
				"--max-tokens",
				"512",
			],
			GRAMMAR_PORT,
			modelId,
			"grammar-server.log",
			GRAMMAR_SIDECAR_IDLE_MS,
		);
	}

	async function ensureSttServerReady(modelId: string): Promise<void> {
		if (!canStartLocalAISidecars()) {
			throw new Error("Enable Local AI in Settings first.");
		}

		if (sttSidecar.proc && sttSidecar.modelId === modelId && await isSidecarHealthy(STT_PORT)) {
			appendHealthLog(`STT server already healthy for ${modelId}`);
			scheduleSidecarIdleShutdown(sttSidecar, STT_SIDECAR_IDLE_MS, "stt-server.log");
			return;
		}

		const provider = getModelProvider(modelId, "stt");
		const scriptPath = provider === "mlx-whisper"
			? join(import.meta.dir, "..", "whisper_server.py")
			: join(import.meta.dir, "..", "audio_stt_server.py");

		await startProcessSidecar(
			sttSidecar,
			[getVenvPythonPath(), scriptPath],
			STT_PORT,
			modelId,
			"stt-server.log",
			STT_SIDECAR_IDLE_MS,
			provider === "mlx-whisper"
				? { WHISPER_MODEL: modelId, WHISPER_PORT: String(STT_PORT) }
				: { STT_MODEL: modelId, STT_PORT: String(STT_PORT) },
		);
	}

	async function ensureTtsServerReady(modelId: string): Promise<void> {
		if (!canStartLocalAISidecars()) {
			throw new Error("Enable Local AI in Settings first.");
		}

		if (ttsSidecar.proc && ttsSidecar.modelId === modelId && await isSidecarHealthy(TTS_PORT)) {
			appendHealthLog(`TTS server already healthy for ${modelId}`);
			scheduleSidecarIdleShutdown(ttsSidecar, TTS_SIDECAR_IDLE_MS, "tts-server.log");
			return;
		}

		const entry = catalogService.getModelEntry(modelId);
		const scriptPath = join(import.meta.dir, "..", "audio_tts_server.py");
		await startProcessSidecar(
			ttsSidecar,
			[getVenvPythonPath(), scriptPath],
			TTS_PORT,
			modelId,
			"tts-server.log",
			TTS_SIDECAR_IDLE_MS,
			{
				TTS_MODEL: modelId,
				TTS_PORT: String(TTS_PORT),
				TTS_DEFAULT_VOICE: entry?.defaultVoice ?? "Chelsie",
				TTS_DEFAULT_LANGUAGE: entry?.defaultLanguage ?? "English",
				TTS_DEFAULT_LANG_CODE: entry?.defaultLangCode ?? "",
			},
		);
	}

	async function ensureLocalAIRuntimeReady(): Promise<void> {
		const settings = settingsRepository.getSettings();
		const runtimeStatus = runtimeStatusService.getRuntimeStatus();
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

	async function captureLocalAIDiagnostics(reason: string): Promise<void> {
		const settings = settingsRepository.getSettings();
		const runtimeStatus = runtimeStatusService.getRuntimeStatus();
		const diagnostics: LocalAIDiagnostics = {
			capturedAt: new Date().toISOString(),
			reason,
			installState: runtimeStatus.installState,
			currentPhase: runtimeStatus.currentPhase,
			lastError: runtimeStatus.lastError,
			installBundleVersion: runtimeStatus.installBundleVersion,
			catalogVersion: runtimeStatus.catalogVersion,
			installRoot: localAIPaths.localAIRoot,
			logsDir: localAIPaths.localAILogsDir,
			profileId: settings.localAI.selectedProfileId,
			models: {
				text: settings.localAI.textModelId,
				grammar: settings.localAI.grammarModelId,
				stt: settings.localAI.sttModelId,
				tts: settings.localAI.ttsModelId,
			},
			paths: {
				uv: getUvPath(),
				python: getVenvPythonPath(),
				venv: localAIPaths.localAIVenvDir,
			},
			artifacts: {
				uvInstalled: existsSync(getUvPath()),
				venvReady: isManagedVenvReady(),
				packagesReady: hasRequiredLocalAIPackages(),
				textModelCached: hasManagedModelCache(settings.localAI.textModelId),
				grammarModelCached: hasManagedModelCache(settings.localAI.grammarModelId),
				sttModelCached: hasManagedModelCache(settings.localAI.sttModelId),
				ttsModelCached: hasManagedModelCache(settings.localAI.ttsModelId),
			},
			sidecars: {
				text: {
					pid: textSidecar.proc?.pid ?? null,
					healthy: await isSidecarHealthy(MLX_PORT),
					modelId: textSidecar.modelId,
				},
				grammar: {
					pid: grammarSidecar.proc?.pid ?? null,
					healthy: await isSidecarHealthy(GRAMMAR_PORT),
					modelId: grammarSidecar.modelId,
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

		ensureLocalAIDirectories();
		writeJsonFile(localAIPaths.localAIDiagnosticsPath, diagnostics);
		appendHealthLog(
			[
				`Diagnostics captured (${reason})`,
				`state=${diagnostics.installState}`,
				`bundle=${diagnostics.installBundleVersion ?? "none"}`,
				`textHealthy=${diagnostics.sidecars.text.healthy}`,
				`grammarHealthy=${diagnostics.sidecars.grammar.healthy}`,
				`sttHealthy=${diagnostics.sidecars.stt.healthy}`,
				`ttsHealthy=${diagnostics.sidecars.tts.healthy}`,
			].join(" "),
		);
	}

	async function verifyLocalAIRuntime(): Promise<void> {
		if (runtimeStatusService.isInstallStepComplete("verify")
			&& await isSidecarHealthy(MLX_PORT)
			&& await isSidecarHealthy(GRAMMAR_PORT)
			&& await isSidecarHealthy(STT_PORT)
			&& await isSidecarHealthy(TTS_PORT)) {
			appendHealthLog("Runtime verification skipped because all sidecars are already healthy");
			await captureLocalAIDiagnostics("verify-skipped-healthy");
			return;
		}

		runtimeStatusService.setRuntimeStatus({ currentPhase: "Verifying local AI", progressPct: 92 });
		const settings = settingsRepository.getSettings();
		await ensureTextServerReady(settings.localAI.textModelId);
		await ensureGrammarServerReady(settings.localAI.grammarModelId);
		await ensureSttServerReady(settings.localAI.sttModelId);
		await ensureTtsServerReady(settings.localAI.ttsModelId);
		appendHealthLog("Runtime verification succeeded for text, grammar, STT, and TTS sidecars");
		runtimeStatusService.markInstallStepComplete("verify");
		await captureLocalAIDiagnostics("verify-success");
	}

	function refreshKeepWarmState(reason: string): void {
		appendHealthLog(`Refreshing sidecar residency: ${reason}`);
		const settings = settingsRepository.getSettings();
		const runtimeStatus = runtimeStatusService.getRuntimeStatus();
		const canKeepResident = settings.localAI.enabled
			&& settings.provider === "local"
			&& runtimeStatus.installState === "ready";

		if (canKeepResident) return;
		stopAllSidecars();
	}

	return {
		appendHealthLog,
		captureLocalAIDiagnostics,
		ensureGrammarServerReady,
		ensureLocalAIRuntimeReady,
		ensureSttServerReady,
		ensureTextServerReady,
		ensureTtsServerReady,
		flush: stopAllSidecars,
		getModelProvider,
		isSidecarHealthy,
		refreshKeepWarmState,
		verifyLocalAIRuntime,
	};
}
