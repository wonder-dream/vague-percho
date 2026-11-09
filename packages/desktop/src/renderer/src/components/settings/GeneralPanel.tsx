import { type AvailableModel, environmentKey } from "@percho/shared";
import { useEffect, useState } from "react";
import { useEnvironment } from "../../environment-context";
import type { Language } from "../../i18n";
import { useI18nStore, useT } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { Select } from "../ui/Select";
import { CacheWarmingSettings } from "./CacheWarmingSettings";
import { SettingsSwitchRow } from "./SettingsSwitchRow";
import { TaskNotificationSettings } from "./TaskNotificationSettings";

const LANGUAGES: Language[] = ["zh", "en"];
const NO_AVAILABLE_MODELS: AvailableModel[] = [];

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
	const magicContextModels = useSettingsStore((s) => s.magicContextModels);
	const setMagicContextAgentModel = useSettingsStore((s) => s.setMagicContextAgentModel);
	const environment = useEnvironment();
	const availableModels = useSessionsStore(
		(s) => s.modelsByEnvironment[environmentKey(environment)] ?? NO_AVAILABLE_MODELS,
	);
	const loadModels = useSessionsStore((s) => s.loadModels);
	useEffect(() => {
		if (magicContextEnabled === true) void loadModels(environment);
	}, [environment, loadModels, magicContextEnabled]);

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
			<div>
				<SettingsSwitchRow
					title={t("settings.codemodeOnly")}
					hint={t("settings.codemodeOnlyHint")}
					checked={codemodeOnly === true}
					disabled={codemodeEnabled !== true || codemodeOnly === null || codemodeSaving}
					onCheckedChange={(only) => void setCodemodeOnly(only)}
				/>
			</div>
			<SettingsSwitchRow
				title={t("settings.magicContext")}
				hint={t("settings.magicContextHint")}
				checked={magicContextEnabled === true}
				disabled={magicContextEnabled === null}
				onCheckedChange={(enabled) => void setMagicContextEnabled(enabled)}
			/>
			{magicContextEnabled === true && magicContextHfEndpoint !== null && magicContextModels !== null && (
				<div className="-mt-3 flex flex-col gap-4">
					<HfEndpointField value={magicContextHfEndpoint} onSave={setMagicContextHfEndpoint} />
					<MagicContextModelField
						title={t("settings.magicContextHistorian")}
						hint={t("settings.magicContextHistorianHint")}
						value={magicContextModels.historian}
						models={availableModels}
						onSave={(modelRef) => setMagicContextAgentModel("historian", modelRef)}
					/>
					<MagicContextModelField
						title={t("settings.magicContextDreamer")}
						hint={t("settings.magicContextDreamerHint")}
						value={magicContextModels.dreamer}
						models={availableModels}
						onSave={(modelRef) => setMagicContextAgentModel("dreamer", modelRef)}
					/>
				</div>
			)}
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
		<div className="flex flex-col gap-1 pl-0">
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

function MagicContextModelField({
	title,
	hint,
	value,
	models,
	onSave,
}: {
	title: string;
	hint: string;
	value: string;
	models: AvailableModel[];
	onSave: (modelRef: string | null) => Promise<void>;
}) {
	const t = useT();
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const hasSelectedModel = models.some((model) => `${model.provider}/${model.id}` === value);
	const save = async (next: string) => {
		if (saving || next === value) return;
		setSaving(true);
		setError(null);
		try {
			await onSave(next || null);
		} catch (err) {
			setError(err instanceof Error ? err.message.replace(/^.*Error: /, "") : String(err));
		} finally {
			setSaving(false);
		}
	};
	return (
		<div className="flex flex-col gap-1.5">
			<div className="text-ui-12 text-ink-2">{title}</div>
			<Select
				ariaLabel={title}
				value={value}
				disabled={saving}
				options={[
					{ value: "", label: t("settings.magicContextModelDisabled") },
					...(value && !hasSelectedModel ? [{ value, label: value }] : []),
					...models.map((model) => ({
						value: `${model.provider}/${model.id}`,
						label: `${model.providerName} · ${model.label}`,
					})),
				]}
				onChange={(next) => void save(next)}
			/>
			<p className={`text-ui-11 ${error ? "text-err" : "text-ink-faint"}`}>{error ?? hint}</p>
		</div>
	);
}
