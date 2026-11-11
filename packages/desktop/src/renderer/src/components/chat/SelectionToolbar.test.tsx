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
	return container;
}

function typeInto(input: HTMLTextAreaElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
	if (!setter) throw new Error("Missing textarea value setter");
	setter.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("SelectionToolbar 批注", () => {
	it("点击添加到对话后在选区附近打开输入框，确认后写入批注包", async () => {
		await selectText();

		const buttons = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
		expect(buttons.map((item) => item.textContent)).toContain("selection.addToChat");
		expect(buttons.map((item) => item.textContent)).not.toContain("selection.addComment");
		await act(async () => {
			buttons.find((item) => item.textContent === "selection.addToChat")?.click();
			await Promise.resolve();
		});

		const input = host.querySelector<HTMLTextAreaElement>("textarea");
		expect(input).not.toBeNull();
		expect(input?.placeholder).toBe("selection.annotationPlaceholder");
		await act(async () => {
			if (!input) throw new Error("Missing annotation input");
			typeInto(input, "请解释这段代码");
			await Promise.resolve();
		});

		await act(async () => {
			const confirm = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
				(item) => item.textContent === "selection.annotationConfirm",
			);
			confirm?.click();
			await Promise.resolve();
		});

		expect(useDraftStore.getState().bySession.fixture).toMatchObject({
			comments: [{ quote: "选中的代码片段", comment: "请解释这段代码" }],
			quotes: [],
		});
	});

	it("可以连续添加多个批注包", async () => {
		const firstContainer = await selectText();
		await act(async () => {
			host.querySelector<HTMLButtonElement>('[role="menuitem"]')?.click();
			await Promise.resolve();
		});
		const firstInput = host.querySelector<HTMLTextAreaElement>("textarea");
		if (!firstInput) throw new Error("Missing first annotation input");
		await act(async () => {
			typeInto(firstInput, "第一条说明");
			await Promise.resolve();
			[...host.querySelectorAll<HTMLButtonElement>("button")]
				.find((item) => item.textContent === "selection.annotationConfirm")
				?.click();
			await Promise.resolve();
		});

		const second = document.createElement("div");
		second.textContent = "第二个选段";
		firstContainer.append(second);
		const text = second.firstChild;
		if (!text) throw new Error("Missing second selection text");
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
		await act(async () => {
			host.querySelector<HTMLButtonElement>('[role="menuitem"]')?.click();
			await Promise.resolve();
		});
		const secondInput = host.querySelector<HTMLTextAreaElement>("textarea");
		if (!secondInput) throw new Error("Missing second annotation input");
		await act(async () => {
			typeInto(secondInput, "第二条说明");
			await Promise.resolve();
			[...host.querySelectorAll<HTMLButtonElement>("button")]
				.find((item) => item.textContent === "selection.annotationConfirm")
				?.click();
			await Promise.resolve();
		});

		expect(useDraftStore.getState().bySession.fixture?.comments).toHaveLength(2);
		expect(
			useDraftStore.getState().bySession.fixture?.comments.map(({ quote, comment }) => ({ quote, comment })),
		).toEqual([
			{ quote: "选中的代码片段", comment: "第一条说明" },
			{ quote: "第二个选段", comment: "第二条说明" },
		]);
	});
});
