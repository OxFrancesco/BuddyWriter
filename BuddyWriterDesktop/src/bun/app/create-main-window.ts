import { BrowserWindow, type RPCDefinition } from "electrobun/bun";
import type { WriterRPC } from "../rpc/create-writer-rpc";

const electrobunBridgeCompatPreload = `
if (window.__electrobunInternalBridge) {
	window.__electrobunEventBridge = window.__electrobunInternalBridge;
}
`;

export function createMainWindow(writerRPC: RPCDefinition<WriterRPC>): BrowserWindow<WriterRPC> {
	const win = new BrowserWindow<WriterRPC>({
		title: "BuddyWriter",
		url: "views://mainview/index.html",
		rpc: writerRPC,
		preload: electrobunBridgeCompatPreload,
		titleBarStyle: "hiddenInset",
		frame: {
			x: 200,
			y: 200,
			width: 1000,
			height: 700,
		},
	});

	win.webview.setNavigationRules([
		"^*",
		"views://mainview/*",
		"views://internal/*",
	]);

	return win;
}
