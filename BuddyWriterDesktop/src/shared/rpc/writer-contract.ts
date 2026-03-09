import type {
	LocalAICatalog,
	LocalAIProfileId,
	LocalAIProfileSummary,
	LocalAIRequestResult,
	LocalAIStatus,
} from "../models/local-ai";
import type { SaveSettingsResult, Settings } from "../models/settings";
import type { WorkspaceDocument, WorkspaceState } from "../models/workspace";

export type WriterBunRequestMap = {
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
	getWorkspaceState: {
		params: {};
		response: WorkspaceState;
	};
	setWorkspacePath: {
		params: { path: string };
		response: WorkspaceState;
	};
	openDocument: {
		params: { relativePath: string };
		response: WorkspaceDocument;
	};
	saveDocument: {
		params: { relativePath: string; content: string };
		response: { success: boolean; savedAt: string };
	};
	createDocument: {
		params: { parentRelativePath?: string; name?: string };
		response: WorkspaceState;
	};
	createFolder: {
		params: { parentRelativePath?: string; name?: string };
		response: WorkspaceState;
	};
	updateDocumentMetadata: {
		params: {
			relativePath: string;
			title: string;
			labels: string[];
			targetParentRelativePath: string;
		};
		response: WorkspaceState;
	};
	renameDocument: {
		params: { relativePath: string; title: string };
		response: WorkspaceState;
	};
	moveDocument: {
		params: { relativePath: string; targetParentRelativePath: string };
		response: WorkspaceState;
	};
	deleteDocument: {
		params: { relativePath: string };
		response: WorkspaceState;
	};
	archiveDocument: {
		params: { relativePath: string; archived: boolean };
		response: WorkspaceState;
	};
	setDocumentLabels: {
		params: { relativePath: string; labels: string[] };
		response: WorkspaceState;
	};
	getLocalAICatalog: {
		params: {};
		response: { catalog: LocalAICatalog; profiles: LocalAIProfileSummary[] };
	};
	getLocalAIStatus: {
		params: {};
		response: LocalAIStatus;
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
	openMicrophoneSystemSettings: {
		params: {};
		response: { opened: boolean };
	};
	speakText: {
		params: { text: string };
		response: { accepted: boolean; audioPath?: string };
	};
	releaseSpeechAudio: {
		params: { audioPath: string };
		response: { success: boolean };
	};
};

export type WriterWebviewMessageMap = {
	toggleZenMode: {};
	fixGrammar: {};
	toggleAIChat: {};
	toggleMarkdown: {};
	newDocument: {};
	newFolder: {};
	saveDocument: {};
	changeWorkspace: {};
	workspaceUpdated: {};
};

export type WriterContract = {
	bun: {
		requests: WriterBunRequestMap;
		messages: {};
	};
	webview: {
		requests: {};
		messages: WriterWebviewMessageMap;
	};
};

export type WriterMenuCommand = keyof WriterWebviewMessageMap;
