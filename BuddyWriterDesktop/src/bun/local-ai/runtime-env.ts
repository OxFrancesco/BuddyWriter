import { existsSync } from "fs";
import { join } from "path";
import {
	localAIBinDir,
	localAICacheDir,
	localAIHFDir,
	localAIHFHubDir,
	localAIHomeDir,
	localAIPythonDir,
	localAIVenvDir,
} from "../config";

export function getLocalAIEnv(extra: Record<string, string> = {}): Record<string, string> {
	return {
		...process.env,
		HOME: localAIHomeDir,
		XDG_CACHE_HOME: localAICacheDir,
		HF_HOME: localAIHFDir,
		HUGGINGFACE_HUB_CACHE: localAIHFHubDir,
		TRANSFORMERS_CACHE: localAIHFHubDir,
		UV_PYTHON_INSTALL_DIR: localAIPythonDir,
		UV_CACHE_DIR: localAICacheDir,
		PATH: [localAIBinDir, join(localAIVenvDir, "bin"), process.env.PATH ?? ""].filter(Boolean).join(":"),
		...extra,
	};
}

export function getVenvPythonPath(): string {
	const python3Path = join(localAIVenvDir, "bin", "python3");
	if (existsSync(python3Path)) return python3Path;
	return join(localAIVenvDir, "bin", "python");
}

export function getUvPath(): string {
	return join(localAIBinDir, "uv");
}

export async function readStreamText(stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
	if (!stream) return "";
	return new Response(stream).text();
}
