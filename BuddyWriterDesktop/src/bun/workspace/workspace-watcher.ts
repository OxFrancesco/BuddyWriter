import { type FSWatcher, watch } from "fs";
import type { WorkspaceService } from "./workspace-service";

export function shouldIgnoreWorkspaceWatcherPath(filename: string): boolean {
	if (!filename) return false;
	const normalizedName = filename.replaceAll("\\", "/");
	return normalizedName === ".buddywriter"
		|| normalizedName.startsWith(".buddywriter/")
		|| normalizedName.includes(".tmp-");
}

export function createWorkspaceWatcher(options: {
	notifyWorkspaceUpdated: () => void;
	onError: (message: string) => void;
	workspaceService: WorkspaceService;
}) {
	const { notifyWorkspaceUpdated, onError, workspaceService } = options;
	let workspaceWatcher: FSWatcher | null = null;
	let workspaceWatcherTimer: ReturnType<typeof setTimeout> | null = null;
	let workspaceWatcherMutedUntil = 0;

	function muteWorkspaceWatcher(durationMs = 500): void {
		workspaceWatcherMutedUntil = Date.now() + durationMs;
	}

	function stopWorkspaceWatcher(): void {
		if (workspaceWatcherTimer) {
			clearTimeout(workspaceWatcherTimer);
			workspaceWatcherTimer = null;
		}
		workspaceWatcher?.close();
		workspaceWatcher = null;
	}

	function scheduleWorkspaceWatcherRefresh(): void {
		if (workspaceWatcherTimer) {
			clearTimeout(workspaceWatcherTimer);
		}
		workspaceWatcherTimer = setTimeout(() => {
			workspaceWatcherTimer = null;
			if (Date.now() < workspaceWatcherMutedUntil) return;
			notifyWorkspaceUpdated();
		}, 180);
	}

	function restartWorkspaceWatcher(workspacePath: string): void {
		stopWorkspaceWatcher();
		workspaceService.ensureWorkspaceStructure(workspacePath);

		try {
			workspaceWatcher = watch(workspacePath, { recursive: true }, (_eventType, filename) => {
				if (Date.now() < workspaceWatcherMutedUntil) return;
				const relativeName = typeof filename === "string" ? filename : "";
				if (shouldIgnoreWorkspaceWatcherPath(relativeName)) return;
				scheduleWorkspaceWatcherRefresh();
			});

			workspaceWatcher.on("error", (error) => {
				onError(`Workspace watcher error: ${error instanceof Error ? error.message : String(error)}`);
			});
		} catch (error) {
			onError(`Unable to watch workspace: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	return {
		muteWorkspaceWatcher,
		restartWorkspaceWatcher,
		stopWorkspaceWatcher,
	};
}
