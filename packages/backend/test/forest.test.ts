import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { buildForestGraph, loadForestGraph, toForestTurnDetail, toForestTurns } from "../src/session/forest";

const user = (text: string, timestamp: number): Message => ({ role: "user", content: text, timestamp });
const assistant = (text: string, timestamp: number, extra: Record<string, unknown> = {}): Message =>
	({
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic",
		provider: "anthropic",
		model: "claude",
		timestamp,
		...extra,
	}) as unknown as Message;

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("toForestTurns", () => {
	it("把频道唤醒作为独立轮次并归属后续回复", () => {
		const sm = SessionManager.inMemory();
		sm.appendMessage(user("Original", 1));
		sm.appendMessage(assistant("First reply", 2));
		const wake = sm.appendCustomMessageEntry("channel-wake", "[channel:review] 查收", true);
		sm.appendMessage(assistant("Reviewed", 3));
		expect(toForestTurns(sm.getBranch())).toMatchObject([
			{ question: "Original", answer: "First reply" },
			{ userEntryId: wake, question: "[channel:review] 查收", answer: "Reviewed" },
		]);
	});

	it("folds assistant replies and tool calls into the preceding question", () => {
		const sm = SessionManager.inMemory();
		const q1 = sm.appendMessage(user("Q1", 1));
		sm.appendMessage({
			role: "assistant",
			content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }],
			api: "anthropic",
			provider: "anthropic",
			model: "claude",
			timestamp: 2,
		} as unknown as Message);
		const a1 = sm.appendMessage(assistant("A1", 3));
		const q2 = sm.appendMessage(user("Q2", 4));
		sm.appendMessage(assistant("", 5, { stopReason: "error", errorMessage: "boom" }));
		const turns = toForestTurns(sm.getBranch());
		expect(turns).toHaveLength(2);
		expect(turns[0]).toMatchObject({
			userEntryId: q1,
			assistantEntryId: a1,
			question: "Q1",
			answer: "A1",
			toolCount: 1,
		});
		expect(turns[1]).toMatchObject({ userEntryId: q2, answer: "boom", errored: true });
	});
});

describe("toForestTurnDetail", () => {
	it("returns the full turn with tool outputs and stops at the next question", () => {
		const dir = mkdtempSync(join(tmpdir(), "forest-detail-"));
		dirs.push(dir);
		const sm = SessionManager.create(dir, dir);
		const long = "x".repeat(2000);
		const q1 = sm.appendMessage(user("Q1", 1));
		sm.appendMessage({
			role: "assistant",
			content: [
				{ type: "text", text: "looking" },
				{ type: "toolCall", id: "c1", name: "read", arguments: { path: "a" } },
			],
			api: "anthropic",
			provider: "anthropic",
			model: "claude",
			timestamp: 2,
		} as unknown as Message);
		sm.appendMessage({
			role: "toolResult",
			toolCallId: "c1",
			toolName: "read",
			content: [{ type: "text", text: "file body" }],
			isError: false,
			timestamp: 3,
		} as unknown as Message);
		sm.appendMessage(assistant(long, 4));
		sm.appendMessage(user("Q2", 5));
		sm.appendMessage(assistant("A2", 6));
		const content =
			readdirSync(dir)
				.filter((name) => name.endsWith(".jsonl"))
				.map((name) => readFileSync(join(dir, name), "utf8"))[0] ?? "";
		const detail = toForestTurnDetail(content, q1);
		expect(detail.question).toBe("Q1");
		expect(detail.answers).toEqual(["looking", long]);
		expect(detail.tools).toEqual([
			{ name: "read", args: JSON.stringify({ path: "a" }), output: "file body", isError: false },
		]);
		expect(detail.truncated).toBe(false);
		expect(() => toForestTurnDetail(content, "missing")).toThrow();
	});
});

describe("buildForestGraph", () => {
	it("links a SDK fork to the last shared turn of its parent", async () => {
		const dir = mkdtempSync(join(tmpdir(), "forest-"));
		dirs.push(dir);
		const parent = SessionManager.create(dir, dir);
		const q1 = parent.appendMessage(user("Q1", 1));
		const a1 = parent.appendMessage(assistant("A1", 2));
		parent.appendMessage(user("Q2", 3));
		parent.appendMessage(assistant("A2", 4));
		const parentFile = parent.getSessionFile();
		expect(parentFile).toBeTruthy();

		const fork = SessionManager.open(parentFile as string, dir);
		fork.createBranchedSession(a1);
		fork.appendMessage(user("Q2-alt", 5));
		fork.appendMessage(assistant("A2-alt", 6));

		const files = readdirSync(dir)
			.filter((name) => name.endsWith(".jsonl"))
			.map((name) => join(dir, name));
		expect(files).toHaveLength(2);
		const graph = await loadForestGraph(dir, files);
		const root = graph.sessions.find((session) => session.sessionId === parent.getSessionId());
		const child = graph.sessions.find((session) => session.sessionId === fork.getSessionId());
		expect(root?.turns.map((turn) => turn.question)).toEqual(["Q1", "Q2"]);
		expect(child).toMatchObject({
			parentSessionId: parent.getSessionId(),
			forkTurnId: q1,
			inheritedTurns: 1,
		});
		expect(child?.turns.map((turn) => turn.question)).toEqual(["Q1", "Q2-alt"]);
	});

	it("ignores unparsable files and unknown parents", () => {
		const graph = buildForestGraph("/x", [
			{ path: "/x/bad.jsonl", content: "not json" },
			{
				path: "/x/a.jsonl",
				content: `${JSON.stringify({ type: "session", version: 3, id: "a", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/x", parentSession: "/elsewhere.jsonl" })}\n`,
			},
		]);
		expect(graph.sessions).toHaveLength(1);
		expect(graph.sessions[0]?.parentSessionId).toBeUndefined();
		expect(graph.sessions[0]?.inheritedTurns).toBe(0);
	});
});
