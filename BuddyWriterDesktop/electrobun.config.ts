import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "BuddyWriter",
		identifier: "buddywriter.electrobun.dev",
		version: "0.0.1",
	},
	build: {
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		views: {
			mainview: {
				entrypoint: "src/mainview/index.ts",
			},
		},
		copy: {
			"src/mainview/index.html": "views/mainview/index.html",
			"src/mainview/index.css": "views/mainview/index.css",
			"src/bun/local_ai_catalog.json": "bun/local_ai_catalog.json",
			"src/bun/audio_stt_server.py": "bun/audio_stt_server.py",
			"src/bun/audio_tts_server.py": "bun/audio_tts_server.py",
			"src/bun/whisper_server.py": "bun/whisper_server.py",
		},
		mac: {
			bundleCEF: false,
			icons: "icon.iconset",
			entitlements: {
				"com.apple.security.device.audio-input":
					"BuddyWriter needs microphone access to record and transcribe your voice.",
			},
		},
		linux: {
			bundleCEF: false,
			icon: "public/logo.png",
		},
		win: {
			bundleCEF: false,
			icon: "public/logo.png",
		},
	},
} satisfies ElectrobunConfig;
