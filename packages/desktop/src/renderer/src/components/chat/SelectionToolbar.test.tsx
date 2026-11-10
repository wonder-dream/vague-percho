// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftStore } from "../../stores/drafts";
import { useSessionsStore } from "../../stores/sessions";
import { useTranscriptStore } from "../../stores/transcript";
import { SelectionToolbar } from "./SelectionToolbar";

vi.mock("../../i18n", () => ({ useT: () => (key: string) => key }));

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
		callback();
		return 0;
	});
	useSessionsStore.setState({ activeSessionId: "fixture" });
	useTranscriptStore.setState({ bySession: { fixture: { agentActive: false, compacting: false } } as never });
	useDraftStore.setState({ bySession: {}, failedBySession: {}, pendingBySession: {}, errorsBySession: {} });
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 200, 40, 20));
});

afterEach(async () => {
	window.getSelection()?.removeAllRanges();
	await act(() => root.unmount());
	host.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function selectText() {
	const container = document.createElement("div");
	container.textContent = "选中的代码片段";
	host.append(container);
	const ref = { current: container };
	await act(() => root.render(<SelectionToolbar containerRef={ref} />));
	const text = container.firstChild;
	if (!text) throw new Error("Missing selection text");
	await act(async () => {
		const range = document.createRange();
		range.selectNodeContents(text);
		const selection = window.getSelection();
		if (!selection) throw new Error("Selection is unavailable");
		selection.removeAllRanges();
		selection.addRange(range);
		document.dispatchEvent(new Event("selectionchange"));
		document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
		await Promise.resolve();
	});
}

describe("SelectionToolbar 批注", () => {
	it("选择添加批注后把选区写入批注草稿，而不是普通引用", async () => {
		await selectText();

		const button = host.querySelector<HTMLButtonElement>('[role="menuitem"]');
		const buttons = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
		expect(button).not.toBeNull();
		expect(buttons.map((item) => item.textContent)).toContain("selection.addComment");
		await act(async () => {
			buttons.find((item) => item.textContent === "selection.addComment")?.click();
			await Promise.resolve();
		});

		expect(useDraftStore.getState().bySession.fixture).toMatchObject({
			commentQuote: "选中的代码片段",
			quotes: [],
		});
	});
});
