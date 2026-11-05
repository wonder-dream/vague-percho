import { join } from "node:path";
import { JsonStore } from "../json-store";

/**
 * Magic Context（@cortexkit/pi-magic-context）开关：存 agentDir/magic-context.json，缺省关闭。
 * 开启后会在后台调用模型（historian/dreamer）并在 ~/.local/share/cortexkit 落库，所以必须用户显式打开。
 * 扩展自身的细项配置仍走它的 magic-context.jsonc（CortexKit 共享目录），这里只管「装不装」。
 */
function store(agentDir: string) {
	return new JsonStore<{ enabled?: boolean }>({
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

export async function writeMagicContextEnabled(agentDir: string, enabled: boolean): Promise<void> {
	await store(agentDir).update((draft) => {
		draft.enabled = enabled;
	});
}
