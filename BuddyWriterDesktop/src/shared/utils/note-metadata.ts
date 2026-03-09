export function normalizeDocumentTitle(title: string, fallback = ""): string {
	const normalizedTitle = title.trim().replace(/\s+/g, " ");
	return normalizedTitle || fallback;
}

export function normalizeDocumentLabels(labels: Iterable<string>): string[] {
	const uniqueLabels = new Map<string, string>();

	for (const label of labels) {
		const normalizedLabel = label.trim().replace(/\s+/g, " ").toLocaleLowerCase();
		if (!normalizedLabel) continue;
		uniqueLabels.set(normalizedLabel, normalizedLabel);
	}

	return Array.from(uniqueLabels.values())
		.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

export function parseDocumentLabelsInput(value: string): string[] {
	return normalizeDocumentLabels(value.split(","));
}
