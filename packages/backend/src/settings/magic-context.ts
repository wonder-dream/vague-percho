import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MagicContextAgent, MagicContextModelSettings } from "@percho/shared";
import { applyEdits, modify, type ParseError, parse } from "jsonc-parser";
import { JsonStore } from "../json-store";

/**
 * Magic Context（@cortexkit/pi-magic-context）开关：存 agentDir/magic-context.json，缺省关闭。
 * 开启后会在后台调用模型（historian/dreamer）并在 ~/.local/share/cortexkit 落库，所以必须用户显式打开。
 * 扩展自身的细项配置走它的 magic-context.jsonc（CortexKit 共享目录）；设置页暴露的后台角色模型也由本模块读写。
 */
function store(agentDir: string) {
	return new JsonStore<{ enabled?: boolean; hfEndpoint?: string }>({
		path: join(agentDir, "magic-context.json"),
		defaultValue: () => ({}),
		parse: (raw) => {
			const value = JSON.parse(raw);
			if (!value || typeof value !== "object" || Array.isArray(value))
				throw new Error("Magic Context 配置必须是对象");
			return value;
		},
	});
}

export function readMagicContextEnabled(agentDir: string): boolean {
	return store(agentDir).readSync().enabled === true;
}

/** 嵌入模型下载镜像（写入 HF_ENDPOINT）；空 = 官方 huggingface.co */
export function readMagicContextHfEndpoint(agentDir: string): string {
	const value = store(agentDir).readSync().hfEndpoint;
	return typeof value === "string" ? value : "";
}

/** 只接受 http(s) 绝对地址；去掉末尾斜杠。空串 = 清除 */
export function normalizeHfEndpoint(input: string): string {
	const value = input.trim().replace(/\/+$/, "");
	if (!value) return "";
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("镜像地址必须是完整的 http(s) URL");
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("镜像地址必须是 http(s) URL");
	return value;
}

export async function writeMagicContextHfEndpoint(agentDir: string, endpoint: string): Promise<string> {
	const value = normalizeHfEndpoint(endpoint);
	await store(agentDir).update((draft) => {
		if (value) draft.hfEndpoint = value;
		else delete draft.hfEndpoint;
	});
	applyMagicContextEnv(agentDir);
	return value;
}

/**
 * 扩展从 process.env.HF_ENDPOINT 取下载源（嵌入 worker 子进程继承同一份 env）。
 * 只在配置了镜像时覆盖；未配置时保留用户自己设置的 HF_ENDPOINT，不主动删除。
 */
let appliedEndpoint: string | undefined;
export function applyMagicContextEnv(agentDir: string): void {
	const endpoint = readMagicContextHfEndpoint(agentDir);
	if (endpoint) {
		process.env.HF_ENDPOINT = endpoint;
		appliedEndpoint = endpoint;
	} else if (appliedEndpoint !== undefined && process.env.HF_ENDPOINT === appliedEndpoint) {
		delete process.env.HF_ENDPOINT;
		appliedEndpoint = undefined;
	}
}

export async function writeMagicContextEnabled(agentDir: string, enabled: boolean): Promise<void> {
	await store(agentDir).update((draft) => {
		draft.enabled = enabled;
	});
}

type MagicContextDocument = Record<string, unknown>;

function configPath(): string {
	const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
	return join(configHome, "cortexkit", "magic-context.jsonc");
}

function parseDocument(raw: string, path: string): MagicContextDocument {
	const errors: ParseError[] = [];
	const value: unknown = parse(raw, errors, { allowTrailingComma: true, disallowComments: false });
	if (errors.length > 0 || !value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Magic Context 配置文件损坏：${path}，请修复后重试`);
	}
	return value as MagicContextDocument;
}

function readDocument(): { path: string; value: MagicContextDocument } {
	const path = configPath();
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, value: {} };
		throw error;
	}
	return { path, value: parseDocument(raw, path) };
}

function objectValue(value: unknown): MagicContextDocument | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as MagicContextDocument) : null;
}

function readAgentModel(document: MagicContextDocument, agent: MagicContextAgent): string {
	const pi = objectValue(objectValue(document[agent])?.pi);
	const model = pi?.model;
	if (typeof model === "string") return model.trim();
	const objectModel = objectValue(model)?.model;
	return typeof objectModel === "string" ? objectModel.trim() : "";
}

function modelSettings(document: MagicContextDocument): MagicContextModelSettings {
	return {
		historian: readAgentModel(document, "historian"),
		dreamer: readAgentModel(document, "dreamer"),
	};
}

export function readMagicContextModelSettings(): MagicContextModelSettings {
	return modelSettings(readDocument().value);
}

function normalizeModelRef(modelRef: string | null): string {
	const value = modelRef?.trim() ?? "";
	if (!value) return "";
	const separator = value.indexOf("/");
	if (separator <= 0 || separator === value.length - 1) {
		throw new Error("Magic Context 模型必须使用 provider/modelId 格式");
	}
	return value;
}

/** 写用户级共享 JSONC；JsonStore 提供同路径串行读改写和原子替换，注释/其他字段由 jsonc-parser 保留。 */
export async function writeMagicContextAgentModel(
	agent: MagicContextAgent,
	modelRef: string | null,
): Promise<MagicContextModelSettings> {
	const value = normalizeModelRef(modelRef);
	const path = configPath();
	const textStore = new JsonStore<string>({
		path,
		defaultValue: () => "{}\n",
		parse: (raw) => {
			parseDocument(raw, path);
			return raw;
		},
		stringify: (raw) => raw,
	});
	let saved: MagicContextModelSettings | null = null;
	await textStore.update((raw) => {
		const document = parseDocument(raw, path);
		const currentModel = objectValue(objectValue(document[agent])?.pi)?.model;
		const preserveObject = value !== "" && objectValue(currentModel) !== null;
		const edits = modify(
			raw,
			[agent, "pi", "model", ...(preserveObject ? ["model"] : [])],
			value || undefined,
			{ formattingOptions: { insertSpaces: true, tabSize: 2, eol: raw.includes("\r\n") ? "\r\n" : "\n" } },
		);
		const output = applyEdits(raw, edits);
		saved = modelSettings(parseDocument(output, path));
		return output;
	});
	if (!saved) throw new Error("Magic Context 模型配置保存失败");
	return saved;
}
