import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseSessionEntries, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { FOREST_PREVIEW_CHARS, type ForestGraph, type ForestSession, type ForestTurn } from "@percho/shared";
import { blockText, type ContentBlock, type RawMessage } from "./messages";

/**
 * 森林工作台投影（纯函数 + 只读文件读取）：会话 jsonl → 轮次卡片 + fork 连线。
 * 不走 SessionManager.open（可能迁移写盘），与 readSessionMessagesFromContent 同一只读路径。
 */

export interface ForestSourceFile {
	path: string;
	content: string;
}

interface ParsedSession {
	id: string;
	path: string;
	cwd: string;
	parentPath?: string;
	name?: string;
	createdAt: number;
	modifiedAt: number;
	branch: SessionEntry[];
}

const clip = (text: string): string =>
	text.length > FOREST_PREVIEW_CHARS ? `${text.slice(0, FOREST_PREVIEW_CHARS)}…` : text;

const ms = (iso: string | undefined, fallback: number): number => {
	const parsed = iso ? Date.parse(iso) : Number.NaN;
	return Number.isNaN(parsed) ? fallback : parsed;
};

/** 用户亲手输入的消息才算一轮（排除注入的 custom/system-reminder 等） */
function isUserTurn(entry: SessionEntry): boolean {
	if (entry.type !== "message") return false;
	const message = entry.message as RawMessage;
	return message.role === "user" && blockText(message.content).trim().length > 0;
}

function toolCallCount(content: RawMessage["content"]): number {
	return typeof content === "string"
		? 0
		: (content ?? []).filter((block: ContentBlock) => block.type === "toolCall").length;
}

/** 当前分支（leaf = 文件末条 entry，沿 parentId 回溯；与 getBranch() 同语义） */
function currentBranch(entries: ReturnType<typeof parseSessionEntries>): SessionEntry[] {
	const byId = new Map<string, SessionEntry>();
	for (const entry of entries) if (entry.type !== "session") byId.set(entry.id, entry);
	const branch: SessionEntry[] = [];
	let cursor = entries.length > 0 ? entries[entries.length - 1] : undefined;
	const seen = new Set<string>();
	while (cursor && cursor.type !== "session" && !seen.has(cursor.id)) {
		seen.add(cursor.id);
		branch.unshift(cursor);
		cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
	}
	return branch;
}

export function parseForestSession(file: ForestSourceFile): ParsedSession | null {
	const entries = parseSessionEntries(file.content);
	const header = entries.find((entry) => entry.type === "session");
	if (!header || header.type !== "session") return null;
	const createdAt = ms(header.timestamp, 0);
	let name: string | undefined;
	let modifiedAt = createdAt;
	for (const entry of entries) {
		if (entry.type === "session") continue;
		if (entry.type === "session_info" && entry.name) name = entry.name;
		modifiedAt = Math.max(modifiedAt, ms(entry.timestamp, modifiedAt));
	}
	return {
		id: header.id,
		path: file.path,
		cwd: header.cwd,
		parentPath: header.parentSession,
		name,
		createdAt,
		modifiedAt,
		branch: currentBranch(entries),
	};
}

/** 分支 → 轮次：每条用户提问开一轮，之后的助手消息并入该轮，最后一条助手文本作为回答 */
export function toForestTurns(branch: readonly SessionEntry[]): ForestTurn[] {
	const turns: ForestTurn[] = [];
	let current: ForestTurn | undefined;
	for (const entry of branch) {
		if (entry.type !== "message") continue;
		const message = entry.message as RawMessage;
		if (isUserTurn(entry)) {
			current = {
				userEntryId: entry.id,
				question: clip(blockText(message.content).trim()),
				answer: "",
				toolCount: 0,
				errored: false,
				timestamp: ms(entry.timestamp, 0),
			};
			turns.push(current);
			continue;
		}
		if (!current || message.role !== "assistant") continue;
		current.assistantEntryId = entry.id;
		current.toolCount += toolCallCount(message.content);
		const text = blockText(message.content).trim();
		if (text) current.answer = clip(text);
		current.errored = message.stopReason === "error";
		if (current.errored && !text && message.errorMessage) current.answer = clip(message.errorMessage);
	}
	return turns;
}

/**
 * 建图：fork 关系以会话头 parentSession（来源文件路径）为准；分叉点 = 子会话轮次里
 * 与父会话共享的最长 userEntryId 前缀（createBranchedSession 原样保留 entry id）。
 */
export function buildForestGraph(cwd: string, files: readonly ForestSourceFile[]): ForestGraph {
	const parsed = files
		.map(parseForestSession)
		.filter((session): session is ParsedSession => session !== null);
	const byPath = new Map(parsed.map((session) => [resolve(session.path), session]));
	const turnsById = new Map(parsed.map((session) => [session.id, toForestTurns(session.branch)]));
	const sessions: ForestSession[] = parsed.map((session) => {
		const turns = turnsById.get(session.id) ?? [];
		const parent = session.parentPath ? byPath.get(resolve(session.parentPath)) : undefined;
		let inheritedTurns = 0;
		let forkTurnId: string | undefined;
		if (parent && parent.id !== session.id) {
			const parentIds = new Set((turnsById.get(parent.id) ?? []).map((turn) => turn.userEntryId));
			while (inheritedTurns < turns.length && parentIds.has(turns[inheritedTurns]?.userEntryId ?? "")) {
				inheritedTurns++;
			}
			forkTurnId = inheritedTurns > 0 ? turns[inheritedTurns - 1]?.userEntryId : undefined;
		}
		return {
			sessionId: session.id,
			sessionFile: session.path,
			...(session.name ? { name: session.name } : {}),
			createdAt: session.createdAt,
			modifiedAt: session.modifiedAt,
			...(parent && parent.id !== session.id ? { parentSessionId: parent.id } : {}),
			...(forkTurnId ? { forkTurnId } : {}),
			inheritedTurns,
			turns,
		};
	});
	sessions.sort((a, b) => a.createdAt - b.createdAt);
	return { cwd, sessions };
}

/** 读取一组会话文件并建图（读失败的文件跳过：并发写入中/已删除） */
export async function loadForestGraph(cwd: string, paths: readonly string[]): Promise<ForestGraph> {
	const files = (
		await Promise.all(
			paths.map(async (path) => {
				try {
					return { path, content: await readFile(path, "utf8") };
				} catch {
					return null;
				}
			}),
		)
	).filter((file): file is ForestSourceFile => file !== null);
	return buildForestGraph(cwd, files);
}
