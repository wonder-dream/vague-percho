import { useT } from "../../i18n";
import { CloseIcon, PencilIcon } from "../icons";
import { Tooltip } from "../ui/Tooltip";
import { quoteSummary } from "./quote";

/**
 * 选中引用胶囊：无边框纯白悬浮（surface 底 + 阴影，靠阴影从输入框底上浮起）+ 引号 glyph；
 * 多行内容折叠为单行截断，Tooltip 显示单行化摘要；× 移除。
 */
export function QuoteChip({
	quote,
	onRemove,
	annotation = false,
}: {
	quote: string;
	onRemove: () => void;
	annotation?: boolean;
}) {
	const t = useT();
	const summary = quoteSummary(quote);
	const chip = (
		<span className="flex max-w-[220px] select-none items-center gap-1 rounded-md bg-surface px-2 py-0.5 text-ui-12 leading-5 text-ink-2 shadow-pop">
			{annotation && (
				<span
					className="flex shrink-0 items-center gap-1 text-ink-faint"
					title={t("composer.commentSelection")}
				>
					<PencilIcon size={10} />
					<span>{t("composer.commentSelection")}</span>
				</span>
			)}
			{annotation && <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-border" />}
			<span aria-hidden="true" className="font-serif text-ui-13 leading-none text-ink-faint">
				&ldquo;
			</span>
			<span className="min-w-0 truncate">{summary}</span>
			<button
				type="button"
				aria-label={t("composer.removeQuote")}
				onClick={onRemove}
				className="shrink-0 text-ink-faint transition-colors hover:text-ink-2"
			>
				<CloseIcon size={8} />
			</button>
		</span>
	);
	return <Tooltip label={summary}>{chip}</Tooltip>;
}
