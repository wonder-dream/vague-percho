import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { useLanStore } from "../store";
import { ArrowUpIcon, StopIcon } from "./icons";

/**
 * 远程输入区（M2）：remoteControl 开启时才由 App 渲染。
 * 发送：agent 运行中默认 steer（当前工具跑完即插入引导，不打断整轮），可切到 followUp 排队。
 * 停止：运行中才可用。readOnly（subagent 产物）会话整区禁用。
 * UX v3：悬浮毛玻璃条 + 同位单按钮状态切换（与桌面端同构）：运行中且无输入 → 停止
 * （黑白钮 + 实心方块，与发送同色同位）；有输入文本 → 发送（按当前投递方式）。
 * 移动端没有 Ctrl 键：运行中显示一个投递方式胶囊，点一下在「插入引导 / 排队」之间切换。
 */
export function Composer({ sessionId }: { sessionId: string }) {
	const sendPrompt = useLanStore((s) => s.sendPrompt);
	const abortSession = useLanStore((s) => s.abortSession);
	const agentActive = useLanStore((s) => s.views[sessionId]?.agentActive ?? false);
	/** 会话未在桌面打开（无视图）→ 不能远程发消息（prompt 会 404），给提示 */
	const hasView = useLanStore((s) => Boolean(s.views[sessionId]));
	const readOnly = useLanStore((s) => s.list.find((item) => item.sessionId === sessionId)?.readOnly ?? false);
	const [text, setText] = useState("");
	/** 运行中投递方式：默认中途插入引导；移动端靠胶囊切换，桌面浏览器也可 Ctrl/⌘+Enter 直接排队。 */
	const [mode, setMode] = useState<"steer" | "followUp">("steer");
	const [sending, setSending] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const areaRef = useRef<HTMLTextAreaElement>(null);
	const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (noticeTimer.current) clearTimeout(noticeTimer.current);
		};
	}, []);

	const showNotice = (message: string) => {
		setNotice(message);
		if (noticeTimer.current) clearTimeout(noticeTimer.current);
		noticeTimer.current = setTimeout(() => setNotice(null), 3000);
	};

	/** 服务端错误串 → 本地化提示（已知错误映射，未知原文显示）。 */
	const showError = (error: string) => {
		if (error.includes("remote control disabled")) return showNotice(t("composer.disabled"));
		if (error.includes("read-only")) return showNotice(t("composer.readonly"));
		if (error === "network error") return showNotice(t("toast.failed"));
		showNotice(error);
	};

	const autoGrow = () => {
		const el = areaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
	};

	const send = async (override?: "steer" | "followUp") => {
		const value = text.trim();
		if (!value || sending || readOnly) return;
		const behavior = override ?? mode;
		setSending(true);
		const wasActive = agentActive;
		const error = await sendPrompt(sessionId, value, behavior);
		setSending(false);
		if (error) {
			showError(error);
			return;
		}
		setText("");
		requestAnimationFrame(autoGrow);
		if (wasActive) showNotice(t(behavior === "steer" ? "composer.steered" : "composer.queued"));
	};

	const abort = async () => {
		const error = await abortSession(sessionId);
		if (error) showError(error);
	};

	if (readOnly || !hasView) {
		return (
			<div className="composer-zone">
				<div className="composer-readonly">{readOnly ? t("composer.readonly") : t("composer.closed")}</div>
			</div>
		);
	}

	const canSend = !sending && Boolean(text.trim());
	// 同位单按钮（与桌面端同构）：运行中且无输入 → 停止；否则发送（运行中发送 = followUp 排队）
	const showStop = agentActive && !canSend;
	return (
		<div className="composer-zone">
			{notice && <div className="queue-hint">{notice}</div>}
			<div className="composer-bar">
				<textarea
					ref={areaRef}
					className="composer-input"
					rows={1}
					placeholder={t("composer.placeholder")}
					value={text}
					disabled={sending}
					onChange={(e) => {
						setText(e.target.value);
						autoGrow();
					}}
					onKeyDown={(e) => {
						// Enter 发送、Shift+Enter 换行（移动端输入法合成期不触发）；Ctrl/⌘+Enter 强制排队
						if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
							e.preventDefault();
							void send(e.ctrlKey || e.metaKey ? "followUp" : undefined);
						}
					}}
				/>
				{agentActive && (
					<button
						type="button"
						className="mode-chip"
						data-mode={mode}
						onClick={() => setMode((prev) => (prev === "steer" ? "followUp" : "steer"))}
						aria-label={t("composer.modeToggle")}
						title={t("composer.modeToggle")}
					>
						{t(mode === "steer" ? "composer.modeSteer" : "composer.modeQueue")}
					</button>
				)}
				{showStop ? (
					<button
						type="button"
						className="c-btn send stop"
						onClick={() => void abort()}
						aria-label={t("composer.stop")}
					>
						<StopIcon size={11} />
					</button>
				) : (
					<button
						type="button"
						className={`c-btn send${canSend ? "" : " off"}`}
						disabled={!canSend}
						onClick={() => void send()}
						aria-label={t("composer.send")}
					>
						<ArrowUpIcon size={16} />
					</button>
				)}
			</div>
		</div>
	);
}
