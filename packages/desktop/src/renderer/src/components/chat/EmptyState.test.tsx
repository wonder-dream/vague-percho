// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	activeSessionId: null as string | null,
	newSessionDraft: { generation: 1 },
	load: vi.fn(),
}));
vi.mock("../../stores/projects", () => ({
	useProjectsStore: (select: (value: typeof state) => unknown) => select(state),
}));
vi.mock("../../stores/sessions", () => ({
	useSessionsStore: (select: (value: typeof state) => unknown) => select(state),
}));
vi.mock("../composer/Composer", () => ({ Composer: () => null }));
vi.mock("../session/ProjectBranchPicker", () => ({ ProjectBranchPicker: () => null }));

import { useI18nStore } from "../../i18n";
import { EmptyState } from "./EmptyState";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	useI18nStore.setState({ language: "zh" });
	state.activeSessionId = null;
	state.newSessionDraft = { generation: 1 };
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});
afterEach(async () => {
	await act(() => root.unmount());
	host.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("随机显示成对标题，在同一草稿页保持不变，进入新草稿页重新选择", async () => {
	const random = vi.spyOn(Math, "random").mockReturnValue(0.1);
	await act(async () => root.render(<EmptyState />));
	expect(host.querySelector("h1")?.textContent).toBe("Vague 身陷浓雾，不辨去路");

	random.mockReturnValue(0.9);
	await act(async () => root.render(<EmptyState />));
	expect(host.querySelector("h1")?.textContent).toBe("Vague 身陷浓雾，不辨去路");

	state.newSessionDraft = { generation: 2 };
	await act(async () => root.render(<EmptyState />));
	expect(host.querySelector("h1")?.textContent).toBe("Dream 神游幻梦，不知归途");
});
