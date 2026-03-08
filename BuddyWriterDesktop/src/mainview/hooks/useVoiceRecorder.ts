import { useEffect, useRef, useState } from "react";
import type { EditorSurfaceHandle, MicAnchor } from "../components/EditorSurface";
import { rpcClient } from "../rpc/client";
import { arrayBufferToBase64, encodeWav } from "../utils/audio";
import {
	classifyMicrophoneAccessError,
	getMicrophoneAccessStatusMessage,
	getMicrophonePermissionState,
	queryMicrophonePermissionStatus,
	type MicrophoneAccessIssue,
	type MicrophonePermissionState,
} from "../utils/microphone-permissions";
import { useEventCallback } from "./useEventCallback";

type VoiceRecorderOptions = {
	editorRef: React.RefObject<EditorSurfaceHandle | null>;
	ensureVoiceInputReady: (showMessage: (message: string) => void) => Promise<boolean>;
	hideStatusMessage: () => void;
	showStatusMessage: (message: string) => void;
};

type PermissionDialogState = {
	issue: MicrophoneAccessIssue;
	openingSystemSettings: boolean;
};

export function useVoiceRecorder(options: VoiceRecorderOptions) {
	const { editorRef, ensureVoiceInputReady, hideStatusMessage, showStatusMessage } = options;
	const [anchor, setAnchor] = useState<MicAnchor>({ left: 0, top: 0, visible: false });
	const [isRecording, setIsRecording] = useState(false);
	const [isTranscribing, setIsTranscribing] = useState(false);
	const [statusText, setStatusText] = useState("");
	const [voiceClipboard, setVoiceClipboard] = useState("");
	const [microphonePermissionState, setMicrophonePermissionState] = useState<MicrophonePermissionState>("unsupported");
	const [permissionDialog, setPermissionDialog] = useState<PermissionDialogState | null>(null);
	const isRecordingRef = useRef(false);
	const holdModeRef = useRef(false);
	const holdTimerRef = useRef<number | null>(null);
	const microphonePermissionStatusRef = useRef<PermissionStatus | null>(null);
	const microphonePermissionChangeHandlerRef = useRef<(() => void) | null>(null);
	const startRecordingInFlightRef = useRef(false);
	const recordingContextRef = useRef<AudioContext | null>(null);
	const recordingStreamRef = useRef<MediaStream | null>(null);
	const recordingSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const recordingProcessorRef = useRef<ScriptProcessorNode | null>(null);
	const recordingSilenceRef = useRef<GainNode | null>(null);
	const recordedChunksRef = useRef<Float32Array[]>([]);
	const recordedSampleRateRef = useRef(44100);

	const clearHoldTimer = useEventCallback(() => {
		if (holdTimerRef.current) {
			window.clearTimeout(holdTimerRef.current);
			holdTimerRef.current = null;
		}
	});

	const clearRecordingResources = useEventCallback(() => {
		recordingSourceRef.current?.disconnect();
		recordingProcessorRef.current?.disconnect();
		recordingSilenceRef.current?.disconnect();
		recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
		void recordingContextRef.current?.close();
		recordingSourceRef.current = null;
		recordingProcessorRef.current = null;
		recordingSilenceRef.current = null;
		recordingStreamRef.current = null;
		recordingContextRef.current = null;
	});

	const syncMicrophonePermissionListener = useEventCallback((permissionStatus: PermissionStatus | null) => {
		if (microphonePermissionStatusRef.current === permissionStatus) return;

		if (microphonePermissionStatusRef.current && microphonePermissionChangeHandlerRef.current) {
			microphonePermissionStatusRef.current.removeEventListener("change", microphonePermissionChangeHandlerRef.current);
		}

		microphonePermissionStatusRef.current = permissionStatus;
		if (!permissionStatus) {
			microphonePermissionChangeHandlerRef.current = null;
			return;
		}

		const handlePermissionChange = () => {
			void refreshMicrophonePermission();
		};

		microphonePermissionChangeHandlerRef.current = handlePermissionChange;
		permissionStatus.addEventListener("change", handlePermissionChange);
	});

	const refreshMicrophonePermission = useEventCallback(async () => {
		const permissionStatus = await queryMicrophonePermissionStatus();
		const nextState = getMicrophonePermissionState(permissionStatus);
		setMicrophonePermissionState(nextState);
		syncMicrophonePermissionListener(permissionStatus);
		if (nextState === "granted") {
			setPermissionDialog((currentDialog) => currentDialog?.issue === "denied" ? null : currentDialog);
		}
		return nextState;
	});

	const showPermissionDialog = useEventCallback((issue: MicrophoneAccessIssue) => {
		setPermissionDialog({
			issue,
			openingSystemSettings: false,
		});
		showStatusMessage(getMicrophoneAccessStatusMessage(issue));
	});

	const finishRecording = useEventCallback(async () => {
		if (recordedChunksRef.current.length === 0) return;
		const chunks = recordedChunksRef.current;
		recordedChunksRef.current = [];
		setIsTranscribing(true);
		setStatusText("transcribing...");
		showStatusMessage("transcribing voice...");

		try {
			const wavBuffer = encodeWav(chunks, recordedSampleRateRef.current);
			const base64 = arrayBufferToBase64(wavBuffer);
			const { text } = await rpcClient.transcribeAudio({
				audioPath: `base64:${base64}`,
			});

			if (text.trim()) {
				setVoiceClipboard(text);
				editorRef.current?.insertTextAtCursor(text);
			}
		} catch (error) {
			console.error("Transcription failed:", error);
			setStatusText("error");
			window.setTimeout(() => {
				setStatusText("");
			}, 2000);
		} finally {
			setIsTranscribing(false);
			setStatusText("");
			hideStatusMessage();
			recordedChunksRef.current = [];
		}
	});

	const startRecording = useEventCallback(async (permissionState: MicrophonePermissionState) => {
		if (isRecording || startRecordingInFlightRef.current) return false;
		editorRef.current?.saveCursorPosition();
		startRecordingInFlightRef.current = true;

		if (permissionState !== "granted") {
			setStatusText("allow mic");
			showStatusMessage("Allow microphone access to start dictation.");
		}

		try {
			if (!navigator.mediaDevices?.getUserMedia) {
				showPermissionDialog("unsupported");
				return false;
			}

			recordingStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
			recordingContextRef.current = new AudioContext();
			recordedSampleRateRef.current = recordingContextRef.current.sampleRate;
			recordedChunksRef.current = [];

			recordingSourceRef.current = recordingContextRef.current.createMediaStreamSource(recordingStreamRef.current);
			recordingProcessorRef.current = recordingContextRef.current.createScriptProcessor(4096, 1, 1);
			recordingSilenceRef.current = recordingContextRef.current.createGain();
			recordingSilenceRef.current.gain.value = 0;

			recordingProcessorRef.current.onaudioprocess = (event) => {
				if (!isRecordingRef.current) return;
				recordedChunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
			};

			recordingSourceRef.current.connect(recordingProcessorRef.current);
			recordingProcessorRef.current.connect(recordingSilenceRef.current);
			recordingSilenceRef.current.connect(recordingContextRef.current.destination);
			isRecordingRef.current = true;
			setIsRecording(true);
			setStatusText("● rec");
			hideStatusMessage();
			setPermissionDialog(null);
			void refreshMicrophonePermission();
			return true;
		} catch (error) {
			const issue = classifyMicrophoneAccessError(error);
			console.error("Mic access failed:", error);
			if (issue === "denied") {
				void refreshMicrophonePermission();
				showPermissionDialog(issue);
				return false;
			}

			if (issue === "missing-device" || issue === "busy" || issue === "unsupported") {
				showPermissionDialog(issue);
				return false;
			}

			setStatusText("mic error");
			showStatusMessage(getMicrophoneAccessStatusMessage(issue));
			window.setTimeout(() => {
				setStatusText("");
			}, 2200);
			return false;
		} finally {
			startRecordingInFlightRef.current = false;
		}
	});

	const stopRecording = useEventCallback(() => {
		if (!isRecording) return;
		isRecordingRef.current = false;
		setIsRecording(false);
		clearRecordingResources();
		void finishRecording();
	});

	const startMicSession = useEventCallback(async (options?: { armHoldMode?: boolean }) => {
		if (isRecording || startRecordingInFlightRef.current) return false;
		holdModeRef.current = false;
		clearHoldTimer();

		const voiceInputReady = await ensureVoiceInputReady(showStatusMessage);
		if (!voiceInputReady) return false;

		const permissionState = await refreshMicrophonePermission();
		if (permissionState === "denied") {
			showPermissionDialog("denied");
			return false;
		}

		if (options?.armHoldMode) {
			holdTimerRef.current = window.setTimeout(() => {
				holdModeRef.current = true;
			}, 200);
		}

		const recordingStarted = await startRecording(permissionState);
		if (!recordingStarted) {
			clearHoldTimer();
			holdModeRef.current = false;
		}

		return recordingStarted;
	});

	const handleMouseDown = useEventCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
		event.preventDefault();
		if (isRecording) {
			stopRecording();
			return;
		}

		await startMicSession({ armHoldMode: true });
	});

	const stopIfHolding = useEventCallback(() => {
		clearHoldTimer();
		if (holdModeRef.current && isRecording) {
			stopRecording();
		}
	});

	const dismissPermissionDialog = useEventCallback(() => {
		setPermissionDialog(null);
		hideStatusMessage();
	});

	const retryMicrophoneAccess = useEventCallback(async () => {
		setPermissionDialog(null);
		hideStatusMessage();
		await startMicSession();
	});

	const openMicrophoneSystemSettings = useEventCallback(async () => {
		setPermissionDialog((currentDialog) => currentDialog ? {
			...currentDialog,
			openingSystemSettings: true,
		} : currentDialog);

		try {
			const { opened } = await rpcClient.openMicrophoneSystemSettings({});
			if (!opened) {
				showStatusMessage("Open your system microphone settings and enable BuddyWriter.");
			}
		} finally {
			setPermissionDialog((currentDialog) => currentDialog ? {
				...currentDialog,
				openingSystemSettings: false,
			} : currentDialog);
		}
	});

	useEffect(() => {
		isRecordingRef.current = isRecording;
	}, [isRecording]);

	useEffect(() => {
		void refreshMicrophonePermission();

		const handleFocus = () => {
			void refreshMicrophonePermission();
		};
		const handleVisibilityChange = () => {
			if (!document.hidden) {
				void refreshMicrophonePermission();
			}
		};

		window.addEventListener("focus", handleFocus);
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => {
			window.removeEventListener("focus", handleFocus);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			syncMicrophonePermissionListener(null);
		};
	}, [refreshMicrophonePermission, syncMicrophonePermissionListener]);

	useEffect(() => {
		const handleVoiceClipboardPaste = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.altKey && event.key.toLowerCase() === "v") {
				event.preventDefault();
				if (voiceClipboard) {
					editorRef.current?.insertTextAtCursor(voiceClipboard);
				}
			}
		};

		document.addEventListener("keydown", handleVoiceClipboardPaste, true);
		return () => {
			document.removeEventListener("keydown", handleVoiceClipboardPaste, true);
		};
	}, [editorRef, voiceClipboard]);

	const passiveStatusText = microphonePermissionState === "denied" ? "allow mic" : "";

	return {
		anchor,
		dismissPermissionDialog,
		handleMouseDown,
		handleMouseLeave: stopIfHolding,
		handleMouseUp: stopIfHolding,
		isRecording,
		isTranscribing,
		openMicrophoneSystemSettings,
		permissionDialog,
		retryMicrophoneAccess,
		setAnchor,
		statusText: statusText || passiveStatusText,
		voiceClipboard,
	};
}
