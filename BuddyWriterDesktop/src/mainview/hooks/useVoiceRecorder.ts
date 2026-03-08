import { useEffect, useRef, useState } from "react";
import { rpcClient } from "../rpc/client";
import { arrayBufferToBase64, encodeWav } from "../utils/audio";
import type { EditorSurfaceHandle, MicAnchor } from "../components/EditorSurface";
import { useEventCallback } from "./useEventCallback";

type VoiceRecorderOptions = {
	editorRef: React.RefObject<EditorSurfaceHandle | null>;
	ensureVoiceInputReady: (showMessage: (message: string) => void) => Promise<boolean>;
	hideStatusMessage: () => void;
	showStatusMessage: (message: string) => void;
};

export function useVoiceRecorder(options: VoiceRecorderOptions) {
	const { editorRef, ensureVoiceInputReady, hideStatusMessage, showStatusMessage } = options;
	const [anchor, setAnchor] = useState<MicAnchor>({ left: 0, top: 0, visible: false });
	const [isRecording, setIsRecording] = useState(false);
	const [isTranscribing, setIsTranscribing] = useState(false);
	const [statusText, setStatusText] = useState("");
	const [voiceClipboard, setVoiceClipboard] = useState("");
	const isRecordingRef = useRef(false);
	const holdModeRef = useRef(false);
	const holdTimerRef = useRef<number | null>(null);
	const recordingContextRef = useRef<AudioContext | null>(null);
	const recordingStreamRef = useRef<MediaStream | null>(null);
	const recordingSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const recordingProcessorRef = useRef<ScriptProcessorNode | null>(null);
	const recordingSilenceRef = useRef<GainNode | null>(null);
	const recordedChunksRef = useRef<Float32Array[]>([]);
	const recordedSampleRateRef = useRef(44100);

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

	const startRecording = useEventCallback(async () => {
		if (isRecording) return;
		editorRef.current?.saveCursorPosition();

		try {
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
		} catch (error) {
			console.error("Mic access failed:", error);
			setStatusText("mic denied");
			window.setTimeout(() => {
				setStatusText("");
			}, 2000);
		}
	});

	const stopRecording = useEventCallback(() => {
		if (!isRecording) return;
		isRecordingRef.current = false;
		setIsRecording(false);
		clearRecordingResources();
		void finishRecording();
	});

	const handleMouseDown = useEventCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
		event.preventDefault();
		if (isRecording) {
			stopRecording();
			return;
		}

		holdModeRef.current = false;
		const voiceInputReady = await ensureVoiceInputReady(showStatusMessage);
		if (!voiceInputReady) return;

		holdTimerRef.current = window.setTimeout(() => {
			holdModeRef.current = true;
		}, 200);
		await startRecording();
	});

	const stopIfHolding = useEventCallback(() => {
		if (holdTimerRef.current) {
			window.clearTimeout(holdTimerRef.current);
			holdTimerRef.current = null;
		}
		if (holdModeRef.current && isRecording) {
			stopRecording();
		}
	});

	useEffect(() => {
		isRecordingRef.current = isRecording;
	}, [isRecording]);

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

	return {
		anchor,
		handleMouseDown,
		handleMouseLeave: stopIfHolding,
		handleMouseUp: stopIfHolding,
		isRecording,
		isTranscribing,
		setAnchor,
		statusText,
		voiceClipboard,
	};
}
