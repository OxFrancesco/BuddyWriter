import { describe, expect, it } from "vitest";
import {
	classifyMicrophoneAccessError,
	getMicrophonePermissionDialogContent,
} from "./microphone-permissions";

describe("microphone permissions", () => {
	it("classifies denied microphone errors", () => {
		expect(classifyMicrophoneAccessError(new DOMException("Permission denied", "NotAllowedError"))).toBe("denied");
	});

	it("classifies missing microphone errors", () => {
		expect(classifyMicrophoneAccessError(new DOMException("No device found", "NotFoundError"))).toBe("missing-device");
	});

	it("classifies busy microphone errors", () => {
		expect(classifyMicrophoneAccessError(new DOMException("Could not start audio source", "NotReadableError"))).toBe("busy");
	});

	it("returns the system settings CTA for denied access", () => {
		expect(getMicrophonePermissionDialogContent("denied")).toMatchObject({
			primaryAction: "open-settings",
			primaryLabel: "Open System Settings",
		});
	});

	it("returns a retry CTA when the device is unavailable", () => {
		expect(getMicrophonePermissionDialogContent("missing-device")).toMatchObject({
			primaryAction: "retry",
			primaryLabel: "Try again",
		});
	});
});
