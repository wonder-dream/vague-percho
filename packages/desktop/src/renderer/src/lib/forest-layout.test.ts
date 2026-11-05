import type { ForestGraph, ForestSession, ForestTurn } from "@percho/shared";
import { describe, expect, it } from "vitest";
import { FOREST_CARD_HEIGHT, FOREST_CARD_WIDTH, layoutForest, overlayLiveTurns } from "./forest-layout";

const turn = (id: string): ForestTurn => ({
	userEntryId: id,
	assistantEntryId: `${id}-a`,
	question: id,
	answer: "",
	toolCount: 0,
	errored: false,
	timestamp: 0,
});
const session = (id: string, turns: string[], extra: Partial<ForestSession> = {}): ForestSession => ({
	sessionId: id,
	sessionFile: `/p/${id}.jsonl`,
	createdAt: 0,
	modifiedAt: 0,
	inheritedTurns: 0,
	turns: turns.map(turn),
	...extra,
});
const empty = { version: 1 as const, positions: {}, collapsed: [] };

describe("layoutForest", () => {
	const graph: ForestGraph = {
		cwd: "/p",
		sessions: [
			session("root", ["q1", "q2", "q3"], { createdAt: 1 }),
			session("fork", ["q1", "f2"], {
				createdAt: 2,
				parentSessionId: "root",
				forkTurnId: "q1",
				inheritedTurns: 1,
			}),
			session("solo", ["s1"], { createdAt: 3 }),
		],
	};

	it("places a chain on one row and branches the fork below its anchor", () => {
		const view = layoutForest(graph, empty);
		const at = (key: string) => view.cards.find((card) => card.key === key);
		expect(view.cards.map((card) => card.key)).toEqual([
			"root:q1",
			"root:q2",
			"root:q3",
			"fork:f2",
			"solo:s1",
		]);
		expect(at("root:q2")).toMatchObject({ y: 0, x: FOREST_CARD_WIDTH + 64 });
		// 分支从分叉卡下一列开始，开新行
		expect(at("fork:f2")).toMatchObject({ x: at("root:q2")?.x, turnNumber: 2, branch: true });
		expect(at("fork:f2")?.y).toBeGreaterThan(0);
		expect(at("solo:s1")?.y).toBeGreaterThan(at("fork:f2")?.y ?? 0);
		expect(view.edges).toContainEqual({ from: "root:q1", to: "fork:f2", fork: true });
		expect(view.edges).toContainEqual({ from: "root:q1", to: "root:q2", fork: false });
	});

	it("hides descendants of a collapsed card and honors saved positions", () => {
		const view = layoutForest(graph, {
			version: 1,
			positions: { "solo:s1": { x: 5, y: 7 } },
			collapsed: ["root:q1"],
		});
		expect(view.cards.map((card) => card.key)).toEqual(["root:q1", "solo:s1"]);
		expect(view.hiddenCounts["root:q1"]).toBe(3);
		expect(view.cards.find((card) => card.key === "solo:s1")).toMatchObject({ x: 5, y: 7 });
		expect(view.height).toBeGreaterThanOrEqual(FOREST_CARD_HEIGHT);
	});

	it("gives an empty fork a placeholder card", () => {
		const view = layoutForest(
			{
				cwd: "/p",
				sessions: [
					session("root", ["q1"]),
					session("f", ["q1"], { parentSessionId: "root", forkTurnId: "q1", inheritedTurns: 1 }),
				],
			},
			empty,
		);
		expect(view.cards.find((card) => card.key === "f:empty")).toMatchObject({ turn: null, head: true });
	});
});

describe("overlayLiveTurns", () => {
	const base: ForestGraph = { cwd: "/p", sessions: [session("s", ["q1", "q2"])] };
	it("streams into the last persisted turn when the question matches", () => {
		const next = overlayLiveTurns(base, new Map([["s", { question: "q2", answer: "partial" }]]));
		expect(next.sessions[0]?.turns.map((t) => [t.question, t.answer])).toEqual([
			["q1", ""],
			["q2", "partial"],
		]);
	});
	it("appends a live card for a question not yet on disk", () => {
		const next = overlayLiveTurns(base, new Map([["s", { question: "q3", answer: "" }]]));
		expect(next.sessions[0]?.turns.at(-1)).toMatchObject({ userEntryId: "live", question: "q3" });
		expect(layoutForest(next, empty).cards.at(-1)?.key).toBe("s:live");
	});
	it("returns the same graph without live sessions", () => {
		expect(overlayLiveTurns(base, new Map())).toBe(base);
	});
});
