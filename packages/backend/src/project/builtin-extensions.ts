/// <reference path="./magic-context-module.d.ts" />
import type { ExtensionFactory, InlineExtension } from "@earendil-works/pi-coding-agent";
import {
	createCodemodeExtension,
	createMcpExtension,
	createToolSearchExtension,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { readCodemodeConfig } from "../settings/codemode";
import { readMagicContextEnabled } from "../settings/magic-context";

/**
 * 官方内置扩展（照抄 CLI 侧元数据，spec §4.1）—— 不要自己发明字段：
 * `builtin: true` 让错误信息与 CLI 一致（未知/被替换时能识别），`replaceable: true` 让装了同名
 * 第三方扩展时加载期自动让位（第三方扩展的工具因此能接管，我们不做拦截）。
 *
 * 官方 CLI 还有第 4 个 `llama.cpp`，但它的 factory **没有从包根导出**（`dist/extensions/llama/index.js`
 * 被 package.json exports map 拦，实测 ERR_PACKAGE_PATH_NOT_EXPORTED），本批不接；
 * 官方一旦导出 `builtInExtensions`，在这里补一行即可（spec §4.4）。
 */
export function builtinExtensions(deps: {
	openUrl?: (url: string) => void;
	agentDir?: string;
}): InlineExtension[] {
	const agentDir = deps.agentDir ?? getAgentDir();
	return [
		...(readMagicContextEnabled(agentDir)
			? [
					{
						name: "magic-context",
						// 懒加载：包体 10MB，关闭时不应拖慢启动；默认导出即标准 ExtensionFactory
						factory: async (pi: Parameters<ExtensionFactory>[0]) =>
							(await import("@cortexkit/pi-magic-context")).default(pi),
					},
				]
			: []),
		{
			name: "codemode",
			factory: createCodemodeExtension({
				mode: readCodemodeConfig(agentDir).only ? "only" : "on",
			}),
			builtin: true,
			replaceable: true,
		},
		{ name: "tool-search", factory: createToolSearchExtension(), builtin: true, replaceable: true },
		// openUrl：MCP OAuth 授权页交给 Electron 打开（缺省则扩展回落到平台默认浏览器）
		{ name: "mcp", factory: createMcpExtension({ openUrl: deps.openUrl }), builtin: true, replaceable: true },
	];
}
