import { useT } from "../../i18n";
import type { DraftComment } from "../../stores/drafts";
import { CloseIcon, PencilIcon } from "../icons";
import { Tooltip } from "../ui/Tooltip";
import { quoteSummary } from "./quote";

/**
 * Composer 中的批注包：选段和说明放在同一个可编辑单元里，避免用户看到的内容
 * 与最终发送的结构脱节；多个包可以独立删除或修改。
 */
export function CommentPackageCard({
	comment,
	onCommentChange,
	onRemove,
}: {
	comment: DraftComment;
	onCommentChange: (value: string) => void;
	onRemove: () => void;
}) {
	const t = useT();
	const summary = quoteSummary(comment.quote);
	return (
		<div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-hover/45 px-2.5 py-2">
			<div className="flex min-w-0 items-center gap-1.5">
				<span className="flex shrink-0 items-center gap-1 text-ui-11 text-ink-faint">
					<PencilIcon size={10} />
					{t("composer.commentSelection")}
				</span>
				<Tooltip label={comment.quote}>
					<span className="min-w-0 truncate text-ui-12 text-ink-2">{summary}</span>
				</Tooltip>
				<button
					type="button"
					aria-label={t("composer.removeComment")}
					className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface hover:text-ink-2"
					onClick={onRemove}
				>
					<CloseIcon size={9} />
				</button>
			</div>
			<textarea
				aria-label={t("composer.commentInput")}
				rows={2}
				value={comment.comment}
				onChange={(event) => onCommentChange(event.target.value)}
				className="min-h-10 w-full resize-none rounded-md border border-border bg-canvas px-2 py-1.5 text-ui-12 leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-border-strong"
				placeholder={t("composer.commentInputPlaceholder")}
			/>
		</div>
	);
}
