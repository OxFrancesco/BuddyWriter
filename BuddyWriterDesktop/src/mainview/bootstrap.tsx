import Electrobun, { Electroview } from "electrobun/view";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { menuCommandBus } from "./ipc/menu-command-bus";
import { setRPCClient, type WriterViewRPC } from "./rpc/client";

function emitMenuCommand(command: keyof WriterViewRPC["webview"]["messages"]): void {
	menuCommandBus.emit(command);
}

const rpc = Electroview.defineRPC<WriterViewRPC>({
	maxRequestTime: 180000,
	handlers: {
		requests: {},
		messages: {
			toggleZenMode: () => emitMenuCommand("toggleZenMode"),
			fixGrammar: () => emitMenuCommand("fixGrammar"),
			toggleAIChat: () => emitMenuCommand("toggleAIChat"),
			toggleMarkdown: () => emitMenuCommand("toggleMarkdown"),
			newDocument: () => emitMenuCommand("newDocument"),
			newFolder: () => emitMenuCommand("newFolder"),
			saveDocument: () => emitMenuCommand("saveDocument"),
			changeWorkspace: () => emitMenuCommand("changeWorkspace"),
			workspaceUpdated: () => emitMenuCommand("workspaceUpdated"),
		},
	},
});

const electrobun = new Electrobun.Electroview({ rpc });
setRPCClient(electrobun);

const container = document.getElementById("app-root");
if (!container) {
	throw new Error("BuddyWriter root element was not found.");
}

createRoot(container).render(<App />);
