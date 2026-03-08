import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import {
	localAIBinDir,
	localAICacheDir,
	localAICachedCatalogPath,
	localAIDiagnosticsPath,
	localAIHFDir,
	localAIHFHubDir,
	localAIHomeDir,
	localAIInstallStatePath,
	localAILogsDir,
	localAIManifestsDir,
	localAIModelsDir,
	localAIPythonDir,
	localAIRoot,
	localAIUVInstallerPath,
	localAIVenvDir,
} from "../config";

export function ensureDir(path: string): void {
	if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export function ensureLocalAIDirectories(): void {
	[
		localAIRoot,
		localAIBinDir,
		localAIPythonDir,
		localAIManifestsDir,
		localAIModelsDir,
		localAILogsDir,
		localAIHomeDir,
		localAICacheDir,
		localAIHFDir,
		localAIHFHubDir,
	].forEach(ensureDir);
}

export function getModelCacheFolderName(modelId: string): string {
	return `models--${modelId.replaceAll("/", "--")}`;
}

export function getModelCachePath(cacheRoot: string, modelId: string): string {
	return join(cacheRoot, getModelCacheFolderName(modelId));
}

export function hasCachedModelSnapshot(modelPath: string): boolean {
	if (!existsSync(modelPath)) return false;
	const snapshotsPath = join(modelPath, "snapshots");
	if (!existsSync(snapshotsPath)) return false;

	try {
		return readdirSync(snapshotsPath).length > 0;
	} catch {
		return false;
	}
}

export function getExternalHFHubCandidates(): string[] {
	const home = homedir();
	return [
		Bun.env.HUGGINGFACE_HUB_CACHE?.trim(),
		Bun.env.HF_HOME?.trim() ? join(Bun.env.HF_HOME.trim(), "hub") : "",
		join(home, ".cache", "huggingface", "hub"),
		join(home, "Library", "Caches", "huggingface", "hub"),
	].filter((path, index, values): path is string => Boolean(path) && values.indexOf(path) === index);
}

export function findReusableModelCache(modelId: string): string | null {
	for (const cacheRoot of getExternalHFHubCandidates()) {
		const candidate = getModelCachePath(cacheRoot, modelId);
		if (hasCachedModelSnapshot(candidate)) {
			return candidate;
		}
	}

	return null;
}

export function getLocalAIModelCachePath(modelId: string): string {
	return getModelCachePath(localAIHFHubDir, modelId);
}

export function hasManagedModelCache(modelId: string): boolean {
	return hasCachedModelSnapshot(getLocalAIModelCachePath(modelId));
}

export function reuseExistingModelCache(modelId: string, appendLog: (logName: string, text: string) => void): boolean {
	const managedCachePath = getModelCachePath(localAIHFHubDir, modelId);
	if (hasCachedModelSnapshot(managedCachePath)) {
		return false;
	}

	if (existsSync(managedCachePath)) {
		try {
			if (lstatSync(managedCachePath).isSymbolicLink()) {
				rmSync(managedCachePath, { force: true, recursive: true });
			}
		} catch {}
	}

	const reusableCachePath = findReusableModelCache(modelId);
	if (!reusableCachePath) {
		return false;
	}

	try {
		ensureDir(localAIHFHubDir);
		symlinkSync(reusableCachePath, managedCachePath, "dir");
		appendLog("install.log", `Reusing cached model ${modelId} from ${reusableCachePath}`);
		return true;
	} catch (error) {
		appendLog(
			"install.log",
			`Found cached model ${modelId} at ${reusableCachePath}, but could not link it: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

export function readJsonFile<T>(path: string): T | null {
	try {
		if (!existsSync(path)) return null;
		return JSON.parse(readFileSync(path, "utf-8")) as T;
	} catch {
		return null;
	}
}

export function writeJsonFile(path: string, value: unknown): void {
	ensureDir(dirname(path));
	writeFileSync(path, JSON.stringify(value, null, 2));
}

export function getDirectorySizeBytes(path: string): number {
	const stats = statSync(path);
	if (stats.isFile()) return stats.size;
	if (!stats.isDirectory()) return 0;
	return readdirSync(path).reduce((sum, entry) => sum + getDirectorySizeBytes(join(path, entry)), 0);
}

export function getDirectorySizeGB(path: string): number {
	try {
		if (!existsSync(path)) return 0;
		const bytes = getDirectorySizeBytes(path);
		return Math.round((bytes / (1024 ** 3)) * 10) / 10;
	} catch {
		return 0;
	}
}

export function appendLog(logName: string, text: string): void {
	if (!text.trim()) return;
	ensureLocalAIDirectories();
	const path = join(localAILogsDir, logName);
	writeFileSync(path, `${new Date().toISOString()} ${text}\n`, { flag: "a" });
}

export const localAIPaths = {
	localAICachedCatalogPath,
	localAIDiagnosticsPath,
	localAIInstallStatePath,
	localAILogsDir,
	localAIRoot,
	localAIUVInstallerPath,
	localAIVenvDir,
};
