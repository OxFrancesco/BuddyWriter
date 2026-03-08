import { createContext, startTransition, useContext, useEffect, useMemo, useState } from "react";
import type { WorkspaceDocument, WorkspaceState } from "../../shared/models/workspace";
import { useEventCallback } from "../hooks/useEventCallback";
import { rpcClient } from "../rpc/client";

type WorkspaceContextValue = {
	activeDocument: WorkspaceDocument | null;
	refreshWorkspace: () => Promise<WorkspaceState>;
	setActiveDocumentContent: (content: string) => void;
	setWorkspaceState: (state: WorkspaceState) => void;
	workspaceState: WorkspaceState | null;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

type WorkspaceProviderProps = {
	children: React.ReactNode;
};

export function WorkspaceProvider(props: WorkspaceProviderProps): React.ReactElement {
	const { children } = props;
	const [workspaceState, setWorkspaceStateState] = useState<WorkspaceState | null>(null);

	const setWorkspaceState = useEventCallback((state: WorkspaceState) => {
		startTransition(() => {
			setWorkspaceStateState(state);
		});
	});

	const refreshWorkspace = useEventCallback(async () => {
		const state = await rpcClient.getWorkspaceState({});
		setWorkspaceState(state);
		return state;
	});

	const setActiveDocumentContent = useEventCallback((content: string) => {
		startTransition(() => {
			setWorkspaceStateState((previousState) => {
				if (!previousState?.activeDocument) return previousState;
				return {
					...previousState,
					activeDocument: {
						...previousState.activeDocument,
						content,
					},
				};
			});
		});
	});

	useEffect(() => {
		void refreshWorkspace();
	}, [refreshWorkspace]);

	const value = useMemo<WorkspaceContextValue>(() => ({
		activeDocument: workspaceState?.activeDocument ?? null,
		refreshWorkspace,
		setActiveDocumentContent,
		setWorkspaceState,
		workspaceState,
	}), [refreshWorkspace, setActiveDocumentContent, setWorkspaceState, workspaceState]);

	return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceContext(): WorkspaceContextValue {
	const context = useContext(WorkspaceContext);
	if (!context) {
		throw new Error("useWorkspaceContext must be used inside WorkspaceProvider.");
	}

	return context;
}
