import type { LocalAICatalog, LocalAIModelEntry, LocalAIProfile, LocalAIProfileId, LocalAIProfileSummary } from "../../shared/models/local-ai";
import { LOCAL_AI_REMOTE_CATALOG_URL, localAICachedCatalogPath } from "../config";
import { ensureLocalAIDirectories, readJsonFile, writeJsonFile } from "./fs-utils";

export type CatalogService = ReturnType<typeof createCatalogService>;

export function createCatalogService(options: {
	bundledCatalog: LocalAICatalog;
}) {
	const { bundledCatalog } = options;
	let currentCatalog = bundledCatalog;

	function getCatalog(): LocalAICatalog {
		return currentCatalog;
	}

	function getProfile(profileId: LocalAIProfileId): LocalAIProfile {
		return currentCatalog.profiles.find((profile) => profile.id === profileId) ?? currentCatalog.profiles[0];
	}

	function getModelEntry(modelId: string): LocalAIModelEntry | undefined {
		return currentCatalog.models.find((model) => model.id === modelId);
	}

	function getProfilesSummary(): LocalAIProfileSummary[] {
		return currentCatalog.profiles.map((profile) => ({
			id: profile.id,
			label: profile.label,
			approxBundleGB: profile.approxBundleGB,
		}));
	}

	function loadCatalog(): LocalAICatalog {
		ensureLocalAIDirectories();
		const cached = readJsonFile<LocalAICatalog>(localAICachedCatalogPath);
		currentCatalog = cached ?? bundledCatalog;
		return currentCatalog;
	}

	async function refreshCatalogFromRemote(onCatalogUpdated?: (catalog: LocalAICatalog) => void): Promise<void> {
		if (!LOCAL_AI_REMOTE_CATALOG_URL) return;
		try {
			const response = await fetch(LOCAL_AI_REMOTE_CATALOG_URL);
			if (!response.ok) return;
			const remoteCatalog = await response.json() as LocalAICatalog;
			currentCatalog = remoteCatalog;
			writeJsonFile(localAICachedCatalogPath, remoteCatalog);
			onCatalogUpdated?.(remoteCatalog);
		} catch {}
	}

	loadCatalog();

	return {
		getCatalog,
		getModelEntry,
		getProfile,
		getProfilesSummary,
		loadCatalog,
		refreshCatalogFromRemote,
	};
}
