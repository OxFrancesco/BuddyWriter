declare module "electrobun" {
	export interface ElectrobunConfig {
		app?: {
			name?: string;
			identifier?: string;
			version?: string;
		};
		build?: {
			bun?: {
				entrypoint?: string;
			};
			views?: Record<string, { entrypoint?: string }>;
			copy?: Record<string, string>;
			watchIgnore?: string[];
			mac?: Record<string, unknown>;
			linux?: Record<string, unknown>;
			win?: Record<string, unknown>;
		};
	}
}

declare module "electrobun/bun" {
	type RequestMap<T> = T extends Record<string, { params: infer P; response: infer R }>
		? { [K in keyof T]: (params: T[K]["params"]) => Promise<T[K]["response"]> }
		: {};

	type MessageMap<T> = T extends Record<string, infer P>
		? { [K in keyof T]: (params: T[K]) => void }
		: {};

	type BunRequests<T> = T extends { bun: { requests: infer R } } ? RequestMap<R> : {};
	type WebviewMessages<T> = T extends { webview: { messages: infer M } } ? MessageMap<M> : {};

	export type RPCSchema<T> = T;

	export type RPCDefinition<T> = {
		__schema?: T;
	};

	export class BrowserView<T = unknown> {
		rpc?: {
			request: BunRequests<T>;
			send: WebviewMessages<T>;
		};
		static defineRPC<T>(config: unknown): RPCDefinition<T>;
		setNavigationRules(rules: string[]): void;
		loadURL(url: string): void;
		on(name: string, handler: (event: unknown) => void): void;
	}

	export class BrowserWindow<T = unknown> {
		id: number;
		webviewId: number;
		webview: BrowserView<T>;
		constructor(options?: {
			title?: string;
			url?: string;
			rpc?: RPCDefinition<T>;
			titleBarStyle?: "hidden" | "hiddenInset" | "default";
			frame?: {
				x?: number;
				y?: number;
				width?: number;
				height?: number;
			};
		});
	}

	export const ApplicationMenu: {
		setApplicationMenu(menu: unknown[]): void;
		on(name: string, handler: (event: any) => void): void;
	};

	export const Utils: {
		paths: {
			userData: string;
		};
	};
}

declare module "electrobun/view" {
	type RequestMap<T> = T extends Record<string, { params: infer P; response: infer R }>
		? { [K in keyof T]: (params: T[K]["params"]) => Promise<T[K]["response"]> }
		: {};

	type MessageMap<T> = T extends Record<string, infer P>
		? { [K in keyof T]: (params: T[K]) => void }
		: {};

	type BunRequests<T> = T extends { bun: { requests: infer R } } ? RequestMap<R> : {};
	type WebviewMessages<T> = T extends { webview: { messages: infer M } } ? MessageMap<M> : {};

	export type RPCDefinition<T> = {
		__schema?: T;
	};

	export class Electroview<T = unknown> {
		rpc?: {
			request: BunRequests<T>;
			send: WebviewMessages<T>;
		};
		constructor(options?: { rpc?: RPCDefinition<T> });
		static defineRPC<T>(config: unknown): RPCDefinition<T>;
	}

	const Electrobun: {
		Electroview: typeof Electroview;
	};

	export default Electrobun;
}
