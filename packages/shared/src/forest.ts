/**
 * 森林工作台（会话地图）数据模型：把同一项目下的会话按「轮」投影成卡片，
 * 按真实 fork 关系（会话头 parentSession + 共享 entry 前缀）连线。
 * 只读投影：正文始终来自会话 jsonl，地图自己只存布局（见 ForestLayout）。
 */

/** 卡片正文预览上限（完整内容在详情栏按需读取） */
export const FOREST_PREVIEW_CHARS = 600;

/** 一轮对话：一条用户提问 + 其后直到下一条提问前的助手回复 */
export interface ForestTurn {
	/** 用户提问 entry id（卡片身份，跨 fork 的共享前缀里与父会话一致） */
	userEntryId: string;
	/** 本轮最后一条助手消息 entry id（fork 点；未回复为 undefined） */
	assistantEntryId?: string;
	question: string;
	answer: string;
	/** 本轮工具调用次数 */
	toolCount: number;
	/** 回复以错误结束 */
	errored: boolean;
	timestamp: number;
}

/** 地图上的一个会话（一条链） */
export interface ForestSession {
	sessionId: string;
	sessionFile: string;
	name?: string;
	createdAt: number;
	modifiedAt: number;
	/** 父会话 id（fork 来源；父会话不在本项目或已删除时为 undefined） */
	parentSessionId?: string;
	/** 分叉点：父会话中最后一个共享轮次的 userEntryId（继承自父会话的轮次不再重复画） */
	forkTurnId?: string;
	/** 从父会话继承的前缀轮数（turns 里前 inheritedTurns 轮与父会话相同） */
	inheritedTurns: number;
	turns: ForestTurn[];
}

export interface ForestGraph {
	cwd: string;
	sessions: ForestSession[];
}

/** 详情全文上限：超出截断并标注（完整内容在原会话里） */
export const FOREST_BODY_CHARS = 200_000;

/** 详情栏读取的一轮完整内容（正文不进图数据，按需读取） */
export interface ForestTurnDetail {
	question: string;
	/** 本轮各条助手消息正文（按顺序；工具调用穿插在中间的分段） */
	answers: string[];
	tools: Array<{ name: string; args: string; output: string; isError: boolean }>;
	truncated: boolean;
}

/** 卡片布局（app 本地 userData/forest/，不写进会话文件；删掉只丢布局） */
export interface ForestLayout {
	version: 1;
	/** key = `${sessionId}:${userEntryId}` */
	positions: Record<string, { x: number; y: number }>;
	collapsed: string[];
}
