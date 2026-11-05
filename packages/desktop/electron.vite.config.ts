import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin({ exclude: ["@percho/backend", "@percho/shared"] })],
		build: {
			rollupOptions: {
				input: {
					index: resolve(__dirname, "src/main/index.ts"),
					"session-media-worker": resolve(__dirname, "../backend/src/session/media-maintenance-worker.ts"),
				},
				output: {
					entryFileNames: (chunk) =>
						chunk.name === "session-media-worker" ? "session-media-worker.mjs" : "[name].js",
				},
				// magic-context 自带 worker（new Worker(new URL(...))）与 wasm 资源，必须保持 node_modules 原样加载
				external: ["@earendil-works/pi-coding-agent", "@cortexkit/pi-magic-context"],
			},
		},
		resolve: {
			alias: {
				"@percho/backend": resolve(__dirname, "../backend/src/index.ts"),
				"@percho/shared": resolve(__dirname, "../shared/src/index.ts"),
			},
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin({ exclude: ["@percho/shared"] })],
		build: {
			rollupOptions: {
				output: {
					format: "cjs",
					entryFileNames: "index.cjs",
				},
			},
		},
		resolve: {
			alias: {
				"@percho/shared": resolve(__dirname, "../shared/src/index.ts"),
			},
		},
	},
	renderer: {
		resolve: {
			alias: {
				"@percho/shared": resolve(__dirname, "../shared/src/index.ts"),
				"@renderer": resolve(__dirname, "src/renderer/src"),
			},
		},
		plugins: [react(), tailwindcss()],
	},
});
