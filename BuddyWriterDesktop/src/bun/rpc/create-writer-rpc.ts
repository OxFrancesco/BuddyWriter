import { BrowserView, Utils, type RPCSchema } from "electrobun/bun";
import { platform } from "node:os";
import type { WriterBunRequestMap, WriterContract } from "../../shared/rpc/writer-contract";
import type { CatalogService } from "../local-ai/catalog-service";
import type { LocalAIInstaller } from "../local-ai/installer";
import type { RuntimeStatusService } from "../local-ai/runtime-status";
import type { SidecarManager } from "../local-ai/sidecar-manager";
import { escapeMarkdownHtml, type AIService } from "../services/ai-service";
import type { SettingsRepository } from "../services/settings-repository";
import type { SpeechService } from "../services/speech-service";
import type { WorkspaceService } from "../workspace/workspace-service";

export type WriterRPC = {
	bun: RPCSchema<WriterContract["bun"]>;
	webview: RPCSchema<WriterContract["webview"]>;
};

export function createWriterRPC(options: {
	aiService: AIService;
	catalogService: CatalogService;
	installer: LocalAIInstaller;
	runtimeStatusService: RuntimeStatusService;
	settingsRepository: SettingsRepository;
	sidecarManager: SidecarManager;
	speechService: SpeechService;
	workspaceService: WorkspaceService;
	onWorkspaceChanged: (workspacePath: string) => void;
	muteWorkspaceWatcher: (durationMs?: number) => void;
}) {
	const {
		aiService,
		catalogService,
		installer,
		runtimeStatusService,
		settingsRepository,
		sidecarManager,
		speechService,
		workspaceService,
		onWorkspaceChanged,
		muteWorkspaceWatcher,
	} = options;

	function openMicrophoneSystemSettings(): boolean {
		switch (platform()) {
			case "darwin":
				return Utils.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone");
			case "win32":
				return Utils.openExternal("ms-settings:privacy-microphone");
			default:
				return false;
		}
	}

	return BrowserView.defineRPC<WriterRPC>({
		maxRequestTime: 180000,
		handlers: {
			requests: {
				aiComplete: async ({ text, instruction }: WriterBunRequestMap["aiComplete"]["params"]) => {
					const result = await aiService.callAI(instruction, text);
					return { result };
				},
				grammarFix: async ({ text }: WriterBunRequestMap["grammarFix"]["params"]) => {
					const result = await aiService.callAIGrammar(
						"You are a grammar and style editor. Fix grammar, spelling, and punctuation errors in the following text. Return ONLY the corrected text, nothing else. Preserve the original meaning and tone.",
						text,
					);
					return { result };
				},
				renderMarkdown: ({ text }: WriterBunRequestMap["renderMarkdown"]["params"]) => {
					return { html: Bun.markdown.html(escapeMarkdownHtml(text)) };
				},
				getSettings: async () => {
					settingsRepository.syncOpenRouterKeyFromSecureStorage();
					const settings = settingsRepository.getSettings();
					settings.localAI = settingsRepository.normalizeLocalAISettings(settings.localAI);
					settings.workspacePath = settingsRepository.normalizeWorkspaceRootPath(settings.workspacePath);
					return settings;
				},
				saveSettings: (newSettings: WriterBunRequestMap["saveSettings"]["params"]) => {
					const previousWorkspacePath = settingsRepository.getSettings().workspacePath;
					const result = settingsRepository.saveSettingsWithSecureStorage(newSettings);
					const settings = settingsRepository.getSettings();
					workspaceService.ensureWorkspaceStructure(settings.workspacePath);
					if (result.success && settings.workspacePath !== previousWorkspacePath) {
						onWorkspaceChanged(settings.workspacePath);
					}
					sidecarManager.refreshKeepWarmState("settings-saved");
					return result;
				},
				getWorkspaceState: () => workspaceService.getWorkspaceState(),
				setWorkspacePath: ({ path }: WriterBunRequestMap["setWorkspacePath"]["params"]) => {
					muteWorkspaceWatcher();
					const state = workspaceService.setWorkspacePath(path);
					onWorkspaceChanged(state.workspacePath);
					return state;
				},
				openDocument: ({ relativePath }: WriterBunRequestMap["openDocument"]["params"]) => workspaceService.openWorkspaceDocument(relativePath),
				saveDocument: ({ relativePath, content }: WriterBunRequestMap["saveDocument"]["params"]) => {
					muteWorkspaceWatcher();
					return workspaceService.saveWorkspaceDocument(relativePath, content);
				},
				createDocument: ({ parentRelativePath, name }: WriterBunRequestMap["createDocument"]["params"]) => {
					muteWorkspaceWatcher();
					return workspaceService.createWorkspaceDocument(parentRelativePath, name);
				},
				createFolder: ({ parentRelativePath, name }: WriterBunRequestMap["createFolder"]["params"]) => {
					muteWorkspaceWatcher();
					return workspaceService.createWorkspaceFolder(parentRelativePath, name);
				},
				updateDocumentMetadata: ({ relativePath, title, labels, targetParentRelativePath }: WriterBunRequestMap["updateDocumentMetadata"]["params"]) => {
					muteWorkspaceWatcher();
					return workspaceService.updateWorkspaceDocumentMetadata(relativePath, title, labels, targetParentRelativePath);
				},
				renameDocument: ({ relativePath, title }: WriterBunRequestMap["renameDocument"]["params"]) => {
					muteWorkspaceWatcher();
					return workspaceService.renameWorkspaceDocument(relativePath, title);
				},
				moveDocument: ({ relativePath, targetParentRelativePath }: WriterBunRequestMap["moveDocument"]["params"]) => {
					muteWorkspaceWatcher();
					return workspaceService.moveWorkspaceDocument(relativePath, targetParentRelativePath);
				},
				deleteDocument: ({ relativePath }: WriterBunRequestMap["deleteDocument"]["params"]) => {
					muteWorkspaceWatcher();
					return workspaceService.deleteWorkspaceDocument(relativePath);
				},
				archiveDocument: ({ relativePath, archived }: WriterBunRequestMap["archiveDocument"]["params"]) => {
					muteWorkspaceWatcher();
					return workspaceService.archiveWorkspaceDocument(relativePath, archived);
				},
				setDocumentLabels: ({ relativePath, labels }: WriterBunRequestMap["setDocumentLabels"]["params"]) => {
					return workspaceService.setWorkspaceDocumentLabels(relativePath, labels);
				},
				getLocalAICatalog: () => {
					return {
						catalog: catalogService.getCatalog(),
						profiles: catalogService.getProfilesSummary(),
					};
				},
				getLocalAIStatus: () => runtimeStatusService.getLocalAIStatus(),
				installLocalAI: ({ profileId }: WriterBunRequestMap["installLocalAI"]["params"]) => {
					return installer.beginLocalAIInstall(profileId ?? settingsRepository.getSettings().localAI.selectedProfileId);
				},
				cancelLocalAIInstall: () => installer.cancelLocalAIInstall(),
				repairLocalAI: () => installer.beginLocalAIInstall(settingsRepository.getSettings().localAI.selectedProfileId, true),
				removeLocalAI: () => installer.removeLocalAI(),
				setLocalAIProfile: ({ profileId }: WriterBunRequestMap["setLocalAIProfile"]["params"]) => {
					settingsRepository.applyProfileToSettings(profileId);
					if (
						settingsRepository.getSettings().localAI.enabled
						&& runtimeStatusService.getRuntimeStatus().installState === "ready"
					) {
						installer.beginLocalAIInstall(profileId);
					}
					sidecarManager.refreshKeepWarmState("profile-changed");
					return { success: true };
				},
				transcribeAudio: async ({ audioPath, audioMimeType, language }: WriterBunRequestMap["transcribeAudio"]["params"]) => {
					const text = await speechService.transcribeAudio(audioPath, language, audioMimeType);
					return { text };
				},
				openMicrophoneSystemSettings: () => {
					return { opened: openMicrophoneSystemSettings() };
				},
				speakText: async ({ text }: WriterBunRequestMap["speakText"]["params"]) => {
					const result = await speechService.speakText(text);
					return { accepted: true, audioPath: result.audioPath };
				},
				releaseSpeechAudio: ({ audioPath }: WriterBunRequestMap["releaseSpeechAudio"]["params"]) => speechService.releaseSpeechAudio(audioPath),
			},
			messages: {},
		},
	});
}
