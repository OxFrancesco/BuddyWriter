import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceDocument, WorkspaceState } from "../../shared/models/workspace";

const testState = vi.hoisted(() => {
	const activeDocument: WorkspaceDocument = {
		content: "Plan body",
		isArchived: false,
		labels: ["draft"],
		name: "Plan.md",
		parentRelativePath: "Inbox",
		projectRelativePath: null,
		relativePath: "Inbox/Plan.md",
		title: "Plan",
	};

	const workspaceState: WorkspaceState = {
		workspacePath: "/tmp/BuddyWriter",
		tree: [],
		activeDocument,
	};

	return {
		activeDocument: activeDocument as WorkspaceDocument | null,
		flushAutosave: vi.fn().mockResolvedValue(undefined),
		openSettings: vi.fn().mockResolvedValue(undefined),
		pendingGuardTask: null as null | (() => Promise<void>),
		refreshWorkspace: vi.fn().mockResolvedValue(workspaceState),
		rpcClient: {
			archiveDocument: vi.fn().mockResolvedValue(workspaceState),
			deleteDocument: vi.fn().mockResolvedValue(workspaceState),
			saveDocument: vi.fn().mockResolvedValue({ savedAt: new Date().toISOString(), success: true }),
			setWorkspacePath: vi.fn().mockResolvedValue({
				...workspaceState,
				workspacePath: "/tmp/OtherWorkspace",
			}),
			updateDocumentMetadata: vi.fn().mockResolvedValue({
				...workspaceState,
				activeDocument: {
					...activeDocument,
					name: "Renamed.md",
					relativePath: "Inbox/Renamed.md",
					title: "Renamed",
				},
			}),
			createDocument: vi.fn().mockResolvedValue(workspaceState),
			createFolder: vi.fn().mockResolvedValue(workspaceState),
		},
		setActiveDocumentContent: vi.fn(),
		setSaveStatus: vi.fn(),
		setWorkspaceState: vi.fn(),
		showStatusMessage: vi.fn(),
		syncWorkspacePath: vi.fn(),
		workspaceState: workspaceState as WorkspaceState,
	};
});

vi.mock("../components/ChatPanel", () => ({
	ChatPanel: () => null,
}));

vi.mock("../components/ConfirmModal", () => ({
	ConfirmModal: (props: {
		cancelLabel?: string;
		confirmLabel?: string;
		onCancel: () => void;
		onConfirm: () => void;
		open: boolean;
	}) => props.open ? (
		<div>
			<button type="button" onClick={props.onCancel}>{props.cancelLabel ?? "Cancel"}</button>
			<button type="button" onClick={props.onConfirm}>{props.confirmLabel ?? "Confirm"}</button>
		</div>
	) : null,
}));

vi.mock("../components/DocumentHeader", () => ({
	DocumentHeader: (props: { onRenameDocument: (nextTitle: string) => void }) => (
		<div>
			<button type="button" onClick={() => {
				void props.onRenameDocument("Renamed");
			}}
			>
				Rename Note
			</button>
			<button type="button" onClick={() => {
				void props.onRenameDocument("   ");
			}}
			>
				Rename Blank
			</button>
		</div>
	),
}));

vi.mock("../components/EditorSurface", async () => {
	const React = await vi.importActual<typeof import("react")>("react");
	return {
		EditorSurface: React.forwardRef(function MockEditorSurface(_, _ref) {
			return <div data-testid="editor-surface" />;
		}),
	};
});

vi.mock("../components/MicButton", () => ({
	MicButton: () => null,
}));

vi.mock("../components/MicrophonePermissionModal", () => ({
	MicrophonePermissionModal: () => null,
}));

vi.mock("../components/SettingsPanel", () => ({
	SettingsPanel: (props: { onWorkspacePathApply: (path: string) => Promise<void> }) => (
		<button type="button" onClick={() => {
			void props.onWorkspacePathApply("/tmp/OtherWorkspace");
		}}
		>
			Apply Workspace
		</button>
	),
}));

vi.mock("../components/StatusBar", () => ({
	StatusBar: () => null,
}));

vi.mock("../components/WorkspaceSidebar", async () => {
	const React = await vi.importActual<typeof import("react")>("react");
	return {
		WorkspaceSidebar: React.forwardRef(function MockWorkspaceSidebar(props: {
			onArchiveDocument: (params: { archived: boolean; relativePath: string }) => Promise<void>;
			onCreateDocument: () => void;
			onCreateFolder: () => void;
			onDeleteDocument: (relativePath: string) => Promise<void>;
		}, ref) {
			React.useImperativeHandle(ref, () => ({
				handleEscape: () => false,
				runWithNoteSettingsGuard: async (task: () => Promise<void>) => {
					testState.pendingGuardTask = task;
				},
			}));

			return (
				<div>
					<button type="button" onClick={props.onCreateDocument}>Create Note</button>
					<button type="button" onClick={props.onCreateFolder}>Create Folder</button>
					<button type="button" onClick={() => {
						void props.onArchiveDocument({ relativePath: "Inbox/Plan.md", archived: true });
					}}
					>
						Archive Note
					</button>
					<button type="button" onClick={() => {
						void props.onDeleteDocument("Inbox/Plan.md");
					}}
					>
						Delete Note
					</button>
				</div>
			);
		}),
	};
});

vi.mock("../hooks/useAutosave", () => ({
	useAutosave: () => ({
		flushAutosave: testState.flushAutosave,
		saveInFlightRef: { current: null },
		saveStatus: { label: "Saved", state: "saved" as const },
		setSaveStatus: testState.setSaveStatus,
	}),
}));

vi.mock("../hooks/useGlobalShortcuts", () => ({
	useGlobalShortcuts: () => {},
}));

vi.mock("../hooks/useVoiceRecorder", () => ({
	useVoiceRecorder: () => ({
		anchor: { left: 0, top: 0, visible: false },
		dismissPermissionDialog: vi.fn(),
		handleMouseDown: vi.fn(),
		handleMouseLeave: vi.fn(),
		handleMouseUp: vi.fn(),
		isRecording: false,
		isTranscribing: false,
		openMicrophoneSystemSettings: vi.fn(),
		permissionDialog: null,
		retryMicrophoneAccess: vi.fn(),
		setAnchor: vi.fn(),
		statusText: "",
	}),
}));

vi.mock("../ipc/menu-command-bus", () => ({
	menuCommandBus: {
		subscribe: vi.fn(() => () => {}),
	},
}));

vi.mock("../providers/SettingsProvider", () => ({
	SettingsProvider: (props: { children: any }) => props.children,
	useSettingsContext: () => ({
		closeSettings: vi.fn().mockResolvedValue(undefined),
		currentSettings: {
			hotkeys: {},
			workspacePath: "/tmp/BuddyWriter",
		},
		ensureVoiceInputReady: vi.fn().mockResolvedValue(true),
		localAIStatus: null,
		openSettings: testState.openSettings,
		settingsOpen: false,
		syncWorkspacePath: testState.syncWorkspacePath,
	}),
}));

vi.mock("../providers/WorkspaceProvider", () => ({
	WorkspaceProvider: (props: { children: any }) => props.children,
	useWorkspaceContext: () => ({
		activeDocument: testState.activeDocument,
		refreshWorkspace: testState.refreshWorkspace,
		setActiveDocumentContent: testState.setActiveDocumentContent,
		setWorkspaceState: testState.setWorkspaceState,
		workspaceState: testState.workspaceState,
	}),
}));

vi.mock("../rpc/client", () => ({
	rpcClient: testState.rpcClient,
}));

import { AppShell } from "./App";

async function confirmGuardedAction() {
	const task = testState.pendingGuardTask;
	testState.pendingGuardTask = null;
	await act(async () => {
		await task?.();
	});
}

describe("AppShell", () => {
	beforeEach(() => {
		testState.pendingGuardTask = null;
		testState.flushAutosave.mockClear();
		testState.openSettings.mockClear();
		testState.refreshWorkspace.mockClear();
		testState.setActiveDocumentContent.mockClear();
		testState.setSaveStatus.mockClear();
		testState.setWorkspaceState.mockClear();
		testState.syncWorkspacePath.mockClear();
		testState.rpcClient.archiveDocument.mockClear();
		testState.rpcClient.createDocument.mockClear();
		testState.rpcClient.createFolder.mockClear();
		testState.rpcClient.deleteDocument.mockClear();
		testState.rpcClient.saveDocument.mockClear();
		testState.rpcClient.setWorkspacePath.mockClear();
		testState.rpcClient.updateDocumentMetadata.mockClear();
		testState.activeDocument = {
			content: "Plan body",
			isArchived: false,
			labels: ["draft"],
			name: "Plan.md",
			parentRelativePath: "Inbox",
			projectRelativePath: null,
			relativePath: "Inbox/Plan.md",
			title: "Plan",
		};
		testState.workspaceState = {
			workspacePath: "/tmp/BuddyWriter",
			tree: [],
			activeDocument: testState.activeDocument,
		};
		vi.restoreAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it("validates blank titles before it asks the guard to continue", async () => {
		render(<AppShell />);

		fireEvent.click(screen.getByRole("button", { name: "Rename Blank" }));

		expect(testState.pendingGuardTask).toBeNull();
		expect(testState.rpcClient.updateDocumentMetadata).not.toHaveBeenCalled();
	});

	it("guards header renames before dispatching metadata updates", async () => {
		render(<AppShell />);

		fireEvent.click(screen.getByRole("button", { name: "Rename Note" }));

		expect(testState.pendingGuardTask).not.toBeNull();
		expect(testState.rpcClient.updateDocumentMetadata).not.toHaveBeenCalled();

		await confirmGuardedAction();

		await waitFor(() => {
			expect(testState.rpcClient.updateDocumentMetadata).toHaveBeenCalledWith({
				relativePath: "Inbox/Plan.md",
				title: "Renamed",
				labels: ["draft"],
				targetParentRelativePath: "Inbox",
			});
		});
	});

	it("creates a new untitled note without using a browser prompt", async () => {
		render(<AppShell />);

		fireEvent.click(screen.getByRole("button", { name: "Create Note" }));

		expect(testState.pendingGuardTask).not.toBeNull();
		expect(testState.rpcClient.createDocument).not.toHaveBeenCalled();

		await confirmGuardedAction();

		await waitFor(() => {
			expect(testState.rpcClient.createDocument).toHaveBeenCalledWith({
				parentRelativePath: "Inbox",
			});
		});
	});

	it("guards new folder creation", async () => {
		const promptSpy = vi.spyOn(window, "prompt").mockReturnValueOnce("Roadmap");
		render(<AppShell />);

		fireEvent.click(screen.getByRole("button", { name: "Create Folder" }));

		expect(promptSpy).toHaveBeenCalledWith("New folder name", "New Folder");
		expect(testState.pendingGuardTask).not.toBeNull();
		expect(testState.rpcClient.createFolder).not.toHaveBeenCalled();

		await confirmGuardedAction();

		await waitFor(() => {
			expect(testState.rpcClient.createFolder).toHaveBeenCalledWith({
				parentRelativePath: "Inbox",
				name: "Roadmap",
			});
		});
	});

	it("creates a note from a title edit when no active document exists", async () => {
		testState.activeDocument = null;
		testState.workspaceState = {
			workspacePath: "/tmp/BuddyWriter",
			tree: [],
			activeDocument: null,
		};
		testState.rpcClient.createDocument.mockResolvedValueOnce({
			workspacePath: "/tmp/BuddyWriter",
			tree: [],
			activeDocument: {
				content: "",
				isArchived: false,
				labels: [],
				name: "Renamed.md",
				parentRelativePath: "Inbox",
				projectRelativePath: null,
				relativePath: "Inbox/Renamed.md",
				title: "Renamed",
			},
		});
		render(<AppShell />);

		fireEvent.click(screen.getByRole("button", { name: "Rename Note" }));

		expect(testState.pendingGuardTask).not.toBeNull();
		expect(testState.rpcClient.createDocument).not.toHaveBeenCalled();

		await confirmGuardedAction();

		await waitFor(() => {
			expect(testState.rpcClient.createDocument).toHaveBeenCalledWith({
				name: "Renamed",
			});
		});
		expect(testState.rpcClient.updateDocumentMetadata).not.toHaveBeenCalled();
	});

	it("guards workspace changes before applying them", async () => {
		render(<AppShell />);

		fireEvent.click(screen.getByRole("button", { name: "Apply Workspace" }));

		expect(testState.pendingGuardTask).not.toBeNull();
		expect(testState.rpcClient.setWorkspacePath).not.toHaveBeenCalled();

		await confirmGuardedAction();

		await waitFor(() => {
			expect(testState.rpcClient.setWorkspacePath).toHaveBeenCalledWith({
				path: "/tmp/OtherWorkspace",
			});
		});
	});

	it("guards archive and delete actions from the sidebar", async () => {
		render(<AppShell />);

		fireEvent.click(screen.getByRole("button", { name: "Archive Note" }));

		expect(testState.pendingGuardTask).not.toBeNull();
		expect(testState.rpcClient.archiveDocument).not.toHaveBeenCalled();

		await confirmGuardedAction();

		await waitFor(() => {
			expect(testState.rpcClient.archiveDocument).toHaveBeenCalledWith({
				relativePath: "Inbox/Plan.md",
				archived: true,
			});
		});

		fireEvent.click(screen.getByRole("button", { name: "Delete Note" }));

		expect(testState.pendingGuardTask).not.toBeNull();
		expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();

		await confirmGuardedAction();

		expect(screen.getByRole("button", { name: "Delete" })).not.toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));

		await waitFor(() => {
			expect(testState.rpcClient.deleteDocument).toHaveBeenCalledWith({
				relativePath: "Inbox/Plan.md",
			});
		});
	});
});
