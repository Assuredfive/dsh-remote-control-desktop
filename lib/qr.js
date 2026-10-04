// 本地二维码生成。
//
// 上游用 https://api.qrserver.com 的外链图片来显示二维码，问题有两个：
//   1) 完全依赖境外服务，Electron 渲染进程里可能被拦，用户看到的就是一块空白；
//   2) 会把用户自己的穿透地址（含公网域名）发给第三方。
// 这里改成用本机依赖 qrcode（MIT）生成 PNG，由本机 8092 直接返回。
import QRCode from "qrcode";

const cache = new Map();
const CACHE_MAX = 32;

/**
 * @param {string} text  要编码的内容（通常是公网访问 URL）
 * @param {number} size  输出边长像素，默认 320
 * @returns {Promise<Buffer>} PNG 字节
 */
export async function qrPng(text, size) {
	const s = Math.max(96, Math.min(1024, Number(size) | 0 || 320));
	const key = s + "|" + text;
	const hit = cache.get(key);
	if (hit) return hit;
	const buf = await QRCode.toBuffer(String(text), {
		type: "png",
		margin: 2,
		width: s,
		errorCorrectionLevel: "M",
	});
	cache.set(key, buf);
	if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
	return buf;
}
