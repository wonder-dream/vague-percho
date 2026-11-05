import type { ForestGraph, ForestLayout, SessionMeta } from "@percho/shared";
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
			if (ticket === refreshTicket) set({ graph, loading: false });
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
