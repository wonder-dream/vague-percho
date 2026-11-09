// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
	codemodeEnabled: true as boolean | null,
	codemodeOnly: false as boolean | null,
	codemodeSaving: false,
	channelWatchEnabled: true,
	magicContextEnabled: null as boolean | null,
	magicContextHfEndpoint: null as string | null,
	magicContextModels: null as { historian: string; dreamer: string } | null,
	setCodemodeEnabled: vi.fn(),
	setCodemodeOnly: vi.fn(),
	setChannelWatchEnabled: vi.fn(),
	setMagicContextAgentModel: vi.fn(),
}));
vi.mock("../../stores/settings", () => ({
	useSettingsStore: (select: (state: typeof settings) => unknown) => select(settings),
}));
vi.mock("./TaskNotificationSettings", () => ({ TaskNotificationSettings: () => null }));
vi.mock("./CacheWarmingSettings", () => ({ CacheWarmingSettings: () => null }));

import { useI18nStore } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { GeneralPanel } from "./GeneralPanel";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
	vi.clearAllMocks();
	Object.assign(settings, { codemodeEnabled: true, codemodeOnly: false, codemodeSaving: false });
	Object.assign(settings, {
		magicContextEnabled: null,
		magicContextHfEndpoint: null,
		magicContextModels: null,
	});
	useSessionsStore.setState({ modelsByEnvironment: {} });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	useI18nStore.setState({ language: "zh" });
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});
afterEach(async () => {
	await act(() => root.unmount());
	host.remove();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
async function render() {
	await act(async () => root.render(<GeneralPanel />));
	const [main, only] = host.querySelectorAll<HTMLButtonElement>('[role="switch"]');
	if (!main || !only) throw new Error("Missing Code Mode switches");
	return { main, only };
}
it("独占模式默认关闭，可以保存；中英文名称一致", async () => {
	const switches = await render();
	expect(host.textContent).toContain("Code Mode 独占模式");
	expect(switches.only.getAttribute("aria-checked")).toBe("false");
	expect(switches.only.disabled).toBe(false);
	await act(async () => switches.only.click());
	expect(settings.setCodemodeOnly).toHaveBeenCalledWith(true);
	await act(async () => useI18nStore.setState({ language: "en" }));
	expect(host.textContent).toContain("Code Mode only");
});
it.each([false, null])("总开关关闭或未加载时不能操作独占模式：%s", async (enabled) => {
	settings.codemodeEnabled = enabled;
	settings.codemodeOnly = true;
	const switches = await render();
	expect(switches.only.disabled).toBe(true);
	expect(switches.only.getAttribute("aria-checked")).toBe("true");
	await act(async () => switches.only.click());
	expect(settings.setCodemodeOnly).not.toHaveBeenCalled();
});
it("保存期间两个开关都禁用，避免交错写入", async () => {
	settings.codemodeSaving = true;
	const switches = await render();
	expect(switches.main.disabled).toBe(true);
	expect(switches.only.disabled).toBe(true);
});

it("Historian 和 Dreamer 可以直接选择聊天模型", async () => {
	vi.spyOn(useSessionsStore.getState(), "loadModels").mockResolvedValue(undefined);
	Object.assign(settings, {
		magicContextEnabled: true,
		magicContextHfEndpoint: "",
		magicContextModels: { historian: "", dreamer: "" },
	});
	useSessionsStore.setState({
		modelsByEnvironment: {
			local: [
				{
					provider: "deepseek",
					providerName: "DeepSeek",
					id: "deepseek-flash",
					label: "DeepSeek V4.1 Flash",
					authed: true,
				},
			],
		},
	});
	await render();
	const historian = host.querySelector<HTMLButtonElement>('button[aria-label="历史压缩模型（Historian）"]');
	if (!historian) throw new Error("Missing Historian model select");
	expect(host.querySelector('button[aria-label="记忆整理模型（Dreamer）"]')).not.toBeNull();
	await act(async () => historian.click());
	const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((item) =>
		item.textContent?.includes("DeepSeek V4.1 Flash"),
	);
	if (!option) throw new Error("Missing DeepSeek model option");
	await act(async () => option.click());
	expect(settings.setMagicContextAgentModel).toHaveBeenCalledWith("historian", "deepseek/deepseek-flash");
});
