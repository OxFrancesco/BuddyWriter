import { useEffect, useState } from "react";
import { defaultHotkeys, hotkeyLabels, type Hotkey, type HotkeyMap, type Settings } from "../../shared/models/settings";
import { useSettingsContext } from "../providers/SettingsProvider";

type SettingsPanelProps = {
	onStatusMessage: (message: string) => void;
	onWorkspacePathApply: (path: string) => Promise<void>;
};

function formatHotkey(hotkey: Hotkey): string {
	let label = "";
	if (hotkey.mod) label += "⌘";
	if (hotkey.shift) label += "⇧";
	label += hotkey.key.toUpperCase();
	return label;
}

export function SettingsPanel(props: SettingsPanelProps): React.ReactElement {
	const { onStatusMessage, onWorkspacePathApply } = props;
	const {
		closeSettings,
		currentCatalog,
		currentSettings,
		localAIAdvancedOpen,
		localAIManageOpen,
		localAIStatus,
		persistSettings,
		setCurrentSettings,
		setLocalAIAdvancedOpen,
		setLocalAIManageOpen,
		setLocalAIProfile,
		settingsOpen,
		triggerLocalAIAction,
	} = useSettingsContext();
	const [workspacePathDraft, setWorkspacePathDraft] = useState("");
	const [recordingAction, setRecordingAction] = useState<keyof HotkeyMap | null>(null);

	useEffect(() => {
		setWorkspacePathDraft(currentSettings?.workspacePath ?? "");
	}, [currentSettings?.workspacePath]);

	useEffect(() => {
		if (!recordingAction) return;

		const handler = (event: KeyboardEvent) => {
			event.preventDefault();
			event.stopPropagation();
			const key = event.key.toLowerCase();
			if (["meta", "control", "shift", "alt"].includes(key)) return;
			if (!currentSettings) return;

			const hotkey: Hotkey = {
				mod: event.metaKey || event.ctrlKey,
				shift: event.shiftKey,
				key,
			};

			const nextSettings: Settings = {
				...currentSettings,
				hotkeys: {
					...currentSettings.hotkeys,
					[recordingAction]: hotkey,
				},
			};
			setCurrentSettings(nextSettings);
			void persistSettings(nextSettings);
			setRecordingAction(null);
			onStatusMessage("");
		};

		document.addEventListener("keydown", handler, true);
		return () => {
			document.removeEventListener("keydown", handler, true);
		};
	}, [currentSettings, onStatusMessage, persistSettings, recordingAction, setCurrentSettings]);

	const localAIState = localAIStatus?.installState ?? "not_installed";
	const localAIProgress = localAIStatus?.progressPct ?? 0;
	const hasLocalAIError = localAIState === "error" && Boolean(localAIStatus?.lastError);

	return (
		<div className={`settings-panel ${settingsOpen ? "open" : ""}`}>
			<div className="settings-inner">
				<div className="settings-header">
					<h2 className="settings-title">Preferences</h2>
					<button type="button" className="chat-close" onClick={() => void closeSettings()}>
						&times;
					</button>
				</div>

				<div className="settings-body">
					<div className="settings-section">
						<label className="settings-label">AI Provider</label>
						<div className="settings-toggle-group">
							<button
								type="button"
								className={`settings-toggle ${currentSettings?.provider === "openrouter" ? "active" : ""}`}
								onClick={() => {
									if (!currentSettings) return;
									const nextSettings = { ...currentSettings, provider: "openrouter" as const };
									setCurrentSettings(nextSettings);
									void persistSettings(nextSettings);
								}}
							>
								OpenRouter
							</button>
							<button
								type="button"
								className={`settings-toggle ${currentSettings?.provider === "local" ? "active" : ""}`}
								onClick={() => {
									if (!currentSettings) return;
									const nextSettings = { ...currentSettings, provider: "local" as const };
									setCurrentSettings(nextSettings);
									void persistSettings(nextSettings);
								}}
							>
								Local AI
							</button>
						</div>
					</div>

					<div className="settings-section">
						<label className="settings-label">Workspace Folder</label>
						<input
							type="text"
							className="settings-input"
							placeholder="/Users/you/Documents/BuddyWriter"
							value={workspacePathDraft}
							onChange={(event) => {
								setWorkspacePathDraft(event.currentTarget.value);
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									void onWorkspacePathApply(workspacePathDraft);
								}
							}}
						/>
						<div className="settings-inline-actions">
							<button type="button" className="settings-btn-action" onClick={() => void onWorkspacePathApply(workspacePathDraft)}>
								Use Folder
							</button>
						</div>
							<p className="settings-hint">
								BuddyWriter stores your notes as real <code>.md</code> files inside this folder, with note metadata in front matter and app state in <code>.buddywriter/</code>.
							</p>
						</div>

					<div id="openrouter-settings" className="settings-section" style={{ display: currentSettings?.provider === "openrouter" ? "flex" : "none" }}>
						<label className="settings-label">OpenRouter API Key</label>
						<input
							type="password"
							className="settings-input"
							placeholder="sk-or-..."
							value={currentSettings?.openrouterKey ?? ""}
							onBlur={() => {
								if (currentSettings) {
									void persistSettings(currentSettings);
								}
							}}
							onChange={(event) => {
								setCurrentSettings((previousSettings) => previousSettings ? {
									...previousSettings,
									openrouterKey: event.currentTarget.value,
								} : previousSettings);
							}}
						/>
						<p className="settings-hint">
							Stored in the OS keychain when available. Use <code>OPENROUTER_API_KEY</code> to preload or override it at launch.
						</p>
						<label className="settings-label">Model</label>
						<select
							className="settings-select"
							value={currentSettings?.openrouterModel ?? "google/gemini-2.5-flash"}
							onChange={(event) => {
								if (!currentSettings) return;
								const nextSettings = {
									...currentSettings,
									openrouterModel: event.currentTarget.value,
								};
								setCurrentSettings(nextSettings);
								void persistSettings(nextSettings);
							}}
						>
							<option value="google/gemini-2.5-flash">Gemini 2.5 Flash</option>
							<option value="anthropic/claude-sonnet-4">Claude Sonnet 4</option>
							<option value="openai/gpt-4.1-mini">GPT-4.1 Mini</option>
							<option value="meta-llama/llama-4-scout">Llama 4 Scout</option>
							<option value="qwen/qwen3-8b">Qwen3 8B</option>
						</select>
					</div>

					<div id="local-settings" className="settings-section" style={{ display: currentSettings?.provider === "local" ? "flex" : "none" }}>
						<div className="local-ai-card">
							<div className="local-ai-header">
								<div>
									<label className="settings-label">Local AI</label>
									<div className="local-ai-headline">{localAIState === "ready" ? "Local AI Ready" : "Enable Local AI"}</div>
								</div>
								<div className={`local-ai-pill ${localAIState}`}>
									{localAIState === "ready"
										? "Ready"
										: localAIState === "installing"
											? "Installing"
											: localAIState === "error"
												? "Needs attention"
												: "Not installed"}
								</div>
							</div>

							<p className="settings-hint">
								{localAIState === "ready"
									? `${currentCatalog?.profiles.find((profile) => profile.id === currentSettings?.localAI.selectedProfileId)?.label ?? "Starter"} bundle installed. Local writing help, dictation, and speech are available offline.`
									: localAIState === "installing"
										? "BuddyWriter is downloading and preparing the local runtime for you."
										: "One button installs the managed runtime, text model, voice input model, and voice output model."}
							</p>

							<div className="local-ai-progress-shell" style={{ display: localAIState === "installing" ? "flex" : "none" }}>
								<div className="local-ai-progress-bar">
									<span style={{ width: `${localAIProgress}%` }} />
								</div>
								<div className="local-ai-progress-meta">
									<span>{localAIStatus?.currentPhase ?? "Preparing local AI workspace"}</span>
									<span>{`${localAIProgress}%`}</span>
								</div>
							</div>

							<div className="local-ai-error" style={{ display: hasLocalAIError ? "block" : "none" }}>
								<div className="local-ai-error-summary">{localAIStatus?.lastError ?? ""}</div>
								<details className="local-ai-error-details">
									<summary>Details</summary>
									<pre>{localAIStatus?.lastError ?? ""}</pre>
								</details>
							</div>

							<div className="local-ai-actions">
								<button
									type="button"
									className="settings-btn-action primary"
									style={{ display: localAIState === "ready" ? "none" : "inline-flex" }}
									disabled={localAIState === "installing"}
									onClick={() => void triggerLocalAIAction("install")}
								>
									{localAIState === "installing" ? "Installing..." : "Enable Local AI"}
								</button>
								<button
									type="button"
									className="settings-btn-action"
									style={{ display: localAIState === "ready" || hasLocalAIError ? "inline-flex" : "none" }}
									onClick={() => {
										setLocalAIManageOpen((previousState) => !previousState);
									}}
								>
									Manage Local AI
								</button>
								<button
									type="button"
									className="settings-btn-action"
									style={{ display: hasLocalAIError ? "inline-flex" : "none" }}
									onClick={() => void triggerLocalAIAction("retry")}
								>
									Retry
								</button>
								<button
									type="button"
									className="settings-btn-action danger"
									style={{ display: localAIState === "installing" ? "inline-flex" : "none" }}
									onClick={() => void triggerLocalAIAction("cancel")}
								>
									Cancel
								</button>
							</div>
						</div>

						<div className="local-ai-manage" style={{ display: localAIManageOpen && localAIState !== "installing" && localAIState !== "not_installed" ? "flex" : "none" }}>
							<div className="local-ai-section">
								<label className="settings-label">Profile</label>
								<div className="local-ai-profile-grid">
									<button
										type="button"
										className={`local-ai-profile-btn ${currentSettings?.localAI.selectedProfileId === "starter" ? "active" : ""}`}
										onClick={() => void setLocalAIProfile("starter")}
									>
										Starter
									</button>
									<button
										type="button"
										className={`local-ai-profile-btn ${currentSettings?.localAI.selectedProfileId === "quality" ? "active" : ""}`}
										onClick={() => void setLocalAIProfile("quality")}
									>
										Better Quality
									</button>
								</div>
							</div>

							<div className="local-ai-meta-grid">
								<div className="local-ai-meta-item">
									<span className="settings-label">Install Location</span>
									<span className="local-ai-meta-value">{localAIStatus?.installRoot ?? ""}</span>
								</div>
								<div className="local-ai-meta-item">
									<span className="settings-label">Storage Used</span>
									<span className="local-ai-meta-value">{`${(localAIStatus?.storageUsedGB ?? 0).toFixed(1)} GB`}</span>
								</div>
								<div className="local-ai-meta-item">
									<span className="settings-label">Text Model</span>
									<span className="local-ai-meta-value">
										{currentCatalog?.models.find((model) => model.id === currentSettings?.localAI.textModelId)?.label ?? currentSettings?.localAI.textModelId}
									</span>
								</div>
								<div className="local-ai-meta-item">
									<span className="settings-label">Voice Input</span>
									<span className="local-ai-meta-value">
										{currentCatalog?.models.find((model) => model.id === currentSettings?.localAI.sttModelId)?.label ?? currentSettings?.localAI.sttModelId}
									</span>
								</div>
								<div className="local-ai-meta-item">
									<span className="settings-label">Voice Output</span>
									<span className="local-ai-meta-value">
										{currentCatalog?.models.find((model) => model.id === currentSettings?.localAI.ttsModelId)?.label ?? currentSettings?.localAI.ttsModelId}
									</span>
								</div>
								<div className="local-ai-meta-item">
									<span className="settings-label">Bundle Version</span>
									<span className="local-ai-meta-value">{localAIStatus?.installBundleVersion ?? "Not installed"}</span>
								</div>
							</div>

							<button
								type="button"
								className="local-ai-advanced-toggle"
								onClick={() => {
									setLocalAIAdvancedOpen((previousState) => !previousState);
								}}
							>
								{localAIAdvancedOpen ? "Hide Advanced" : "Advanced"}
							</button>

							<div className="local-ai-advanced" style={{ display: localAIAdvancedOpen ? "flex" : "none" }}>
								{(["textModelId", "sttModelId", "ttsModelId"] as const).map((key) => {
									const kind = key === "textModelId" ? "text" : key === "sttModelId" ? "stt" : "tts";
									const label = key === "textModelId" ? "Text Model" : key === "sttModelId" ? "Voice Input Model" : "Voice Output Model";
									const selectedId = currentSettings?.localAI[key] ?? "";
									const models = currentCatalog?.models.filter((model) => model.kind === kind && (!model.hidden || model.id === selectedId)) ?? [];
									return (
										<div key={key} className="settings-section">
											<label className="settings-label">{label}</label>
											<select
												className="settings-select"
												value={selectedId}
												onChange={(event) => {
													if (!currentSettings) return;
													const nextSettings: Settings = {
														...currentSettings,
														localAI: {
															...currentSettings.localAI,
															[key]: event.currentTarget.value,
														},
													};
													setCurrentSettings(nextSettings);
													void persistSettings(nextSettings);
												}}
											>
												{models.map((model) => (
													<option key={model.id} value={model.id}>
														{`${model.label} • ${model.quantization} • ${model.approxDownloadGB.toFixed(1)} GB`}
													</option>
												))}
											</select>
										</div>
									);
								})}
								<div className="local-ai-actions">
									<button type="button" className="settings-btn-action" onClick={() => void triggerLocalAIAction("repair")}>
										Repair / Reinstall
									</button>
									<button type="button" className="settings-btn-action danger" onClick={() => void triggerLocalAIAction("remove")}>
										Remove Local AI
									</button>
								</div>
							</div>
						</div>
					</div>

					<div className="settings-section">
						<label className="settings-label">Keyboard Shortcuts</label>
						<div className="hotkeys-list">
							{(Object.keys(hotkeyLabels) as (keyof HotkeyMap)[]).map((actionId) => {
								const hotkeys = currentSettings?.hotkeys ?? defaultHotkeys;
								return (
									<div key={actionId} className="hotkey-row">
										<span className="hotkey-action">{hotkeyLabels[actionId]}</span>
										<button
											type="button"
											className={`hotkey-btn ${recordingAction === actionId ? "recording" : ""}`}
											onClick={() => {
												setRecordingAction(actionId);
												onStatusMessage("Press keys...");
											}}
										>
											{recordingAction === actionId ? "Press keys..." : formatHotkey(hotkeys[actionId])}
										</button>
									</div>
								);
							})}
						</div>
						<p className="settings-hint">Click a shortcut to rebind it. Press your new key combination.</p>
					</div>
				</div>
			</div>
		</div>
	);
}
