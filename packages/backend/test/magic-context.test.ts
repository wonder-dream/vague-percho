import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { builtinExtensions } from "../src/project/builtin-extensions";

/**
 * Magic Context 集成冒烟：在真实 SDK 会话里加载 @cortexkit/pi-magic-context。
 * XDG_* 指向临时目录，扩展的配置/数据库/日志都落在这里，不碰用户的 ~/.config 与 ~/.local/share。
 */
const saved: Record<string, string | undefined> = {};
const ENV = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "MAGIC_CONTEXT_LOG_PATH"] as const;

beforeEach(() => {
	for (const key of ENV) saved[key] = process.env[key];
});
afterEach(() => {
	for (const key of ENV) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
});

function sandbox() {
	const root = mkdtempSync(join(tmpdir(), "percho-mc-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	process.env.XDG_CONFIG_HOME = join(root, "config");
	process.env.XDG_DATA_HOME = join(root, "data");
	process.env.MAGIC_CONTEXT_LOG_PATH = join(root, "magic-context.log");
	return { root, agentDir, cwd };
}

async function loadSession(agentDir: string, cwd: string, root: string) {
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		extensionFactories: builtinExtensions({ agentDir }),
	});
	await loader.reload();
	return createAgentSession({
		cwd,
		agentDir,
		sessionManager: SessionManager.create(cwd, join(root, "sessions")),
		settingsManager: SettingsManager.create(cwd, agentDir),
		resourceLoader: loader,
	});
}

describe("Magic Context 内置集成", () => {
	it("默认关闭：不进内置扩展列表", () => {
		const { agentDir } = sandbox();
		const names = builtinExtensions({ agentDir }).map((e) => (typeof e === "function" ? "?" : e.name));
		expect(names).not.toContain("magic-context");
	});

	it("开启后在真实 SDK 会话里加载并注册它的工具", { timeout: 60_000 }, async () => {
		const { root, agentDir, cwd } = sandbox();
		writeFileSync(join(agentDir, "magic-context.json"), JSON.stringify({ enabled: true }));
		const { session, extensionsResult } = await loadSession(agentDir, cwd, root);
		try {
			expect(extensionsResult.errors).toEqual([]);
			expect(extensionsResult.extensions.map((e) => e.path)).toContain("<inline:magic-context>");
			const tools = session.getAllTools().map((tool) => tool.name);
			// 扩展核心工具：记忆检索/写入
			expect(tools.some((name) => name.startsWith("ctx_"))).toBe(true);
			console.log("magic-context tools:", tools.filter((name) => name.startsWith("ctx_")).join(", "));
		} finally {
			session.dispose();
		}
	});
});