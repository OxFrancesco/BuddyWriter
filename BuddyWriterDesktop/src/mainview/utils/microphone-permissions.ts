export type MicrophonePermissionState = PermissionState | "unsupported";

export type MicrophoneAccessIssue =
	| "denied"
	| "missing-device"
	| "busy"
	| "unsupported"
	| "unknown";

export type MicrophonePermissionDialogContent = {
	eyebrow: string;
	title: string;
	copy: string;
	note?: string;
	primaryAction: "open-settings" | "retry";
	primaryLabel: string;
	secondaryLabel: string;
};

type ErrorLike = {
	message?: string;
	name?: string;
};

export async function queryMicrophonePermissionStatus(): Promise<PermissionStatus | null> {
	if (
		typeof navigator === "undefined"
		|| !("permissions" in navigator)
		|| typeof navigator.permissions.query !== "function"
	) {
		return null;
	}

	try {
		return await navigator.permissions.query({ name: "microphone" as PermissionName });
	} catch {
		return null;
	}
}

export function getMicrophonePermissionState(permissionStatus: PermissionStatus | null): MicrophonePermissionState {
	return permissionStatus?.state ?? "unsupported";
}

export function classifyMicrophoneAccessError(error: unknown): MicrophoneAccessIssue {
	const normalizedError = (error ?? {}) as ErrorLike;
	const name = normalizedError.name ?? "";
	const message = normalizedError.message?.toLowerCase() ?? "";

	if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
		return "denied";
	}

	if (
		name === "NotFoundError"
		|| name === "DevicesNotFoundError"
		|| name === "OverconstrainedError"
	) {
		return "missing-device";
	}

	if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
		return "busy";
	}

	if (name === "TypeError") {
		return "unsupported";
	}

	if (message.includes("permission") && message.includes("denied")) {
		return "denied";
	}

	if (message.includes("not found") || message.includes("no device")) {
		return "missing-device";
	}

	if (message.includes("not readable") || message.includes("device busy") || message.includes("could not start")) {
		return "busy";
	}

	if (message.includes("unsupported") || message.includes("secure context")) {
		return "unsupported";
	}

	return "unknown";
}

export function getMicrophonePermissionDialogContent(issue: MicrophoneAccessIssue): MicrophonePermissionDialogContent {
	switch (issue) {
		case "denied":
			return {
				eyebrow: "Permission required",
				title: "Allow microphone access",
				copy: "BuddyWriter needs OS microphone access before it can start dictation. If you denied it earlier, the system prompt will not appear again until you re-enable the app in your privacy settings.",
				note: "On macOS, if BuddyWriter was previously denied access, reopen the app after enabling the microphone.",
				primaryAction: "open-settings",
				primaryLabel: "Open System Settings",
				secondaryLabel: "Not now",
			};
		case "missing-device":
			return {
				eyebrow: "Microphone unavailable",
				title: "No microphone is available",
				copy: "BuddyWriter could not find a usable microphone. Connect or enable one, then try again.",
				primaryAction: "retry",
				primaryLabel: "Try again",
				secondaryLabel: "Close",
			};
		case "busy":
			return {
				eyebrow: "Microphone unavailable",
				title: "The microphone is busy",
				copy: "Another app may already be using the microphone. Close the other app or switch inputs, then try again.",
				primaryAction: "retry",
				primaryLabel: "Try again",
				secondaryLabel: "Close",
			};
		case "unsupported":
			return {
				eyebrow: "Microphone unavailable",
				title: "Microphone access is unavailable",
				copy: "BuddyWriter could not start microphone capture in this environment. Check your desktop privacy settings, then try again.",
				primaryAction: "retry",
				primaryLabel: "Try again",
				secondaryLabel: "Close",
			};
		case "unknown":
		default:
			return {
				eyebrow: "Microphone unavailable",
				title: "BuddyWriter could not start the microphone",
				copy: "Check microphone access in your system settings, then try again.",
				primaryAction: "retry",
				primaryLabel: "Try again",
				secondaryLabel: "Close",
			};
	}
}

export function getMicrophoneAccessStatusMessage(issue: MicrophoneAccessIssue): string {
	switch (issue) {
		case "denied":
			return "Enable microphone access to use dictation.";
		case "missing-device":
			return "No microphone is available.";
		case "busy":
			return "The microphone is already in use.";
		case "unsupported":
			return "Microphone access is unavailable in this environment.";
		case "unknown":
		default:
			return "BuddyWriter could not start the microphone.";
	}
}
