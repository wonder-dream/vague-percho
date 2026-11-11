/** 选中引用（quotes）发送拼接的纯函数集合 */

/**
 * 把引用文本数组拼成 markdown blockquote 段落：每条独立成段（空行分隔），
 * 每行加 `> ` 前缀（空行只留 `>` 防尾随空格）。空数组返回空串由调用方过滤。
 */
export function buildQuoteBlock(quotes: string[]): string {
	return quotes
		.map((quote) =>
			quote
				.split("\n")
				.map((line) => (line.trim() ? `> ${line}` : ">"))
				.join("\n"),
		)
		.join("\n\n");
}

/** 把批注目标和用户说明拼成一条可读的 prompt；空说明时只保留引用，方便继续编辑。 */
export function buildCommentBlock(quote: string | null | undefined, comment: string): string {
	if (!quote) return "";
	return [buildQuoteBlock([quote]), comment.trim()].filter(Boolean).join("\n\n");
}

/** 把多个批注包按输入顺序拼成独立段落；包内始终先放选段，再放说明。 */
export function buildCommentBlocks(comments: ReadonlyArray<{ quote: string; comment: string }>): string {
	return comments
		.map(({ quote, comment }) => buildCommentBlock(quote, comment))
		.filter(Boolean)
		.join("\n\n");
}

/** 引用胶囊摘要：折叠全部空白为单空格并截断（Tooltip 展示同款文本） */
export function quoteSummary(quote: string, max = 160): string {
	const flat = quote.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
