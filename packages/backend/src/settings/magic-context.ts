import { join } from "node:path";
import { JsonStore } from "../json-store";

/**
 * Magic Context（@cortexkit/pi-magic-context）开关：存 agentDir/magic-context.json，缺省关闭。
 * 开启后会在后台调用模型（historian/dreamer）并在 ~/.local/share/cortexkit 落库，所以必须用户显式打开。
 * 扩展自身的细项配置仍走它的 magic-context.jsonc（CortexKit 共享目录），这里只管「装不装」。
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
