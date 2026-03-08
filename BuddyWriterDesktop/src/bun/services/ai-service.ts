import { GRAMMAR_PORT, MLX_PORT } from "../config";
import type { SettingsRepository } from "./settings-repository";
import type { SidecarManager } from "../local-ai/sidecar-manager";

export type AIService = ReturnType<typeof createAIService>;

export function escapeMarkdownHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

export function createAIService(options: {
	settingsRepository: SettingsRepository;
	sidecarManager: SidecarManager;
}) {
	const { settingsRepository, sidecarManager } = options;

	async function callOpenRouter(systemPrompt: string, userMessage: string): Promise<string> {
		settingsRepository.syncOpenRouterKeyFromSecureStorage();
		const settings = settingsRepository.getSettings();
		if (!settings.openrouterKey.trim()) {
			throw new Error("OpenRouter API key is missing. Set OPENROUTER_API_KEY or enter a key in Settings.");
		}

		const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${settings.openrouterKey}`,
			},
			body: JSON.stringify({
				model: settings.openrouterModel,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userMessage },
				],
			}),
		});
		const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
		return data.choices?.[0]?.message?.content ?? "";
	}

	async function callLocalAI(systemPrompt: string, userMessage: string): Promise<string> {
		await sidecarManager.ensureLocalAIRuntimeReady();
		const settings = settingsRepository.getSettings();
		await sidecarManager.ensureTextServerReady(settings.localAI.textModelId);
		const response = await fetch(`http://127.0.0.1:${MLX_PORT}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userMessage },
				],
				max_tokens: 2048,
				temperature: 0.7,
			}),
		});
		const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
		return data.choices?.[0]?.message?.content ?? "";
	}

	async function callLocalAIGrammar(systemPrompt: string, userMessage: string): Promise<string> {
		await sidecarManager.ensureLocalAIRuntimeReady();
		const settings = settingsRepository.getSettings();
		await sidecarManager.ensureGrammarServerReady(settings.localAI.grammarModelId);
		const response = await fetch(`http://127.0.0.1:${GRAMMAR_PORT}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userMessage },
				],
				max_tokens: 512,
				temperature: 0.1,
			}),
		});
		const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
		return data.choices?.[0]?.message?.content ?? "";
	}

	async function callAI(systemPrompt: string, userMessage: string): Promise<string> {
		if (settingsRepository.getSettings().provider === "local") {
			return callLocalAI(systemPrompt, userMessage);
		}
		return callOpenRouter(systemPrompt, userMessage);
	}

	async function callAIGrammar(systemPrompt: string, userMessage: string): Promise<string> {
		if (settingsRepository.getSettings().provider === "local") {
			return callLocalAIGrammar(systemPrompt, userMessage);
		}
		return callOpenRouter(systemPrompt, userMessage);
	}

	return {
		callAI,
		callAIGrammar,
	};
}
