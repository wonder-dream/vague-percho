import { useT } from "../../i18n";
import { UndoIcon } from "../icons";

/**
 * 运行中待投递消息条：steer（中途插入引导）与 followUp（本轮结束后排队）分组展示，
 * 各自按受理顺序排列；取回时一次恢复两条队列（clearQueue 同时清空）。
 */
export function QueueBar({
	steering,
	followUp,
	onRestore,
}: {
	steering: readonly string[];
	followUp: readonly string[];
	onRestore: () => void;
}) {
	const t = useT();
	const groups = [
		{ key: "steer", label: t("composer.steerTitle"), texts: steering },
		{ key: "followUp", label: t("composer.queueTitle"), texts: followUp },
	].filter((group) => group.texts.length > 0);
	return (
		<div className="group/queue relative mb-1.5 flex items-start gap-2 overflow-hidden rounded-xl bg-surface px-3 py-1.5 shadow-soft">
			<div className="min-w-0 max-h-24 flex-1 overflow-y-auto thin-scrollbar">
				{groups.map((group) => (
					<div key={group.key} className="flex items-baseline gap-2">
						<span className="shrink-0 text-ui-12 text-ink-faint">{group.label}</span>
						<span className="min-w-0 whitespace-pre-line break-words text-ui-13 text-ink-2">
							{group.texts.join("\n")}
						</span>
					</div>
				))}
			</div>
			{/* 撤销层：hover 行才显示；渐变模糊压住下方文字，仅镂空图标可点（防误点） */}
			<div className="pointer-events-none absolute inset-y-0 right-0 flex w-14 items-center justify-end pr-2.5 opacity-0 transition-opacity group-hover/queue:opacity-100">
				<span
					className="absolute inset-0 bg-gradient-to-l from-surface/60 to-transparent backdrop-blur-[3px] [mask-image:linear-gradient(to_left,black_45%,transparent)]"
					aria-hidden="true"
				/>
				<button
					type="button"
					className="pointer-events-auto relative flex items-center justify-center text-ink-faint transition-colors hover:text-ink-2"
					aria-label={t("composer.queueRestore")}
					onClick={onRestore}
				>
					<UndoIcon size={14} />
				</button>
			</div>
		</div>
	);
}
