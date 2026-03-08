import { spawnSync } from "bun";
import { OPENROUTER_KEYCHAIN_ACCOUNT, OPENROUTER_KEYCHAIN_SERVICE } from "../config";

type SecretStoreReadResult = {
	ok: boolean;
	supported: boolean;
	value: string;
	error?: string;
};

type SecretStoreWriteResult = {
	ok: boolean;
	supported: boolean;
	error?: string;
};

export type OpenRouterSecretStore = {
	load(): SecretStoreReadResult;
	save(value: string): SecretStoreWriteResult;
};

function decodeCommandOutput(output: string | Uint8Array | null | undefined): string {
	if (!output) return "";
	if (typeof output === "string") return output.trim();
	return new TextDecoder().decode(output).trim();
}

function hasCommand(command: string): boolean {
	const result = spawnSync({
		cmd: ["which", command],
		stdout: "pipe",
		stderr: "pipe",
	});

	return result.exitCode === 0;
}

function loadFromDarwin(): SecretStoreReadResult {
	const result = spawnSync({
		cmd: [
			"security",
			"find-generic-password",
			"-s",
			OPENROUTER_KEYCHAIN_SERVICE,
			"-a",
			OPENROUTER_KEYCHAIN_ACCOUNT,
			"-w",
		],
		stdout: "pipe",
		stderr: "pipe",
	});
	const stderr = decodeCommandOutput(result.stderr);

	if (result.exitCode === 0) {
		return { ok: true, supported: true, value: decodeCommandOutput(result.stdout) };
	}

	if (stderr.includes("could not be found")) {
		return { ok: true, supported: true, value: "" };
	}

	return {
		ok: false,
		supported: true,
		value: "",
		error: stderr || "Unable to read the OpenRouter API key from macOS Keychain.",
	};
}

function loadFromLinux(): SecretStoreReadResult {
	if (!hasCommand("secret-tool")) {
		return { ok: false, supported: false, value: "" };
	}

	const result = spawnSync({
		cmd: [
			"secret-tool",
			"lookup",
			"service",
			OPENROUTER_KEYCHAIN_SERVICE,
			"account",
			OPENROUTER_KEYCHAIN_ACCOUNT,
		],
		stdout: "pipe",
		stderr: "pipe",
	});
	const stderr = decodeCommandOutput(result.stderr);

	if (result.exitCode === 0) {
		return { ok: true, supported: true, value: decodeCommandOutput(result.stdout) };
	}

	if (result.exitCode === 1 && !stderr) {
		return { ok: true, supported: true, value: "" };
	}

	return {
		ok: false,
		supported: true,
		value: "",
		error: stderr || "Unable to read the OpenRouter API key from the system secret store.",
	};
}

function saveToDarwin(value: string): SecretStoreWriteResult {
	if (!value.trim()) {
		const deleteResult = spawnSync({
			cmd: [
				"security",
				"delete-generic-password",
				"-s",
				OPENROUTER_KEYCHAIN_SERVICE,
				"-a",
				OPENROUTER_KEYCHAIN_ACCOUNT,
			],
			stdout: "pipe",
			stderr: "pipe",
		});
		const stderr = decodeCommandOutput(deleteResult.stderr);
		if (deleteResult.exitCode === 0 || stderr.includes("could not be found")) {
			return { ok: true, supported: true };
		}

		return {
			ok: false,
			supported: true,
			error: stderr || "Unable to clear the OpenRouter API key from macOS Keychain.",
		};
	}

	const saveResult = spawnSync({
		cmd: [
			"security",
			"add-generic-password",
			"-U",
			"-s",
			OPENROUTER_KEYCHAIN_SERVICE,
			"-a",
			OPENROUTER_KEYCHAIN_ACCOUNT,
			"-w",
			value,
		],
		stdout: "pipe",
		stderr: "pipe",
	});
	const stderr = decodeCommandOutput(saveResult.stderr);

	if (saveResult.exitCode === 0) {
		return { ok: true, supported: true };
	}

	return {
		ok: false,
		supported: true,
		error: stderr || "Unable to store the OpenRouter API key in macOS Keychain.",
	};
}

function saveToLinux(value: string): SecretStoreWriteResult {
	if (!hasCommand("secret-tool")) {
		return { ok: false, supported: false, error: "Install `secret-tool` to persist the OpenRouter API key securely." };
	}

	if (!value.trim()) {
		const clearResult = spawnSync({
			cmd: [
				"secret-tool",
				"clear",
				"service",
				OPENROUTER_KEYCHAIN_SERVICE,
				"account",
				OPENROUTER_KEYCHAIN_ACCOUNT,
			],
			stdout: "pipe",
			stderr: "pipe",
		});
		const stderr = decodeCommandOutput(clearResult.stderr);

		if (clearResult.exitCode === 0 || clearResult.exitCode === 1) {
			return { ok: true, supported: true };
		}

		return {
			ok: false,
			supported: true,
			error: stderr || "Unable to clear the OpenRouter API key from the system secret store.",
		};
	}

	const saveResult = spawnSync({
		cmd: [
			"secret-tool",
			"store",
			"--label=BuddyWriter OpenRouter API Key",
			"service",
			OPENROUTER_KEYCHAIN_SERVICE,
			"account",
			OPENROUTER_KEYCHAIN_ACCOUNT,
		],
		stdin: new TextEncoder().encode(value),
		stdout: "pipe",
		stderr: "pipe",
	});
	const stderr = decodeCommandOutput(saveResult.stderr);

	if (saveResult.exitCode === 0) {
		return { ok: true, supported: true };
	}

	return {
		ok: false,
		supported: true,
		error: stderr || "Unable to store the OpenRouter API key in the system secret store.",
	};
}

export function createOpenRouterSecretStore(): OpenRouterSecretStore {
	return {
		load(): SecretStoreReadResult {
			switch (process.platform) {
				case "darwin":
					return loadFromDarwin();
				case "linux":
					return loadFromLinux();
				default:
					return { ok: false, supported: false, value: "" };
			}
		},
		save(value: string): SecretStoreWriteResult {
			switch (process.platform) {
				case "darwin":
					return saveToDarwin(value);
				case "linux":
					return saveToLinux(value);
				default:
					if (!value.trim()) {
						return { ok: true, supported: false };
					}

					return {
						ok: false,
						supported: false,
						error: "Secure API key persistence is not implemented on this platform yet.",
					};
			}
		},
	};
}
