import { useEffect, useState } from "react";
import type { Language } from "../../i18n";
import { useI18nStore, useT } from "../../i18n";
import { useSettingsStore } from "../../stores/settings";
import { Select } from "../ui/Select";
import { CacheWarmingSettings } from "./CacheWarmingSettings";
import { SettingsSwitchRow } from "./SettingsSwitchRow";
import { TaskNotificationSettings } from "./TaskNotificationSettings";

const LANGUAGES: Language[] = ["zh", "en"];

/** 通用设置面板（上下文蒸发为内置常开策略，不提供开关） */
export function GeneralPanel() {
	const t = useT();
	const codemodeEnabled = useSettingsStore((s) => s.codemodeEnabled);
	const codemodeSaving = useSettingsStore((s) => s.codemodeSaving);
	const setCodemodeEnabled = useSettingsStore((s) => s.setCodemodeEnabled);
	const codemodeOnly = useSettingsStore((s) => s.codemodeOnly);
	const setCodemodeOnly = useSettingsStore((s) => s.setCodemodeOnly);
	const language = useI18nStore((s) => s.language);
	const setLanguage = useI18nStore((s) => s.setLanguage);
	const channelWatchEnabled = useSettingsStore((s) => s.channelWatchEnabled);
	const setChannelWatchEnabled = useSettingsStore((s) => s.setChannelWatchEnabled);
	const magicContextEnabled = useSettingsStore((s) => s.magicContextEnabled);
	const setMagicContextEnabled = useSettingsStore((s) => s.setMagicContextEnabled);
	const magicContextHfEndpoint = useSettingsStore((s) => s.magicContextHfEndpoint);
	const setMagicContextHfEndpoint = useSettingsStore((s) => s.setMagicContextHfEndpoint);

	return (
		<div className="flex flex-col gap-6">
			<TaskNotificationSettings />
			<CacheWarmingSettings />
			<SettingsSwitchRow
				title={t("settings.codemode")}
				hint={t("settings.codemodeHint")}
				checked={codemodeEnabled === true}
				disabled={codemodeEnabled === null || codemodeSaving}
				onCheckedChange={(enabled) => void setCodemodeEnabled(enabled)}
			/>
			<SettingsSwitchRow
				title={t("settings.magicContext")}
				hint={t("settings.magicContextHint")}
				checked={magicContextEnabled === true}
				disabled={magicContextEnabled === null}
				onCheckedChange={(enabled) => void setMagicContextEnabled(enabled)}
			/>
			{magicContextEnabled === true && magicContextHfEndpoint !== null && (
				<HfEndpointField value={magicContextHfEndpoint} onSave={setMagicContextHfEndpoint} />
			)}
			<div>
				<SettingsSwitchRow
					title={t("settings.codemodeOnly")}
					hint={t("settings.codemodeOnlyHint")}
					checked={codemodeOnly === true}
					disabled={codemodeEnabled !== true || codemodeOnly === null || codemodeSaving}
					onCheckedChange={(only) => void setCodemodeOnly(only)}
				/>
			</div>
			<div>
				<div className="flex items-center justify-between gap-4">
					<div className="min-w-0">
						<h3 className="text-ui-13 font-medium text-ink">{t("settings.language")}</h3>
						<p className="mt-0.5 text-ui-11 text-ink-faint">{t("settings.languageHint")}</p>
					</div>
					<div className="shrink-0">
						<Select
							variant="ghost"
							ariaLabel={t("settings.language")}
							value={language}
							options={LANGUAGES.map((lang) => ({ value: lang, label: t(`lang.${lang}`) }))}
							onChange={(value) => setLanguage(value as Language)}
						/>
					</div>
				</div>
			</div>
			<SettingsSwitchRow
				title={t("settings.channelWatch")}
				hint={t("settings.channelWatchHint")}
				checked={channelWatchEnabled === true}
				disabled={channelWatchEnabled === null}
				onCheckedChange={(enabled) => void setChannelWatchEnabled(enabled)}
			/>
		</div>
	);
}

/** Magic Context 嵌入模型下载镜像：失焦或回车保存，空 = 官方 huggingface.co */
function HfEndpointField({ value, onSave }: { value: string; onSave: (endpoint: string) => Promise<void> }) {
	const t = useT();
	const [draft, setDraft] = useState(value);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	useEffect(() => setDraft(value), [value]);
	const commit = async () => {
		if (draft.trim() === value) return;
		try {
			await onSave(draft);
			setError(null);
			setSaved(true);
			window.setTimeout(() => setSaved(false), 1500);
		} catch (err) {
			setError(err instanceof Error ? err.message.replace(/^.*Error: /, "") : String(err));
		}
	};
	return (
		<div className="-mt-3 flex flex-col gap-1 pl-0">
			<label className="text-ui-12 text-ink-2" htmlFor="mc-hf-endpoint">
				{t("settings.magicContextMirror")}
			</label>
			<div className="flex items-center gap-2">
				<input
					id="mc-hf-endpoint"
					className="min-w-0 flex-1 rounded-md border border-border bg-canvas px-2 py-1 text-ui-12 text-ink outline-none placeholder:text-ink-faint focus:border-border-strong"
					placeholder="https://huggingface.co"
					spellCheck={false}
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={() => void commit()}
					onKeyDown={(event) => {
						if (event.key === "Enter") void commit();
						if (event.key === "Escape") setDraft(value);
					}}
				/>
				{saved && <span className="text-ui-11 text-ok">{t("settings.saved")}</span>}
			</div>
			<p className={`text-ui-11 ${error ? "text-err" : "text-ink-faint"}`}>
				{error ?? t("settings.magicContextMirrorHint")}
			</p>
		</div>
	);
}
