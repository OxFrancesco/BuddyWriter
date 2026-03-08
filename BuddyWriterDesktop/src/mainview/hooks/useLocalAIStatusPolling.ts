import { useEffect } from "react";

export function useLocalAIStatusPolling(enabled: boolean, refresh: () => Promise<unknown>, intervalMs = 1200): void {
	useEffect(() => {
		if (!enabled) return;

		const timer = window.setInterval(() => {
			void refresh();
		}, intervalMs);

		return () => {
			window.clearInterval(timer);
		};
	}, [enabled, intervalMs, refresh]);
}
