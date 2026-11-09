import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	createAgentSession,
	DefaultResourceLoader,
	type InlineExtension,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { parse } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { builtinExtensions, magicContextOwnsWindow } from "../src/project/builtin-extensions";
import { toBranchSessionMessages } from "../src/session/messages";
import {
	applyMagicContextEnv,
	normalizeHfEndpoint,
	readMagicContextHfEndpoint,
	readMagicContextModelSettings,
	writeMagicContextAgentModel,
	writeMagicContextHfEndpoint,
} from "../src/settings/magic-context";
import { makeChannelWatchExtension } from "../src/tools/channel-watch/extension";
import { ChannelWatcher } from "../src/tools/channel-watch/watcher";

const execFileAsync = promisify(execFile);

/**
 * Magic Context 集成冒烟：在真实 SDK 会话里加载 @cortexkit/pi-magic-context。
 * XDG_* 指向临时目录，扩展的配置/数据库/日志都落在这里，不碰用户的 ~/.config 与 ~/.local/share。
 */
const saved: Record<string, string | undefined> = {};
const ENV = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "MAGIC_CONTEXT_LOG_PATH", "HF_ENDPOINT"] as const;

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

async function loadSession(agentDir: string, cwd: string, root: string, extensions: InlineExtension[] = []) {
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		extensionFactories: [...extensions, ...builtinExtensions({ agentDir })],
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
			expect(magicContextOwnsWindow(extensionsResult)).toBe(true);
			const tools = session.getAllTools().map((tool) => tool.name);
			// 扩展核心工具：记忆检索/写入
			expect(tools.some((name) => name.startsWith("ctx_"))).toBe(true);
			console.log("magic-context tools:", tools.filter((name) => name.startsWith("ctx_")).join(", "));
		} finally {
			session.dispose();
		}
	});

	it("仅启用知识层时仍由 Percho 管理窗口", { timeout: 60_000 }, async () => {
		const { root, agentDir, cwd } = sandbox();
		writeFileSync(join(agentDir, "magic-context.json"), JSON.stringify({ enabled: true }));
		mkdirSync(join(root, "config", "cortexkit"), { recursive: true });
		writeFileSync(
			join(root, "config", "cortexkit", "magic-context.jsonc"),
			'{ "compaction": { "enabled": false } }',
		);
		const { session, extensionsResult } = await loadSession(agentDir, cwd, root);
		try {
			expect(extensionsResult.errors).toEqual([]);
			expect(extensionsResult.extensions.map((e) => e.path)).toContain("<inline:magic-context>");
			expect(magicContextOwnsWindow(extensionsResult)).toBe(false);
			const tools = session.getAllTools().map((tool) => tool.name);
			expect(tools).toContain("ctx_search");
			expect(tools).not.toContain("ctx_reduce");
		} finally {
			session.dispose();
		}
	});

	it("与频道扩展共同运行时，唤醒保留可查收路径且不附加记忆检索提示", { timeout: 60_000 }, async () => {
		const { root, agentDir, cwd } = sandbox();
		writeFileSync(join(agentDir, "magic-context.json"), JSON.stringify({ enabled: true }));
		const channel = makeChannelWatchExtension({
			agentDir,
			cwd,
			isEnabled: () => true,
			watcherFactory: (options) => new ChannelWatcher({ ...options, debounceMs: 20, pollIntervalMs: 20 }),
		});
		const { session, extensionsResult } = await loadSession(agentDir, cwd, root, [channel]);
		try {
			await session.bindExtensions({ mode: "rpc" });
			expect(extensionsResult.errors).toEqual([]);
			expect(extensionsResult.extensions.map((e) => e.path)).toEqual(
				expect.arrayContaining(["<inline:channel-watch>", "<inline:magic-context>"]),
			);
			const runner = (
				session as unknown as {
					_extensionRunner: {
						getToolDefinition: (
							name: string,
						) => { execute: (id: string, params: object) => Promise<unknown> } | undefined;
						emitContext: (messages: typeof session.messages) => Promise<typeof session.messages>;
					};
				}
			)._extensionRunner;
			const subscribe = runner.getToolDefinition("channel_subscribe");
			if (!subscribe) throw new Error("channel_subscribe missing");
			await subscribe.execute("subscribe", { topic: "review" });
			let wakeText = "";
			const off = session.subscribe((event) => {
				if (
					event.type === "message_end" &&
					event.message.role === "custom" &&
					event.message.customType === "channel-wake"
				) {
					wakeText = typeof event.message.content === "string" ? event.message.content : "";
				}
			});
			const file = join(cwd, ".local", "agent-work", "channel", "review", "MESSAGES.md");
			await mkdir(join(cwd, ".local", "agent-work", "channel", "review"), { recursive: true });
			await writeFile(file, "## review\n\nnew update\n");
			await vi.waitFor(() => expect(wakeText).toContain("[channel:review]"), { timeout: 5000 });
			off();
			await vi.waitFor(() => {
				expect(toBranchSessionMessages(session.sessionManager.getBranch())).toEqual(
					expect.arrayContaining([expect.objectContaining({ role: "channel-wake" })]),
				);
			});
			session.refreshContext();
			const output = await runner.emitContext([...session.messages]);
			const text = output
				.filter((message) => message.role === "custom" || message.role === "user")
				.map((message) =>
					typeof message.content === "string"
						? message.content
						: message.content
								.filter((part) => part.type === "text")
								.map((part) => part.text)
								.join(""),
				)
				.join("\n");
			expect(text).toContain("[channel:review] 有新消息");
			expect(text).toContain(".local/agent-work/channel/review/MESSAGES.md");
			expect(text).not.toContain("<ctx-search-hint>");
		} finally {
			session.dispose();
		}
	});

	it("WASM 注入不加载已排除的原生库，并保留文件缓存", { timeout: 30_000 }, async () => {
		const probe = fileURLToPath(new URL("./fixtures/magic-context-wasm-probe.cjs", import.meta.url));
		const { stdout } = await execFileAsync(process.execPath, [probe], { timeout: 30_000 });
		const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? "{}");
		expect(result).toEqual({ ok: true, nativeLoaded: false, fsCache: true });
	});
});

describe("Magic Context 嵌入模型镜像", () => {
	it("只接受 http(s) 绝对地址，去掉末尾斜杠，空串表示清除", () => {
		expect(normalizeHfEndpoint(" https://hf-mirror.com/ ")).toBe("https://hf-mirror.com");
		expect(normalizeHfEndpoint("")).toBe("");
		expect(() => normalizeHfEndpoint("hf-mirror.com")).toThrow();
		expect(() => normalizeHfEndpoint("file:///etc")).toThrow();
	});

	it("保存后写入 HF_ENDPOINT；清除时只撤销自己设的值", async () => {
		const { agentDir } = sandbox();
		delete process.env.HF_ENDPOINT;
		await writeMagicContextHfEndpoint(agentDir, "https://hf-mirror.com/");
		expect(readMagicContextHfEndpoint(agentDir)).toBe("https://hf-mirror.com");
		expect(process.env.HF_ENDPOINT).toBe("https://hf-mirror.com");
		await writeMagicContextHfEndpoint(agentDir, "");
		expect(readMagicContextHfEndpoint(agentDir)).toBe("");
		expect(process.env.HF_ENDPOINT).toBeUndefined();
	});

	it("未配置镜像时不覆盖用户自己的 HF_ENDPOINT", () => {
		const { agentDir } = sandbox();
		process.env.HF_ENDPOINT = "https://user.example";
		applyMagicContextEnv(agentDir);
		expect(process.env.HF_ENDPOINT).toBe("https://user.example");
	});
});

describe("Magic Context 后台角色模型", () => {
	it("保存模型时保留已有 JSONC 配置、注释和思考档位", async () => {
		const { root } = sandbox();
		const path = join(root, "config", "cortexkit", "magic-context.jsonc");
		mkdirSync(join(root, "config", "cortexkit"), { recursive: true });
		writeFileSync(
			path,
			`{
  // 保留这条用户注释
  "embedding": { "provider": "openai-compatible", "model": "Qwen/Qwen3-Embedding-8B" },
  "historian": { "pi": { "model": { "model": "deepseek/old", "thinking_level": "high" } } }
}\n`,
		);
		await writeMagicContextAgentModel("historian", "deepseek/deepseek-flash");
		await writeMagicContextAgentModel("dreamer", "anthropic/claude-haiku-4-5");
		const raw = readFileSync(path, "utf8");
		const document = parse(raw) as {
			embedding: { model: string };
			historian: { pi: { model: { model: string; thinking_level: string } } };
		};
		expect(readMagicContextModelSettings()).toEqual({
			historian: "deepseek/deepseek-flash",
			dreamer: "anthropic/claude-haiku-4-5",
		});
		expect(raw).toContain("保留这条用户注释");
		expect(document.embedding.model).toBe("Qwen/Qwen3-Embedding-8B");
		expect(document.historian.pi.model).toEqual({
			model: "deepseek/deepseek-flash",
			thinking_level: "high",
		});
	});

	it("并发保存不互相覆盖；禁用只移除对应角色", async () => {
		sandbox();
		await Promise.all([
			writeMagicContextAgentModel("historian", "deepseek/deepseek-flash"),
			writeMagicContextAgentModel("dreamer", "deepseek/deepseek-reasoner"),
		]);
		expect(readMagicContextModelSettings()).toEqual({
			historian: "deepseek/deepseek-flash",
			dreamer: "deepseek/deepseek-reasoner",
		});
		const saved = await writeMagicContextAgentModel("historian", null);
		expect(saved).toEqual({ historian: "", dreamer: "deepseek/deepseek-reasoner" });
	});

	it("拒绝非法模型引用和损坏配置", async () => {
		const { root } = sandbox();
		await expect(writeMagicContextAgentModel("historian", "missing-provider")).rejects.toThrow(
			"provider/modelId",
		);
		const path = join(root, "config", "cortexkit", "magic-context.jsonc");
		mkdirSync(join(root, "config", "cortexkit"), { recursive: true });
		writeFileSync(path, "{");
		await expect(writeMagicContextAgentModel("historian", "deepseek/deepseek-flash")).rejects.toThrow(
			"配置文件损坏",
		);
		expect(() => readMagicContextModelSettings()).toThrow("配置文件损坏");
	});
});
