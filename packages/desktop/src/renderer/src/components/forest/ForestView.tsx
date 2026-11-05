import type { ForestTurn } from "@percho/shared";
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import {
	FOREST_CARD_HEIGHT,
	FOREST_CARD_WIDTH,
	type ForestCard,
	forestEdgePath,
	layoutForest,
} from "../../lib/forest-layout";
import { useForestStore } from "../../stores/forest";
import { useSessionsStore } from "../../stores/sessions";
import { useTranscriptStore } from "../../stores/transcript";
import { Markdown } from "../chat/Markdown";
import {
	ArrowUpIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	CloseIcon,
	ForkIcon,
	LayoutGridIcon,
	LocateIcon,
	PencilIcon,
	PlusIcon,
	RefreshIcon,
	UndoIcon,
} from "../icons";
import { Tooltip } from "../ui/Tooltip";

/** 卡片预览：去掉 Markdown 标记，只留可读文本（完整渲染在详情栏） */
export function plainPreview(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?(```|$)/g, (block) => block.replace(/```\w*/g, "").trim())
		.replace(/^\s*\|?\s*:?-{3,}.*$/gm, "")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/^\s*>\s?/gm, "")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/(\*\*|__|\*|_|~~|`)(\S.*?\S|\S)\1/g, "$2")
		.replace(/\|/g, " ")
		.replace(/[ \t]+/g, " ")
		.replace(/\n{2,}/g, "\n")
		.trim();
}

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 4;
const PADDING = 48;

interface Camera {
	x: number;
	y: number;
	zoom: number;
}

interface Composer {
	cardKey: string;
	mode: "continue" | "fork";
}

function IconButton({
	label,
	onClick,
	children,
	align = "center",
}: {
	label: string;
	onClick: () => void;
	children: React.ReactNode;
	align?: "center" | "start" | "end";
}) {
	return (
		<Tooltip label={label} align={align}>
			<button
				type="button"
				aria-label={label}
				className="flex size-7 items-center justify-center rounded-md text-ink-dim transition-colors hover:bg-hover hover:text-ink"
				onClick={onClick}
			>
				{children}
			</button>
		</Tooltip>
	);
}

/** 单张轮次卡片 */
function TurnCard({
	card,
	active,
	selected,
	running,
	collapsed,
	hiddenCount,
	hasChildren,
	composer,
	onSelect,
	onDragStart,
	onToggleCollapse,
	onCompose,
	onCloseComposer,
}: {
	card: ForestCard;
	active: boolean;
	selected: boolean;
	running: boolean;
	collapsed: boolean;
	hiddenCount: number;
	hasChildren: boolean;
	composer: Composer | null;
	onSelect: () => void;
	onDragStart: (event: ReactPointerEvent) => void;
	onToggleCollapse: () => void;
	onCompose: (mode: Composer["mode"]) => void;
	onCloseComposer: () => void;
}) {
	const t = useT();
	const turn = card.turn;
	return (
		<div
			data-forest-card={card.key}
			className={`absolute flex flex-col rounded-lg border bg-surface shadow-soft transition-[border-color,box-shadow] ${
				selected ? "border-accent" : active ? "border-ink-faint" : "border-border hover:border-border-strong"
			}`}
			style={{
				left: card.x,
				top: card.y,
				width: FOREST_CARD_WIDTH,
				height: composer ? undefined : FOREST_CARD_HEIGHT,
				minHeight: FOREST_CARD_HEIGHT,
				zIndex: composer || selected ? 2 : 1,
			}}
		>
			{/* 拖动把手：整个头部，点击（无位移）= 选中 */}
			<div
				className="flex cursor-grab items-start gap-2 px-3 pt-3 active:cursor-grabbing"
				onPointerDown={onDragStart}
			>
				<span
					className={`mt-1.5 size-2 shrink-0 rounded-full ${
						running
							? "animate-pulse bg-accent"
							: turn?.errored
								? "bg-err"
								: active
									? "bg-accent"
									: "bg-ink-faint"
					}`}
				/>
				<div className="min-w-0 flex-1">
					<div className="line-clamp-2 text-ui-13 font-medium text-ink">
						{turn ? turn.question : t("forest.emptyBranch")}
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-ui-11 text-ink-faint">
						{card.head && card.branch && <span className="text-accent">{t("forest.branch")}</span>}
						{card.head && card.sessionName && <span className="max-w-40 truncate">{card.sessionName}</span>}
						<span>{t("forest.turn", { n: card.turnNumber })}</span>
						{turn?.errored && <span className="text-err">{t("forest.failed")}</span>}
						{turn && turn.toolCount > 0 && <span>{t("forest.tools", { count: turn.toolCount })}</span>}
					</div>
				</div>
			</div>
			<button
				type="button"
				className="mx-3 mt-2 flex min-h-0 flex-1 items-start overflow-hidden text-left text-ui-12 leading-relaxed text-ink-2"
				style={{ maxHeight: composer ? 96 : undefined }}
				onClick={onSelect}
			>
				<span className={`whitespace-pre-line break-words ${composer ? "line-clamp-4" : "line-clamp-6"}`}>
					{turn ? (turn.answer ? plainPreview(turn.answer) : t("forest.noAnswer")) : ""}
				</span>
			</button>
			{composer && <CardComposer card={card} mode={composer.mode} onClose={onCloseComposer} />}
			<div className="flex items-center gap-0.5 border-t border-border px-1.5 py-1">
				{hasChildren && (
					<IconButton
						label={collapsed ? t("forest.expand") : t("forest.collapse")}
						onClick={onToggleCollapse}
						align="start"
					>
						{collapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}
					</IconButton>
				)}
				{collapsed && hiddenCount > 0 && (
					<span className="text-ui-11 text-ink-faint">{t("forest.hidden", { count: hiddenCount })}</span>
				)}
				<div className="flex-1" />
				{turn && (
					<IconButton label={t("forest.continue")} onClick={() => onCompose("continue")}>
						<PlusIcon size={14} />
					</IconButton>
				)}
				{turn?.assistantEntryId && (
					<IconButton label={t("forest.fork")} onClick={() => onCompose("fork")}>
						<ForkIcon size={14} />
					</IconButton>
				)}
				<IconButton label={t("forest.detail")} onClick={onSelect} align="end">
					<ChevronRightIcon size={14} />
				</IconButton>
			</div>
		</div>
	);
}

/** 卡片内联输入框（追问 / 分支） */
function CardComposer({
	card,
	mode,
	onClose,
}: {
	card: ForestCard;
	mode: Composer["mode"];
	onClose: () => void;
}) {
	const t = useT();
	const ask = useForestStore((s) => s.ask);
	const quote = useForestStore((s) => s.composer?.quote);
	const phrases = useForestStore((s) => s.phrases);
	const setPhrases = useForestStore((s) => s.setPhrases);
	const [editingPhrases, setEditingPhrases] = useState(false);
	const [newPhrase, setNewPhrase] = useState("");
	const [text, setText] = useState("");
	const [sending, setSending] = useState(false);
	const ref = useRef<HTMLTextAreaElement>(null);
	useEffect(() => ref.current?.focus(), []);
	const submit = async () => {
		if (!text.trim() || sending) return;
		setSending(true);
		const quoted = quote
			? `${quote
					.split("\n")
					.map((line) => `> ${line}`)
					.join("\n")}\n\n${text}`
			: text;
		const ok = await ask({
			sessionId: card.sessionId,
			sessionFile: card.sessionFile,
			mode,
			assistantEntryId: card.turn?.assistantEntryId,
			text: quoted,
		});
		setSending(false);
		if (ok) onClose();
	};
	return (
		<div className="mx-3 mt-2 flex flex-col gap-1.5" onPointerDown={(event) => event.stopPropagation()}>
			{quote && (
				<blockquote className="line-clamp-3 border-l-2 border-accent pl-2 text-ui-11 text-ink-dim">
					{quote}
				</blockquote>
			)}
			<div className="flex flex-wrap items-center gap-1">
				{phrases.map((phrase, index) => (
					<span key={phrase} className="inline-flex items-center">
						<button
							type="button"
							className="rounded-md border border-border px-1.5 py-0.5 text-ui-11 text-ink-2 hover:bg-hover"
							onClick={() => {
								setText((current) => (current.trim() ? `${current.trimEnd()}，${phrase}` : phrase));
								ref.current?.focus();
							}}
						>
							{phrase}
						</button>
						{editingPhrases && (
							<button
								type="button"
								aria-label={t("forest.removePhrase")}
								className="ml-0.5 text-ink-faint hover:text-err"
								onClick={() => setPhrases(phrases.filter((_, i) => i !== index))}
							>
								<CloseIcon size={11} />
							</button>
						)}
					</span>
				))}
				{editingPhrases ? (
					<input
						value={newPhrase}
						placeholder={t("forest.addPhrase")}
						className="w-24 rounded-md border border-border bg-canvas px-1.5 py-0.5 text-ui-11 text-ink outline-none"
						onChange={(event) => setNewPhrase(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && newPhrase.trim()) {
								setPhrases([...phrases, newPhrase.trim()]);
								setNewPhrase("");
							}
							if (event.key === "Escape") setEditingPhrases(false);
						}}
					/>
				) : null}
				<IconButton
					label={editingPhrases ? t("forest.donePhrases") : t("forest.editPhrases")}
					onClick={() => setEditingPhrases((value) => !value)}
				>
					{editingPhrases ? <CheckIcon size={12} /> : <PencilIcon size={12} />}
				</IconButton>
			</div>
			<textarea
				ref={ref}
				value={text}
				rows={3}
				disabled={sending}
				placeholder={mode === "fork" ? t("forest.forkPlaceholder") : t("forest.continuePlaceholder")}
				className="w-full resize-none rounded-md border border-border bg-canvas px-2 py-1.5 text-ui-12 text-ink outline-none placeholder:text-ink-faint focus:border-border-strong"
				onChange={(event) => setText(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") onClose();
					if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
						event.preventDefault();
						void submit();
					}
				}}
			/>
			<div className="flex justify-end gap-1">
				<IconButton label={t("forest.cancel")} onClick={onClose}>
					<CloseIcon size={14} />
				</IconButton>
				<Tooltip label={t("forest.send")} align="end">
					<button
						type="button"
						aria-label={t("forest.send")}
						disabled={!text.trim() || sending}
						className="flex size-7 items-center justify-center rounded-full bg-accent text-on-accent transition-opacity disabled:opacity-40"
						onClick={() => void submit()}
					>
						<ArrowUpIcon size={14} />
					</button>
				</Tooltip>
			</div>
		</div>
	);
}

/** 右侧详情栏：本轮完整提问 + 回答（Markdown），以及打开/追问/分支入口 */
function Inspector({
	card,
	onClose,
	onCompose,
}: {
	card: ForestCard;
	onClose: () => void;
	onCompose: (mode: Composer["mode"], quote?: string) => void;
}) {
	const t = useT();
	const openSession = useForestStore((s) => s.openSession);
	const loadDetail = useForestStore((s) => s.loadDetail);
	const detail = useForestStore((s) => s.details[card.key]);
	const turn: ForestTurn | null = card.turn;
	useEffect(() => {
		if (turn) void loadDetail(card.key, card.sessionFile, turn.userEntryId);
	}, [card.key, card.sessionFile, turn, loadDetail]);
	const full = detail && !("error" in detail) ? detail : undefined;
	const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	// 在回答里选中文字 → 浮出「追问」按钮，带引文打开卡片输入框
	const captureSelection = () => {
		const current = window.getSelection();
		const text = current?.toString().trim() ?? "";
		if (!current || !text || current.rangeCount === 0 || !bodyRef.current?.contains(current.anchorNode)) {
			setSelection(null);
			return;
		}
		const rect = current.getRangeAt(0).getBoundingClientRect();
		const host = bodyRef.current.getBoundingClientRect();
		setSelection({
			text: text.slice(0, 2000),
			x: rect.left - host.left + rect.width / 2,
			y: rect.top - host.top,
		});
	};
	// 选区稳定后（松开鼠标/键盘扩选结束）再定位按钮：selectionchange 在拖选过程中连续触发，防抖到停顿
	useEffect(() => {
		let timer = 0;
		const onChange = () => {
			window.clearTimeout(timer);
			timer = window.setTimeout(captureSelection, 180);
		};
		document.addEventListener("selectionchange", onChange);
		return () => {
			window.clearTimeout(timer);
			document.removeEventListener("selectionchange", onChange);
		};
	});
	return (
		<aside className="flex h-full w-[min(420px,40%)] min-w-72 shrink-0 flex-col border-l border-border bg-canvas">
			<div className="flex items-start gap-2 px-4 pt-3 pb-2">
				<div className="min-w-0 flex-1">
					<div className="text-ui-11 text-ink-faint">
						{card.sessionName ? `${card.sessionName} · ` : ""}
						{t("forest.turn", { n: card.turnNumber })}
					</div>
				</div>
				<IconButton label={t("forest.close")} onClick={onClose} align="end">
					<CloseIcon size={14} />
				</IconButton>
			</div>
			<div
				ref={bodyRef}
				className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-4"
				onScroll={() => setSelection(null)}
			>
				<h3 className="text-ui-11 font-medium text-ink-faint">{t("forest.question")}</h3>
				<p className="mt-1 whitespace-pre-wrap break-words text-ui-13 text-ink">
					{full?.question ?? turn?.question ?? t("forest.emptyBranch")}
				</p>
				{turn && (
					<>
						<h3 className="mt-4 text-ui-11 font-medium text-ink-faint">{t("forest.answer")}</h3>
						<div className="mt-1 flex flex-col gap-3 text-ui-13">
							{full ? (
								full.answers.length > 0 ? (
									full.answers.map((answer, index) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: 同一轮的回答分段只追加不重排
										<Markdown key={index} text={answer} />
									))
								) : (
									<span className="text-ink-faint">{t("forest.noAnswer")}</span>
								)
							) : turn.answer ? (
								<Markdown text={turn.answer} />
							) : (
								<span className="text-ink-faint">{t("forest.noAnswer")}</span>
							)}
							{full?.truncated && <p className="text-ui-11 text-warn">{t("forest.truncated")}</p>}
							{detail && "error" in detail && <p className="text-ui-11 text-err">{detail.error}</p>}
						</div>
						{full && full.tools.length > 0 && (
							<details className="mt-4">
								<summary className="cursor-pointer text-ui-11 font-medium text-ink-faint">
									{t("forest.tools", { count: full.tools.length })}
								</summary>
								<ul className="mt-2 flex flex-col gap-2">
									{full.tools.map((tool, index) => (
										<li
											// biome-ignore lint/suspicious/noArrayIndexKey: 工具调用顺序固定
											key={index}
											className="rounded-md border border-border bg-surface px-2 py-1.5 text-ui-11"
										>
											<div className={`font-medium ${tool.isError ? "text-err" : "text-ink-2"}`}>
												{tool.name}
											</div>
											<div className="mt-0.5 truncate font-mono text-ink-faint">{tool.args}</div>
											{tool.output && (
												<pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-ink-dim">
													{tool.output}
												</pre>
											)}
										</li>
									))}
								</ul>
							</details>
						)}
					</>
				)}
				{selection && turn && (
					<button
						type="button"
						className="absolute z-10 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-md bg-ink px-2 py-1 text-ui-11 text-on-ink shadow-pop"
						style={{ left: selection.x, top: selection.y - 6 + (bodyRef.current?.scrollTop ?? 0) }}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => {
							onCompose("continue", selection.text);
							setSelection(null);
							window.getSelection()?.removeAllRanges();
						}}
					>
						<PlusIcon size={12} />
						{t("forest.askSelection")}
					</button>
				)}
			</div>
			<div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2">
				{turn && (
					<button
						type="button"
						className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-ui-12 text-ink-2 hover:bg-hover"
						onClick={() => onCompose("continue")}
					>
						<PlusIcon size={13} />
						{t("forest.continue")}
					</button>
				)}
				{turn?.assistantEntryId && (
					<button
						type="button"
						className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-ui-12 text-ink-2 hover:bg-hover"
						onClick={() => onCompose("fork")}
					>
						<ForkIcon size={13} />
						{t("forest.fork")}
					</button>
				)}
				<button
					type="button"
					className="rounded-md bg-accent px-2.5 py-1 text-ui-12 text-on-accent hover:opacity-90"
					onClick={() => void openSession(card.sessionId, card.sessionFile)}
				>
					{t("forest.open")}
				</button>
			</div>
		</aside>
	);
}

export function ForestView() {
	const t = useT();
	const cwd = useSessionsStore((s) => s.cwd);
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const { graph, loading, error, layout, selected } = useForestStore();
	const { refresh, select, moveCard, toggleCollapsed, resetLayout, setOpen } = useForestStore.getState();
	const runningIds = useTranscriptStore((s) =>
		Object.entries(s.bySession)
			.filter(([, entry]) => entry.agentActive)
			.map(([id]) => id)
			.join("|"),
	);
	const running = useMemo(() => new Set(runningIds.split("|").filter(Boolean)), [runningIds]);

	useEffect(() => {
		if (cwd) void refresh(cwd);
	}, [cwd, refresh]);
	// 有会话在跑时轮询，结束一轮就能看到新卡
	useEffect(() => {
		if (!cwd || running.size === 0) return;
		const timer = window.setInterval(() => void refresh(cwd), 2500);
		return () => window.clearInterval(timer);
	}, [cwd, running.size, refresh]);

	// 拖动中的临时位置（松手才写布局）
	const [dragging, setDragging] = useState<{ key: string; x: number; y: number } | null>(null);
	const view = useMemo(() => {
		if (!graph) return null;
		const positions = dragging
			? { ...layout.positions, [dragging.key]: { x: dragging.x, y: dragging.y } }
			: layout.positions;
		return layoutForest(graph, { ...layout, positions });
	}, [graph, layout, dragging]);

	const [camera, setCamera] = useState<Camera>({ x: PADDING, y: PADDING, zoom: 1 });
	// 首次拿到图（及换项目）时缩放到全图可见，最大 100%
	const fittedFor = useRef<string | null>(null);
	useEffect(() => {
		const rect = viewportRef.current?.getBoundingClientRect();
		if (!view || !cwd || fittedFor.current === cwd || !rect || view.cards.length === 0) return;
		fittedFor.current = cwd;
		const zoom = Math.max(
			MIN_ZOOM,
			Math.min(1, (rect.width - PADDING * 2) / view.width, (rect.height - PADDING * 2) / view.height),
		);
		setCamera({ zoom, x: PADDING, y: Math.max(PADDING, (rect.height - view.height * zoom) / 2) });
	}, [view, cwd]);
	const composer = useForestStore((s) => s.composer);
	const setComposer = useForestStore((s) => s.openComposer);
	const closeComposer = useForestStore((s) => s.closeComposer);
	const viewportRef = useRef<HTMLDivElement>(null);

	const cardByKey = useMemo(() => new Map((view?.cards ?? []).map((card) => [card.key, card])), [view]);
	const parentKeys = useMemo(() => new Set((view?.edges ?? []).map((edge) => edge.from)), [view]);
	const collapsedSet = useMemo(() => new Set(layout.collapsed), [layout.collapsed]);
	const selectedCard = selected ? cardByKey.get(selected) : undefined;

	/** 把卡片移到视口中央；minZoom 用于需要阅读/输入的场景（输入框在 36% 下没法用） */
	const centerOn = (card: ForestCard, minZoom = 0) => {
		const rect = viewportRef.current?.getBoundingClientRect();
		if (!rect) return;
		setCamera((current) => {
			const zoom = Math.max(current.zoom, minZoom);
			return {
				zoom,
				x: rect.width / 2 - (card.x + FOREST_CARD_WIDTH / 2) * zoom,
				y: rect.height / 2 - (card.y + FOREST_CARD_HEIGHT / 2) * zoom,
			};
		});
	};
	const locate = () => {
		const cards = view?.cards.filter((card) => card.sessionId === activeSessionId) ?? [];
		const target = cards[cards.length - 1];
		if (target) centerOn(target);
	};

	const zoomAt = (nextZoom: number, clientX?: number, clientY?: number) => {
		const rect = viewportRef.current?.getBoundingClientRect();
		if (!rect) return;
		const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
		const px = (clientX ?? rect.left + rect.width / 2) - rect.left;
		const py = (clientY ?? rect.top + rect.height / 2) - rect.top;
		setCamera((current) => ({
			zoom,
			x: px - ((px - current.x) / current.zoom) * zoom,
			y: py - ((py - current.y) / current.zoom) * zoom,
		}));
	};

	// 滚轮：Ctrl/⌘ = 缩放，否则平移（触控板双指）
	useEffect(() => {
		const element = viewportRef.current;
		if (!element) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			if (event.ctrlKey || event.metaKey) {
				setCamera((current) => {
					const rect = element.getBoundingClientRect();
					const zoom = Math.min(
						MAX_ZOOM,
						Math.max(MIN_ZOOM, current.zoom * Math.exp(-event.deltaY * 0.0015)),
					);
					const px = event.clientX - rect.left;
					const py = event.clientY - rect.top;
					return {
						zoom,
						x: px - ((px - current.x) / current.zoom) * zoom,
						y: py - ((py - current.y) / current.zoom) * zoom,
					};
				});
			} else {
				setCamera((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
			}
		};
		element.addEventListener("wheel", onWheel, { passive: false });
		return () => element.removeEventListener("wheel", onWheel);
	}, []);

	// 背景拖动 = 平移画布
	const panFrom = (event: ReactPointerEvent) => {
		if (event.button !== 0 || event.target !== event.currentTarget) return;
		const start = { x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y };
		const move = (moveEvent: PointerEvent) =>
			setCamera((current) => ({
				...current,
				x: start.cx + moveEvent.clientX - start.x,
				y: start.cy + moveEvent.clientY - start.y,
			}));
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	// 卡片头部拖动：位移 < 4px 视为点击选中
	const dragCard = (card: ForestCard) => (event: ReactPointerEvent) => {
		if (event.button !== 0) return;
		event.stopPropagation();
		const start = { x: event.clientX, y: event.clientY };
		let moved = false;
		let last = { x: card.x, y: card.y };
		const move = (moveEvent: PointerEvent) => {
			const dx = (moveEvent.clientX - start.x) / camera.zoom;
			const dy = (moveEvent.clientY - start.y) / camera.zoom;
			if (!moved && Math.hypot(dx, dy) < 4) return;
			moved = true;
			last = { x: Math.round(card.x + dx), y: Math.round(card.y + dy) };
			setDragging({ key: card.key, ...last });
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			if (moved) moveCard(card.key, last);
			else select(card.key);
			setDragging(null);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	const openComposer = (card: ForestCard, mode: Composer["mode"], quote?: string) => {
		setComposer(card.key, mode, quote);
		centerOn(card, 1);
	};

	let body: React.ReactNode = null;
	if (!cwd) body = <p className="m-auto text-ui-13 text-ink-faint">{t("forest.pickProject")}</p>;
	else if (error) body = <p className="m-auto max-w-md text-center text-ui-13 text-err">{error}</p>;
	else if (!view) body = <p className="m-auto text-ui-13 text-ink-faint">{t("forest.loading")}</p>;
	else if (view.cards.length === 0)
		body = <p className="m-auto text-ui-13 text-ink-faint">{t("forest.empty")}</p>;

	return (
		<div className="flex h-full min-h-0">
			<div className="relative flex min-w-0 flex-1 flex-col">
				<div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-3">
					<IconButton label={t("forest.back")} onClick={() => setOpen(false)} align="start">
						<UndoIcon size={14} />
					</IconButton>
					<span className="ml-1 text-ui-13 font-medium text-ink">{t("forest.title")}</span>
					{loading && <span className="ml-2 size-1.5 animate-pulse rounded-full bg-ink-faint" />}
					<div className="flex-1" />
					<IconButton label={t("forest.refresh")} onClick={() => cwd && void refresh(cwd)}>
						<RefreshIcon size={14} />
					</IconButton>
					<IconButton label={t("forest.arrange")} onClick={resetLayout}>
						<LayoutGridIcon size={14} />
					</IconButton>
					<IconButton label={t("forest.locate")} onClick={locate}>
						<LocateIcon size={14} />
					</IconButton>
					<div className="mx-1 h-4 w-px bg-border" />
					<IconButton label={t("forest.zoomOut")} onClick={() => zoomAt(camera.zoom / 1.2)}>
						<span className="text-ui-13 leading-none">−</span>
					</IconButton>
					<Tooltip label={t("forest.zoomReset")}>
						<button
							type="button"
							className="w-12 rounded-md py-1 text-center text-ui-11 tabular-nums text-ink-dim hover:bg-hover"
							onClick={() => zoomAt(1)}
						>
							{Math.round(camera.zoom * 100)}%
						</button>
					</Tooltip>
					<IconButton label={t("forest.zoomIn")} onClick={() => zoomAt(camera.zoom * 1.2)} align="end">
						<PlusIcon size={14} />
					</IconButton>
				</div>
				<div
					ref={viewportRef}
					data-forest-viewport=""
					className="forest-grid relative min-h-0 flex-1 cursor-default overflow-hidden"
					style={{
						backgroundPosition: `${camera.x}px ${camera.y}px`,
						backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`,
					}}
					onPointerDown={panFrom}
				>
					{body ? (
						<div className="flex h-full">{body}</div>
					) : (
						view && (
							<div
								className="pointer-events-none absolute top-0 left-0 origin-top-left"
								style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
							>
								<svg
									className="absolute top-0 left-0 overflow-visible"
									width={view.width}
									height={view.height}
									aria-hidden="true"
								>
									{view.edges.map((edge) => {
										const from = cardByKey.get(edge.from);
										const to = cardByKey.get(edge.to);
										if (!from || !to) return null;
										return (
											<path
												key={`${edge.from}->${edge.to}`}
												d={forestEdgePath(from, to)}
												fill="none"
												stroke={edge.fork ? "var(--color-accent)" : "var(--color-border-strong)"}
												strokeWidth={1.5}
												strokeDasharray={edge.fork ? "5 4" : undefined}
											/>
										);
									})}
								</svg>
								<div className="pointer-events-auto">
									{view.cards.map((card) => (
										<TurnCard
											key={card.key}
											card={card}
											active={card.sessionId === activeSessionId}
											selected={card.key === selected}
											running={running.has(card.sessionId)}
											collapsed={collapsedSet.has(card.key)}
											hiddenCount={view.hiddenCounts[card.key] ?? 0}
											hasChildren={parentKeys.has(card.key) || (view.hiddenCounts[card.key] ?? 0) > 0}
											composer={composer?.cardKey === card.key ? composer : null}
											onSelect={() => select(card.key)}
											onDragStart={dragCard(card)}
											onToggleCollapse={() => toggleCollapsed(card.key)}
											onCompose={(mode) => openComposer(card, mode)}
											onCloseComposer={closeComposer}
										/>
									))}
								</div>
							</div>
						)
					)}
				</div>
			</div>
			{selectedCard && (
				<Inspector
					card={selectedCard}
					onClose={() => select(null)}
					onCompose={(mode, quote) => openComposer(selectedCard, mode, quote)}
				/>
			)}
		</div>
	);
}
