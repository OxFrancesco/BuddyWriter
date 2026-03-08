export function encodeWav(chunks: Float32Array[], sampleRate: number): ArrayBuffer {
	const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const buffer = new ArrayBuffer(44 + length * 2);
	const view = new DataView(buffer);

	function writeString(offset: number, value: string): void {
		for (let index = 0; index < value.length; index += 1) {
			view.setUint8(offset + index, value.charCodeAt(index));
		}
	}

	writeString(0, "RIFF");
	view.setUint32(4, 36 + length * 2, true);
	writeString(8, "WAVE");
	writeString(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeString(36, "data");
	view.setUint32(40, length * 2, true);

	let offset = 44;
	for (const chunk of chunks) {
		for (let index = 0; index < chunk.length; index += 1) {
			const sample = Math.max(-1, Math.min(1, chunk[index]));
			view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
			offset += 2;
		}
	}

	return buffer;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const chunkSize = 0x8000;
	let binary = "";

	for (let index = 0; index < bytes.length; index += chunkSize) {
		const chunk = bytes.subarray(index, index + chunkSize);
		binary += String.fromCharCode(...chunk);
	}

	return btoa(binary);
}
