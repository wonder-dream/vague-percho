/** @cortexkit/pi-magic-context 不带类型声明；只用到默认导出（标准 pi 扩展工厂）。 */
declare module "@cortexkit/pi-magic-context" {
	import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

	const factory: ExtensionFactory;
	export default factory;
}
