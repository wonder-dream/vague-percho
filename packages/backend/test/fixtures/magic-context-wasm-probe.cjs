const Module = require("node:module");
const { dirname, join } = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
	const ortCjs = require.resolve("onnxruntime-web");
	const ort = await import(pathToFileURL(join(dirname(ortCjs), "ort.node.min.mjs")).href);
	globalThis[Symbol.for("onnxruntime")] = ort;
	const originalLoad = Module._load;
	Module._load = function (request, parent, isMain) {
		if (request === "onnxruntime-node") throw new Error("native runtime must not be loaded");
		return originalLoad.call(this, request, parent, isMain);
	};
	const bundle = join(
		dirname(ortCjs),
		"..",
		"..",
		"@cortexkit",
		"pi-magic-context",
		"dist",
		"transformers.node-3zqr6k1w.js",
	);
	const transformers = await import(pathToFileURL(bundle).href);
	console.log(
		JSON.stringify({ ok: true, nativeLoaded: false, fsCache: transformers.env.useFSCache === true }),
	);
})().catch((error) => {
	console.error(error?.stack || error);
	process.exit(1);
});
