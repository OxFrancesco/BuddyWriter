import { useEffect, useRef } from "react";
import {
	getMicrophonePermissionDialogContent,
	type MicrophoneAccessIssue,
} from "../utils/microphone-permissions";

type MicrophonePermissionModalProps = {
	dialog: {
		issue: MicrophoneAccessIssue;
		openingSystemSettings: boolean;
	} | null;
	onClose: () => void;
	onOpenSystemSettings: () => void;
	onRetry: () => void;
};

export function MicrophonePermissionModal(props: MicrophonePermissionModalProps): React.ReactElement | null {
	const { dialog, onClose, onOpenSystemSettings, onRetry } = props;
	const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
	const content = dialog ? getMicrophonePermissionDialogContent(dialog.issue) : null;

	useEffect(() => {
		if (!dialog) return;
		primaryButtonRef.current?.focus();
	}, [dialog]);

	if (!dialog || !content) {
		return null;
	}

	return (
		<div
			className="permission-modal open"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) {
					onClose();
				}
			}}
		>
			<div
				className="permission-modal__dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby="microphone-permission-title"
				aria-describedby="microphone-permission-copy"
				onMouseDown={(event) => {
					event.stopPropagation();
				}}
			>
				<div className="permission-modal__eyebrow">{content?.eyebrow ?? ""}</div>
				<h2 id="microphone-permission-title" className="permission-modal__title">
					{content?.title ?? ""}
				</h2>
				<p id="microphone-permission-copy" className="permission-modal__copy">
					{content.copy}
				</p>
				{content.note ? (
					<p className="permission-modal__copy">{content.note}</p>
				) : null}
				<div className="permission-modal__actions">
					<button
						type="button"
						className="permission-modal__button permission-modal__button--secondary"
						onClick={onClose}
					>
						{content.secondaryLabel}
					</button>
					<button
						ref={primaryButtonRef}
						type="button"
						className="permission-modal__button"
						disabled={dialog.openingSystemSettings}
						onClick={() => {
							if (content.primaryAction === "open-settings") {
								onOpenSystemSettings();
								return;
							}
							onRetry();
						}}
					>
						{content.primaryAction === "open-settings" && dialog.openingSystemSettings
							? "Opening..."
							: content.primaryLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
