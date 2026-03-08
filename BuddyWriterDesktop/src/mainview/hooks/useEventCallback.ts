import { useCallback, useLayoutEffect, useRef } from "react";

export function useEventCallback<T extends (...args: never[]) => unknown>(callback: T): T {
	const callbackRef = useRef(callback);

	useLayoutEffect(() => {
		callbackRef.current = callback;
	}, [callback]);

	return useCallback(((...args: Parameters<T>) => callbackRef.current(...args)) as T, []);
}
