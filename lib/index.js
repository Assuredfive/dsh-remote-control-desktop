// dsh-remote 主机端：远程代理 + 屏幕流 + 输入注入 + 设置
import { createServer, request as httpRequest } from "node:http";
import { spawn, exec } from "node:child_process";
import net from "node:net";
import { readFileSync, writeFileSync, existsSync, readdir, stat, createReadStream, mkdir, appendFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const name = "remote";
export const inject = ["webServer"];

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = join(__dirname, "screen.ps1");
const SETTINGS_FILE = join(__dirname, "remote-settings.json");
const SCREEN_PORT = 8092;
const FAKE_ORIGIN = (host) => "http://" + host;

// ---------- 设置 ----------
const settings = { controlEnabled: true, compression: true, defaultMode: "smooth", noLock: false };
try {
	if (existsSync(SETTINGS_FILE)) Object.assign(settings, JSON.parse(readFileSync(SETTINGS_FILE, "utf8")));
} catch (_) {}
function saveSettings() {
	try { writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch (_) {}
}

// ---------- PowerShell 工作进程 ----------
let helperProc = null;
function startHelper() {
	if (helperProc && helperProc.exitCode === null) return;
	const helperPath = join(dirname(fileURLToPath(import.meta.url)), "helper.ps1");
	helperProc = spawn("powershell.exe", ["-STA", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helperPath], { stdio: "ignore" });
	helperProc.on("exit", () => { helperProc = null; });
}
let worker = null;
let pendingFrame = null;
let frameSeq = 0;
// 分辨率：优先用上次记录（worker启动前就返回正确值，避免首次状态给默认分辨率）
let screenSize = (settings.screenSize && settings.screenSize.w) ? settings.screenSize : { w: 1920, h: 1080 };
let cursorPos = { x: 0, y: 0 };
let viewerCount = 0;
let lastFrameAt = 0;      // 最近一次帧请求时间（判断查看者是否在线）
let holdState = false;   // worker 当前是否处于 hold（保持唤醒）状态
let captureTimer = null;
let captureParams = null;
const viewers = new Set();

let spawningWorker = false;
function startWorker() {
	if (worker && worker.exitCode === null) return;
	if (spawningWorker) return;  // 防止并发重复生成
	spawningWorker = true;
	startHelper();
	worker = spawn("powershell.exe", ["-STA", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", WORKER_SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
	// 防止 worker 死亡后 stdin 写入触发 EPIPE 导致 dsh 崩溃
	if (worker.stdin) worker.stdin.on("error", () => {});
	let buf = "";
	worker.stdout.on("data", (d) => {
		buf += d.toString("utf8");
		let i;
		while ((i = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, i).trim();
			buf = buf.slice(i + 1);
			if (line.startsWith("SIZE:")) {
				const m = line.slice(5).split("x");
				if (m.length === 2) { screenSize = { w: parseInt(m[0], 10) || 1920, h: parseInt(m[1], 10) || 1080 }; settings.screenSize = screenSize; saveSettings(); console.log("[dsh-remote] screen size:", screenSize); }
			} else if (line.startsWith("POS:")) {
				const m = line.slice(4).split("x");
				if (m.length === 2) { cursorPos = { x: parseInt(m[0], 10) || 0, y: parseInt(m[1], 10) || 0 }; }
			} else if (line === "RDY") {
				mouseBusy = false;  // worker 已处理完上一条鼠标命令，可发下一条
			} else if (line.startsWith("FRAME:")) {
				pendingFrame = line.slice(6);
				frameSeq++;
				writeFrameToViewers(pendingFrame);
			} else if (line.startsWith("ERR:")) {
				console.error("[dsh-remote] worker:", line);
			}
		}
	});
	worker.on("exit", () => {
		worker = null;
		spawningWorker = false;
		if (viewerCount > 0) setTimeout(startWorker, 1000);
	});
	spawningWorker = false;
	console.log("[dsh-remote] screen worker started");
}
function workerCmd(cmd) {
	if (!worker || worker.exitCode !== null) startWorker();
	if (worker && worker.exitCode === null && worker.stdin && worker.stdin.writable) {
		try { worker.stdin.write(cmd + "\n"); } catch (_) {}
	}
}

// ---------- 截屏循环（需求驱动：轮询或流请求都激活，3秒无请求停止） ----------
let demandTimer = null;
function setCapture(p) {
	captureParams = p;
	if (demandTimer) clearTimeout(demandTimer);
	demandTimer = setTimeout(() => { if (captureTimer) { clearInterval(captureTimer); captureTimer = null; } }, 3000);
	if (captureTimer) return;
	if (!p) return;
	startWorker();
	captureTimer = setInterval(() => {
		if (!captureParams) return;
		workerCmd("capture " + captureParams.w + " " + captureParams.h + " " + captureParams.q);
	}, Math.max(100, Math.round(1000 / p.fps)));
}

// ---------- MJPEG 广播 ----------
function writeFrameToViewers(b64) {
	const body = Buffer.from(b64, "base64");
	const chunk = Buffer.concat([
		Buffer.from("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + body.length + "\r\n\r\n"),
		body,
		Buffer.from("\r\n")
	]);
	for (const v of viewers) {
		try { v.write(chunk); } catch (_) {}
	}
}

// ---------- 输入注入 ----------
// 鼠标命令合并+限速：只保留最新位置，每150ms最多发一次——
// 避免逐点发送导致 worker 堆积、松手后桌面鼠标还在逐个移动
let pendingMouse = null;
let lastMouseSent = 0;
let restoreToggle = false;  // ⌂ 按钮切换：恢复全部 ↔ 最小化全部
let mouseBusy = false;  // true = worker 正在处理上一条鼠标命令，等待 RDY
function flushMouse() {
	if (pendingMouse && !mouseBusy) {
		const now = Date.now();
		if (now - lastMouseSent >= 100) {
			workerCmd("mouse " + pendingMouse.x + " " + pendingMouse.y);
			lastMouseSent = now;
			mouseBusy = true;
			pendingMouse = null;
		}
	}
}
setInterval(flushMouse, 40);
// 查看者在线时保持系统/显示器唤醒（防锁屏），离线后恢复
setInterval(() => {
	const active = Date.now() - lastFrameAt < 10000;  // 10秒内有帧请求=在线
	const wantHold = active || settings.noLock;  // 防锁屏开关开启时始终保持唤醒
	if (wantHold && !holdState) { workerCmd("hold"); holdState = true; }
	else if (!wantHold && holdState) { workerCmd("release"); holdState = false; }
}, 5000);
function injectInput(body) {
	if (!settings.controlEnabled) return { ok: false, reason: "control-disabled" };
	const t = body && body.type;
	if (t === "mouse") {
		pendingMouse = { x: Math.round(body.x), y: Math.round(body.y) };  // 合并，只留最新
	} else if (t === "click") { flushMouse(); workerCmd("click " + body.button); }
	else if (t === "key") workerCmd("key " + (body.text || ""));
	else if (t === "keytext") workerCmd("keytext " + (body.text || ""));
	else if (t === "keyenter") workerCmd("keyenter");
	else if (t === "keyback") workerCmd("keyback");
	else if (t === "ime") workerCmd("ime");
	else if (t === "restoreall") { restoreToggle = !restoreToggle; workerCmd(restoreToggle ? "restoreall" : "minimizeall"); }
	else if (t === "scroll") workerCmd("click " + body.dir);
	else if (t === "wheelup") workerCmd("wheelup");
	else if (t === "wheeldown") workerCmd("wheeldown");
	else return { ok: false, reason: "bad-input" };
	return { ok: true };
}

// ---------- 查看页面 ----------
const VIEWER_HTML = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>远程屏幕</title>
<style>
html,body{margin:0;background:#000;height:100%;overflow:hidden}
body{display:flex;flex-direction:row}
#screen{flex:1;display:flex;align-items:center;justify-content:center;position:relative;min-width:0;overflow:hidden}
img#view{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;touch-action:none;user-select:none;-webkit-user-select:none}
img#view.rotimg{transform:rotate(90deg);object-fit:contain}
#side{width:56px;background:#334155;border-left:1px solid #64748b;display:flex;flex-direction:column;gap:8px;padding:8px;align-items:center}
#side button{width:34px;height:34px;border:none;border-radius:7px;cursor:pointer;padding:0;font-size:16px;line-height:34px}
#side button.on{outline:2px solid #fff}
#mode-btn{background:#22c55e}
#rot-btn{background:#8b5cf6}
#kbd-btn{background:#06b6d4}
#close-btn{background:#64748b}
#status{color:#e2e8f0;font-size:11px;text-align:center;word-break:break-all;cursor:pointer;background:#475569;border-radius:6px;padding:4px 2px;width:100%;line-height:1.4}
/* 菜单位置跟随手机方向：竖屏→底部横条(文字正)；横屏→右侧竖栏(文字正) */
body.menu-bottom{flex-direction:column}
body.menu-bottom #side{flex-direction:row;width:auto;height:56px;justify-content:space-around;padding:6px;align-items:center;border-left:none;border-top:1px solid #64748b}
body.menu-bottom #side button{width:38px;height:38px;flex:none;font-size:18px;line-height:38px}
body.menu-bottom #screen{flex:1}
body.menu-bottom #kbd{right:0}
#kbd{position:fixed;left:0;right:84px;bottom:0;padding:6px;background:#111;display:none;display:none;align-items:center;gap:6px}
#kbd input{flex:1;padding:10px;font-size:16px;border-radius:6px;border:none;box-sizing:border-box}
#kbd-enter{flex:0 0 auto;width:56px;padding:10px 0;font-size:18px;border-radius:6px;border:none;background:#06b6d4;color:#fff;cursor:pointer}
#kbd-back{flex:0 0 auto;width:56px;padding:10px 0;font-size:18px;border-radius:6px;border:none;background:#f59e0b;color:#fff;cursor:pointer}
</style></head><body>
<div id="screen"><img id="view" alt="远程屏幕"><div id="cursor" style="position:absolute;display:none;pointer-events:none;z-index:5;width:22px;height:22px;margin-left:-1px;margin-top:-1px"><svg width="22" height="22" viewBox="0 0 22 22" style="display:block"><path d="M1,1 L1,19 L5.5,14.5 L8,20 L10.5,18.5 L8,13 L13.5,13 Z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg></div></div>
<div id="side">
  <button id="mode-btn" class="on" title="画质:流畅(点击切换)" aria-label="画质"><svg viewBox="0 0 24 24" width="20" height="20" style="display:block;margin:auto"><path d="M13 2 L5.5 13.5 L10.5 13.5 L9 21 L18.5 8.5 L12.5 8.5 Z" fill="#fff"/></svg></button>
  <button id="rot-btn" title="旋转" aria-label="旋转">↻</button>
  <button id="zoom-btn" title="放大精确操控" aria-label="放大">🔍</button>
  <button id="restore-btn" title="恢复所有最小化窗口" aria-label="恢复窗口">⌂</button>
  <button id="kbd-btn" title="键盘" aria-label="键盘">⌨</button>
  <button id="close-btn" title="关闭" aria-label="关闭">✖</button>
  <button id="mouse-btn" title="鼠标：单击=点击，双击=双击" aria-label="鼠标">🖱</button>
</div>
<div id="kbd"><input id="keys" placeholder="输入文字后发送到电脑"><button id="kbd-back" title="发送退格到电脑" aria-label="退格">⌫</button><button id="kbd-enter" title="发送回车到电脑" aria-label="回车">⏎</button></div>
<script>
var DBG = function (m) { var el = document.getElementById("status"); if (el) el.textContent = m; };
DBG("脚本启动…");
var screenW = 1920, screenH = 1080;
var img = document.getElementById("view");
var mode = "smooth";
var ctrlOk = true;
var modes = { smooth: [640,360,50,5], hd: [960,540,60,3], full: [1280,720,70,2] };
var pollTimer = null;
var showRate = false;      // false=状态(控制/分辨率), true=实时速率
var rateBytes = 0, rateT0 = Date.now();
var lastUrl = "";
var statusFetched = false;
// 图片加载完成后统计实际传输字节（performance API；用绝对URL匹配，定期清理缓冲）
img.onload = function () {
	// 首次帧加载成功后重新取状态：worker刚重启时首次status可能返回默认分辨率，导致鼠标映射偏移
	if (!statusFetched) { statusFetched = true; loadStatus(); }
	if (lastUrl && window.performance && performance.getEntriesByName) {
		try {
			var absUrl = new URL(lastUrl, location.href).href;
			var es = performance.getEntriesByName(absUrl);
			if (es.length) rateBytes += es[es.length - 1].transferSize || 0;
			if (typeof performance.clearResourceTimings === "function") performance.clearResourceTimings();
		} catch (_) {}
	}
};
function fetchFrame(m) {
	var p = modes[m];
	lastUrl = "remote-screen/frame?w=" + p[0] + "&h=" + p[1] + "&q=" + p[2] + "&fps=" + p[3] + "&t=" + Date.now();
	img.src = lastUrl; // 直连加载（稳定，与之前验证通过的方式一致）
}
function startPoll(m) {
	if (pollTimer) clearInterval(pollTimer);
	var p = modes[m];
	fetchFrame(m);
	pollTimer = setInterval(function () { fetchFrame(m); }, Math.max(150, Math.round(1000 / p[3])));
	// 每秒刷新状态文字（速率或状态）
	if (window.__rateTimer) clearInterval(window.__rateTimer);
	window.__rateTimer = setInterval(updateStatus, 1000);
}
var modeNames = { smooth: "流畅", hd: "标清", full: "高清" };
var modeColors = { smooth: "#22c55e", hd: "#eab308", full: "#ef4444" };  // 绿=快/低清, 黄=中, 红=高画质
var modeOrder = ["smooth", "hd", "full"];
function setMode(m) {
	mode = m;
	DBG("已启动，请求状态…");
	var mb = document.getElementById("mode-btn");
	if (mb) {
		mb.style.background = modeColors[m];
		mb.title = "画质:" + modeNames[m] + "(点击切换)";
	}
	startPoll(m);
	loadStatus();
}
// 鼠标按钮：单击=左键点击，双击=左键双击（在光标当前位置）
var mouseTapTimer = null;
document.getElementById("mouse-btn").onclick = function () {
	if (mouseTapTimer) { clearTimeout(mouseTapTimer); mouseTapTimer = null; send("click", { button: "left" }); setTimeout(function () { send("click", { button: "left" }); }, 80); }
	else { mouseTapTimer = setTimeout(function () { mouseTapTimer = null; send("click", { button: "left" }); }, 300); }
};
// 画质三合一：点击循环切换 流畅⚡ → 标清⚡⚡ → 高清⚡⚡⚡
document.getElementById("mode-btn").onclick = function () {
	var i = modeOrder.indexOf(mode);
	setMode(modeOrder[(i + 1) % modeOrder.length]);
};
setMode("smooth");

function loadStatus() {
	fetch("remote-screen/status").then(function (r) { return r.json(); }).then(function (s) {
		screenW = s.screenW; screenH = s.screenH; ctrlOk = s.controlEnabled;
		updateStatus();
	}).catch(function (e) {
		DBG("状态请求失败: " + (e && e.message ? e.message : "网络错误"));
	});
}
// ---------- 锁屏检测 + 解锁界面 ----------
var lockUI = null;
function checkLock() {
	fetch("remote-screen/lockstate").then(function (r) { return r.json(); }).then(function (s) {
		if (s.locked) showLockUI();
		else hideLockUI();
	}).catch(function () {});
}
function showLockUI() {
	if (lockUI) return;
	lockUI = document.createElement("div");
	lockUI.style.cssText = "position:fixed;inset:0;z-index:2147483600;background:rgba(15,23,42,.92);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:20px;font-family:system-ui,sans-serif";
	lockUI.innerHTML =
		'<button id="lock-back" style="position:fixed;top:14px;left:14px;padding:8px 14px;background:rgba(255,255,255,.12);color:#fff;border:1px solid #475569;border-radius:8px;font-size:14px;cursor:pointer">← 返回</button>' +
		'<div style="font-size:18px;font-weight:600">🔒 电脑已锁屏</div>' +
		'<div style="font-size:13px;color:#94a3b8">⚠ Windows 安全限制：无法远程输入密码解锁<br>请在电脑前按 Win+L 后的密码/PIN 解锁</div>' +
		'<img id="lock-preview" style="width:min(90vw,360px);border-radius:10px;border:1px solid #334155" alt="锁屏画面">' +
		'<div style="font-size:12px;color:#64748b">（只能查看锁屏画面，不能远程操控）</div>';
	document.body.appendChild(lockUI);
	document.getElementById("lock-back").onclick = function () { location.href = location.origin + "/"; };
	// 锁屏画面预览轮询（只读）
	var prev = document.getElementById("lock-preview");
	var timer = setInterval(function () {
		if (!lockUI || !document.body.contains(lockUI)) { clearInterval(timer); return; }
		prev.src = "remote-screen/frame?w=640&h=360&q=50&fps=2&t=" + Date.now();
	}, 700);
}
function hideLockUI() {
	if (!lockUI) return;
	var el = lockUI;
	lockUI = null;
	try { el.remove(); } catch (_) {}
}
// 每 3 秒检测锁屏状态
setInterval(checkLock, 3000);

function updateStatus() {
	var el = document.getElementById("status");
	if (!el) return;
	if (showRate) {
		var now = Date.now();
		var dt = (now - rateT0) / 1000;
		var kb = rateBytes / 1024;
		if (dt >= 0.8) {
			el.textContent = Math.round(kb / dt) + " KB/s";
			rateBytes = 0; rateT0 = now;
		} else {
			el.textContent = "…";
		}
	} else {
		el.textContent = (ctrlOk ? "控制开" : "控制关") + "\\n" + screenW + "x" + screenH;
	}
}
// 状态文字已移除（不再需要点击切换速率显示）
function send(type, data) {
	fetch("remote-screen/input", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.assign({ type: type }, data)) });
}
function toScreen(e) {
	var r = img.getBoundingClientRect();
	return { x: (e.clientX - r.left) / r.width * screenW, y: (e.clientY - r.top) / r.height * screenH };
}
var dragging = false;
var zoom = 1;                    // 1=正常, 3=放大精确操控
var panFX = 0.5, panFY = 0.5;    // 放大时可见中心（图像比例 0~1）
var panTouch = null, panMoved = false, panDist = 0;
var dragTouch = null, dragDist = 0;
var lastMX = -1, lastMY = -1;    // 最近一次移动的鼠标屏幕坐标
var lastLocalMove = 0;
function moveMouse(p) {
	lastLocalMove = Date.now();
	lastMX = p.x; lastMY = p.y;
	send("mouse", { x: p.x, y: p.y });
	// 立即更新光标覆盖层（消除轮询延迟，拖动即时反馈）
	var ce = document.getElementById("cursor");
	if (ce) {
		var dd = fromScreen(p.x, p.y);
		ce.style.display = "block";
		ce.style.left = dd.x + "px";
		ce.style.top = dd.y + "px";
	}
}
// 点击屏幕图像区域时自动关闭键盘输入框
function hideKbd() { document.getElementById("kbd").style.display = "none"; }
// 计算图像在容器内的适配尺寸
function getFit() {
	var s = document.getElementById("screen");
	var cw = s.clientWidth || 300, ch = s.clientHeight || 300;
	var iw = img.naturalWidth || 640, ih = img.naturalHeight || 360;
	var aspect = iw / ih;
	var fitW = cw, fitH = fitW / aspect;
	if (fitH > ch) { fitH = ch; fitW = fitH * aspect; }
	return { cw: cw, ch: ch, fitW: fitW, fitH: fitH };
}
// 旋转模式的盒尺寸与内容实际尺寸（object-fit 黑边校正）
function rotContent(cw, ch, Z) {
	var W = ch * Z, H = cw * Z;
	var iw = img.naturalWidth || 640, ih = img.naturalHeight || 360;
	var aspect = iw / ih;
	var contentW = W, contentH = contentW / aspect;
	if (contentH > H) { contentH = H; contentW = contentH * aspect; }
	return { W: W, H: H, contentW: contentW, contentH: contentH, cLeft: (W - contentW) / 2, cTop: (H - contentH) / 2 };
}
function clampPan() {
	if (img.classList.contains("rotimg")) {
		var s2 = document.getElementById("screen");
		var rc = rotContent(s2.clientWidth, s2.clientHeight, zoom);
		var hx = Math.min((s2.clientHeight / 2) / rc.contentW, 0.5);
		var hy = Math.min((s2.clientWidth / 2) / rc.contentH, 0.5);
		panFX = Math.max(hx, Math.min(1 - hx, panFX));
		panFY = Math.max(hy, Math.min(1 - hy, panFY));
		return;
	}
	var f = getFit();
	var hw = Math.min(f.cw / (2 * f.fitW * zoom), 0.5), hh = Math.min(f.ch / (2 * f.fitH * zoom), 0.5);
	panFX = Math.max(hw, Math.min(1 - hw, panFX));
	panFY = Math.max(hh, Math.min(1 - hh, panFY));
}
function toScreen(e) {
	var s = document.getElementById("screen");
	var sr = s.getBoundingClientRect();
	var rx = e.clientX - sr.left, ry = e.clientY - sr.top;
	var rot = img.classList.contains("rotimg");
	if (rot) {
		// 旋转（含放大）：手机竖轴↔桌面横轴（上移→左），手机横轴↔桌面纵轴（左移→下）
		var rc = rotContent(sr.width, sr.height, zoom);
		var bx = panFX + (ry - sr.height / 2) / rc.contentW;   // 手机纵向 → 桌面横轴
		var by = panFY + (sr.width / 2 - rx) / rc.contentH;    // 手机横向 → 桌面纵轴
		return { x: bx * screenW, y: by * screenH };
	}
	if (zoom > 1 && !rot) {
		var f = getFit();
		return {
			x: (panFX + (rx - f.cw / 2) / (f.fitW * zoom)) * screenW,
			y: (panFY + (ry - f.ch / 2) / (f.fitH * zoom)) * screenH
		};
	}
	// 非旋转非放大：按内容实际区域（去掉 letterbox 黑边）映射
	var f = getFit();
	var ox = (f.cw - f.fitW) / 2, oy = (f.ch - f.fitH) / 2;
	return {
		x: ((rx - ox) / f.fitW) * screenW,
		y: ((ry - oy) / f.fitH) * screenH
	};
}
img.addEventListener("touchstart", (e) => {
	hideKbd();
	if (e.touches.length === 1) {
		if (zoom > 1) { panMoved = false; panDist = 0; var t = e.touches[0]; panTouch = { x: t.clientX, y: t.clientY }; }
		else {
			dragging = true; dragDist = 0;
			dragTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
			lastLocalMove = Date.now();
			// 本地显示光标，不发命令（拖动只发终点）
			var ce0 = document.getElementById("cursor");
			if (ce0) { ce0.style.display = "block"; ce0.style.left = dragTouch.x + "px"; ce0.style.top = dragTouch.y + "px"; }
		}
	}
	e.preventDefault();
}, { passive: false });
img.addEventListener("touchmove", (e) => {
	if (e.touches.length === 1) {
		if (zoom > 1 && panTouch) {
			var t = e.touches[0];
			var dx = t.clientX - panTouch.x, dy = t.clientY - panTouch.y;
			panDist += Math.abs(dx) + Math.abs(dy);
			if (panDist > 15) panMoved = true;
			panTouch = { x: t.clientX, y: t.clientY };
			if (img.classList.contains("rotimg")) {
				// 旋转模式：内容跟随手指（与竖屏视觉一致）——上拖内容上移、左拖内容左移
				var cw2 = document.getElementById("screen").clientWidth, ch2 = document.getElementById("screen").clientHeight;
				var rcp = rotContent(cw2, ch2, zoom);
				panFX -= dy / rcp.contentW; panFY += dx / rcp.contentH;
			} else {
				var f = getFit();
				panFX -= dx / (f.fitW * zoom); panFY -= dy / (f.fitH * zoom);
			}
			clampPan(); sizeImage();
		} else if (dragging) {
			var t2 = e.touches[0];
			dragDist += Math.abs(t2.clientX - dragTouch.x) + Math.abs(t2.clientY - dragTouch.y);
			dragTouch = { x: t2.clientX, y: t2.clientY };
			lastLocalMove = Date.now();
			// 只更新本地光标显示，桌面位置等松手再发
			var ce2 = document.getElementById("cursor");
			if (ce2) { ce2.style.display = "block"; ce2.style.left = dragTouch.x + "px"; ce2.style.top = dragTouch.y + "px"; }
		}
	}
	e.preventDefault();
}, { passive: false });
img.addEventListener("touchend", (e) => {
	if (zoom > 1) {
		if (panTouch && e.changedTouches.length) {
			// 放大模式：松手总是指向该点（平移后鼠标跟随）；未移动则为精确定位点击
			var p = toScreen(e.changedTouches[0]);
			moveMouse(p);
			if (!panMoved && panDist <= 15) send("click", { button: "left" });
		}
		panTouch = null;
	} else if (dragging) {
		dragging = false;
		// 普通模式：轻点（几乎没移动）= 移动+点击；拖动 = 只发最终位置
		var fp = e.changedTouches.length ? toScreen(e.changedTouches[0]) : null;
		if (fp) {
			if (dragDist <= 15) { moveMouse(fp); send("click", { button: "left" }); }
			else moveMouse(fp);
		}
	}
	e.preventDefault();
}, { passive: false });
img.addEventListener("click", (e) => {
	hideKbd();
	if (ctrlOk) { var p = toScreen(e); moveMouse(p); send("click", { button: "left" }); }
});
img.addEventListener("contextmenu", (e) => { e.preventDefault(); if (ctrlOk) { var p = toScreen(e); moveMouse(p); send("click", { button: "right" }); } });

document.getElementById("zoom-btn").onclick = function () {
	zoom = zoom > 1 ? 1 : 3;
	panFX = 0.5; panFY = 0.5; panMoved = false; panDist = 0;
	this.classList.toggle("on", zoom > 1);
	sizeImage();
};
// （已移除独立的点击按钮：轻点即点击）
// 鼠标光标覆盖层：屏幕坐标 → 显示坐标（与 toScreen 互逆），并轮询真实光标位置
function fromScreen(sx, sy) {
	var s = document.getElementById("screen");
	var sr = s.getBoundingClientRect();
	var cw = sr.width, ch = sr.height;
	var rot = img.classList.contains("rotimg");
	if (rot) {
		var rc = rotContent(cw, ch, zoom);
		var bx = sx / screenW, by = sy / screenH;
		var rx = cw / 2 - (by - panFY) * rc.contentH;
		var ry = ch / 2 + (bx - panFX) * rc.contentW;
		return { x: rx, y: ry };
	}
	if (zoom > 1) {
		var f = getFit();
		var rx2 = f.cw / 2 + (sx / screenW - panFX) * f.fitW * zoom;
		var ry2 = f.ch / 2 + (sy / screenH - panFY) * f.fitH * zoom;
		return { x: rx2, y: ry2 };
	}
	// 非旋转非放大：光标定位到内容实际区域（去掉 letterbox 黑边）
	var f = getFit();
	var ox = (f.cw - f.fitW) / 2, oy = (f.ch - f.fitH) / 2;
	return { x: ox + (sx / screenW) * f.fitW, y: oy + (sy / screenH) * f.fitH };
}
var curEl = document.getElementById("cursor");
function updateCursor() {
	fetch("remote-screen/pos").then(function (r) { return r.json(); }).then(function (p) {
		// 刚发生过本地移动/点击（1.2秒内）时忽略轮询旧值——避免光标跳回旧位置
		if (Date.now() - lastLocalMove < 1200) return;
		var d = fromScreen(p.x, p.y);
		curEl.style.display = "block";
		curEl.style.left = d.x + "px";
		curEl.style.top = d.y + "px";
	}).catch(function () {});
}
setInterval(updateCursor, 800);
updateCursor();
document.getElementById("kbd-btn").onclick = () => { document.getElementById("kbd").style.display = document.getElementById("kbd").style.display === "none" ? "block" : "none"; };
function handleKbdEnter(inp) {
	var v = inp ? inp.value : "";
	if (v) { send("key", { text: v }); if (inp) inp.value = ""; }
	else send("keyenter", {});
}
document.getElementById("keys").addEventListener("keydown", (e) => {
	if (e.key === "Enter") {
		var inp = e.target;
		if (e.isComposing) {
			// IME组合中的回车：不拦截（让IME提交文字），提交后发送文字或回车
			var done = false;
			function trySend() {
				if (done) return; done = true;
				handleKbdEnter(inp);
			}
			setTimeout(trySend, 600);
			inp.addEventListener("compositionend", function h() {
				inp.removeEventListener("compositionend", h);
				setTimeout(trySend, 100);
			});
		} else {
			e.preventDefault();
			handleKbdEnter(inp);
		}
	}
});
document.getElementById("kbd-back").onclick = () => send("keyback", {});
document.getElementById("kbd-enter").onclick = function () {
	var inp = document.getElementById("keys");
	var v = inp ? inp.value : "";
	if (v) { send("key", { text: v }); inp.value = ""; }
	else send("keyenter", {});
};
// ⌂ 按钮切换：显示当前动作
var restoreState = false;
document.getElementById("restore-btn").onclick = function () {
	restoreState = !restoreState;
	this.textContent = restoreState ? "—" : "⌂";
	this.title = restoreState ? "最小化所有窗口" : "恢复所有最小化窗口";
	send("restoreall", {});
};
// 图像旋转：默认旋转（横屏大图）；手动按钮切换
var rotated = true;
function applyOrient() {
	// 菜单跟随手机方向：竖屏→底部横条；横屏→右侧竖栏（保证文字方向正确）
	var portrait = window.innerHeight > window.innerWidth;
	document.body.classList.toggle("menu-bottom", portrait);
	// 图像旋转独立于手机方向
	img.classList.toggle("rotimg", rotated);
	sizeImage();
}
// 图片适配：填满容器 + object-fit:contain → 最大化等比显示，只留单边底色，不裁剪；放大模式按 zoom+pan 渲染
function sizeImage() {
	var s = document.getElementById("screen");
	var cw = s.clientWidth, ch = s.clientHeight;
	if (cw === 0 || ch === 0) return;
	var Z = zoom;
	if (img.classList.contains("rotimg")) {
		// 旋转+放大：盒定位考虑内容黑边偏移（pan 时内容准确对准容器中心）
		var rc = rotContent(cw, ch, Z);
		var Cx = cw / 2 + rc.cTop + panFY * rc.contentH - rc.H / 2;
		var Cy = ch / 2 - rc.cLeft - panFX * rc.contentW + rc.W / 2;
		img.style.width = rc.W + "px";
		img.style.height = rc.H + "px";
		img.style.left = (Cx - rc.W / 2) + "px";
		img.style.top = (Cy - rc.H / 2) + "px";
		return;
	}
	if (Z > 1) {
		var f = getFit();
		clampPan();
		img.style.width = (f.fitW * Z) + "px";
		img.style.height = (f.fitH * Z) + "px";
		img.style.left = (f.cw / 2 - panFX * f.fitW * Z) + "px";
		img.style.top = (f.ch / 2 - panFY * f.fitH * Z) + "px";
	} else {
		img.style.width = "100%";
		img.style.height = "100%";
		img.style.left = "0"; img.style.top = "0";
	}
}
if (typeof ResizeObserver !== "undefined") { new ResizeObserver(sizeImage).observe(document.getElementById("screen")); }
window.addEventListener("resize", applyOrient);
setTimeout(applyOrient, 300);
try { if (typeof window.console === "undefined") window.console = { log: function () {} }; } catch (_) {}
document.getElementById("rot-btn").onclick = function () {
	rotated = !rotated;
	this.classList.toggle("on", rotated);
	applyOrient();
};
applyOrient();
// 关闭按钮：像浏览器返回一样回到 DSH 页面（不重载数据）
document.getElementById("close-btn").onclick = function () {
	window.history.back(); // 返回上一页（bfcache 缓存，不重新加载）
	setTimeout(function () { try { window.close(); } catch (_) {} }, 400); // 若无历史则关闭标签页
};
window.addEventListener("error", function (ev) { DBG("JS错误: " + (ev.message || "未知")); });
</script></body></html>`;

// ---------- 截屏/控制服务器 ----------
const screenServer = createServer((req, res) => {
	const u = new URL(req.url, "http://localhost");
	const cors = () => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "content-type"); };
	if (req.method === "OPTIONS") { cors(); res.writeHead(204); res.end(); return; }

	if (u.pathname === "/remote-screen" && req.method === "GET") {
		res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
		res.end(VIEWER_HTML);
		return;
	}
	if (u.pathname === "/remote-screen/frame" && req.method === "GET") {
		lastFrameAt = Date.now();  // 有帧请求 = 查看者在线
		const w = parseInt(u.searchParams.get("w") || "640", 10);
		const h = parseInt(u.searchParams.get("h") || "360", 10);
		const q = parseInt(u.searchParams.get("q") || "50", 10);
		const fps = parseInt(u.searchParams.get("fps") || "5", 10);
		const effQ = settings.compression ? q : Math.min(85, q + 25);
		setCapture({ w, h, q: effQ, fps });
		const waitUntil = Date.now() + 2500;
		const trySend = () => {
			if (pendingFrame) {
				const buf = Buffer.from(pendingFrame, "base64");
				res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store", "content-length": buf.length });
				res.end(buf);
				return;
			}
			if (Date.now() < waitUntil) { setTimeout(trySend, 80); return; }
			res.writeHead(204); res.end();
		};
		trySend();
		return;
	}
	if (u.pathname === "/remote-screen/pos" && req.method === "GET") {
		workerCmd("pos");
		res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
		res.end(JSON.stringify(cursorPos));
		return;
	}
	if (u.pathname === "/remote-nolock" && req.method === "POST") {
		cors();
		let body = "";
		req.on("data", (d) => body += d);
		req.on("end", () => {
			let on = false;
			try { on = !!JSON.parse(body).on; } catch (_) {}
			settings.noLock = on;
			saveSettings();
			if (on) { workerCmd("hold"); holdState = true; exec("powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_NONE CONSOLELOCK 0 && powercfg /SETACTIVE SCHEME_CURRENT"); exec("reg add \"HKCU\\Control Panel\\Desktop\" /v ScreenSaverIsSecure /t REG_SZ /d 0 /f"); exec("reg add \"HKCU\\Control Panel\\Desktop\" /v ScreenSaveActive /t REG_SZ /d 0 /f"); }
			else { workerCmd("release"); holdState = false; exec("powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_NONE CONSOLELOCK 1 && powercfg /SETACTIVE SCHEME_CURRENT"); exec("reg add \"HKCU\\Control Panel\\Desktop\" /v ScreenSaverIsSecure /t REG_SZ /d 1 /f"); exec("reg add \"HKCU\\Control Panel\\Desktop\" /v ScreenSaveActive /t REG_SZ /d 1 /f"); }
			res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
			res.end(JSON.stringify({ ok: true, noLock: on }));
		});
		return;
	}
	if (u.pathname === "/remote-screen/status" && req.method === "GET") {
		res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
		res.end(JSON.stringify({ screenW: screenSize.w, screenH: screenSize.h, controlEnabled: settings.controlEnabled, compression: settings.compression, viewers: viewerCount }));
		return;
	}
	if (u.pathname === "/remote-screen/stream" && req.method === "GET") {
		cors();
		const w = parseInt(u.searchParams.get("w") || "640", 10);
		const h = parseInt(u.searchParams.get("h") || "360", 10);
		const q = parseInt(u.searchParams.get("q") || "50", 10);
		const fps = parseInt(u.searchParams.get("fps") || "5", 10);
		const effQ = settings.compression ? q : Math.min(85, q + 25);
		res.writeHead(200, { "content-type": "multipart/x-mixed-replace; boundary=frame", "cache-control": "no-store" });
		viewers.add(res);
		setCapture({ w, h, q: effQ, fps });
		req.on("close", () => { viewers.delete(res); });
		return;
	}
	if (u.pathname === "/remote-screen/input" && req.method === "POST") {
		cors();
		let body = "";
		req.on("data", (d) => body += d);
		req.on("end", () => {
			try {
				const data = JSON.parse(body);
				const r = injectInput(data);
				res.writeHead(r.ok ? 200 : 403, { "content-type": "application/json" });
				res.end(JSON.stringify(r));
			} catch (_) { res.writeHead(400); res.end("{}"); }
		});
		return;
	}
	// ---------- 锁屏解锁服务（dsh-unlock-svc.exe，SYSTEM 计划任务） ----------
	// 解锁服务走本地 HTTP（dsh 进程无法连接命名管道，但回环 HTTP 可用）
	const UNLOCK_URL = "http://127.0.0.1:8093";
	function unlockCmd(path, timeoutMs) {
		return new Promise((resolve) => {
			const req = httpRequest(UNLOCK_URL + path, { timeout: timeoutMs || 6000 }, (res) => {
				let b = "";
				res.on("data", (d) => b += d);
				res.on("end", () => resolve(b || null));
			});
			req.on("error", () => resolve(null));
			req.on("timeout", () => { req.destroy(); resolve(null); });
			req.end();
		});
	}
	// 锁屏状态/预览/解锁端点
	if (u.pathname === "/remote-screen/lockstate" && req.method === "GET") {
		cors();
		unlockCmd("/state").then((r) => {
			const locked = !!r && r.toLowerCase().startsWith("locked:true");
			res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
			res.end(JSON.stringify({ locked, svc: !!r }));
		});
		return;
	}
	if (u.pathname === "/remote-screen/lockcap" && req.method === "GET") {
		cors();
		const w = parseInt(u.searchParams.get("w") || "640", 10);
		const h = parseInt(u.searchParams.get("h") || "360", 10);
		unlockCmd("/capture").then((r) => {
			if (!r || !r.startsWith("FRAME:")) { res.writeHead(204); res.end(); return; }
			const buf = Buffer.from(r.slice(6), "base64");
			res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store", "content-length": buf.length });
			res.end(buf);
		});
		return;
	}
	if (u.pathname === "/remote-screen/unlock" && req.method === "POST") {
		cors();
		let body = "";
		req.on("data", (d) => body += d);
		req.on("end", () => {
			let key = "";
			try { key = JSON.parse(body).key || ""; } catch (_) {}
			if (!key) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: "no key" })); return; }
			// 解锁日志（排查用）
			(function logUnlock(m) { try { appendFileSync("D:\\dsh-temp\\unlock.log", new Date().toISOString() + " " + m + "\n"); } catch (_) {} })("unlock request key-len=" + (key || "").length);
			// 解锁序列：停捕获（防worker被摄像头截屏卡住）→ 唤醒 → 点击 → 等9秒（摄像头失败回PIN框）→ 清空+输PIN+回车×2 → 恢复捕获
if (captureTimer) { clearInterval(captureTimer); captureTimer = null; }
workerCmd("hold");   // 保持显示器唤醒（防9秒等待期间休眠）
workerCmd("wake");
workerCmd("click left");
setTimeout(() => {
  // 9秒后 PIN 框已出现 → 由服务在会话1注入 PIN（SYSTEM 绕过锁屏输入拦截）
  unlockCmd("/unlockkey?t=" + encodeURIComponent(key), 15000).then(() => {
    if (captureParams) setCapture(captureParams);
    res.end(JSON.stringify({ ok: true, method: "system-inject", wait: 9 }));
  }).catch(() => {
    if (captureParams) setCapture(captureParams);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "inject failed" }));
  });
}, 9000);
		});
		return;
	}
	// ---------- 文件浏览/传输 ----------
	let crcTable = null;
	function crc32(buf) {
		if (!crcTable) {
			crcTable = new Uint32Array(256);
			for (let i = 0; i < 256; i++) {
				let c = i;
				for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
				crcTable[i] = c >>> 0;
			}
		}
		let c = 0xFFFFFFFF;
		for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
		return (c ^ 0xFFFFFFFF) >>> 0;
	}
	function buildZip(files) {  // files: [{name, data: Buffer}]（STORE 方式，无压缩）
		const chunks = [];
		const central = [];
		let offset = 0;
		const now = new Date();
		const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
		const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
		for (const f of files) {
			const nameBuf = Buffer.from(f.name, "utf8");
			const crc = crc32(f.data);
			const size = f.data.length;
			const flags = 0x800;  // UTF-8 文件名
			const lh = Buffer.alloc(30);
			lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6);
			lh.writeUInt16LE(0, 8); lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12);
			lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(size, 18); lh.writeUInt32LE(size, 22);
			lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
			chunks.push(lh, nameBuf, f.data);
			const ch = Buffer.alloc(46);
			ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8);
			ch.writeUInt16LE(0, 10); ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14);
			ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(size, 20); ch.writeUInt32LE(size, 24);
			ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
			ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
			central.push(ch, nameBuf);
			offset += 30 + nameBuf.length + size;
		}
		const cdSize = central.reduce((s, b) => s + b.length, 0);
		const eocd = Buffer.alloc(22);
		eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
		eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
		eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
		return Buffer.concat([...chunks, ...central, eocd]);
	}
	if (u.pathname === "/remote-file/drives" && req.method === "GET") {
		cors();
		const drives = [];
		for (let c = 65; c <= 90; c++) {
			const letter = String.fromCharCode(c);
			const p = letter + ":\\";
			try { if (existsSync(p)) drives.push({ name: letter + ":", path: p }); } catch (_) {}
		}
		res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
		res.end(JSON.stringify({ ok: true, drives, desktop: join(homedir(), "Desktop") }));
		return;
	}
	// ---------- 安卓 APP 下载 ----------
	if (u.pathname === "/remote-apk-page" && req.method === "GET") {
		res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
		res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH远程 APK 下载</title></head><body style="font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:40px 20px;margin:0;background:#f8fafc"><div style="background:#fff;border-radius:14px;padding:28px 20px;max-width:340px;margin:0 auto;box-shadow:0 2px 12px rgba(0,0,0,.08)"><h2 style="margin:0 0 6px">📱 DSH远程</h2><p style="color:#64748b;font-size:14px;margin:0 0 22px">安卓远程访问应用（WebView 包装）</p><button id="dl" onclick="downloadApk()" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 34px;border-radius:10px;border:none;font-size:16px;font-weight:600;cursor:pointer">⬇ 下载 DSH远程.apk</button><p style="color:#94a3b8;font-size:12px;margin-top:20px">使用 fetch 带认证下载，绕过下载管理器</p></div><script>function downloadApk(){var b=document.getElementById('dl');b.disabled=true;b.textContent='下载中…';fetch('remote-apk').then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.blob();}).then(function(blob){var u=URL.createObjectURL(blob);var a=document.createElement('a');a.href=u;a.download='DSH远程.apk';document.body.appendChild(a);a.click();setTimeout(function(){try{URL.revokeObjectURL(u);a.remove();}catch(_){}},3000);b.textContent='✓ 已开始下载';}).catch(function(e){b.disabled=false;b.textContent='⬇ 重试下载';alert('下载失败: '+e.message);});}</script></body></html>`);
		return;
	}
	if (u.pathname === "/remote-apk" && req.method === "GET") {
		const apkPath = join(__dirname, "dsh-remote.apk");
		stat(apkPath, (err, st) => {
			if (err || !st.isFile()) { res.writeHead(404); res.end("apk not bundled"); return; }
			res.writeHead(200, {
				"content-type": "application/vnd.android.package-archive",
				"content-disposition": "attachment; filename*=UTF-8''" + encodeURIComponent("DSH远程.apk"),
				"content-length": st.size,
				"cache-control": "no-store"
			});
			createReadStream(apkPath).pipe(res);
		});
		return;
	}
	if (u.pathname === "/remote-file/list" && req.method === "GET") {
		cors();
		const raw = u.searchParams.get("path") || "";
		const dir = raw ? resolve(raw) : "D:\\";
		readdir(dir, { withFileTypes: true }, (err, ents) => {
			if (err) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: String(err.message || err) })); return; }
			const entries = [];
			let pending = ents.length;
			if (pending === 0) { sendList(); return; }
			ents.forEach((ent) => {
				const full = join(dir, ent.name);
				stat(full, (err2, st) => {
					if (!err2) entries.push({ name: ent.name, isDir: ent.isDirectory(), size: st.size, mtime: st.mtimeMs });
					else entries.push({ name: ent.name, isDir: ent.isDirectory(), size: 0, mtime: 0 });
					if (--pending === 0) sendList();
				});
			});
			function sendList() {
				entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, "zh-CN") : a.isDir ? -1 : 1));
				const trimmed = dir.replace(/[\\/]+$/, "");  // 去掉尾部斜杠
				const parent = /^[a-zA-Z]:$/.test(trimmed) ? null : resolve(dir, "..");  // 盘符根目录无上级
				res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
				res.end(JSON.stringify({ ok: true, path: dir, parent, entries }));
			}
		});
		return;
	}
	if (u.pathname === "/remote-file/download" && req.method === "GET") {
		const f = resolve(u.searchParams.get("path") || "");
		stat(f, (err, st) => {
			if (err || !st.isFile()) { res.writeHead(404); res.end("not found"); return; }
			const name = encodeURIComponent(f.split(sep).pop() || "file");
			res.writeHead(200, {
				"content-type": "application/octet-stream",
				"content-disposition": "attachment; filename*=UTF-8''" + name,
				"content-length": st.size,
				"cache-control": "no-store"
			});
			createReadStream(f).pipe(res);
		});
		return;
	}
	if (u.pathname === "/remote-file/zip" && req.method === "GET") {
		let paths = [];
		try { paths = JSON.parse(u.searchParams.get("files") || "[]"); } catch (_) {}
		if (!paths.length || paths.length < 2) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: "need 2+ files" })); return; }
		const buffers = [];
		let total = 0;
		for (const p of paths) {
			const f = resolve(String(p));
			try {
				const data = readFileSync(f);
				total += data.length;
				if (total > 500 * 1024 * 1024) { res.writeHead(413); res.end(JSON.stringify({ ok: false, error: "total too large" })); return; }
				buffers.push({ name: f.split(sep).pop(), data });
			} catch (_) {}
		}
		if (!buffers.length) { res.writeHead(404); res.end("not found"); return; }
		const zip = buildZip(buffers);
		res.writeHead(200, {
			"content-type": "application/zip",
			"content-disposition": "attachment; filename*=UTF-8''" + encodeURIComponent("下载文件.zip"),
			"content-length": zip.length,
			"cache-control": "no-store"
		});
		res.end(zip);
		return;
	}
	if (u.pathname === "/remote-file/upload" && req.method === "POST") {
		cors();
		const dir = resolve(u.searchParams.get("path") || "D:\\");
		const name = (u.searchParams.get("name") || "").replace(/[\\/\0]/g, "_");
		if (!name) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: "no name" })); return; }
		const chunks = [];
		let size = 0;
		const LIMIT = 2 * 1024 * 1024 * 1024;  // 2GB 上限
		req.on("data", (d) => { chunks.push(d); size += d.length; if (size > LIMIT) req.destroy(); });
		req.on("end", () => {
			const out = join(dir, name);
			mkdir(dir, { recursive: true }, () => {
				writeFileSync(out, Buffer.concat(chunks));
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ ok: true, name, size, path: out }));
			});
		});
		req.on("error", () => { try { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: "upload failed" })); } catch (_) {} });
		return;
	}
	if (u.pathname === "/remote-settings") {
		cors();
		if (req.method === "POST") {
			let body = "";
			req.on("data", (d) => body += d);
			req.on("end", () => {
				try {
					const d = JSON.parse(body);
					if (typeof d.controlEnabled === "boolean") settings.controlEnabled = d.controlEnabled;
					if (typeof d.compression === "boolean") settings.compression = d.compression;
					saveSettings();
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify({ ok: true, settings }));
				} catch (_) { res.writeHead(400); res.end("{}"); }
			});
			return;
		}
		res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
		res.end(JSON.stringify(settings));
		return;
	}
	res.writeHead(404); res.end("not found");
});

// ---------- 代理（/remote-* → 截屏服务器，其余 → dsh） ----------
function rewriteHeaders(headers, fakeHost) {
	const h = Object.assign({}, headers);
	h["host"] = fakeHost;
	if (h["origin"]) h["origin"] = FAKE_ORIGIN(fakeHost);
	if (h["referer"]) h["referer"] = FAKE_ORIGIN(fakeHost) + "/";
	return h;
}
function safePipe(from, to) {
	from.on("error", () => { try { to.destroy(); } catch (_) {} });
	to.on("error", () => { try { from.destroy(); } catch (_) {} });
	from.pipe(to);
}

export function apply(ctx, config = {}) {
	const listenPort = config.listenPort ?? 8090;
	const targetPort = ctx.get("webServer")?.port ?? config.targetPort ?? 3080;
	const fakeHost = "127.0.0.1:" + targetPort;

	// ---------- [PATCH harness-auth] ----------
	// DSH 0.2.x 的 browser-auth 是「绑定 authority 的签名 cookie，回环无豁免」，
	// 纯转发请求必然 401（dsh web authentication required）。这里用本进程的启动
	// token 换一份 cookie，再挂到转发请求上。authority 与 rewriteHeaders 改写后的
	// Host（127.0.0.1:<targetPort>）一致，所以 cookie 名对得上。
	let innerCookie = null;
	function connectionService() {
		for (const pick of [
			() => ctx.connection,
			() => (typeof ctx.get === "function" ? ctx.get("connection") : undefined),
			() => ctx.root?.get?.("connection")
		]) {
			try { const svc = pick(); if (svc) return svc; } catch (_) {}
		}
		return undefined;
	}
	async function harnessCookie(force) {
		if (innerCookie && force !== true) return innerCookie;
		innerCookie = null;
		try {
			const svc = connectionService();
			const url = svc?.authenticatedUrl?.(`http://127.0.0.1:${targetPort}/`);
			if (!url) return null;
			const res = await fetch(url, { redirect: "manual" }); // 不跟随 303，才能读到 Set-Cookie
			const raw = res.headers.get("set-cookie") ?? "";
			const pair = raw.split(",").map((part) => part.trim()).find((part) => part.startsWith("dsh-auth-"));
			innerCookie = pair ? pair.split(";")[0] : null;
			console.log("[dsh-remote] harness-auth cookie: " + (innerCookie ? "redeemed" : "unavailable"));
		} catch (e) {
			innerCookie = null;
			console.log("[dsh-remote] harness-auth redeem failed: " + String(e && e.message ? e.message : e));
		}
		return innerCookie;
	}
	/** 把 harness cookie 合并进转发头（不覆盖客户端已有 cookie）。 */
	async function withHarnessCookie(headers, enabled) {
		if (enabled !== true) return headers;
		const c = await harnessCookie();
		if (c) headers.cookie = headers.cookie ? headers.cookie + "; " + c : c;
		return headers;
	}
	// ---------- [/PATCH harness-auth] ----------

	let lastPublicHost = null;  // 最近一次从隧道进来的 Host（公网域名），任意穿透工具通用
	const server = createServer(async (clientReq, clientRes) => {
		clientReq.on("error", () => { try { clientRes.destroy(); } catch (_) {} });
		const inHost = (clientReq.headers.host || "").toLowerCase();
		if (inHost && !inHost.includes("127.0.0.1") && !inHost.includes("localhost")) lastPublicHost = inHost;
		if (clientReq.method === "GET" && clientReq.url === "/remote-addr") {
			clientRes.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
			clientRes.end(JSON.stringify({ host: lastPublicHost }));
			return;
		}
		const isRemote = clientReq.url.startsWith("/remote-");
		const upPort = isRemote ? SCREEN_PORT : targetPort;
		const upHost = isRemote ? "127.0.0.1:" + SCREEN_PORT : fakeHost;
		const headers = await withHarnessCookie(rewriteHeaders(clientReq.headers, upHost), !isRemote);
		const proxyReq = httpRequest({
			host: "127.0.0.1", port: upPort, path: clientReq.url, method: clientReq.method,
			headers: headers
		}, (proxyRes) => {
			if (!isRemote && proxyRes.statusCode === 401) void harnessCookie(true); // 自愈：下次请求重新换
			proxyRes.on("error", () => { try { clientRes.destroy(); } catch (_) {} });
			clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
			safePipe(proxyRes, clientRes);
		});
		proxyReq.on("error", () => { try { clientRes.writeHead(502); clientRes.end("proxy error"); } catch (_) {} });
		safePipe(clientReq, proxyReq);
	});

	server.on("upgrade", async (clientReq, clientSocket, head) => {
		clientSocket.on("error", () => { try { clientSocket.destroy(); } catch (_) {} });
		const headers = await withHarnessCookie(rewriteHeaders(clientReq.headers, fakeHost), true);
		const proxyReq = httpRequest({
			host: "127.0.0.1", port: targetPort, path: clientReq.url, method: "GET",
			headers: headers
		});
		proxyReq.on("upgrade", (proxyRes, proxySocket) => {
			proxySocket.on("error", () => { try { clientSocket.destroy(); } catch (_) {} });
			const accept = proxyRes.headers["sec-websocket-accept"] || "";
			clientSocket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
			safePipe(proxySocket, clientSocket);
			safePipe(clientSocket, proxySocket);
			if (head && head.length) proxySocket.write(head);
		});
		proxyReq.on("error", () => { try { clientSocket.destroy(); } catch (_) {} });
		proxyReq.end();
	});

	server.on("clientError", (err, socket) => { try { socket.destroy(); } catch (_) {} });

	screenServer.listen(SCREEN_PORT, "127.0.0.1", () => {
		console.log("[dsh-remote] screen server on 127.0.0.1:" + SCREEN_PORT);
	});

	server.listen(listenPort, "127.0.0.1", () => {
		console.log("[dsh-remote] proxy listening on 127.0.0.1:" + listenPort + " -> 127.0.0.1:" + targetPort + " (+remote)");
	});

	ctx.on("dispose", () => {
		try { server.close(); } catch (_) {}
		try { screenServer.close(); } catch (_) {}
		if (worker && worker.exitCode === null) { try { worker.stdin.write("exit\n"); } catch (_) {} }
	});
}
