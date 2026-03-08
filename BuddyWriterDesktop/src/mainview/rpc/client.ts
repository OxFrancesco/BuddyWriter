import type { WriterBunRequestMap, WriterContract } from "../../shared/rpc/writer-contract";

type RequestClient<T extends Record<string, { params: unknown; response: unknown }>> = {
	[K in keyof T]: (params: T[K]["params"]) => Promise<T[K]["response"]>;
};

export type WriterViewRPC = {
	bun: WriterContract["bun"];
	webview: WriterContract["webview"];
};

type ElectroviewClient = {
	rpc?: {
		request: RequestClient<WriterBunRequestMap>;
	};
};

let electrobunClient: ElectroviewClient | null = null;

function getRequestClient(): RequestClient<WriterBunRequestMap> {
	if (!electrobunClient?.rpc?.request) {
		throw new Error("BuddyWriter RPC client is not initialized.");
	}

	return electrobunClient.rpc.request;
}

export function setRPCClient(client: ElectroviewClient): void {
	electrobunClient = client;
}

export const rpcClient = {
	archiveDocument(params: WriterBunRequestMap["archiveDocument"]["params"]) {
		return getRequestClient().archiveDocument(params);
	},
	aiComplete(params: WriterBunRequestMap["aiComplete"]["params"]) {
		return getRequestClient().aiComplete(params);
	},
	cancelLocalAIInstall(params: WriterBunRequestMap["cancelLocalAIInstall"]["params"]) {
		return getRequestClient().cancelLocalAIInstall(params);
	},
	createDocument(params: WriterBunRequestMap["createDocument"]["params"]) {
		return getRequestClient().createDocument(params);
	},
	createFolder(params: WriterBunRequestMap["createFolder"]["params"]) {
		return getRequestClient().createFolder(params);
	},
	getLocalAICatalog(params: WriterBunRequestMap["getLocalAICatalog"]["params"]) {
		return getRequestClient().getLocalAICatalog(params);
	},
	getLocalAIStatus(params: WriterBunRequestMap["getLocalAIStatus"]["params"]) {
		return getRequestClient().getLocalAIStatus(params);
	},
	getSettings(params: WriterBunRequestMap["getSettings"]["params"]) {
		return getRequestClient().getSettings(params);
	},
	getWorkspaceState(params: WriterBunRequestMap["getWorkspaceState"]["params"]) {
		return getRequestClient().getWorkspaceState(params);
	},
	grammarFix(params: WriterBunRequestMap["grammarFix"]["params"]) {
		return getRequestClient().grammarFix(params);
	},
	installLocalAI(params: WriterBunRequestMap["installLocalAI"]["params"]) {
		return getRequestClient().installLocalAI(params);
	},
	moveDocument(params: WriterBunRequestMap["moveDocument"]["params"]) {
		return getRequestClient().moveDocument(params);
	},
	openMicrophoneSystemSettings(params: WriterBunRequestMap["openMicrophoneSystemSettings"]["params"]) {
		return getRequestClient().openMicrophoneSystemSettings(params);
	},
	openDocument(params: WriterBunRequestMap["openDocument"]["params"]) {
		return getRequestClient().openDocument(params);
	},
	releaseSpeechAudio(params: WriterBunRequestMap["releaseSpeechAudio"]["params"]) {
		return getRequestClient().releaseSpeechAudio(params);
	},
	removeLocalAI(params: WriterBunRequestMap["removeLocalAI"]["params"]) {
		return getRequestClient().removeLocalAI(params);
	},
	renderMarkdown(params: WriterBunRequestMap["renderMarkdown"]["params"]) {
		return getRequestClient().renderMarkdown(params);
	},
	repairLocalAI(params: WriterBunRequestMap["repairLocalAI"]["params"]) {
		return getRequestClient().repairLocalAI(params);
	},
	renameDocument(params: WriterBunRequestMap["renameDocument"]["params"]) {
		return getRequestClient().renameDocument(params);
	},
	updateDocumentMetadata(params: WriterBunRequestMap["updateDocumentMetadata"]["params"]) {
		return getRequestClient().updateDocumentMetadata(params);
	},
	saveDocument(params: WriterBunRequestMap["saveDocument"]["params"]) {
		return getRequestClient().saveDocument(params);
	},
	saveSettings(params: WriterBunRequestMap["saveSettings"]["params"]) {
		return getRequestClient().saveSettings(params);
	},
	setDocumentLabels(params: WriterBunRequestMap["setDocumentLabels"]["params"]) {
		return getRequestClient().setDocumentLabels(params);
	},
	setLocalAIProfile(params: WriterBunRequestMap["setLocalAIProfile"]["params"]) {
		return getRequestClient().setLocalAIProfile(params);
	},
	setWorkspacePath(params: WriterBunRequestMap["setWorkspacePath"]["params"]) {
		return getRequestClient().setWorkspacePath(params);
	},
	speakText(params: WriterBunRequestMap["speakText"]["params"]) {
		return getRequestClient().speakText(params);
	},
	transcribeAudio(params: WriterBunRequestMap["transcribeAudio"]["params"]) {
		return getRequestClient().transcribeAudio(params);
	},
};
