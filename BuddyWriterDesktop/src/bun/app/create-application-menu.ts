import { ApplicationMenu } from "electrobun/bun";
import type { BrowserWindow } from "electrobun/bun";
import type { WriterRPC } from "../rpc/create-writer-rpc";

export function createApplicationMenu(win: BrowserWindow<WriterRPC>): void {
	ApplicationMenu.setApplicationMenu([
		{
			label: "BuddyWriter",
			submenu: [
				{ role: "about" },
				{ role: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "separator" },
				{ role: "quit" },
			],
		},
		{
			label: "File",
			submenu: [
				{
					label: "New Note",
					action: "new-document",
					accelerator: "CommandOrControl+N",
				},
				{
					label: "New Folder",
					action: "new-folder",
					accelerator: "CommandOrControl+Shift+N",
				},
				{ role: "separator" },
				{
					label: "Save",
					action: "save-document",
					accelerator: "CommandOrControl+S",
				},
				{
					label: "Set Workspace Folder",
					action: "change-workspace",
					accelerator: "CommandOrControl+Shift+O",
				},
			],
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ role: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" },
			],
		},
		{
			label: "View",
			submenu: [
				{
					label: "Zen Mode",
					action: "zen-mode",
					accelerator: "CommandOrControl+Shift+F",
				},
			],
		},
		{
			label: "AI",
			submenu: [
				{
					label: "Fix Grammar",
					action: "fix-grammar",
					accelerator: "CommandOrControl+G",
				},
				{
					label: "AI Chat",
					action: "ai-chat",
					accelerator: "CommandOrControl+Shift+A",
				},
				{
					label: "Toggle Markdown",
					action: "toggle-markdown",
					accelerator: "CommandOrControl+Shift+M",
				},
			],
		},
	]);

	ApplicationMenu.on("application-menu-clicked", (event) => {
		switch (event.data.action) {
			case "new-document":
				win.webview.rpc?.send.newDocument({});
				break;
			case "new-folder":
				win.webview.rpc?.send.newFolder({});
				break;
			case "save-document":
				win.webview.rpc?.send.saveDocument({});
				break;
			case "change-workspace":
				win.webview.rpc?.send.changeWorkspace({});
				break;
			case "zen-mode":
				win.webview.rpc?.send.toggleZenMode({});
				break;
			case "fix-grammar":
				win.webview.rpc?.send.fixGrammar({});
				break;
			case "ai-chat":
				win.webview.rpc?.send.toggleAIChat({});
				break;
			case "toggle-markdown":
				win.webview.rpc?.send.toggleMarkdown({});
				break;
		}
	});
}
