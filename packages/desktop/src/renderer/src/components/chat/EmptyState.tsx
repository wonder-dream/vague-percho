import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { useProjectsStore } from "../../stores/projects";
import { useSessionsStore } from "../../stores/sessions";
import { Composer } from "../composer/Composer";
import { ProjectBranchPicker } from "../session/ProjectBranchPicker";

const HEADLINES = [
	{ name: "Vague", slogan: "emptyState.vagueSlogan" },
	{ name: "Dream", slogan: "emptyState.dreamSlogan" },
] as const;

function EmptyStateHeadline() {
	const t = useT();
	const [choice] = useState(() => Math.floor(Math.random() * HEADLINES.length));
	const headline = HEADLINES[choice] ?? HEADLINES[0];
	return (
		<h1 className="text-center text-ui-28 min-[721px]:text-ui-32 font-normal leading-[1.4] tracking-[-0.015em] text-ink">
			<span className="mr-3 inline-block text-ui-36 min-[721px]:text-ui-40 font-medium text-ink-faint">
				{headline.name}
			</span>{" "}
			{t(headline.slogan)}
		</h1>
	);
}

/** 空态：居中 slogan、输入框与项目/分支选择。 */
export function EmptyState() {
	const load = useProjectsStore((s) => s.load);
	const viewId = useSessionsStore((s) => s.activeSessionId ?? s.newSessionDraft?.generation ?? "new");

	useEffect(() => {
		void load();
	}, [load]);

	return (
		<div className="flex h-full flex-col items-center justify-center gap-8 px-8 pb-[8vh]">
			<div className="flex min-h-20 w-full max-w-[760px] items-center justify-center min-[721px]:mb-2 min-[721px]:min-h-24">
				<EmptyStateHeadline key={viewId} />
			</div>
			<Composer centered />
			<ProjectBranchPicker />
		</div>
	);
}
