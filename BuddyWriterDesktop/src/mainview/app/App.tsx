import { useEffect, useRef, useState } from "react";
import { defaultHotkeys } from "../../shared/models/settings";
import type { WorkspaceState } from "../../shared/models/workspace";
import { normalizeDocumentTitle } from "../../shared/utils/note-metadata";
import { ChatPanel, type ChatPanelMessage } from "../components/ChatPanel";
import { DocumentHeader } from "../components/DocumentHeader";
import { EditorSurface, type EditorSurfaceHandle } from "../components/EditorSurface";
import { MicButton } from "../components/MicButton";
import { MicrophonePermissionModal } from "../components/MicrophonePermissionModal";
import { SettingsPanel } from "../components/SettingsPanel";
import { StatusBar } from "../components/StatusBar";
import { ConfirmModal } from "../components/ConfirmModal";
import { WorkspaceSidebar, type WorkspaceSidebarHandle } from "../components/WorkspaceSidebar";
import { useAutosave } from "../hooks/useAutosave";
import { useEventCallback } from "../hooks/useEventCallback";
import { useGlobalShortcuts } from "../hooks/useGlobalShortcuts";
import { useVoiceRecorder } from "../hooks/useVoiceRecorder";
import { menuCommandBus } from "../ipc/menu-command-bus";
import { useSettingsContext, SettingsProvider } from "../providers/SettingsProvider";
import { useWorkspaceContext, WorkspaceProvider } from "../providers/WorkspaceProvider";
import { rpcClient } from "../rpc/client";
import { getParentRelativePath, parseLabelsInput } from "../utils/workspace";

function sameLabels(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((label, index) => label === right[index]);
}

function createChatMessageId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function AppShell(): React.ReactElement {
	const editorRef = useRef<EditorSurfaceHandle | null>(null);
	const workspaceSidebarRef = useRef<WorkspaceSidebarHandle | null>(null);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const statusTimerRef = useRef<number | null>(null);
	const workspaceRefreshTimerRef = useRef<number | null>(null);
	const documentActionInFlightRef = useRef<Promise<void> | null>(null);
	const openDocumentRequestIdRef = useRef(0);
	const currentSpeechAudioPathRef = useRef<string | null>(null);
	const {
		activeDocument,
		refreshWorkspace,
		setActiveDocumentContent,
		setWorkspaceState,
		workspaceState,
	} = useWorkspaceContext();
	const {
		closeSettings,
		currentSettings,
		ensureVoiceInputReady,
		localAIStatus,
		openSettings,
		settingsOpen,
		syncWorkspacePath,
	} = useSettingsContext();
	const workspaceStateRef = useRef(workspaceState);
	const [aiStatus, setAIStatus] = useState("");
	const [chatMessages, setChatMessages] = useState<ChatPanelMessage[]>([]);
	const [chatOpen, setChatOpen] = useState(false);
	const [editorText, setEditorText] = useState("");
	const [grammarBusy, setGrammarBusy] = useState(false);
	const [markdownMode, setMarkdownMode] = useState(false);
	const [selectedText, setSelectedText] = useState("");
	const [wordCount, setWordCount] = useState(0);
	const [zenMode, setZenMode] = useState(false);
	const [deleteConfirmPath, setDeleteConfirmPath] = useState<string | null>(null);

	const currentWorkspacePath = workspaceState?.workspacePath ?? currentSettings?.workspacePath ?? "";

	const clearStatusMessage = useEventCallback(() => {
		if (statusTimerRef.current) {
			window.clearTimeout(statusTimerRef.current);
			statusTimerRef.current = null;
		}
		setAIStatus("");
	});

	const showStatusMessage = useEventCallback((message: string) => {
		if (statusTimerRef.current) {
			window.clearTimeout(statusTimerRef.current);
			statusTimerRef.current = null;
		}
		setAIStatus(message);
	});

	const showTransientStatus = useEventCallback((message: string, durationMs = 3500) => {
		showStatusMessage(message);
		if (!message) return;
		statusTimerRef.current = window.setTimeout(() => {
			statusTimerRef.current = null;
			setAIStatus("");
		}, durationMs);
	});

	const applyWorkspaceState = useEventCallback((state: WorkspaceState) => {
		setWorkspaceState(state);
		syncWorkspacePath(state.workspacePath);
		setEditorText(state.activeDocument?.content ?? "");
	});

	const { flushAutosave, saveInFlightRef, saveStatus, setSaveStatus } = useAutosave({
		activeDocument,
		editorText,
		onSave: async (relativePath, content) => {
			const result = await rpcClient.saveDocument({ relativePath, content });
			if (!result.success) {
				throw new Error("Unable to save document.");
			}
		},
		onSaveError: (error) => {
			console.error("Save failed:", error);
			showStatusMessage("This note changed on disk. Refreshing workspace...");
			void scheduleWorkspaceRefresh(120);
		},
		onSaveSuccess: (content) => {
			setActiveDocumentContent(content);
		},
	});

	const scheduleWorkspaceRefresh = useEventCallback(async (delayMs = 200) => {
		if (workspaceRefreshTimerRef.current) {
			window.clearTimeout(workspaceRefreshTimerRef.current);
		}

		workspaceRefreshTimerRef.current = window.setTimeout(() => {
			workspaceRefreshTimerRef.current = null;
			if (
				saveInFlightRef.current
				|| documentActionInFlightRef.current
				|| (activeDocument && activeDocument.content !== editorText)
			) {
				void scheduleWorkspaceRefresh(400);
				return;
			}

			void refreshWorkspace().then((state) => {
				syncWorkspacePath(state.workspacePath);
				setEditorText(state.activeDocument?.content ?? "");
				clearStatusMessage();
			});
		}, delayMs);
	});

	const runDocumentAction = useEventCallback(async (task: () => Promise<void>) => {
		if (documentActionInFlightRef.current) {
			await documentActionInFlightRef.current;
		}

		let action!: Promise<void>;
		action = task().finally(() => {
			if (documentActionInFlightRef.current === action) {
				documentActionInFlightRef.current = null;
			}
		});
		documentActionInFlightRef.current = action;
		await action;
	});

	const runWithNoteSettingsGuard = useEventCallback(async (task: () => Promise<void>) => {
		const sidebar = workspaceSidebarRef.current;
		if (!sidebar) {
			await task();
			return;
		}

		await sidebar.runWithNoteSettingsGuard(task);
	});

	const releaseCurrentSpeechAudio = useEventCallback(() => {
		if (!currentSpeechAudioPathRef.current) return;
		void rpcClient.releaseSpeechAudio({ audioPath: currentSpeechAudioPathRef.current });
		currentSpeechAudioPathRef.current = null;
		if (audioRef.current) {
			audioRef.current.removeAttribute("src");
			audioRef.current.load();
		}
	});

	const openDocument = useEventCallback(async (relativePath: string) => {
		await flushAutosave();
		const requestId = openDocumentRequestIdRef.current + 1;
		openDocumentRequestIdRef.current = requestId;
		const document = await rpcClient.openDocument({ relativePath });
		if (openDocumentRequestIdRef.current !== requestId) return;

		const currentWorkspaceState = workspaceStateRef.current;
		if (!currentWorkspaceState) {
			const state = await refreshWorkspace();
			if (openDocumentRequestIdRef.current !== requestId) return;
			applyWorkspaceState(state);
			return;
		}

		setWorkspaceState({
			...currentWorkspaceState,
			activeDocument: document,
		});
		setEditorText(document.content);
	});

	const handleWorkspacePathApply = useEventCallback(async (path: string) => {
		await runWithNoteSettingsGuard(async () => {
			try {
				await flushAutosave(true);
				const state = await rpcClient.setWorkspacePath({ path });
				applyWorkspaceState(state);
				setSaveStatus("saved", "Workspace ready");
			} catch (error) {
				console.error("Workspace change failed:", error);
				showTransientStatus("Unable to use that workspace folder.", 4000);
			}
		});
	});

	const promptForWorkspacePath = useEventCallback(async () => {
		const nextPath = window.prompt("Workspace folder", currentWorkspacePath);
		if (!nextPath) return;
		await handleWorkspacePathApply(nextPath);
	});

	const createDocumentFromCurrentContext = useEventCallback(async (params?: {
		name?: string;
		successLabel?: string;
	}) => {
		const seedContent = !activeDocument && editorText ? editorText : null;
		const state = await rpcClient.createDocument({
			parentRelativePath: getParentRelativePath(activeDocument?.relativePath) || undefined,
			name: params?.name,
		});

		let nextState = state;
		if (seedContent && state.activeDocument) {
			const saveResult = await rpcClient.saveDocument({
				relativePath: state.activeDocument.relativePath,
				content: seedContent,
			});
			if (!saveResult.success) {
				throw new Error("Unable to save document.");
			}

			nextState = {
				...state,
				activeDocument: {
					...state.activeDocument,
					content: seedContent,
				},
			};
		}

		applyWorkspaceState(nextState);
		setSaveStatus("saved", params?.successLabel ?? "Saved");
		window.setTimeout(() => {
			editorRef.current?.focus();
		}, 0);
	});

	const handleCreateDocument = useEventCallback(async () => {
		await runWithNoteSettingsGuard(async () => {
			try {
				await flushAutosave();
				await runDocumentAction(async () => {
					await createDocumentFromCurrentContext({ successLabel: "New note" });
				});
			} catch (error) {
				console.error("Create note failed:", error);
				showTransientStatus("Unable to create note.", 4000);
			}
		});
	});

	const handleCreateFolder = useEventCallback(async () => {
		const suggestedName = window.prompt("New folder name", "New Folder");
		if (suggestedName === null) return;
		await runWithNoteSettingsGuard(async () => {
			await flushAutosave();
			const state = await rpcClient.createFolder({
				parentRelativePath: getParentRelativePath(activeDocument?.relativePath),
				name: suggestedName,
			});
			applyWorkspaceState(state);
		});
	});

	const handleSaveDocumentMetadata = useEventCallback(async (params: {
		relativePath: string;
		title: string;
		labels: string[];
		targetParentRelativePath: string;
	}, successLabel = "Note updated") => {
		const normalizedTitle = normalizeDocumentTitle(params.title);
		if (!normalizedTitle) {
			showTransientStatus("Note title cannot be blank.", 4000);
			return;
		}

		await runDocumentAction(async () => {
			if (!activeDocument) return;
			const normalizedLabels = parseLabelsInput(params.labels.join(", "));
			const normalizedTargetParentRelativePath = params.targetParentRelativePath.trim();
			const currentLabels = [...activeDocument.labels].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

			if (
				params.relativePath === activeDocument.relativePath
				&& normalizedTitle === activeDocument.title
				&& normalizedTargetParentRelativePath === activeDocument.parentRelativePath
				&& sameLabels(currentLabels, normalizedLabels)
			) {
				return;
			}

			await flushAutosave(true);
			const state = await rpcClient.updateDocumentMetadata({
				relativePath: params.relativePath,
				title: normalizedTitle,
				labels: normalizedLabels,
				targetParentRelativePath: normalizedTargetParentRelativePath,
			});
			applyWorkspaceState(state);
			setSaveStatus("saved", successLabel);
		});
	});

	const handleRenameDocument = useEventCallback(async (nextTitle: string) => {
		const normalizedTitle = normalizeDocumentTitle(nextTitle);
		if (!normalizedTitle) {
			showTransientStatus("Note title cannot be blank.", 4000);
			return;
		}

		await runWithNoteSettingsGuard(async () => {
			if (!activeDocument) {
				try {
					await runDocumentAction(async () => {
						await createDocumentFromCurrentContext({
							name: normalizedTitle,
							successLabel: "Created",
						});
					});
				} catch (error) {
					console.error("Create note from title failed:", error);
					showTransientStatus("Unable to create note.", 4000);
				}
				return;
			}

			await handleSaveDocumentMetadata({
				relativePath: activeDocument.relativePath,
				title: nextTitle,
				labels: activeDocument.labels,
				targetParentRelativePath: activeDocument.parentRelativePath,
			}, "Renamed");
		});
	});

	const handleArchiveDocument = useEventCallback(async (params: { relativePath: string; archived: boolean }) => {
		await runWithNoteSettingsGuard(async () => {
			await runDocumentAction(async () => {
				if (!activeDocument) return;

				await flushAutosave(true);
				const state = await rpcClient.archiveDocument({
					relativePath: params.relativePath,
					archived: params.archived,
				});
				applyWorkspaceState(state);
				setSaveStatus("saved", params.archived ? "Archived" : "Restored");
			});
		});
	});

	const handleDeleteDocument = useEventCallback(async (relativePath: string) => {
		await runWithNoteSettingsGuard(async () => {
			setDeleteConfirmPath(relativePath);
		});
	});

	const confirmDeleteDocument = useEventCallback(async () => {
		const relativePath = deleteConfirmPath;
		setDeleteConfirmPath(null);
		if (!relativePath) return;

		await runDocumentAction(async () => {
			await flushAutosave(true);
			const state = await rpcClient.deleteDocument({ relativePath });
			applyWorkspaceState(state);
			setSaveStatus("saved", "Deleted");
		});
	});

	const toggleZen = useEventCallback(() => {
		setZenMode((previousZenMode) => !previousZenMode);
		window.setTimeout(() => {
			editorRef.current?.focus();
		}, 0);
	});

	const toggleMarkdownMode = useEventCallback(() => {
		setMarkdownMode((previousMarkdownMode) => {
			const nextMarkdownMode = !previousMarkdownMode;
			if (!nextMarkdownMode) {
				window.setTimeout(() => {
					editorRef.current?.focus();
				}, 0);
			}
			return nextMarkdownMode;
		});
	});

	const handleGrammarFix = useEventCallback(async () => {
		const text = editorText.trim();
		if (!text) return;

		setGrammarBusy(true);
		showStatusMessage("fixing grammar...");
		let shouldClearStatus = true;

		try {
			const result = await rpcClient.grammarFix({ text });
			if (result.result) {
				setEditorText(result.result);
			}
		} catch (error) {
			console.error("Grammar fix failed:", error);
			shouldClearStatus = false;
			showTransientStatus("Grammar fix failed. Please try again.");
		} finally {
			setGrammarBusy(false);
			if (shouldClearStatus) {
				clearStatusMessage();
			}
		}
	});

	const toggleChat = useEventCallback(() => {
		const nextOpen = !chatOpen;
		if (nextOpen) {
			setSelectedText(editorRef.current?.captureSelection() ?? "");
		}
		setChatOpen(nextOpen);
	});

	const clearChatContext = useEventCallback(() => {
		editorRef.current?.clearCapturedSelection();
		setSelectedText("");
	});

	const addChatMessage = useEventCallback((message: Omit<ChatPanelMessage, "id">) => {
		setChatMessages((previousMessages) => [
			...previousMessages,
			{ ...message, id: createChatMessageId() },
		]);
	});

	const handleSendChatMessage = useEventCallback(async (message: string) => {
		addChatMessage({
			rawText: message,
			role: "user",
			showApply: false,
		});

		let instruction = message;
		let text = editorText;

		if (selectedText) {
			instruction = `The user has selected the following text from their document:\n\n"${selectedText}"\n\nTheir request: ${message}\n\nRespond with the rewritten/improved text. If they ask to add content, provide the addition. Be concise and direct.`;
			text = selectedText;
		} else {
			instruction = `The user is writing a document. Here is the full text:\n\n"${editorText}"\n\nTheir request: ${message}\n\nRespond helpfully and concisely.`;
		}

		showStatusMessage("thinking...");
		try {
			const result = await rpcClient.aiComplete({ text, instruction });
			addChatMessage({
				rawText: result.result,
				role: "assistant",
				showApply: Boolean(selectedText),
			});
		} catch (error) {
			console.error("Chat failed:", error);
			addChatMessage({
				rawText: "Something went wrong. Please try again.",
				role: "assistant",
				showApply: false,
			});
		} finally {
			clearStatusMessage();
		}
	});

	const handleApplyAssistantText = useEventCallback((text: string) => {
		editorRef.current?.replaceSelection(text);
		setSelectedText("");
		setChatOpen(false);
	});

	const handleSpeakAssistantText = useEventCallback(async (text: string) => {
		showStatusMessage("speaking...");
		let shouldClearStatus = true;

		try {
			releaseCurrentSpeechAudio();
			const result = await rpcClient.speakText({ text });
			if (result.accepted && result.audioPath && audioRef.current) {
				currentSpeechAudioPathRef.current = result.audioPath;
				audioRef.current.src = `file://${result.audioPath}`;
				await audioRef.current.play();
			}
		} catch (error) {
			console.error("Speech playback failed:", error);
			shouldClearStatus = false;
			showTransientStatus("Speech playback failed. Please try again.");
		} finally {
			if (shouldClearStatus) {
				clearStatusMessage();
			}
		}
	});

	const handleSettingsToggle = useEventCallback(async () => {
		if (settingsOpen) {
			await closeSettings();
			return;
		}
		await openSettings();
	});

	const handleEscape = useEventCallback(() => {
		if (voiceRecorder.permissionDialog) {
			voiceRecorder.dismissPermissionDialog();
			return;
		}
		if (settingsOpen) {
			void closeSettings();
			return;
		}
		if (chatOpen) {
			setChatOpen(false);
			return;
		}
		if (workspaceSidebarRef.current?.handleEscape()) {
			return;
		}
		if (zenMode) {
			setZenMode(false);
		}
	});

	useGlobalShortcuts({
		editorRef,
		hotkeys: currentSettings?.hotkeys ?? defaultHotkeys,
		onEscape: handleEscape,
		onGrammarFix: handleGrammarFix,
		onToggleChat: toggleChat,
		onToggleMarkdown: toggleMarkdownMode,
		onToggleZen: toggleZen,
	});

	const voiceRecorder = useVoiceRecorder({
		editorRef,
		ensureVoiceInputReady,
		hideStatusMessage: clearStatusMessage,
		showStatusMessage,
	});

	useEffect(() => {
		setEditorText(activeDocument?.content ?? "");
	}, [activeDocument?.content, activeDocument?.relativePath]);

	useEffect(() => {
		workspaceStateRef.current = workspaceState;
	}, [workspaceState]);

	useEffect(() => {
		if (!audioRef.current) return;

		const audio = audioRef.current;
		const handleAudioDone = () => {
			releaseCurrentSpeechAudio();
		};

		audio.addEventListener("ended", handleAudioDone);
		audio.addEventListener("error", handleAudioDone);
		return () => {
			audio.removeEventListener("ended", handleAudioDone);
			audio.removeEventListener("error", handleAudioDone);
		};
	}, [releaseCurrentSpeechAudio]);

	useEffect(() => {
		const unsubscribe = menuCommandBus.subscribe((command) => {
			switch (command) {
				case "toggleZenMode":
					toggleZen();
					break;
				case "fixGrammar":
					void handleGrammarFix();
					break;
				case "toggleAIChat":
					toggleChat();
					break;
				case "toggleMarkdown":
					toggleMarkdownMode();
					break;
				case "newDocument":
					void handleCreateDocument();
					break;
				case "newFolder":
					void handleCreateFolder();
					break;
				case "saveDocument":
					void flushAutosave(true);
					break;
				case "changeWorkspace":
					void promptForWorkspacePath();
					break;
				case "workspaceUpdated":
					void scheduleWorkspaceRefresh();
					break;
			}
		});

		return unsubscribe;
	}, [
		flushAutosave,
		handleCreateDocument,
		handleCreateFolder,
		handleGrammarFix,
		promptForWorkspacePath,
		scheduleWorkspaceRefresh,
		toggleChat,
		toggleMarkdownMode,
		toggleZen,
	]);

	useEffect(() => {
		const handleBlur = () => {
			void flushAutosave(true);
		};

		window.addEventListener("blur", handleBlur);
		return () => {
			window.removeEventListener("blur", handleBlur);
		};
	}, [flushAutosave]);

	useEffect(() => {
		return () => {
			if (statusTimerRef.current) {
				window.clearTimeout(statusTimerRef.current);
			}
			if (workspaceRefreshTimerRef.current) {
				window.clearTimeout(workspaceRefreshTimerRef.current);
			}
			releaseCurrentSpeechAudio();
		};
	}, [releaseCurrentSpeechAudio]);

	return (
		<div className={`app ${zenMode ? "zen" : ""}`}>
			<div className="titlebar electrobun-webkit-app-region-drag">
				<button type="button" className="settings-btn" title="Settings" onClick={() => void handleSettingsToggle()}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
						<circle cx="12" cy="12" r="3" />
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
					</svg>
				</button>
			</div>

			<SettingsPanel
				onStatusMessage={showStatusMessage}
				onWorkspacePathApply={handleWorkspacePathApply}
			/>

			<div className="workspace-shell">
				<WorkspaceSidebar
					ref={workspaceSidebarRef}
					activeDocument={activeDocument}
					onArchiveDocument={handleArchiveDocument}
					onCreateDocument={() => void handleCreateDocument()}
					onCreateFolder={() => void handleCreateFolder()}
					onDeleteDocument={handleDeleteDocument}
					onOpenDocument={openDocument}
					onSaveDocumentMetadata={handleSaveDocumentMetadata}
					tree={workspaceState?.tree ?? []}
					workspacePath={currentWorkspacePath}
				/>

				<main className="editor-stage">
					<DocumentHeader
						activeDocument={activeDocument}
						currentWorkspacePath={currentWorkspacePath}
						onRenameDocument={(nextTitle) => void handleRenameDocument(nextTitle)}
						saveStatusLabel={saveStatus.label}
						saveStatusState={saveStatus.state}
					/>
					<EditorSurface
						ref={editorRef}
						markdownMode={markdownMode}
						onMicAnchorChange={voiceRecorder.setAnchor}
						onTextChange={setEditorText}
						onWordCountChange={setWordCount}
						text={editorText}
					/>
				</main>
			</div>

			<MicButton
				anchor={voiceRecorder.anchor}
				isRecording={voiceRecorder.isRecording}
				isTranscribing={voiceRecorder.isTranscribing}
				onMouseDown={voiceRecorder.handleMouseDown}
				onMouseLeave={voiceRecorder.handleMouseLeave}
				onMouseUp={voiceRecorder.handleMouseUp}
				statusText={voiceRecorder.statusText}
			/>

			<MicrophonePermissionModal
				dialog={voiceRecorder.permissionDialog}
				onClose={voiceRecorder.dismissPermissionDialog}
				onOpenSystemSettings={() => void voiceRecorder.openMicrophoneSystemSettings()}
				onRetry={() => void voiceRecorder.retryMicrophoneAccess()}
			/>

			<ConfirmModal
				open={deleteConfirmPath !== null}
				title="Delete this note?"
				description="This note will be moved to trash and permanently deleted after 30 days."
				confirmLabel="Delete"
				cancelLabel="Cancel"
				danger
				onConfirm={() => void confirmDeleteDocument()}
				onCancel={() => setDeleteConfirmPath(null)}
			/>

			<StatusBar aiStatus={aiStatus} wordCount={wordCount} />

			<ChatPanel
				canSpeakAssistantText={localAIStatus?.installState === "ready"}
				hasContext={Boolean(selectedText)}
				markdownMode={markdownMode}
				messages={chatMessages}
				onApplyToSelection={handleApplyAssistantText}
				onClearContext={clearChatContext}
				onClose={() => {
					setChatOpen(false);
				}}
				onSend={handleSendChatMessage}
				onSpeakAssistantText={handleSpeakAssistantText}
				open={chatOpen}
			/>

			{grammarBusy ? (
				<div className="grammar-overlay">
					<div className="grammar-spinner" />
					<span>Refining...</span>
				</div>
			) : null}

			<audio ref={audioRef} preload="none" />
		</div>
	);
}

export function App(): React.ReactElement {
	return (
		<SettingsProvider>
			<WorkspaceProvider>
				<AppShell />
			</WorkspaceProvider>
		</SettingsProvider>
	);
}
