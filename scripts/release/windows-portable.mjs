import { execFile } from "node:child_process";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { run } from "./run.mjs";

const execFileAsync = promisify(execFile);

/** Windows ships bsdtar; its native ZIP writer is much faster than electron-builder's JS writer. */
export async function createWindowsPortableArchive(application, archive, requiredFiles) {
	if (process.platform !== "win32") throw new Error("Windows portable archives require Windows bsdtar");
	const systemRoot = process.env.SystemRoot || process.env.systemroot;
	if (!systemRoot) throw new Error("SystemRoot is required to locate Windows bsdtar");
	const tar = join(systemRoot, "System32", "tar.exe");
	await run(tar, ["-a", "-cf", archive, "-C", application, "."]);
	const { stdout } = await execFileAsync(tar, ["-tf", archive], {
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
	});
	const entries = new Set(stdout.split(/\r?\n/).map((entry) => entry.replace(/^\.\//, "")));
	for (const file of requiredFiles) {
		const entry = relative(application, file).split(sep).join("/");
		if (!entry || entry.startsWith("../") || entry === ".." || !entries.has(entry))
			throw new Error(`Windows portable archive is missing ${entry || file}`);
	}
}
