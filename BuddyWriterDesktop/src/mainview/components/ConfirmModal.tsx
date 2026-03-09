import { useEffect, useRef } from "react";

type ConfirmModalProps = {
	open: boolean;
	title: string;
	description: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
};

export function ConfirmModal(props: ConfirmModalProps): React.ReactElement | null {
	const {
		open,
		title,
		description,
		confirmLabel = "Confirm",
		cancelLabel = "Cancel",
		danger,
		onConfirm,
		onCancel,
	} = props;
	const confirmRef = useRef<HTMLButtonElement | null>(null);

	useEffect(() => {
		if (open) {
			confirmRef.current?.focus();
		}
	}, [open]);

	if (!open) {
		return null;
	}

	return (
		<div
			className="permission-modal open"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) {
					onCancel();
				}
			}}
		>
			<div
				className="permission-modal__dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby="confirm-modal-title"
				aria-describedby="confirm-modal-desc"
				onMouseDown={(event) => {
					event.stopPropagation();
				}}
			>
				<h2 id="confirm-modal-title" className="permission-modal__title">
					{title}
				</h2>
				<p id="confirm-modal-desc" className="permission-modal__copy">
					{description}
				</p>
				<div className="permission-modal__actions">
					<button
						type="button"
						className="permission-modal__button permission-modal__button--secondary"
						onClick={onCancel}
					>
						{cancelLabel}
					</button>
					<button
						ref={confirmRef}
						type="button"
						className={`permission-modal__button ${danger ? "permission-modal__button--danger" : ""}`}
						onClick={onConfirm}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
