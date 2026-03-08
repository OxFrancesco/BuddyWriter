import { useEffect, useRef } from "react";
import lottie from "lottie-web";
import microphoneAnimation from "../../../public/microphone.json";
import type { MicAnchor } from "./EditorSurface";

type MicButtonProps = {
	anchor: MicAnchor;
	isRecording: boolean;
	isTranscribing: boolean;
	onMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => void;
	onMouseLeave: () => void;
	onMouseUp: () => void;
	statusText: string;
};

export function MicButton(props: MicButtonProps): React.ReactElement {
	const { anchor, isRecording, isTranscribing, onMouseDown, onMouseLeave, onMouseUp, statusText } = props;
	const lottieRef = useRef<HTMLDivElement | null>(null);
	const animationRef = useRef<ReturnType<typeof lottie.loadAnimation> | null>(null);
	const buttonLabel = isRecording
		? "Stop voice input"
		: statusText === "allow mic"
			? "Allow microphone access"
			: "Start voice input";

	useEffect(() => {
		if (!lottieRef.current) return;
		animationRef.current = lottie.loadAnimation({
			container: lottieRef.current,
			renderer: "svg",
			loop: true,
			autoplay: false,
			animationData: microphoneAnimation,
			rendererSettings: {
				preserveAspectRatio: "xMidYMid meet",
			},
		});
		animationRef.current.goToAndStop(0, true);
		return () => {
			animationRef.current?.destroy();
			animationRef.current = null;
		};
	}, []);

	useEffect(() => {
		if (!animationRef.current) return;
		if (isRecording) {
			animationRef.current.setSpeed(1.35);
			animationRef.current.play();
			return;
		}
		if (isTranscribing) {
			animationRef.current.setSpeed(1);
			animationRef.current.play();
			return;
		}
		animationRef.current.stop();
	}, [isRecording, isTranscribing]);

	return (
		<button
			className={[
				"mic-btn",
				anchor.visible || isRecording || isTranscribing ? "visible" : "",
				isRecording ? "recording" : "",
				isTranscribing ? "transcribing" : "",
			].filter(Boolean).join(" ")}
			style={{ left: `${anchor.left}px`, top: `${anchor.top}px` }}
			title={buttonLabel}
			type="button"
			aria-label={buttonLabel}
			aria-pressed={isRecording}
			onMouseDown={onMouseDown}
			onMouseLeave={onMouseLeave}
			onMouseUp={onMouseUp}
		>
			<div ref={lottieRef} className="mic-lottie" aria-hidden="true" />
			<span className="mic-status">{statusText}</span>
		</button>
	);
}
