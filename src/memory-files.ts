import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs"
import { join } from "node:path"

export const memoryCoreLimit = 12_000

// Restrict memory operations to regular workspace notes, never symlink targets.
export const memoryFilePath = (workspace: string, file: string) => {
	const parts = file.split("/")
	if (
		(file !== "MEMORY.qmd" &&
			(!file.startsWith("memory/") || !/\.(md|qmd)$/.test(file))) ||
		parts.some(
			(part) => !part || part.startsWith(".") || /[\\\\\0]/.test(part)
		)
	)
		throw new Error(
			"Use MEMORY.qmd or memory/<topic>.md; no hidden paths or traversal."
		)
	let path = realpathSync(workspace)
	for (const [index, part] of parts.entries()) {
		path = join(path, part)
		const stat = lstatSync(path, { throwIfNoEntry: false })
		if (!stat) continue
		if (
			stat.isSymbolicLink() ||
			(index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())
		)
			throw new Error(
				`Memory path must be a regular file without symlinks: ${file}`
			)
	}
	return path
}

export const memoryHash = (content: string) =>
	createHash("sha256").update(content).digest("hex")

export const memorySnapshot = (workspace: string) => {
	const files = [
		"MEMORY.qmd",
		...new Bun.Glob("memory/**/*.{md,qmd}").scanSync({
			cwd: workspace,
			onlyFiles: true,
			followSymlinks: false
		})
	].filter((file) => !file.startsWith("memory/_archive/"))
	const reviewedPath = join(workspace, ".internal", "memory-reviewed.json")
	const reviewed = existsSync(reviewedPath)
		? JSON.parse(readFileSync(reviewedPath, "utf8"))
		: {}
	const current = [...new Set(files)].sort().map((file) => {
		const path = memoryFilePath(workspace, file)
		const content = existsSync(path) ? readFileSync(path, "utf8") : null
		return {
			file,
			hash: content === null ? null : memoryHash(content),
			characters: content?.length ?? 0
		}
	})
	const pending = current.filter(({ file, hash }) => hash !== reviewed[file])
	for (const file of Object.keys(reviewed)) {
		if (!files.includes(file) && reviewed[file] !== null)
			pending.push({ file, hash: null, characters: 0 })
	}
	return { current, pending }
}

export const memoryContext = (workspace: string) => {
	const path = memoryFilePath(workspace, "MEMORY.qmd")
	const content = existsSync(path) ? readFileSync(path, "utf8") : ""
	if (content.length <= memoryCoreLimit) return { path, content }
	const preview = content.slice(0, memoryCoreLimit)
	return {
		path,
		content: `Memory core exceeds ${memoryCoreLimit} characters (${content.length}). Only a preview follows; the file is unchanged. Retrieve MEMORY.qmd with the memory read tool before relying on omitted identity/preferences. Move detail to linked memory/ topic notes, preserving the original facts.\n\n${preview.slice(0, preview.lastIndexOf("\n") > 0 ? preview.lastIndexOf("\n") : preview.length)}`
	}
}
