import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionBusy, useSessionReadOnly } from "../../hooks/use-session-state";
import { useT } from "../../i18n";
import { COMPOSER_FOCUS_EVENT, createDraftComment, useDraftStore } from "../../stores/drafts";
import { useSessionsStore } from "../../stores/sessions";
import { useTranscriptStore } from "../../stores/transcript";

/** 菜单与选区的间距 */
const GAP = 8;
/** 普通菜单的水平 clamp 半宽 */
const MENU_HALF_WIDTH = 132;
/** 批注输入框的近似高度，用于把面板限制在视口内 */
const ANNOTATION_HEIGHT = 220;

interface SelectionState {
	text: string;
	rect: DOMRect;
}

interface AnnotationState extends SelectionState {
	comment: string;
}

/**
 * 对话区选中文字浮出菜单：点击「添加到对话」后，批注输入框锚定在原选区附近；
 * 确认后把选段和说明作为一个批注包放进当前草稿。批注输入框打开期间不再依赖
 * 浏览器 selection 的生命周期，因此点击 textarea 不会让面板因为选区塌陷而消失。
 */
export function SelectionToolbar({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
	const t = useT();
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const readOnly = useSessionReadOnly();
	const busy = useSessionBusy(activeSessionId);
	const [pending, setPending] = useState<SelectionState | null>(null);
	const [annotation, setAnnotation] = useState<AnnotationState | null>(null);
	const [visible, setVisible] = useState(false);
	const [forking, setForking] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);
	const annotationInputRef = useRef<HTMLTextAreaElement>(null);
	const visibleRef = useRef(false);
	const annotationRef = useRef(false);
	/** 上/下放置：true = 选区上方（translate -100%），false = 下方 */
	const [above, setAbove] = useState(true);

	visibleRef.current = visible;
	annotationRef.current = annotation !== null;

	const hide = useCallback(() => {
		setVisible(false);
		setPending(null);
		setAnnotation(null);
	}, []);

	/** 选区归属判定：锚点在对话滚动容器内且不在菜单自身内 */
	const ownsSelection = useCallback(() => {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
		const container = containerRef.current;
		const menu = menuRef.current;
		const node = sel.anchorNode;
		if (!node || !container?.contains(node) || menu?.contains(node)) return null;
		const text = sel.toString().trim();
		if (!text) return null;
		return { text, rect: sel.getRangeAt(0).getBoundingClientRect() };
	}, [containerRef]);

	// selectionchange：非空选区持续缓存（拖选过程不显示，等 mouseup）；塌陷即收起。
	// 批注输入框打开后，textarea 的焦点会让原生 selection 塌陷，此时必须保留面板。
	useEffect(() => {
		if (readOnly) return;
		const onChange = () => {
			if (annotationRef.current) return;
			const owned = ownsSelection();
			if (!owned) {
				if (visibleRef.current) hide();
				return;
			}
			setPending(owned);
		};
		document.addEventListener("selectionchange", onChange);
		return () => document.removeEventListener("selectionchange", onChange);
	}, [readOnly, ownsSelection, hide]);

	// mouseup 显示 / pointerdown 外点收起 / scroll·resize 跟随重算。
	useEffect(() => {
		if (readOnly) return;
		let raf = 0;
		const syncPosition = () => {
			if (annotationRef.current) return;
			const owned = ownsSelection();
			if (!owned) {
				hide();
				return;
			}
			setPending(owned);
		};
		const onMouseUp = () => {
			if (annotationRef.current) return;
			const owned = ownsSelection();
			if (!owned) return;
			setAbove(owned.rect.top > 120);
			setPending(owned);
			setVisible(true);
		};
		const onPointerDown = (e: PointerEvent) => {
			if (!visibleRef.current) return;
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) hide();
		};
		const onScroll = () => {
			if (!visibleRef.current || annotationRef.current) return;
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(syncPosition);
		};
		document.addEventListener("mouseup", onMouseUp);
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onScroll);
		return () => {
			cancelAnimationFrame(raf);
			document.removeEventListener("mouseup", onMouseUp);
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onScroll);
		};
	}, [readOnly, ownsSelection, hide]);

	useEffect(() => {
		if (!annotation) return;
		requestAnimationFrame(() => annotationInputRef.current?.focus());
	}, [annotation]);

	// 会话切换即收起（旧选区/旧定位不再有意义）
	// biome-ignore lint/correctness/useExhaustiveDependencies: activeSessionId 是刻意的重跑触发器（切换会话时收起旧菜单）
	useEffect(() => {
		hide();
	}, [activeSessionId, hide]);

	/** 先清理选区和菜单，等界面提交后再把输入焦点交给 Composer。 */
	const consumeAndFocus = useCallback(
		(sessionId: string) => {
			window.getSelection()?.removeAllRanges();
			hide();
			requestAnimationFrame(() => {
				if (useSessionsStore.getState().activeSessionId !== sessionId) return;
				window.dispatchEvent(new CustomEvent(COMPOSER_FOCUS_EVENT, { detail: { moveToEnd: true } }));
			});
		},
		[hide],
	);

	const addToChat = () => {
		if (!pending || !activeSessionId) return;
		setAbove(pending.rect.top > ANNOTATION_HEIGHT + GAP);
		setAnnotation({ ...pending, comment: "" });
		setVisible(true);
	};

	const confirmAnnotation = () => {
		if (!annotation || !activeSessionId) return;
		const comment = annotation.comment.trim();
		if (!comment) return;
		useDraftStore.getState().updateDraft(activeSessionId, (d) => ({
			...d,
			comments: [...d.comments, createDraftComment(annotation.text, comment)],
		}));
		consumeAndFocus(activeSessionId);
	};

	const cancelAnnotation = () => {
		window.getSelection()?.removeAllRanges();
		hide();
	};

	const continueInNewChat = async () => {
		if (!pending || busy || forking || !activeSessionId) return;
		const messages = useTranscriptStore.getState().bySession[activeSessionId]?.messages ?? [];
		const lastAssistant = [...messages].reverse().find((m) => m.kind === "assistant");
		if (!lastAssistant) return;
		const quote = pending.text;
		const ref = lastAssistant.entryId
			? { entryId: lastAssistant.entryId }
			: { text: lastAssistant.sourceText ?? lastAssistant.text };
		setForking(true);
		try {
			const newId = await useSessionsStore.getState().forkSession(ref);
			if (!newId) return;
			useDraftStore.getState().updateDraft(newId, (d) => ({ ...d, quotes: [...d.quotes, quote] }));
			consumeAndFocus(newId);
		} finally {
			setForking(false);
		}
	};

	if (!visible || !pending || readOnly) return null;
	const anchor = annotation ?? pending;
	const { rect } = anchor;
	const panelWidth = annotation ? Math.min(360, Math.max(0, window.innerWidth - 16)) : MENU_HALF_WIDTH * 2;
	const halfWidth = panelWidth / 2;
	const left = Math.min(
		Math.max(rect.left + rect.width / 2, halfWidth + 8),
		window.innerWidth - halfWidth - 8,
	);
	const top = annotation
		? above
			? Math.max(ANNOTATION_HEIGHT + 8, rect.top - GAP)
			: Math.min(Math.max(rect.bottom + GAP, 8), window.innerHeight - ANNOTATION_HEIGHT - 8)
		: Math.min(Math.max(above ? rect.top - GAP : rect.bottom + GAP, 8), window.innerHeight - 48);

	if (annotation) {
		return (
			<div
				ref={menuRef}
				role="dialog"
				aria-label={t("selection.annotationTitle")}
				className="selection-pop fixed z-50 flex max-h-[calc(100vh-16px)] flex-col gap-2 rounded-xl border border-border bg-surface p-3 shadow-pop"
				style={{
					left,
					top,
					width: panelWidth,
					transform: `translate(-50%, ${above ? "-100%" : "0"})`,
				}}
				onMouseDown={(e) => {
					if (!(e.target instanceof HTMLTextAreaElement)) e.preventDefault();
				}}
			>
				<p className="max-h-20 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-hover px-2.5 py-2 text-ui-12 leading-relaxed text-ink-2">
					{annotation.text}
				</p>
				<textarea
					ref={annotationInputRef}
					value={annotation.comment}
					rows={3}
					placeholder={t("selection.annotationPlaceholder")}
					className="selection-annotation-input w-full resize-none rounded-lg border border-border bg-canvas px-2.5 py-2 text-ui-13 leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-border-strong"
					onChange={(e) =>
						setAnnotation((current) => (current ? { ...current, comment: e.target.value } : current))
					}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							e.preventDefault();
							cancelAnnotation();
						}
					}}
				/>
				<div className="flex items-center justify-end gap-1.5">
					<button type="button" className="selection-menu-btn" onClick={cancelAnnotation}>
						{t("selection.annotationCancel")}
					</button>
					<button
						type="button"
						className="selection-menu-btn font-medium disabled:cursor-not-allowed disabled:opacity-40"
						disabled={!annotation.comment.trim()}
						onClick={confirmAnnotation}
					>
						{t("selection.annotationConfirm")}
					</button>
				</div>
			</div>
		);
	}

	return (
		<div
			ref={menuRef}
			role="menu"
			className="selection-pop fixed z-50 flex items-center gap-0.5 rounded-xl bg-surface p-1 shadow-pop"
			style={{
				left,
				top,
				transform: `translate(-50%, ${above ? "-100%" : "0"})`,
			}}
			onMouseDown={(e) => e.preventDefault()}
		>
			<button type="button" role="menuitem" className="selection-menu-btn" onClick={addToChat}>
				{t("selection.addToChat")}
			</button>
			<span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border" />
			<button
				type="button"
				role="menuitem"
				className="selection-menu-btn disabled:opacity-40"
				disabled={busy || forking}
				title={busy ? t("selection.busyHint") : undefined}
				onClick={() => void continueInNewChat()}
			>
				{t("selection.continueNew")}
			</button>
		</div>
	);
}
