/**
 * 首帧前写入 data-theme：主题由主进程经 ?theme= 传入（与窗口 backgroundColor 同源，
 * 见 main/window.ts），splash 配色与 body 底色因此零等待即正确。
 * 缺参（如浏览器直开）回退系统偏好；theme store init 之后以同值覆盖，幂等。
 */
const param = new URLSearchParams(location.search).get("theme");
const system = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
// dracula 是深色配色变体：data-theme 仍为 dark（沿用全部深色样式），data-palette 覆写色板
document.documentElement.dataset.theme =
	param === "dracula" ? "dark" : param === "dark" || param === "light" ? param : system;
document.documentElement.dataset.palette = param === "dracula" ? "dracula" : "default";
