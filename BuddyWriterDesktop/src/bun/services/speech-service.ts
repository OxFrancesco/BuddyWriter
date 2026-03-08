import { Buffer } from "buffer";
import { readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "fs";
import { basename, dirname, join, resolve, sep } from "path";
import { tmpdir } from "os";
import { STT_PORT, TTS_AUDIO_RETENTION_MS, TTS_PORT } from "../config";
import type { CatalogService } from "../local-ai/catalog-service";
import type { SettingsRepository } from "./settings-repository";
import type { SidecarManager } from "../local-ai/sidecar-manager";

export type SpeechService = ReturnType<typeof createSpeechService>;

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

function isManagedSpeechAudioPath(audioPath: string): boolean {
	const resolvedPath = resolve(audioPath);
	const tempRoot = resolve(tmpdir());
	const parentDir = basename(dirname(resolvedPath));
	return resolvedPath.startsWith(`${tempRoot}${sep}`) && parentDir.startsWith("buddywriter_tts_");
}

export function createSpeechService(options: {
	catalogService: CatalogService;
	settingsRepository: SettingsRepository;
	sidecarManager: SidecarManager;
}) {
	const { catalogService, settingsRepository, sidecarManager } = options;

	function releaseSpeechAudio(audioPath: string): { success: boolean } {
		if (!audioPath || !isManagedSpeechAudioPath(audioPath)) {
			return { success: false };
		}

		rmSync(dirname(audioPath), { recursive: true, force: true });
		return { success: true };
	}

	function cleanupStaleSpeechAudio(maxAgeMs = TTS_AUDIO_RETENTION_MS): void {
		try {
			for (const entry of readdirSync(tmpdir())) {
				if (!entry.startsWith("buddywriter_tts_")) continue;
				const dirPath = join(tmpdir(), entry);
				const stats = statSync(dirPath);
				if (!stats.isDirectory()) continue;
				if (Date.now() - stats.mtimeMs < maxAgeMs) continue;
				rmSync(dirPath, { recursive: true, force: true });
			}
		} catch {}
	}

	function scheduleSpeechAudioCleanup(audioPath: string): void {
		if (!isManagedSpeechAudioPath(audioPath)) return;
		setTimeout(() => {
			releaseSpeechAudio(audioPath);
		}, TTS_AUDIO_RETENTION_MS);
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
			await sidecarManager.ensureLocalAIRuntimeReady();
			await sidecarManager.ensureSttServerReady(settingsRepository.getSettings().localAI.sttModelId);
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
				try {
					unlinkSync(filePath);
				} catch {}
			}
		}
	}

	async function speakText(text: string): Promise<{ audioPath: string }> {
		await sidecarManager.ensureLocalAIRuntimeReady();
		const settings = settingsRepository.getSettings();
		await sidecarManager.ensureTtsServerReady(settings.localAI.ttsModelId);
		cleanupStaleSpeechAudio();
		const entry = catalogService.getModelEntry(settings.localAI.ttsModelId);
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
		const result = await response.json() as { audioPath: string };
		scheduleSpeechAudioCleanup(result.audioPath);
		return result;
	}

	return {
		cleanupStaleSpeechAudio,
		releaseSpeechAudio,
		speakText,
		transcribeAudio,
	};
}
