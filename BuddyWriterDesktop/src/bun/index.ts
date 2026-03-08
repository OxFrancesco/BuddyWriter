import type { LocalAICatalog } from "../shared/models/local-ai";
import { createApplicationMenu } from "./app/create-application-menu";
import { createMainWindow } from "./app/create-main-window";
import bundledCatalog from "./local_ai_catalog.json";
import { createCatalogService } from "./local-ai/catalog-service";
import { createLocalAIInstaller } from "./local-ai/installer";
import { createRuntimeStatusService } from "./local-ai/runtime-status";
import { createSidecarManager } from "./local-ai/sidecar-manager";
import { createWriterRPC } from "./rpc/create-writer-rpc";
import { createAIService } from "./services/ai-service";
import { createOpenRouterSecretStore } from "./services/openrouter-secret-store";
import { createSettingsRepository } from "./services/settings-repository";
import { createSpeechService } from "./services/speech-service";
import { createWorkspaceService } from "./workspace/workspace-service";
import { createWorkspaceWatcher } from "./workspace/workspace-watcher";

const catalogService = createCatalogService({
	bundledCatalog: bundledCatalog as LocalAICatalog,
});

const settingsRepository = createSettingsRepository({
	getCatalog: catalogService.getCatalog,
	secretStore: createOpenRouterSecretStore(),
});

const workspaceService = createWorkspaceService({
	settingsRepository,
});

const runtimeStatusService = createRuntimeStatusService({
	catalogService,
	settingsRepository,
});

const sidecarManager = createSidecarManager({
	catalogService,
	runtimeStatusService,
	settingsRepository,
});

const installer = createLocalAIInstaller({
	catalogService,
	runtimeStatusService,
	settingsRepository,
	sidecarManager,
});

const aiService = createAIService({
	settingsRepository,
	sidecarManager,
});

const speechService = createSpeechService({
	catalogService,
	settingsRepository,
	sidecarManager,
});

let mainWindow: ReturnType<typeof createMainWindow>;
const workspaceWatcher = createWorkspaceWatcher({
	notifyWorkspaceUpdated: () => {
		mainWindow.webview.rpc?.send.workspaceUpdated({});
	},
	onError: sidecarManager.appendHealthLog,
	workspaceService,
});

const writerRPC = createWriterRPC({
	aiService,
	catalogService,
	installer,
	runtimeStatusService,
	settingsRepository,
	sidecarManager,
	speechService,
	workspaceService,
	onWorkspaceChanged: (workspacePath) => {
		workspaceWatcher.restartWorkspaceWatcher(workspacePath);
	},
	muteWorkspaceWatcher: workspaceWatcher.muteWorkspaceWatcher,
});

mainWindow = createMainWindow(writerRPC);
createApplicationMenu(mainWindow);
workspaceService.ensureWorkspaceStructure(settingsRepository.getSettings().workspacePath);
workspaceWatcher.restartWorkspaceWatcher(settingsRepository.getSettings().workspacePath);
speechService.cleanupStaleSpeechAudio();
void catalogService.refreshCatalogFromRemote((catalog) => {
	settingsRepository.syncLocalAIWithCatalog();
	runtimeStatusService.setRuntimeStatus({
		catalogVersion: catalog.version,
	});
});

function cleanupApp(): void {
	workspaceWatcher.stopWorkspaceWatcher();
	sidecarManager.flush();
}

process.on("beforeExit", cleanupApp);
process.on("SIGINT", () => {
	cleanupApp();
	process.exit();
});

console.log("BuddyWriter started!");
sidecarManager.refreshKeepWarmState("app-start");
