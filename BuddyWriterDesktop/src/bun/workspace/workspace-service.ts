import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	statSync,
	writeFileSync,
} from "fs";
import { basename, dirname, extname, join, normalize, relative, resolve, sep } from "path";
import type { WorkspaceDocument, WorkspaceMetadata, WorkspaceState, WorkspaceTreeEntry } from "../../shared/models/workspace";
import type { SettingsRepository } from "../services/settings-repository";

export type WorkspaceService = ReturnType<typeof createWorkspaceService>;

function readJsonFile<T>(path: string): T | null {
	try {
		if (!existsSync(path)) return null;
		return JSON.parse(readFileSync(path, "utf-8")) as T;
	} catch {
		return null;
	}
}

export function ensureDir(path: string): void {
	if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export function writeTextFileAtomic(path: string, value: string): void {
	ensureDir(dirname(path));
	const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(tempPath, value, "utf-8");
	renameSync(tempPath, path);
}

export function isInsideWorkspace(workspacePath: string, candidatePath: string): boolean {
	const rootPath = resolve(workspacePath);
	const resolvedCandidate = resolve(candidatePath);
	return resolvedCandidate === rootPath || resolvedCandidate.startsWith(`${rootPath}${sep}`);
}

export function resolveWorkspaceRelativePath(workspacePath: string, relativePath = ""): string {
	const rootPath = resolve(workspacePath);
	const resolvedPath = resolve(rootPath, relativePath);
	if (!isInsideWorkspace(rootPath, resolvedPath)) {
		throw new Error("Path is outside the current workspace.");
	}
	return resolvedPath;
}

export function workspaceRelativePath(workspacePath: string, absolutePath: string): string {
	const rootPath = resolve(workspacePath);
	const resolvedPath = resolve(absolutePath);
	if (!isInsideWorkspace(rootPath, resolvedPath)) {
		throw new Error("Path is outside the current workspace.");
	}
	return relative(rootPath, resolvedPath).replaceAll("\\", "/");
}

export function sanitizeEntryName(name: string, fallback: string, kind: "file" | "directory"): string {
	const leaf = name.trim().replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? "";
	const collapsed = leaf.replace(/[<>:"|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
	let safeName = collapsed.replace(/^\.+/, "").trim() || fallback;

	if (kind === "file" && extname(safeName).toLowerCase() !== ".md") {
		safeName = `${safeName}.md`;
	}

	return safeName;
}

export function sortWorkspaceEntries(names: string[]): string[] {
	return names.sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
}

export function normalizeWorkspaceDocumentLabels(labels: string[]): string[] {
	return Array.from(new Set(labels
		.map((label) => label.trim().replace(/\s+/g, " "))
		.filter(Boolean)))
		.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

export function getDocumentParentRelativePath(relativePath: string): string {
	const parentRelativePath = dirname(relativePath).replaceAll("\\", "/");
	return parentRelativePath === "." ? "" : parentRelativePath;
}

export function isArchivedDocumentPath(relativePath: string): boolean {
	return relativePath === "Archive" || relativePath.startsWith("Archive/");
}

export function getDocumentProjectRelativePath(relativePath: string): string | null {
	if (!(relativePath === "Projects" || relativePath.startsWith("Projects/"))) {
		return null;
	}

	const parentRelativePath = getDocumentParentRelativePath(relativePath);
	return parentRelativePath === "Projects" ? "Projects" : parentRelativePath;
}

export function ensureUniquePath(parentDir: string, requestedName: string, kind: "file" | "directory"): string {
	const extension = kind === "file" ? extname(requestedName) : "";
	const stem = kind === "file" ? basename(requestedName, extension) : requestedName;
	let counter = 1;
	let candidate = requestedName;

	while (existsSync(join(parentDir, candidate))) {
		counter += 1;
		candidate = kind === "file" ? `${stem} ${counter}${extension}` : `${stem} ${counter}`;
	}

	return candidate;
}

export function createWorkspaceService(options: { settingsRepository: SettingsRepository }) {
	const { settingsRepository } = options;

	function getWorkspaceMetaDir(workspacePath: string): string {
		return join(workspacePath, ".buddywriter");
	}

	function getWorkspaceMetadataPath(workspacePath: string): string {
		return join(getWorkspaceMetaDir(workspacePath), "workspace.json");
	}

	function ensureWorkspaceStructure(workspacePath: string): void {
		const normalizedWorkspacePath = settingsRepository.normalizeWorkspaceRootPath(workspacePath);
		[
			normalizedWorkspacePath,
			join(normalizedWorkspacePath, "Inbox"),
			join(normalizedWorkspacePath, "Projects"),
			join(normalizedWorkspacePath, "Archive"),
			getWorkspaceMetaDir(normalizedWorkspacePath),
		].forEach(ensureDir);

		const defaultNotePath = join(normalizedWorkspacePath, "Inbox", "Untitled.md");
		if (!existsSync(defaultNotePath)) {
			writeTextFileAtomic(defaultNotePath, "");
		}
	}

	function readWorkspaceMetadata(workspacePath: string): WorkspaceMetadata {
		const metadata = readJsonFile<WorkspaceMetadata>(getWorkspaceMetadataPath(workspacePath));
		return {
			lastOpenDocument: metadata?.lastOpenDocument ?? null,
			documents: metadata?.documents ?? {},
		};
	}

	function writeWorkspaceMetadata(workspacePath: string, metadata: WorkspaceMetadata): void {
		ensureDir(dirname(getWorkspaceMetadataPath(workspacePath)));
		writeFileSync(getWorkspaceMetadataPath(workspacePath), JSON.stringify(metadata, null, 2));
	}

	function getWorkspaceDocumentMetadata(workspacePath: string, relativePath: string) {
		const metadata = readWorkspaceMetadata(workspacePath);
		return {
			metadata,
			documentMetadata: metadata.documents[relativePath] ?? { labels: [] },
		};
	}

	function setWorkspaceDocumentMetadata(
		workspacePath: string,
		relativePath: string,
		documentMetadata: { labels?: string[] },
	): WorkspaceMetadata {
		const metadata = readWorkspaceMetadata(workspacePath);
		const previous = metadata.documents[relativePath] ?? { labels: [] };
		const next = {
			labels: normalizeWorkspaceDocumentLabels(documentMetadata.labels ?? previous.labels),
		};

		if (next.labels.length > 0) {
			metadata.documents[relativePath] = next;
		} else {
			delete metadata.documents[relativePath];
		}

		writeWorkspaceMetadata(workspacePath, metadata);
		return metadata;
	}

	function remapWorkspaceDocumentMetadataPath(
		workspacePath: string,
		previousRelativePath: string,
		nextRelativePath: string,
	): WorkspaceMetadata {
		const metadata = readWorkspaceMetadata(workspacePath);
		if (previousRelativePath === nextRelativePath) return metadata;

		const previousDocumentMetadata = metadata.documents[previousRelativePath];
		if (previousDocumentMetadata) {
			metadata.documents[nextRelativePath] = previousDocumentMetadata;
			delete metadata.documents[previousRelativePath];
		}

		if (metadata.lastOpenDocument === previousRelativePath) {
			metadata.lastOpenDocument = nextRelativePath;
		}

		writeWorkspaceMetadata(workspacePath, metadata);
		return metadata;
	}

	function listWorkspaceTree(workspacePath: string, relativeDir = ""): WorkspaceTreeEntry[] {
		const absoluteDir = resolveWorkspaceRelativePath(workspacePath, relativeDir);
		const names = sortWorkspaceEntries(readdirSync(absoluteDir).filter((name) => name !== ".buddywriter" && !name.startsWith(".")));
		const directories: WorkspaceTreeEntry[] = [];
		const files: WorkspaceTreeEntry[] = [];

		for (const name of names) {
			const relativePath = relativeDir ? `${relativeDir}/${name}` : name;
			const absolutePath = resolveWorkspaceRelativePath(workspacePath, relativePath);
			const stats = statSync(absolutePath);

			if (stats.isDirectory()) {
				directories.push({
					kind: "directory",
					name,
					relativePath,
					children: listWorkspaceTree(workspacePath, relativePath),
				});
				continue;
			}

			if (stats.isFile() && extname(name).toLowerCase() === ".md") {
				files.push({
					kind: "file",
					name,
					relativePath,
				});
			}
		}

		return [...directories, ...files];
	}

	function findFirstDocument(entries: WorkspaceTreeEntry[]): string | null {
		for (const entry of entries) {
			if (entry.kind === "file") return entry.relativePath;
			const nested = findFirstDocument(entry.children ?? []);
			if (nested) return nested;
		}
		return null;
	}

	function getDocumentResponse(workspacePath: string, relativePath: string): WorkspaceDocument {
		const absolutePath = resolveWorkspaceRelativePath(workspacePath, relativePath);
		if (!existsSync(absolutePath) || statSync(absolutePath).isDirectory() || extname(absolutePath).toLowerCase() !== ".md") {
			throw new Error("Document not found.");
		}

		const { documentMetadata } = getWorkspaceDocumentMetadata(workspacePath, relativePath);
		return {
			relativePath,
			name: basename(relativePath),
			title: basename(relativePath, extname(relativePath)),
			content: readFileSync(absolutePath, "utf-8"),
			labels: documentMetadata.labels,
			parentRelativePath: getDocumentParentRelativePath(relativePath),
			isArchived: isArchivedDocumentPath(relativePath),
			projectRelativePath: getDocumentProjectRelativePath(relativePath),
		};
	}

	function moveWorkspaceDocumentToTarget(
		workspacePath: string,
		currentRelativePath: string,
		targetParentRelativePath: string,
		requestedName?: string,
	): string {
		const normalizedCurrentRelativePath = normalize(currentRelativePath).replaceAll("\\", "/");
		const absoluteCurrentPath = resolveWorkspaceRelativePath(workspacePath, normalizedCurrentRelativePath);
		if (!existsSync(absoluteCurrentPath) || statSync(absoluteCurrentPath).isDirectory() || extname(absoluteCurrentPath).toLowerCase() !== ".md") {
			throw new Error("Document not found.");
		}

		const normalizedTargetParentRelativePath = targetParentRelativePath.trim()
			? normalize(targetParentRelativePath).replaceAll("\\", "/")
			: "";
		const absoluteTargetPath = resolveWorkspaceRelativePath(workspacePath, normalizedTargetParentRelativePath);
		const targetParentDir = existsSync(absoluteTargetPath) && statSync(absoluteTargetPath).isDirectory()
			? absoluteTargetPath
			: dirname(absoluteTargetPath);
		const safeName = sanitizeEntryName(requestedName ?? basename(normalizedCurrentRelativePath), basename(normalizedCurrentRelativePath), "file");
		const uniqueName =
			resolve(targetParentDir, safeName) === absoluteCurrentPath
				? basename(absoluteCurrentPath)
				: ensureUniquePath(targetParentDir, safeName, "file");
		const absoluteNextPath = join(targetParentDir, uniqueName);
		const nextRelativePath = workspaceRelativePath(workspacePath, absoluteNextPath);

		if (absoluteNextPath !== absoluteCurrentPath) {
			renameSync(absoluteCurrentPath, absoluteNextPath);
		}

		remapWorkspaceDocumentMetadataPath(workspacePath, normalizedCurrentRelativePath, nextRelativePath);
		return nextRelativePath;
	}

	function getWorkspaceState(workspacePath = settingsRepository.getSettings().workspacePath): WorkspaceState {
		const normalizedWorkspacePath = settingsRepository.normalizeWorkspaceRootPath(workspacePath);
		ensureWorkspaceStructure(normalizedWorkspacePath);
		const tree = listWorkspaceTree(normalizedWorkspacePath);
		const metadata = readWorkspaceMetadata(normalizedWorkspacePath);
		let activeDocumentPath = metadata.lastOpenDocument;

		if (activeDocumentPath) {
			try {
				const candidatePath = resolveWorkspaceRelativePath(normalizedWorkspacePath, activeDocumentPath);
				if (!existsSync(candidatePath) || statSync(candidatePath).isDirectory() || extname(candidatePath).toLowerCase() !== ".md") {
					activeDocumentPath = null;
				}
			} catch {
				activeDocumentPath = null;
			}
		}

		if (!activeDocumentPath) {
			activeDocumentPath = findFirstDocument(tree);
		}

		if (!activeDocumentPath) {
			const fallbackPath = "Inbox/Untitled.md";
			writeTextFileAtomic(resolveWorkspaceRelativePath(normalizedWorkspacePath, fallbackPath), "");
			activeDocumentPath = fallbackPath;
		}

		if (metadata.lastOpenDocument !== activeDocumentPath) {
			writeWorkspaceMetadata(normalizedWorkspacePath, { ...metadata, lastOpenDocument: activeDocumentPath });
		}

		return {
			workspacePath: normalizedWorkspacePath,
			tree,
			activeDocument: activeDocumentPath ? getDocumentResponse(normalizedWorkspacePath, activeDocumentPath) : null,
		};
	}

	function setWorkspacePath(workspacePath: string): WorkspaceState {
		const normalizedWorkspacePath = settingsRepository.normalizeWorkspaceRootPath(workspacePath);
		ensureWorkspaceStructure(normalizedWorkspacePath);
		settingsRepository.getSettings().workspacePath = normalizedWorkspacePath;
		settingsRepository.saveSettingsToDisk();
		return getWorkspaceState(normalizedWorkspacePath);
	}

	function openWorkspaceDocument(relativePath: string): WorkspaceDocument {
		const workspacePath = settingsRepository.normalizeWorkspaceRootPath(settingsRepository.getSettings().workspacePath);
		ensureWorkspaceStructure(workspacePath);
		const document = getDocumentResponse(workspacePath, normalize(relativePath).replaceAll("\\", "/"));
		writeWorkspaceMetadata(workspacePath, {
			...readWorkspaceMetadata(workspacePath),
			lastOpenDocument: document.relativePath,
		});
		return document;
	}

	function saveWorkspaceDocument(relativePath: string, content: string): { success: boolean; savedAt: string } {
		const workspacePath = settingsRepository.normalizeWorkspaceRootPath(settingsRepository.getSettings().workspacePath);
		const normalizedRelativePath = normalize(relativePath).replaceAll("\\", "/");
		const absolutePath = resolveWorkspaceRelativePath(workspacePath, normalizedRelativePath);
		if (extname(absolutePath).toLowerCase() !== ".md") {
			throw new Error("Only Markdown documents can be saved.");
		}
		if (!existsSync(absolutePath) || statSync(absolutePath).isDirectory()) {
			throw new Error("Document not found.");
		}

		writeTextFileAtomic(absolutePath, content);
		writeWorkspaceMetadata(workspacePath, {
			...readWorkspaceMetadata(workspacePath),
			lastOpenDocument: normalizedRelativePath,
		});
		return { success: true, savedAt: new Date().toISOString() };
	}

	function createWorkspaceDocument(parentRelativePath?: string, requestedName?: string): WorkspaceState {
		const workspacePath = settingsRepository.normalizeWorkspaceRootPath(settingsRepository.getSettings().workspacePath);
		ensureWorkspaceStructure(workspacePath);
		const baseRelativePath = parentRelativePath?.trim() ? normalize(parentRelativePath).replaceAll("\\", "/") : "Inbox";
		const requestedAbsolutePath = resolveWorkspaceRelativePath(workspacePath, baseRelativePath);
		const parentDir = existsSync(requestedAbsolutePath) && statSync(requestedAbsolutePath).isDirectory()
			? requestedAbsolutePath
			: dirname(requestedAbsolutePath);
		const safeName = sanitizeEntryName(requestedName ?? "Untitled", "Untitled", "file");
		const uniqueName = ensureUniquePath(parentDir, safeName, "file");
		const filePath = join(parentDir, uniqueName);
		writeTextFileAtomic(filePath, "");
		const relativePath = workspaceRelativePath(workspacePath, filePath);
		writeWorkspaceMetadata(workspacePath, {
			...readWorkspaceMetadata(workspacePath),
			lastOpenDocument: relativePath,
		});
		return getWorkspaceState(workspacePath);
	}

	function createWorkspaceFolder(parentRelativePath?: string, requestedName?: string): WorkspaceState {
		const workspacePath = settingsRepository.normalizeWorkspaceRootPath(settingsRepository.getSettings().workspacePath);
		ensureWorkspaceStructure(workspacePath);
		const baseRelativePath = parentRelativePath?.trim() ? normalize(parentRelativePath).replaceAll("\\", "/") : "Projects";
		const requestedAbsolutePath = resolveWorkspaceRelativePath(workspacePath, baseRelativePath);
		const parentDir = existsSync(requestedAbsolutePath) && statSync(requestedAbsolutePath).isDirectory()
			? requestedAbsolutePath
			: dirname(requestedAbsolutePath);
		const safeName = sanitizeEntryName(requestedName ?? "New Folder", "New Folder", "directory");
		const uniqueName = ensureUniquePath(parentDir, safeName, "directory");
		ensureDir(join(parentDir, uniqueName));
		return getWorkspaceState(workspacePath);
	}

	function renameWorkspaceDocument(relativePath: string, title: string): WorkspaceState {
		const workspacePath = settingsRepository.normalizeWorkspaceRootPath(settingsRepository.getSettings().workspacePath);
		ensureWorkspaceStructure(workspacePath);
		const normalizedRelativePath = normalize(relativePath).replaceAll("\\", "/");
		const nextRelativePath = moveWorkspaceDocumentToTarget(
			workspacePath,
			normalizedRelativePath,
			getDocumentParentRelativePath(normalizedRelativePath),
			title,
		);
		writeWorkspaceMetadata(workspacePath, {
			...readWorkspaceMetadata(workspacePath),
			lastOpenDocument: nextRelativePath,
		});
		return getWorkspaceState(workspacePath);
	}

	function moveWorkspaceDocument(relativePath: string, targetParentRelativePath: string): WorkspaceState {
		const workspacePath = settingsRepository.normalizeWorkspaceRootPath(settingsRepository.getSettings().workspacePath);
		ensureWorkspaceStructure(workspacePath);
		const nextRelativePath = moveWorkspaceDocumentToTarget(workspacePath, relativePath, targetParentRelativePath);
		writeWorkspaceMetadata(workspacePath, {
			...readWorkspaceMetadata(workspacePath),
			lastOpenDocument: nextRelativePath,
		});
		return getWorkspaceState(workspacePath);
	}

	function archiveWorkspaceDocument(relativePath: string, archived: boolean): WorkspaceState {
		return moveWorkspaceDocument(relativePath, archived ? "Archive" : "Inbox");
	}

	function setWorkspaceDocumentLabels(relativePath: string, labels: string[]): WorkspaceState {
		const workspacePath = settingsRepository.normalizeWorkspaceRootPath(settingsRepository.getSettings().workspacePath);
		ensureWorkspaceStructure(workspacePath);
		const normalizedRelativePath = normalize(relativePath).replaceAll("\\", "/");
		setWorkspaceDocumentMetadata(workspacePath, normalizedRelativePath, { labels });
		writeWorkspaceMetadata(workspacePath, {
			...readWorkspaceMetadata(workspacePath),
			lastOpenDocument: normalizedRelativePath,
		});
		return getWorkspaceState(workspacePath);
	}

	return {
		archiveWorkspaceDocument,
		createWorkspaceDocument,
		createWorkspaceFolder,
		ensureWorkspaceStructure,
		getWorkspaceState,
		moveWorkspaceDocument,
		openWorkspaceDocument,
		readWorkspaceMetadata,
		renameWorkspaceDocument,
		saveWorkspaceDocument,
		setWorkspaceDocumentLabels,
		setWorkspacePath,
		writeWorkspaceMetadata,
	};
}
