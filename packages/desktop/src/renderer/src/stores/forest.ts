import type { ForestGraph, ForestLayout, ForestTurnDetail, SessionMeta } from "@percho/shared";
import { create } from "zustand";
import { getExecutionApi } from "../environment-api";
import { useProjectsStore } from "./projects";
import { useSessionsStore } from "./sessions";
import { pushToast } from "./toasts";
import { useTranscriptStore } from "./transcript";

/**
 * 森林工作台：当前项目的会话地图（只读投影 + 本地布局）。
 * 布局（卡片拖动位置 / 折叠）存 localStorage，按 cwd 分键；删掉只丢布局，不影响会话。
 */

const LAYOUT_KEY = (cwd: string) => `percho.forest.layout:${cwd}`;
const PHRASES_KEY = "percho.forest.phrases";
export const DEFAULT_QUICK_PHRASES = ["展开说明", "举个例子", "通俗易懂地讲", "对比一下优缺点"];

function readPhrases(): string[] {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(PHRASES_KEY) ?? "null");
		if (Array.isArray(parsed))
			return parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "");
	} catch {
		// 读坏了回默认
	}
	return DEFAULT_QUICK_PHRASES;
}
const EMPTY_LAYOUT: ForestLayout = { version: 1, positions: {}, collapsed: [] };

function readLayout(cwd: string): ForestLayout {
	try {
		const raw = localStorage.getItem(LAYOUT_KEY(cwd));
		const parsed = raw ? (JSON.parse(raw) as Partial<ForestLayout>) : null;
		if (parsed?.version !== 1) return EMPTY_LAYOUT;
		return {
			version: 1,
			positions: typeof parsed.positions === "object" && parsed.positions ? parsed.positions : {},
			collapsed: Array.isArray(parsed.collapsed)
				? parsed.collapsed.filter((id) => typeof id === "string")
				: [],
		};
	} catch {
		return EMPTY_LAYOUT;
	}
}

function writeLayout(cwd: string, layout: ForestLayout): void {
	try {
		localStorage.setItem(LAYOUT_KEY(cwd), JSON.stringify(layout));
	} catch {
		// 隐私模式/配额满：布局只是视觉偏好，失败不影响会话
	}
}

interface ForestStore {
	/** 森林视图是否打开（替换中间聊天区） */
	open: boolean;
	cwd: string | null;
	graph: ForestGraph | null;
	loading: boolean;
	error: string | null;
	layout: ForestLayout;
	/** 详情栏选中的卡片 key（`${sessionId}:${userEntryId}`） */
	selected: string | null;
	/** 详情全文缓存（key 同卡片） */
	details: Record<string, ForestTurnDetail | { error: string }>;
	/** 输入框上方的常用补充词（可编辑，localStorage） */
	phrases: string[];
	/** 卡片上打开的输入框；quote = 从回答里选中的引文 */
	composer: { cardKey: string; mode: "continue" | "fork"; quote?: string } | null;
	openComposer: (cardKey: string, mode: "continue" | "fork", quote?: string) => void;
	closeComposer: () => void;
	loadDetail: (key: string, sessionFile: string, userEntryId: string) => Promise<void>;
	setPhrases: (phrases: string[]) => void;
	setOpen: (open: boolean) => void;
	toggle: () => void;
	/** 拉取（或重拉）当前项目的图；cwd 变化时换布局 */
	refresh: (cwd: string) => Promise<void>;
	select: (key: string | null) => void;
	moveCard: (key: string, position: { x: number; y: number }) => void;
	toggleCollapsed: (key: string) => void;
	resetLayout: () => void;
	/** 打开会话并回到对话视图 */
	openSession: (sessionId: string, sessionFile: string) => Promise<void>;
	/**
	 * 从卡片发起提问：mode=continue 在该会话末尾追问；mode=fork 先在该轮回答处分叉出新会话再提问。
	 * 发送后切回对话视图看流式回复（回到森林时自动刷新）。成功返回 true。
	 */
	ask: (input: {
		sessionId: string;
		sessionFile: string;
		mode: "continue" | "fork";
		assistantEntryId?: string;
		text: string;
	}) => Promise<boolean>;
}

let refreshTicket = 0;

export const useForestStore = create<ForestStore>((set, get) => ({
	open: false,
	cwd: null,
	graph: null,
	loading: false,
	error: null,
	layout: EMPTY_LAYOUT,
	selected: null,
	details: {},
	phrases: readPhrases(),
	composer: null,
	openComposer: (cardKey, mode, quote) => set({ composer: { cardKey, mode, ...(quote ? { quote } : {}) } }),
	closeComposer: () => set({ composer: null }),
	loadDetail: async (key, sessionFile, userEntryId) => {
		if (get().details[key] && !("error" in (get().details[key] ?? {}))) return;
		try {
			const detail = await getExecutionApi(sessionFile).getForestTurn({ sessionFile, userEntryId });
			set((state) => ({ details: { ...state.details, [key]: detail } }));
		} catch (error) {
			set((state) => ({
				details: {
					...state.details,
					[key]: { error: error instanceof Error ? error.message : String(error) },
				},
			}));
		}
	},
	setPhrases: (phrases) => {
		const clean = phrases.map((phrase) => phrase.trim()).filter(Boolean);
		try {
			localStorage.setItem(PHRASES_KEY, JSON.stringify(clean));
		} catch {
			// 只是偏好
		}
		set({ phrases: clean });
	},
	setOpen: (open) => {
		set({ open });
		const { cwd } = get();
		if (open && cwd) void get().refresh(cwd);
	},
	toggle: () => get().setOpen(!get().open),
	refresh: async (cwd) => {
		const ticket = ++refreshTicket;
		if (get().cwd !== cwd) set({ cwd, graph: null, layout: readLayout(cwd), selected: null });
		set({ loading: true, error: null });
		try {
			const graph = await getExecutionApi(cwd).getForestGraph({ cwd });
			if (ticket !== refreshTicket) return;
			// 只清掉内容有变化（modifiedAt 变了）的会话的详情缓存，避免轮询时详情栏闪烁
			const before = new Map((get().graph?.sessions ?? []).map((s) => [s.sessionId, s.modifiedAt]));
			const changed = new Set(
				graph.sessions.filter((s) => before.get(s.sessionId) !== s.modifiedAt).map((s) => s.sessionId),
			);
			const details = Object.fromEntries(
				Object.entries(get().details).filter(([key]) => !changed.has(key.slice(0, key.indexOf(":")))),
			);
			set({ graph, loading: false, details });
		} catch (error) {
			if (ticket === refreshTicket)
				set({ loading: false, error: error instanceof Error ? error.message : String(error) });
		}
	},
	select: (selected) => set({ selected }),
	moveCard: (key, position) => {
		const { cwd, layout } = get();
		if (!cwd) return;
		const next = { ...layout, positions: { ...layout.positions, [key]: position } };
		writeLayout(cwd, next);
		set({ layout: next });
	},
	toggleCollapsed: (key) => {
		const { cwd, layout } = get();
		if (!cwd) return;
		const collapsed = layout.collapsed.includes(key)
			? layout.collapsed.filter((id) => id !== key)
			: [...layout.collapsed, key];
		const next = { ...layout, collapsed };
		writeLayout(cwd, next);
		set({ layout: next });
	},
	resetLayout: () => {
		const { cwd } = get();
		if (!cwd) return;
		writeLayout(cwd, EMPTY_LAYOUT);
		set({ layout: EMPTY_LAYOUT });
	},
	openSession: async (sessionId, sessionFile) => {
		const loaded = useSessionsStore.getState().sessions.find((session) => session.sessionId === sessionId);
		const meta: SessionMeta = loaded ?? {
			sessionId,
			sessionFile,
			cwd: get().cwd ?? "",
			active: false,
			messageCount: 0,
			createdAt: 0,
		};
		await useProjectsStore.getState().openSession(meta);
		set({ open: false });
	},
	ask: async ({ sessionId, sessionFile, mode, assistantEntryId, text }) => {
		const content = text.trim();
		if (!content) return false;
		await get().openSession(sessionId, sessionFile);
		const sessions = useSessionsStore.getState();
		if (sessions.activeSessionId !== sessionId) return false;
		if (useTranscriptStore.getState().bySession[sessionId]?.agentActive) {
			pushToast("warning", "forest.busy");
			return false;
		}
		let target = sessionId;
		if (mode === "fork") {
			if (!assistantEntryId) return false;
			const forked = await sessions.forkSession({ entryId: assistantEntryId });
			if (!forked) return false;
			target = forked;
		}
		const transcript = useTranscriptStore.getState();
		transcript.markAgentActive(target, true);
		const optimisticId = transcript.appendOptimisticUser(target, { text: content, images: [] });
		try {
			await getExecutionApi(target).prompt({ sessionId: target, text: content });
			return true;
		} catch (error) {
			if (optimisticId) useTranscriptStore.getState().removeOptimisticUser(target, optimisticId);
			useTranscriptStore.getState().markAgentActive(target, false);
			pushToast("error", "forest.sendFailed", error instanceof Error ? error.message : String(error));
			return false;
		}
	},
}));
