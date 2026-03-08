import { createContext, startTransition, useContext, useEffect, useMemo, useState } from "react";
import type { LocalAICatalog, LocalAIProfileId, LocalAIStatus } from "../../shared/models/local-ai";
import type { SaveSettingsResult, Settings } from "../../shared/models/settings";
import { useEventCallback } from "../hooks/useEventCallback";
import { rpcClient } from "../rpc/client";
import { useLocalAIStatusPolling } from "../hooks/useLocalAIStatusPolling";

type SettingsContextValue = {
	closeSettings: () => Promise<void>;
	currentCatalog: LocalAICatalog | null;
	currentSettings: Settings | null;
	ensureVoiceInputReady: (showMessage: (message: string) => void) => Promise<boolean>;
	localAIAdvancedOpen: boolean;
	localAIManageOpen: boolean;
	localAIStatus: LocalAIStatus | null;
	openSettings: () => Promise<void>;
	persistSettings: (nextSettings?: Settings) => Promise<SaveSettingsResult>;
	refreshLocalAIStatus: () => Promise<LocalAIStatus | null>;
	setCurrentSettings: React.Dispatch<React.SetStateAction<Settings | null>>;
	setLocalAIAdvancedOpen: React.Dispatch<React.SetStateAction<boolean>>;
	setLocalAIManageOpen: React.Dispatch<React.SetStateAction<boolean>>;
	setLocalAIProfile: (profileId: LocalAIProfileId) => Promise<void>;
	settingsOpen: boolean;
	setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
	syncWorkspacePath: (workspacePath: string) => void;
	triggerLocalAIAction: (
		action: "install" | "retry" | "cancel" | "repair" | "remove",
		profileId?: LocalAIProfileId,
	) => Promise<void>;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

type SettingsProviderProps = {
	children: React.ReactNode;
};

export function SettingsProvider(props: SettingsProviderProps): React.ReactElement {
	const { children } = props;
	const [currentCatalog, setCurrentCatalog] = useState<LocalAICatalog | null>(null);
	const [currentSettings, setCurrentSettings] = useState<Settings | null>(null);
	const [localAIStatus, setLocalAIStatus] = useState<LocalAIStatus | null>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [localAIManageOpen, setLocalAIManageOpen] = useState(false);
	const [localAIAdvancedOpen, setLocalAIAdvancedOpen] = useState(false);

	const refreshLocalAIStatus = useEventCallback(async () => {
		const status = await rpcClient.getLocalAIStatus({});
		startTransition(() => {
			setLocalAIStatus(status);
		});
		return status;
	});

	const loadSettingsUI = useEventCallback(async () => {
		const [{ catalog }, settingsResponse] = await Promise.all([
			rpcClient.getLocalAICatalog({}),
			rpcClient.getSettings({}),
		]);
		startTransition(() => {
			setCurrentCatalog(catalog);
			setCurrentSettings(settingsResponse);
		});
		await refreshLocalAIStatus();
	});

	useEffect(() => {
		void loadSettingsUI();
	}, [loadSettingsUI]);

	useLocalAIStatusPolling(
		settingsOpen || localAIStatus?.installState === "installing",
		refreshLocalAIStatus,
	);

	const persistSettings = useEventCallback(async (nextSettings?: Settings) => {
		const settings = nextSettings ?? currentSettings;
		if (!settings) {
			return { success: false, error: "Settings are not loaded." };
		}

		const result = await rpcClient.saveSettings(settings);
		if (result.success) {
			startTransition(() => {
				setCurrentSettings(settings);
			});
			await refreshLocalAIStatus();
		}
		return result;
	});

	const openSettings = useEventCallback(async () => {
		startTransition(() => {
			setSettingsOpen(true);
		});
		await loadSettingsUI();
	});

	const closeSettings = useEventCallback(async () => {
		startTransition(() => {
			setSettingsOpen(false);
		});
		await persistSettings();
	});

	const syncWorkspacePath = useEventCallback((workspacePath: string) => {
		startTransition(() => {
			setCurrentSettings((previousSettings) => {
				if (!previousSettings) return previousSettings;
				return {
					...previousSettings,
					workspacePath,
				};
			});
		});
	});

	const ensureVoiceInputReady = useEventCallback(async (showMessage: (message: string) => void) => {
		let status = localAIStatus;
		if (!currentSettings || !localAIStatus) {
			await loadSettingsUI();
			status = await refreshLocalAIStatus();
		} else {
			status = await refreshLocalAIStatus();
		}

		if (status?.installState === "ready") {
			return true;
		}

		await openSettings();
		startTransition(() => {
			setCurrentSettings((previousSettings) => previousSettings ? {
				...previousSettings,
				provider: "local",
			} : previousSettings);
		});
		showMessage("Set up Local AI voice input before using dictation.");
		return false;
	});

	const triggerLocalAIAction = useEventCallback(async (
		action: "install" | "retry" | "cancel" | "repair" | "remove",
		profileId?: LocalAIProfileId,
	) => {
		if (action === "install" || action === "retry") {
			if (!currentSettings) return;
			const nextSettings: Settings = {
				...currentSettings,
				provider: "local",
			};
			startTransition(() => {
				setCurrentSettings(nextSettings);
			});
			await persistSettings(nextSettings);
			await rpcClient.installLocalAI({
				profileId: profileId ?? nextSettings.localAI.selectedProfileId,
			});
			await refreshLocalAIStatus();
			return;
		}

		if (action === "cancel") {
			await rpcClient.cancelLocalAIInstall({});
			await refreshLocalAIStatus();
			return;
		}

		if (action === "repair") {
			await rpcClient.repairLocalAI({});
			await refreshLocalAIStatus();
			return;
		}

		await rpcClient.removeLocalAI({});
		startTransition(() => {
			setLocalAIManageOpen(false);
			setLocalAIAdvancedOpen(false);
			setCurrentSettings((previousSettings) => previousSettings ? {
				...previousSettings,
				provider: "openrouter",
			} : previousSettings);
		});
		await loadSettingsUI();
	});

	const setLocalAIProfile = useEventCallback(async (profileId: LocalAIProfileId) => {
		if (!currentSettings || !currentCatalog) return;
		await rpcClient.setLocalAIProfile({ profileId });
		const profile = currentCatalog.profiles.find((candidate) => candidate.id === profileId);
		const nextSettings: Settings = {
			...currentSettings,
			localAI: {
				...currentSettings.localAI,
				selectedProfileId: profileId,
				textModelId: profile?.textModelId ?? currentSettings.localAI.textModelId,
				grammarModelId: profile?.grammarModelId ?? currentSettings.localAI.grammarModelId,
				sttModelId: profile?.sttModelId ?? currentSettings.localAI.sttModelId,
				ttsModelId: profile?.ttsModelId ?? currentSettings.localAI.ttsModelId,
			},
		};
		startTransition(() => {
			setCurrentSettings(nextSettings);
		});
		await persistSettings(nextSettings);
		await refreshLocalAIStatus();
	});

	const value = useMemo<SettingsContextValue>(() => ({
		closeSettings,
		currentCatalog,
		currentSettings,
		ensureVoiceInputReady,
		localAIAdvancedOpen,
		localAIManageOpen,
		localAIStatus,
		openSettings,
		persistSettings,
		refreshLocalAIStatus,
		setCurrentSettings,
		setLocalAIAdvancedOpen,
		setLocalAIManageOpen,
		setLocalAIProfile,
		settingsOpen,
		setSettingsOpen,
		syncWorkspacePath,
		triggerLocalAIAction,
	}), [
		closeSettings,
		currentCatalog,
		currentSettings,
		ensureVoiceInputReady,
		localAIAdvancedOpen,
		localAIManageOpen,
		localAIStatus,
		openSettings,
		persistSettings,
		refreshLocalAIStatus,
		setLocalAIProfile,
		settingsOpen,
		syncWorkspacePath,
		triggerLocalAIAction,
	]);

	return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettingsContext(): SettingsContextValue {
	const context = useContext(SettingsContext);
	if (!context) {
		throw new Error("useSettingsContext must be used inside SettingsProvider.");
	}

	return context;
}
