import type { WriterMenuCommand } from "../../shared/rpc/writer-contract";

type Listener = (command: WriterMenuCommand) => void;

class MenuCommandBus {
	private listeners = new Set<Listener>();

	emit(command: WriterMenuCommand): void {
		for (const listener of this.listeners) {
			listener(command);
		}
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
}

export const menuCommandBus = new MenuCommandBus();
