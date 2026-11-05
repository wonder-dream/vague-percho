import type { ForestGraph, ForestLayout, ForestSession, ForestTurn } from "@percho/shared";

/** 森林卡片几何（画布坐标，px） */
export const FOREST_CARD_WIDTH = 320;
export const FOREST_CARD_HEIGHT = 232;
const COLUMN_GAP = 64;
const ROW_GAP = 40;

export interface ForestCard {
	/** `${sessionId}:${userEntryId}`；空分支占位为 `${sessionId}:empty` */
	key: string;
	sessionId: string;
	sessionFile: string;
	sessionName?: string;
	/** 本卡在其会话里的轮次序号（从 1 起，含继承前缀） */
	turnNumber: number;
	/** 本会话的第一张自有卡（链首：显示会话名 / 分支标记） */
	head: boolean;
	/** 来自 fork 的会话 */
	branch: boolean;
	turn: ForestTurn | null;
	x: number;
	y: number;
}

export interface ForestEdge {
	from: string;
	to: string;
	/** fork 连线（虚线） */
	fork: boolean;
}

export interface ForestView {
	cards: ForestCard[];
	edges: ForestEdge[];
	/** 被折叠隐藏的子孙数（按折叠卡 key） */
	hiddenCounts: Record<string, number>;
	width: number;
	height: number;
}

export const forestCardKey = (sessionId: string, turnId: string): string => `${sessionId}:${turnId}`;

interface Node {
	card: Omit<ForestCard, "x" | "y">;
	column: number;
	children: Node[];
	fork: boolean;
}

/**
 * 布局：每个会话的自有轮次排成一行（链），fork 子会话从父会话分叉卡的下一列开始，
 * 放在父链下方。行号按 DFS 顺序分配（先父链，后各分支，分支按创建时间）。
 * 拖动过的卡片用 layout.positions 覆盖自动坐标；折叠卡片隐藏其全部子孙。
 */
export function layoutForest(graph: ForestGraph, layout: ForestLayout): ForestView {
	const byId = new Map(graph.sessions.map((session) => [session.sessionId, session]));
	const childrenOf = new Map<string, ForestSession[]>();
	const roots: ForestSession[] = [];
	for (const session of graph.sessions) {
		const parent = session.parentSessionId ? byId.get(session.parentSessionId) : undefined;
		if (!parent) {
			roots.push(session);
			continue;
		}
		const list = childrenOf.get(parent.sessionId) ?? [];
		list.push(session);
		childrenOf.set(parent.sessionId, list);
	}

	// 父会话中某 userEntryId 对应的卡 key：继承前缀的轮次归属最早拥有它的祖先
	const ownerKey = (session: ForestSession, turnId: string): string | undefined => {
		let current: ForestSession | undefined = session;
		const seen = new Set<string>();
		while (current && !seen.has(current.sessionId)) {
			seen.add(current.sessionId);
			const index = current.turns.findIndex((turn) => turn.userEntryId === turnId);
			if (index >= current.inheritedTurns) return forestCardKey(current.sessionId, turnId);
			current = current.parentSessionId ? byId.get(current.parentSessionId) : undefined;
		}
		return undefined;
	};

	const nodeByKey = new Map<string, Node>();
	const columnOf = new Map<string, number>();

	const buildChain = (session: ForestSession, startColumn: number): Node[] => {
		const own = session.turns.slice(session.inheritedTurns);
		// fork 子会话的文件头不带 session_info，名字是从父会话复制来的：与父同名时不重复显示
		const parentName = session.parentSessionId ? byId.get(session.parentSessionId)?.name : undefined;
		const ownName = session.name && session.name !== parentName ? session.name : undefined;
		const base = {
			sessionId: session.sessionId,
			sessionFile: session.sessionFile,
			...(ownName ? { sessionName: ownName } : {}),
			branch: Boolean(session.parentSessionId),
		};
		const chain: Node[] = (own.length > 0 ? own : [null]).map((turn, index) => ({
			card: {
				...base,
				key: turn ? forestCardKey(session.sessionId, turn.userEntryId) : `${session.sessionId}:empty`,
				turnNumber: session.inheritedTurns + index + 1,
				head: index === 0,
				turn,
			},
			column: startColumn + index,
			children: [],
			fork: false,
		}));
		for (const [index, node] of chain.entries()) {
			nodeByKey.set(node.card.key, node);
			columnOf.set(node.card.key, node.column);
			const next = chain[index + 1];
			if (next) node.children.push(next);
		}
		return chain;
	};

	const attachForks = (session: ForestSession): void => {
		const children = [...(childrenOf.get(session.sessionId) ?? [])].sort((a, b) => a.createdAt - b.createdAt);
		for (const child of children) {
			const anchorKey = child.forkTurnId ? ownerKey(child, child.forkTurnId) : undefined;
			const anchor = anchorKey ? nodeByKey.get(anchorKey) : undefined;
			const chain = buildChain(child, anchor ? anchor.column + 1 : 0);
			const head = chain[0];
			if (anchor && head) {
				head.fork = true;
				anchor.children.push(head);
			} else if (head) {
				orphanHeads.push(head);
			}
			attachForks(child);
		}
	};

	const orphanHeads: Node[] = [];
	const rootHeads: Node[] = [];
	for (const root of [...roots].sort((a, b) => a.createdAt - b.createdAt)) {
		const head = buildChain(root, 0)[0];
		if (head) rootHeads.push(head);
		attachForks(root);
	}

	const collapsed = new Set(layout.collapsed);
	const cards: ForestCard[] = [];
	const edges: ForestEdge[] = [];
	const hiddenCounts: Record<string, number> = {};
	const countDescendants = (node: Node): number =>
		node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);

	// DFS 分配行号：同链的下一张卡留在当前行，分支各开新行
	let nextRow = 0;
	const place = (node: Node, row: number): void => {
		const auto = {
			x: node.column * (FOREST_CARD_WIDTH + COLUMN_GAP),
			y: row * (FOREST_CARD_HEIGHT + ROW_GAP),
		};
		const saved = layout.positions[node.card.key];
		cards.push({ ...node.card, ...(saved ?? auto) });
		if (collapsed.has(node.card.key)) {
			const hidden = countDescendants(node);
			if (hidden > 0) hiddenCounts[node.card.key] = hidden;
			return;
		}
		const sameChain = node.children.find((child) => !child.fork);
		if (sameChain) {
			edges.push({ from: node.card.key, to: sameChain.card.key, fork: false });
			place(sameChain, row);
		}
		for (const child of node.children) {
			if (child === sameChain) continue;
			edges.push({ from: node.card.key, to: child.card.key, fork: true });
			place(child, ++nextRow);
		}
	};
	for (const head of [...rootHeads, ...orphanHeads]) {
		place(head, nextRow);
		nextRow++;
	}

	const width = Math.max(0, ...cards.map((card) => card.x + FOREST_CARD_WIDTH));
	const height = Math.max(0, ...cards.map((card) => card.y + FOREST_CARD_HEIGHT));
	return { cards, edges, hiddenCounts, width, height };
}

/** 运行中会话的实时状态（来自 transcript：最新提问 + 正在生成的回复） */
export interface ForestLiveTurn {
	question: string;
	answer: string;
}

/**
 * 叠加实时回复：会话最后一轮的提问与 live.question 相同 → 用流式正文覆盖回答；
 * 否则（新问题还没落盘）在链尾追加一张临时卡（key = `${sessionId}:live`）。
 * 不改动原图，返回新图。
 */
export function overlayLiveTurns(graph: ForestGraph, live: ReadonlyMap<string, ForestLiveTurn>): ForestGraph {
	if (live.size === 0) return graph;
	return {
		...graph,
		sessions: graph.sessions.map((session) => {
			const current = live.get(session.sessionId);
			if (!current) return session;
			const turns = [...session.turns];
			const last = turns[turns.length - 1];
			const question = current.question.trim();
			// 图里的提问是截断预览（可能以 … 结尾）：按前缀比对
			const persisted = last?.question.replace(/…$/, "").trim();
			if (last && persisted && question.startsWith(persisted) && turns.length > session.inheritedTurns) {
				turns[turns.length - 1] = { ...last, answer: current.answer || last.answer };
			} else if (question) {
				turns.push({
					userEntryId: "live",
					question,
					answer: current.answer,
					toolCount: 0,
					errored: false,
					timestamp: Date.now(),
				});
			}
			return { ...session, turns };
		}),
	};
}

/** 两卡之间的连线（右缘中点 → 左缘中点的三次贝塞尔） */
export function forestEdgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
	const x1 = from.x + FOREST_CARD_WIDTH;
	const y1 = from.y + FOREST_CARD_HEIGHT / 2;
	const x2 = to.x;
	const y2 = to.y + FOREST_CARD_HEIGHT / 2;
	const bend = Math.max(32, Math.abs(x2 - x1) / 2);
	return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}
