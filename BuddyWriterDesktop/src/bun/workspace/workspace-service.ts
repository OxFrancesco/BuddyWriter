import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "fs";
import matter from "gray-matter";
import { basename, dirname, extname, join, normalize, relative, resolve, sep } from "path";
import type { WorkspaceDocument, WorkspaceDocumentMetadata, WorkspaceMetadata, WorkspaceState, WorkspaceTreeEntry } from "../../shared/models/workspace";
import { normalizeDocumentLabels, normalizeDocumentTitle } from "../../shared/utils/note-metadata";
import type { SettingsRepository } from "../services/settings-repository";

export type WorkspaceService = ReturnType<typeof createWorkspaceService>;
type WorkspaceMetadataState = {
	lastOpenDocument: string | null;
	documents: Record<string, WorkspaceDocumentMetadata>;
};

type WorkspaceDocumentSource = {
	content: string;
	frontmatter: Record<string, unknown>;
	labels: string[];
	title: string;
};

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
	return normalizeDocumentLabels(labels);
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

function toFrontmatterRecord(data: unknown): Record<string, unknown> {
	if (!data || Array.isArray(data) || typeof data !== "object") {
		return {};
	}

	return { ...(data as Record<string, unknown>) };
}

function readWorkspaceDocumentSourceFromDisk(absolutePath: string, fallbackTitle: string): WorkspaceDocumentSource {
	const file = matter(readFileSync(absolutePath, "utf-8"));
	const frontmatter = toFrontmatterRecord(file.data);
	const title = normalizeDocumentTitle(typeof frontmatter.title === "string" ? frontmatter.title : "", fallbackTitle);
	const labels = normalizeWorkspaceDocumentLabels(
		Array.isArray(frontmatter.labels)
			? frontmatter.labels.filter((label): label is string => typeof label === "string")
			: [],
	);

	return {
		content: file.content,
		frontmatter,
		labels,
		title,
	};
}

function buildWorkspaceDocumentFrontmatter(
	frontmatter: Record<string, unknown>,
	title: string,
	labels: string[],
): Record<string, unknown> {
	const nextFrontmatter: Record<string, unknown> = {
		...frontmatter,
		title,
	};

	if (labels.length > 0) {
		nextFrontmatter.labels = labels;
	} else {
		delete nextFrontmatter.labels;
	}

	return nextFrontmatter;
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
	}

	function readWorkspaceMetadata(workspacePath: string): WorkspaceMetadataState {
		const metadata = readJsonFile<WorkspaceMetadata>(getWorkspaceMetadataPath(workspacePath));
		return {
			lastOpenDocument: metadata?.lastOpenDocument ?? null,
			documents: metadata?.documents ?? {},
		};
	}

	function writeWorkspaceMetadata(workspacePath: string, metadata: WorkspaceMetadataState): void {
		ensureDir(dirname(getWorkspaceMetadataPath(workspacePath)));
		const nextMetadata: WorkspaceMetadata = {
			lastOpenDocument: metadata.lastOpenDocument,
		};

		if (Object.keys(metadata.documents).length > 0) {
			nextMetadata.documents = metadata.documents;
		}

		writeFileSync(getWorkspaceMetadataPath(workspacePath), JSON.stringify(nextMetadata, null, 2));
	}

	function writeWorkspaceDocumentSource(
		absolutePath: string,
		frontmatter: Record<string, unknown>,
		content: string,
	): void {
		writeTextFileAtomic(absolutePath, matter.stringify(content, frontmatter));
	}

	function migrateLegacyWorkspaceMetadata(workspacePath: string): WorkspaceMetadataState {
		const metadata = readWorkspaceMetadata(workspacePath);
		const legacyEntries = Object.entries(metadata.documents);
		if (legacyEntries.length === 0) {
			return metadata;
		}

		const unresolvedDocuments: Record<string, WorkspaceDocumentMetadata> = {};
		let didChange = false;

		for (const [relativePath, documentMetadata] of legacyEntries) {
			const normalizedRelativePath = normalize(relativePath).replaceAll("\\", "/");

			let absolutePath: string;
			try {
				absolutePath = resolveWorkspaceRelativePath(workspacePath, normalizedRelativePath);
			} catch {
				didChange = true;
				continue;
			}

			if (!existsSync(absolutePath) || statSync(absolutePath).isDirectory() || extname(absolutePath).toLowerCase() !== ".md") {
				didChange = true;
				continue;
			}

			try {
				const fallbackTitle = basename(normalizedRelativePath, extname(normalizedRelativePath));
				const source = readWorkspaceDocumentSourceFromDisk(absolutePath, fallbackTitle);
				const labels = source.labels.length > 0
					? source.labels
					: normalizeWorkspaceDocumentLabels(documentMetadata.labels);
				const title = normalizeDocumentTitle(source.title, fallbackTitle);
				const nextFrontmatter = buildWorkspaceDocumentFrontmatter(source.frontmatter, title, labels);
				writeWorkspaceDocumentSource(absolutePath, nextFrontmatter, source.content);
				didChange = true;
			} catch {
				unresolvedDocuments[normalizedRelativePath] = {
					labels: normalizeWorkspaceDocumentLabels(documentMetadata.labels),
				};
			}
		}

		if (!didChange && Object.keys(unresolvedDocuments).length === legacyEntries.length) {
			return metadata;
		}

		const nextMetadata = {
			...metadata,
			documents: unresolvedDocuments,
		};
		writeWorkspaceMetadata(workspacePath, nextMetadata);
		return nextMetadata;
	}

	function prepareWorkspace(workspacePath: string): WorkspaceMetadataState {
		ensureWorkspaceStructure(workspacePath);
		return migrateLegacyWorkspaceMetadata(workspacePath);
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

		const fallbackTitle = basename(relativePath, extname(relativePath));
		const source = readWorkspaceDocumentSourceFromDisk(absolutePath, fallbackTitle);
		return {
			relativePath,
			name: basename(relativePath),
			title: source.title,
			content: source.content,
			labels: source.labels,
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
		const metadata = prepareWorkspace(normalizedWorkspacePath);
		purgeExpiredTrash(normalizedWorkspacePath);
		const tree = listWorkspaceTree(normalizedWorkspacePath);
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
		prepareWorkspace(normalizedWorkspacePath);
		settingsRepository.getSettings().workspacePath = normalizedWorkspacePath;
		settingsRepository.saveSettingsToDisk();
		return getWorkspaceState(normalizedWorkspacePath);
	}

	function openWorkspaceDocument(relativePath: string): WorkspaceDocument {
		const workspacePath = settingsRepository.normalizeWorkspaceRootPath(settingsRepository.getSettings().workspacePath);
		prepareWorkspace(workspacePath);
		const document = getDocumentResponse(workspacePath, normalize(relativePath).replaceAll("\\", "/"));
		writeWorkspaceMetadata(workspacePath, {
			...readWorkspaceMetadata(workspacePath),
			lastOpenDocument: document.relativePath,
		});
		return document;
	}

	function saveWorkspaceDocument(relativePath: string, content: string): { success: boolean; savedAt: string } {
		const workspacePath = settingsRepository.normalizeWorkspaceRootPath(settingsRepository.getSettings().workspacePath);
		prepareWorkspace(workspacePath);
		const normalizedRelativePath = normalize(relativePath).replaceAll("\\", "/");
		const absolutePath = resolveWorkspaceRelativePath(workspacePath, normalizedRelativePath);
		if (extname(absolutePath).toLowerCase() !== ".md") {
			throw new Error("Only Markdown documents can be saved.");
		}
		if (!existsSync(absolutePath) || statSync(absolutePath).isDirectory()) {
			throw new Error("Document not found.");
		}

		const fallbackTitle = basename(normalizedRelativePath, extname(normalizedRelativePath));
		const source = readWorkspaceDocumentSourceFromDisk(absolutePath, fallbackTitle);
		writeWorkspaceDocumentSource(
			absolutePath,
			buildWorkspaceDocumentFrontmatter(source.frontmatter, source.title, source.labels),
			content,
		);
		writeWorkspaceMetadata(workspacePath, {
			...readWorkspaceMetadata(workspacePath),
			lastOpenDocument: normalizedRelativePath,
		});
		return { success: true, savedAt: new Date().toISOString() };
	}

	function createWorkspaceDocument(parentRelativePath?: string, requestedName?: string): WorkspaceState {
		const workspacePath = settingsRepository.normalizeWorkspaceRootPath(settingsRepository.getSettings().workspacePath);
		prepareWorkspace(workspacePath);
		const baseRelativePath = parentRelativePath?.trim() ? normalize(parentRelativePath).replaceAll("\\", "/") : "Inbox";
		const requestedAbsolutePath = resolveWorkspaceRelativePath(workspacePath, baseRelativePath);
		const parentDir = existsSync(requestedAbsolutePath) && statSync(requestedAbsolutePath).isDirectory()
			? requestedAbsolutePath
			: dirname(requestedAbsolutePath);
		const safeName = sanitizeEntryName(requestedName ?? "Untitled", "Untitled", "file");
		const uniqueName = ensureUniquePath(parentDir, safeName, "file");
		const filePath = join(parentDir, uniqueName);
		const relativePath = workspaceRelativePath(workspacePath, filePath);
		const title = basename(relativePath, extname(relativePath));
		writeWorkspaceDocumentSource(filePath, buildWorkspaceDocumentFrontmatter({}, title, []), "");
		writeWorkspaceMetadata(workspacePath, {
			...readWorkspaceMetadata(workspacePath),
			lastOpenDocument: relativePath,
		});
		return getWorkspaceState(workspacePath);
	}

	function createWorkspaceFolder(parentRelativePath?: string, requestedName?: string): WorkspaceState {
		const workspacePath = settingsRepository.normalizeWorkspaceRootPath(settingsRepository.getSettings().workspacePath);
		prepareWorkspace(workspacePath);
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
		prepareWorkspace(workspacePath);
		const normalizedRelativePath = normalize(relativePath).replaceAll("\\", "/");
		const normalizedTitle = normalizeDocumentTitle(title);
		if (!normalizedTitle) {
			throw new Error("Document title cannot be empty.");
		}
		const absoluteCurrentPath = resolveWorkspaceRelativePath(workspacePath, normalizedRelativePath);
		const currentFallbackTitle = basename(normalizedRelativePath, extname(normalizedRelativePath));
		const source = readWorkspaceDocumentSourceFromDisk(absoluteCurrentPath, currentFallbackTitle);
		const nextRelativePath = moveWorkspaceDocumentToTarget(
			workspacePath,
			normalizedRelativePath,
			getDocumentParentRelativePath(normalizedRelativePath),
			normalizedTitle,
		);
		const absoluteNextPath = resolveWorkspaceRelativePath(workspacePath, nextRelativePath);
		const nextTitle = basename(nextRelativePath, extname(nextRelativePath));
		writeWorkspaceDocumentSource(
			absoluteNextPath,
			buildWorkspaceDocumentFrontmatter(source.frontmatter, nextTitle, source.labels),
			source.content,
		);
		writeWorkspaceMetadata(workspacePath, {
			...readWorkspaceMetadata(workspacePath),
			lastOpenDocument: nextRelativePath,
		});
		return getWorkspaceState(workspacePath);
	}

	function updateWorkspaceDocumentMetadata(
		relativePath: string,
		title: string,
		labels: string[],
		targetParentRelativePath: string,
	): WorkspaceState {
		const workspacePath = settingsRepository.normalizeWorkspaceRootPath(settingsRepository.getSettings().workspacePath);
		prepareWorkspace(workspacePath);
		const normalizedRelativePath = normalize(relativePath).replaceAll("\\", "/");
		const normalizedTitle = normalizeDocumentTitle(title);
		if (!normalizedTitle) {
			throw new Error("Document title cannot be empty.");
		}

		const normalizedTargetParentRelativePath = targetParentRelativePath.trim()
			? normalize(targetParentRelativePath).replaceAll("\\", "/")
			: "";
		const normalizedLabels = normalizeWorkspaceDocumentLabels(labels);
		const currentTitle = basename(normalizedRelativePath, extname(normalizedRelativePath));
		const currentParentRelativePath = getDocumentParentRelativePath(normalizedRelativePath);
		const absoluteCurrentPath = resolveWorkspaceRelativePath(workspacePath, normalizedRelativePath);
		const source = readWorkspaceDocumentSourceFromDisk(absoluteCurrentPath, currentTitle);
		const shouldMoveOrRename =
			normalizedTitle !== currentTitle
			|| normalizedTargetParentRelativePath !== currentParentRelativePath;

		const nextRelativePath = shouldMoveOrRename
			? moveWorkspaceDocumentToTarget(
				workspacePath,
				normalizedRelativePath,
				normalizedTargetParentRelativePath,
				normalizedTitle,
			)
			: normalizedRelativePath;

		const absoluteNextPath = resolveWorkspaceRelativePath(workspacePath, nextRelativePath);
		const nextTitle = basename(nextRelativePath, extname(nextRelativePath));
		writeWorkspaceDocumentSource(
			absoluteNextPath,
			buildWorkspaceDocumentFrontmatter(source.frontmatter, nextTitle, normalizedLabels),
			source.content,
		);
		writeWorkspaceMetadata(workspacePath, {
			...readWorkspaceMetadata(workspacePath),
			lastOpenDocument: nextRelativePath,
		});
		return getWorkspaceState(workspacePath);
	}

	function moveWorkspaceDocument(relativePath: string, targetParentRelativePath: string): WorkspaceState {
		const workspacePath = settingsRepository.normalizeWorkspaceRootPath(settingsRepository.getSettings().workspacePath);
		prepareWorkspace(workspacePath);
		const normalizedRelativePath = normalize(relativePath).replaceAll("\\", "/");
		const absoluteCurrentPath = resolveWorkspaceRelativePath(workspacePath, normalizedRelativePath);
		const currentTitle = basename(normalizedRelativePath, extname(normalizedRelativePath));
		const source = readWorkspaceDocumentSourceFromDisk(absoluteCurrentPath, currentTitle);
		const nextRelativePath = moveWorkspaceDocumentToTarget(workspacePath, normalizedRelativePath, targetParentRelativePath);
		const absoluteNextPath = resolveWorkspaceRelativePath(workspacePath, nextRelativePath);
		writeWorkspaceDocumentSource(
			absoluteNextPath,
			buildWorkspaceDocumentFrontmatter(source.frontmatter, source.title, source.labels),
			source.content,
		);
		writeWorkspaceMetadata(workspacePath, {
			...readWorkspaceMetadata(workspacePath),
			lastOpenDocument: nextRelativePath,
		});
		return getWorkspaceState(workspacePath);
	}

	function getTrashDir(workspacePath: string): string {
		return join(workspacePath, ".trash");
	}

	function purgeExpiredTrash(workspacePath: string): void {
		const trashDir = getTrashDir(workspacePath);
		if (!existsSync(trashDir)) return;

		const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
		const now = Date.now();
		const entries = readdirSync(trashDir);

		for (const name of entries) {
			const filePath = join(trashDir, name);
			try {
				const stats = statSync(filePath);
				if (stats.isFile() && now - stats.mtimeMs > thirtyDaysMs) {
					unlinkSync(filePath);
				}
			} catch {
				// skip files that can't be read
			}
		}
	}

	function deleteWorkspaceDocument(relativePath: string): WorkspaceState {
		const workspacePath = settingsRepository.normalizeWorkspaceRootPath(settingsRepository.getSettings().workspacePath);
		prepareWorkspace(workspacePath);
		const normalizedRelativePath = normalize(relativePath).replaceAll("\\", "/");
		const absolutePath = resolveWorkspaceRelativePath(workspacePath, normalizedRelativePath);
		if (!existsSync(absolutePath) || statSync(absolutePath).isDirectory() || extname(absolutePath).toLowerCase() !== ".md") {
			throw new Error("Document not found.");
		}

		const trashDir = getTrashDir(workspacePath);
		ensureDir(trashDir);
		const trashName = `${Date.now()}-${basename(normalizedRelativePath)}`;
		renameSync(absolutePath, join(trashDir, trashName));

		const metadata = readWorkspaceMetadata(workspacePath);
		delete metadata.documents[normalizedRelativePath];
		if (metadata.lastOpenDocument === normalizedRelativePath) {
			metadata.lastOpenDocument = null;
		}
		writeWorkspaceMetadata(workspacePath, metadata);
		return getWorkspaceState(workspacePath);
	}

	function archiveWorkspaceDocument(relativePath: string, archived: boolean): WorkspaceState {
		return moveWorkspaceDocument(relativePath, archived ? "Archive" : "Inbox");
	}

	function setWorkspaceDocumentLabels(relativePath: string, labels: string[]): WorkspaceState {
		const workspacePath = settingsRepository.normalizeWorkspaceRootPath(settingsRepository.getSettings().workspacePath);
		prepareWorkspace(workspacePath);
		const normalizedRelativePath = normalize(relativePath).replaceAll("\\", "/");
		const absolutePath = resolveWorkspaceRelativePath(workspacePath, normalizedRelativePath);
		if (!existsSync(absolutePath) || statSync(absolutePath).isDirectory() || extname(absolutePath).toLowerCase() !== ".md") {
			throw new Error("Document not found.");
		}

		const fallbackTitle = basename(normalizedRelativePath, extname(normalizedRelativePath));
		const source = readWorkspaceDocumentSourceFromDisk(absolutePath, fallbackTitle);
		writeWorkspaceDocumentSource(
			absolutePath,
			buildWorkspaceDocumentFrontmatter(
				source.frontmatter,
				source.title,
				normalizeWorkspaceDocumentLabels(labels),
			),
			source.content,
		);
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
		deleteWorkspaceDocument,
		ensureWorkspaceStructure,
		getWorkspaceState,
		moveWorkspaceDocument,
		openWorkspaceDocument,
		readWorkspaceMetadata,
		renameWorkspaceDocument,
		saveWorkspaceDocument,
		setWorkspaceDocumentLabels,
		setWorkspacePath,
		updateWorkspaceDocumentMetadata,
		writeWorkspaceMetadata,
	};
}
