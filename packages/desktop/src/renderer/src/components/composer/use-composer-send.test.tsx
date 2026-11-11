import { composerDocumentFromText, emptyTranscript } from "@percho/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_DRAFT, useDraftStore } from "../../stores/drafts";
import { useTranscriptStore } from "../../stores/transcript";
import { useComposerSend } from "./use-composer-send";

const { prompt, clearQueue } = vi.hoisted(() => ({ prompt: vi.fn(), clearQueue: vi.fn() }));
vi.mock("../../environment-api", () => ({ getExecutionApi: () => ({ prompt, clearQueue }) }));
vi.mock("../../i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("../../stores/session-event-boundary", () => ({ isSessionSynchronizing: () => false }));
vi.mock("../../stores/sessions", () => ({
	useSessionsStore: { getState: () => ({ activeSessionId: "fixture" }) },
}));
vi.mock("../../stores/settings", () => ({ useSettingsStore: { getState: () => ({}) } }));

beforeEach(() => {
	prompt.mockReset().mockResolvedValue(undefined);
	clearQueue.mockReset();
	vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
		callback();
		return 0;
	});
	useDraftStore.setState({ bySession: {}, pendingBySession: {}, errorsBySession: {} });
	useTranscriptStore.setState({ bySession: {} });
});

afterEach(() => vi.unstubAllGlobals());

function composer() {
	let actions!: ReturnType<typeof useComposerSend>;
	function Probe() {
		actions = useComposerSend({ draftKey: "fixture", activeSessionId: "fixture", imagesSupported: true });
		return null;
	}
	renderToStaticMarkup(createElement(Probe));
	return actions;
}

describe("多附件输入不能被历史展示引用替换", () => {
	const images = [
		{ data: "AQID", mimeType: "image/png" },
		{ data: "BAUG", mimeType: "image/png" },
	];
	it.each([false, true])(
		"agentActive=%s的发送/排队保留两张原图，只有空闲发送做乐观回显",
		async (agentActive) => {
			useTranscriptStore.getState().loadHistory("fixture", []);
			useTranscriptStore.getState().markAgentActive("fixture", agentActive);
			useDraftStore.getState().updateDraft("fixture", () => ({
				...EMPTY_DRAFT,
				document: composerDocumentFromText("two images"),
				images,
			}));
			await composer().handleSend();
			expect(prompt).toHaveBeenCalledExactlyOnceWith({
				sessionId: "fixture",
				text: "two images",
				document: undefined,
				images,
			});
			const user = useTranscriptStore
				.getState()
				.bySession.fixture?.messages.find((message) => message.kind === "user");
			if (agentActive) expect(user).toBeUndefined();
			else expect(user).toMatchObject({ images });
			expect(useDraftStore.getState().bySession.fixture).toBeUndefined();
		},
	);
	it("发送失败恢复两张原图且移除乐观消息，不生成引用或丢附件", async () => {
		useTranscriptStore.getState().loadHistory("fixture", []);
		useDraftStore.getState().updateDraft("fixture", () => ({
			...EMPTY_DRAFT,
			document: composerDocumentFromText("failed"),
			images,
		}));
		prompt.mockRejectedValueOnce(new Error("synthetic failure"));
		await composer().handleSend();
		expect(useDraftStore.getState().bySession.fixture?.images).toEqual(images);
		expect(useTranscriptStore.getState().bySession.fixture?.messages).toEqual([]);
	});
	it("取回排队多附件追加到已有草稿，仍可按原图再次发送", async () => {
		useTranscriptStore.getState().loadHistory("fixture", []);
		useDraftStore.getState().updateDraft("fixture", () => ({
			...EMPTY_DRAFT,
			document: composerDocumentFromText("already editing"),
		}));
		clearQueue.mockResolvedValueOnce({
			followUp: ["queued"],
			followUpInputs: [{ document: composerDocumentFromText("queued"), images }],
		});
		const actions = composer();
		await actions.handleRestoreQueue(() => {});
		expect(useDraftStore.getState().bySession.fixture?.images).toEqual(images);
		await actions.handleSend();
		expect(prompt.mock.calls[0]?.[0]?.images).toEqual(images);
	});
});

describe("运行展示不放宽原发送资格", () => {
	it.each(["compacting", "full-queue"])("%s 拒绝普通草稿且保留正文和附件", async (reason) => {
		useTranscriptStore.getState().loadHistory("fixture", []);
		useTranscriptStore.setState((state) => ({
			bySession: {
				...state.bySession,
				fixture: {
					...emptyTranscript(),
					pendingPermissions: [],
					pendingDialogs: [],
					agentActive: true,
					phase: "idle",
					compacting: reason === "compacting",
					followUpQueue: reason === "full-queue" ? ["queued"] : [],
				},
			},
		}));
		const draft = {
			...EMPTY_DRAFT,
			document: composerDocumentFromText("keep this"),
			images: [{ data: "AQID", mimeType: "image/png" }],
		};
		useDraftStore.getState().updateDraft("fixture", () => draft);
		await composer().handleSend();
		expect(prompt).not.toHaveBeenCalled();
		expect(useDraftStore.getState().bySession.fixture).toBe(draft);
	});
	it("工具轮结束的 idle 间隔仍按活跃任务排队，不插入空闲发送的乐观气泡", async () => {
		useTranscriptStore.getState().loadHistory("fixture", []);
		useTranscriptStore.getState().applyEvent("fixture", { type: "agent_start" });
		useTranscriptStore.getState().applyEvent("fixture", {
			type: "turn_end",
			toolResults: [],
			message: {
				role: "assistant",
				stopReason: "toolUse",
				content: [],
				api: "openai-completions",
				provider: "fixture",
				model: "fixture",
				timestamp: 0,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			},
		});
		expect(useTranscriptStore.getState().bySession.fixture).toMatchObject({
			agentActive: true,
			phase: "idle",
		});
		useDraftStore
			.getState()
			.updateDraft("fixture", () => ({ ...EMPTY_DRAFT, document: composerDocumentFromText("follow up") }));
		await composer().handleSend();
		expect(prompt).toHaveBeenCalledOnce();
		expect(useTranscriptStore.getState().bySession.fixture?.messages.some((m) => m.kind === "user")).toBe(
			false,
		);
	});
});

describe("选区批注", () => {
	it("把多个批注包和正文按输入顺序一起发送，并在发送后消费批注包", async () => {
		useTranscriptStore.getState().loadHistory("fixture", []);
		useDraftStore.getState().updateDraft("fixture", () => ({
			...EMPTY_DRAFT,
			document: composerDocumentFromText("请说明这两段内容的影响"),
			comments: [
				{ id: "comment-1", quote: "const answer = await run();", comment: "先解释执行路径" },
				{ id: "comment-2", quote: "return result;", comment: "再说明返回值" },
			],
		}));

		await composer().handleSend();

		expect(prompt).toHaveBeenCalledExactlyOnceWith({
			sessionId: "fixture",
			text: "> const answer = await run();\n\n先解释执行路径\n\n> return result;\n\n再说明返回值\n\n请说明这两段内容的影响",
			document: undefined,
			images: undefined,
		});
		expect(useDraftStore.getState().bySession.fixture).toBeUndefined();
	});

	it("批注包没有说明时仍保留选段，不丢掉用户刚选中的内容", async () => {
		useTranscriptStore.getState().loadHistory("fixture", []);
		useDraftStore.getState().updateDraft("fixture", () => ({
			...EMPTY_DRAFT,
			comments: [{ id: "comment-1", quote: "被选中的句子", comment: "" }],
		}));

		await composer().handleSend();

		expect(prompt).toHaveBeenCalledExactlyOnceWith({
			sessionId: "fixture",
			text: "> 被选中的句子",
			document: undefined,
			images: undefined,
		});
	});

	it("批注和文件引用共存时保留结构化文件输入", async () => {
		useTranscriptStore.getState().loadHistory("fixture", []);
		useDraftStore.getState().updateDraft("fixture", () => ({
			...EMPTY_DRAFT,
			document: {
				version: 1,
				parts: [
					{ type: "text", text: "请检查 " },
					{ type: "file", path: "/tmp/notes.md", label: "notes.md" },
				],
			},
			comments: [{ id: "comment-1", quote: "被选中的代码", comment: "检查文件引用" }],
		}));

		await composer().handleSend();

		expect(prompt).toHaveBeenCalledExactlyOnceWith({
			sessionId: "fixture",
			text: "> 被选中的代码\n\n检查文件引用\n\n请检查 @notes.md",
			document: {
				version: 1,
				parts: [
					{ type: "text", text: "> 被选中的代码\n\n检查文件引用\n\n请检查 " },
					{ type: "file", path: "/tmp/notes.md", label: "notes.md" },
				],
			},
			images: undefined,
		});
	});

	it("发送失败时恢复批注选段和正文", async () => {
		useTranscriptStore.getState().loadHistory("fixture", []);
		useDraftStore.getState().updateDraft("fixture", () => ({
			...EMPTY_DRAFT,
			document: composerDocumentFromText("说明"),
			comments: [{ id: "comment-1", quote: "需要解释的选段", comment: "补充说明" }],
		}));
		prompt.mockRejectedValueOnce(new Error("synthetic failure"));

		await composer().handleSend();

		expect(useDraftStore.getState().bySession.fixture).toMatchObject({
			comments: [{ id: "comment-1", quote: "需要解释的选段", comment: "补充说明" }],
			document: composerDocumentFromText("说明"),
		});
	});
});

describe("compaction recovery send", () => {
	it.each(["paused", "stopped"])(
		"accepts a human correction with a retained queue after %s",
		async (state) => {
			useTranscriptStore.getState().loadHistory("fixture", []);
			useTranscriptStore.setState({
				bySession: {
					fixture: {
						...emptyTranscript(),
						pendingPermissions: [],
						pendingDialogs: [],
						followUpQueue: ["modify config"],
						compactionPause: state === "paused" ? { reason: "failed" } : null,
					},
				},
			});
			useDraftStore.getState().updateDraft("fixture", () => ({
				...EMPTY_DRAFT,
				document: composerDocumentFromText("inspect only"),
			}));
			await composer().handleSend();
			expect(prompt).toHaveBeenCalledExactlyOnceWith({
				sessionId: "fixture",
				text: "inspect only",
				document: undefined,
				images: undefined,
			});
			expect(useTranscriptStore.getState().bySession.fixture?.followUpQueue).toEqual(["modify config"]);
			expect(useDraftStore.getState().bySession.fixture).toBeUndefined();
		},
	);
});
