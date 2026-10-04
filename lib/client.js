window.__ModuleLoader__.load({
	id: "dsh-remote-control-desktop",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var NS = "dsh-remote";
		var state = { url: "", open: false };

		function loadState() {
			try {
				var s = JSON.parse(localStorage.getItem(NS) || "{}");
				state.url = s.url || ""; state.open = !!s.open;
			} catch (e) {}
		}
		function saveState() {
			try { localStorage.setItem(NS, JSON.stringify(state)); } catch (e) {}
		}

		function buildPanel() {
			if (document.getElementById(NS)) return;
			var style = document.createElement("style");
			style.textContent = "#" + NS + "{position:fixed;left:16px;bottom:16px;z-index:2147483000;width:260px;font-family:system-ui,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.25);overflow:hidden}" +
				"#" + NS + "-head{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#059669;color:#fff;font-size:13px;font-weight:600;cursor:move;user-select:none}" +
				"#" + NS + "-body{padding:10px 12px;background:#fff;color:#1f2937;display:flex;flex-direction:column;gap:8px}" +
				"#" + NS + "-body input{width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:6px;padding:5px 6px;font-size:12px}" +
				"#" + NS + "-body button{cursor:pointer;border:none;border-radius:6px;padding:6px 8px;font-size:12px;background:#059669;color:#fff}" +
				"#" + NS + "-status{font-size:12px;color:#6b7280;white-space:pre-wrap}" +
				"#" + NS + "-qr{text-align:center}" +
				"#" + NS + "-qr img{width:160px;height:160px;border:1px solid #e5e7eb;border-radius:6px}";
			document.head.appendChild(style);
			var panel = document.createElement("div");
			panel.id = NS;
			panel.innerHTML =
				'<div id="' + NS + '-head">📡 远程访问 <span id="' + NS + '-toggle">收起</span></div>' +
				'<div id="' + NS + '-body">' +
				'<div style="font-size:12px">访问地址（任意穿透工具的公网 URL）</div>' +
				'<input id="' + NS + '-url" placeholder="https://你的公网域名">' +
				'<div style="font-size:11px;color:#b45309">⚠ 穿透地址需绑定本机 127.0.0.1:8090</div>' +
				
				'<button id="' + NS + '-save">保存并显示二维码</button>' +
				'<div id="' + NS + '-qr"></div>' +
				'<div style="font-size:12px;margin-top:2px">📱 安卓 APP（内置）</div>' +
				'<div id="' + NS + '-apk" style="font-size:11px;color:#6b7280">保存地址后显示</div>' +
				'<div style="display:flex;gap:6px">' +
				'<button id="' + NS + '-ctrl" style="flex:1">🖥 远程控制：读取中</button>' +
				'<button id="' + NS + '-comp" style="flex:1">🗜 压缩：读取中</button>' +
				'</div>' +
				'<button id="' + NS + '-nolock" style="width:100%;margin-top:6px;padding:8px;background:#1f2937;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer">🔒 防锁屏</button>' +
				'<div id="' + NS + '-status">' +
				'使用说明：\n1. 用任意内网穿透工具（cpolar/frp/ngrok等）\n   把公网 URL 转发到本机 127.0.0.1:8090\n2. 手机开移动数据打开上面的网址\n3. 若隧道设置了认证，浏览器会提示输入\n   （由穿透工具配置，非本插件）\n4. 即远程使用本机 Harness' +
				'</div>' +
				'<div id="' + NS + '-warn" style="font-size:11px;color:#dc2626;display:none">⚠ 部分穿透工具（如 cpolar）的 http 地址不支持 WebSocket，若会话不显示请改用 https:// 地址（frp/ngrok 的 http 正常）</div>' +
				'<div id="' + NS + '-detected" style="font-size:11px;color:#059669"></div>' +
				'</div>';
			document.body.appendChild(panel);
			document.getElementById(NS + "-head").addEventListener("click", function () {
				state.open = !state.open;
				document.getElementById(NS + "-body").style.display = state.open ? "flex" : "none";
				document.getElementById(NS + "-toggle").textContent = state.open ? "收起" : "展开";
				saveState();
			});
			// 拖动面板（按住标题拖动）
			var drag = null;
			document.getElementById(NS + "-head").addEventListener("mousedown", function (e) {
				if (e.target.id === NS + "-toggle") return;
				var r = panel.getBoundingClientRect();
				drag = { sx: e.clientX, sy: e.clientY, l: r.left, t: r.top };
				e.preventDefault();
			});
			document.addEventListener("mousemove", function (e) {
				if (!drag) return;
				panel.style.left = Math.max(0, drag.l + e.clientX - drag.sx) + "px";
				panel.style.top = Math.max(0, drag.t + e.clientY - drag.sy) + "px";
				panel.style.bottom = "auto";
			});
			document.addEventListener("mouseup", function () { drag = null; });
			document.getElementById(NS + "-save").addEventListener("click", function () {
				var raw = document.getElementById(NS + "-url").value.trim();
				// 智能修复协议头：https//x（缺冒号）→ https://x；裸域名 x → https://x
				if (raw) {
					var m = raw.match(/^(https?):?\/\//i);
					if (m) raw = m[1].toLowerCase() + "://" + raw.slice(m[0].length);
					else if (raw.indexOf("://") < 0) raw = "https://" + raw;
				}
				state.url = raw;
				document.getElementById(NS + "-url").value = raw;
				saveState();
				renderQr();
				var warn = document.getElementById(NS + "-warn");
				if (warn) warn.style.display = state.url.indexOf("https://") === 0 ? "none" : (state.url ? "block" : "none");
			});
			// 检测最近从隧道进来的公网域名（任意穿透工具）
			function refreshDetected() {
				fetch("http://127.0.0.1:8090/remote-addr").then(function (r) { return r.json(); }).then(function (d) {
					var el = document.getElementById(NS + "-detected");
					if (el) el.textContent = d.host ? "✓ 检测到手机访问域名: " + d.host : "等待手机访问…";
				}).catch(function () {});
			}
			// 远程控制/压缩设置（读写 8090 代理的 remote-settings）
			var settingsApi = "http://127.0.0.1:8090/remote-settings";
			function refreshSettings() {
				fetch(settingsApi).then(function (r) { return r.json(); }).then(function (s) {
					document.getElementById(NS + "-ctrl").textContent = s.controlEnabled ? "🖥 远程控制：开" : "🖥 远程控制：关";
					document.getElementById(NS + "-comp").textContent = s.compression ? "🗜 压缩：开" : "🗜 压缩：关";
				}).catch(function () {
					document.getElementById(NS + "-ctrl").textContent = "🖥 设置读取失败";
				});
			}
			function toggleSetting(key) {
				fetch(settingsApi).then(function (r) { return r.json(); }).then(function (s) {
					var next = {}; next[key] = !s[key];
					return fetch(settingsApi, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
				}).then(function () { refreshSettings(); });
			}
			document.getElementById(NS + "-ctrl").addEventListener("click", function () { toggleSetting("controlEnabled"); });
			document.getElementById(NS + "-comp").addEventListener("click", function () { toggleSetting("compression"); });
			// 防锁屏开关（服务端 /remote-nolock）
function refreshNoLock() {
  // 并行读取：系统锁屏状态 + 防锁屏设置
  var lockP = fetch("http://127.0.0.1:8090/remote-screen/lockstate").then(function (r) { return r.json(); }).catch(function () { return { locked: false }; });
  var setP = fetch("http://127.0.0.1:8090/remote-settings").then(function (r) { return r.json(); }).catch(function () { return {}; });
  Promise.all([lockP, setP]).then(function (a) {
    var locked = !!a[0].locked, noLock = !!a[1].noLock, b = document.getElementById(NS + "-nolock");
    if (!b) return;
    if (noLock) { b.textContent = "🔓 防锁屏开 · 电脑不会锁"; b.style.background = "#059669"; }
    else if (locked) { b.textContent = "🔒 电脑已锁屏 · 需本地解锁"; b.style.background = "#b91c1c"; }
    else { b.textContent = "🔒 防锁屏关 · 未锁屏"; b.style.background = "#1f2937"; }
  });
}
document.getElementById(NS + "-nolock").addEventListener("click", function () {
  var b = document.getElementById(NS + "-nolock");
  b.textContent = "⏳ 切换中…";
  fetch("http://127.0.0.1:8090/remote-settings").then(function (r) { return r.json(); }).then(function (s) {
    return fetch("http://127.0.0.1:8090/remote-nolock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: !s.noLock }) });
  }).then(function () { refreshNoLock(); });
});
refreshNoLock();
  setInterval(refreshNoLock, 3000);  // 每3秒同步锁屏状态
			refreshSettings();
			refreshDetected();
			setInterval(refreshDetected, 5000);
			renderQr();
		}

		function renderQr() {
			var box = document.getElementById(NS + "-qr");
			if (!box) return;
			if (!state.url) { box.innerHTML = ""; return; }
			// 二维码只含纯网址；放大到 260px 便于手机扫描识别；下方附可点击网址文本
			box.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=' + encodeURIComponent(state.url) + '" alt="二维码" style="width:220px;height:220px">' +
				'<div style="font-size:12px;word-break:break-all"><a href="' + encodeURIComponent(state.url) + '" target="_blank" rel="noopener">' + state.url + '</a></div>';
			// 安卓 APP 下载二维码 → 中间页面（先认证再下载，避免下载管理器不带认证）
			var apkBox = document.getElementById(NS + "-apk");
			if (apkBox) {
				var base = state.url.replace(/\/$/, "") + "/remote-apk-page";
				apkBox.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(base) + '" alt="APP二维码" style="width:140px;height:140px;display:block;margin:4px auto">' +
					'<div style="text-align:center"><a href="' + base + '" target="_blank" rel="noopener">打开 APP 下载页</a></div>';
			}
		}

		// 手机端判断：小屏触屏设备
		function isMobile() {
			if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) return true;
			return navigator.maxTouchPoints > 0 && window.innerWidth < 900;
		}

		// 手机端：限制会话历史加载量（初始6条=最近问答，翻页20条），避免慢隧道加载大数据超时
		function installHistoryCap(ctx) {
			try {
				var conn = ctx && ctx.get ? ctx.get("connection") : null;
				var api = conn && conn.api;
				if (!api || !api.sessions || typeof api.sessions.history !== "function") {
					console.log("[dsh-remote] connection api 不可用，跳过历史限制");
					return;
				}
				if (api.sessions.__remoteCapped) return;
				var orig = api.sessions.history;
				api.sessions.history = function (payload, signal) {
					if (isMobile() && payload) {
						var max = payload.beforeSeq ? 20 : 6;
						payload = Object.assign({}, payload, { maxMessages: max });
					}
					return orig.call(this, payload, signal);
				};
				api.sessions.__remoteCapped = true;
				console.log("[dsh-remote] 手机端历史加载已限制(初始6条/翻页20条)");
			} catch (e) {
				console.log("[dsh-remote] 历史限制安装失败:", e.message);
			}
		}

		// APK 内悬浮设置齿轮（左下角，可拖动，仅 APK 环境；文件界面自动隐藏）
		function addSettingsGear() {
			if (!isApkApp()) return;
			if (document.getElementById(NS + "-gear")) return;
			var g = document.createElement("button");
			g.id = NS + "-gear";
			g.textContent = "⚙";
			g.title = "设置";
			g.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483050;width:34px;height:34px;border-radius:50%;border:none;background:rgba(15,118,110,.75);color:#fff;font-size:15px;display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:none";
			g.addEventListener("click", function () {
				if (window.DshBridge) DshBridge.openSettings();
			});
			document.body.appendChild(g);
			// 拖动（触摸 + 鼠标）
			var drag = null;
			g.addEventListener("touchstart", function (e) {
				var t = e.touches[0];
				drag = { sx: t.clientX, sy: t.clientY, l: g.offsetLeft, tp: g.offsetTop };
				e.preventDefault();
			});
			g.addEventListener("touchmove", function (e) {
				if (!drag) return;
				var t = e.touches[0];
				g.style.left = Math.max(0, Math.min(window.innerWidth - 40, drag.l + t.clientX - drag.sx)) + "px";
				g.style.top = Math.max(0, Math.min(window.innerHeight - 40, drag.tp + t.clientY - drag.sy)) + "px";
				g.style.bottom = "auto";
				e.preventDefault();
			});
			// 触摸轻点（未拖动）也触发设置——防止部分 WebView 的 touchstart preventDefault 吞掉 click
			g.addEventListener("touchend", function (e) {
				if (drag) {
					var t = e.changedTouches && e.changedTouches[0];
					if (t && Math.abs(t.clientX - drag.sx) < 8 && Math.abs(t.clientY - drag.sy) < 8) {
						if (window.DshBridge) DshBridge.openSettings();
					}
				}
				drag = null;
			});
			g.addEventListener("mousedown", function (e) {
				drag = { sx: e.clientX, sy: e.clientY, l: g.offsetLeft, tp: g.offsetTop };
				e.preventDefault();
			});
			document.addEventListener("mousemove", function (e) {
				if (!drag) return;
				g.style.left = Math.max(0, Math.min(window.innerWidth - 40, drag.l + e.clientX - drag.sx)) + "px";
				g.style.top = Math.max(0, Math.min(window.innerHeight - 40, drag.tp + e.clientY - drag.sy)) + "px";
				g.style.bottom = "auto";
			});
			document.addEventListener("mouseup", function () { drag = null; });
		}

		// 手机端：小电脑图标按钮 + 文件按钮，插到侧边栏搜索（放大镜）按钮下面
		function addMobileScreenButton() {
			if (document.getElementById(NS + "-screenbtn")) return;
			var b = document.createElement("button");
			b.id = NS + "-screenbtn";
			b.title = "看电脑屏幕";
			b.setAttribute("aria-label", "看电脑屏幕");
			b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>';
			b.style.cssText = "cursor:pointer;width:36px;height:36px;color:var(--dsw-alias-label-secondary,#6b7280);background:0 0;border:none;border-radius:50%;display:inline-flex;justify-content:center;align-items:center;padding:0;flex:none;margin:0 0 12px";
			b.addEventListener("click", function () {
				location.href = location.origin + "/remote-screen";
			});
			// 文件按钮（屏幕按钮下方）
			var fb = document.createElement("button");
			fb.id = NS + "-filebtn";
			fb.title = "文件传输";
			fb.setAttribute("aria-label", "文件传输");
			fb.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 14v-2a2 2 0 0 0-2-2H3v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z"/><path d="M21 14V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2v3"/></svg>';
			fb.style.cssText = b.style.cssText;
			fb.addEventListener("click", openFileBrowser);
			var placed = false;
			var tries = 0;
			function tryPlace() {
				tries++;
				if (placed && document.body.contains(b) && document.body.contains(fb)) return;
				var searchBtn = document.querySelector('button[class*="searchButton"], [class*="searchButton"]');
				if (searchBtn) {
					// 插到搜索框（放大镜 pill）容器后面，而不是搜索按钮内部
					var anchor = searchBtn.closest('[class$="_search"]') || searchBtn;
					if (anchor && anchor.parentNode) {
						anchor.parentNode.insertBefore(b, anchor.nextSibling);
						anchor.parentNode.insertBefore(fb, b.nextSibling);
						placed = true;
						return;
					}
				}
				if (tries > 50 && !placed) {  // 10秒找不到 → 右下角兜底
					b.style.cssText = "position:fixed;right:16px;bottom:80px;z-index:2147483000;width:44px;height:44px;border-radius:50%;background:#059669;color:#fff;border:none;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.3)";
					document.body.appendChild(b);
					fb.style.cssText = "position:fixed;right:16px;bottom:132px;z-index:2147483000;width:44px;height:44px;border-radius:50%;background:#7c3aed;color:#fff;border:none;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.3)";
					document.body.appendChild(fb);
					placed = true;
				}
			}
			tryPlace();
			setInterval(tryPlace, 200);  // 页面重渲染后自动重新插入
		}

		// ---------- 文件传输 ----------
		var fileState = { path: "D:\\", parent: null, sels: {} };  // sels: {path: true} 多选
		function openFileBrowser() {
			var modal = document.getElementById(NS + "-filemodal");
			if (!modal) buildFileModal();
			modal = document.getElementById(NS + "-filemodal");
			modal.style.display = "flex";
			var gear = document.getElementById(NS + "-gear");
			if (gear) gear.style.display = "none";  // 文件界面隐藏齿轮，避免重叠
			loadDrives();
			loadFileList(fileState.path);
		}
		function loadDrives() {
			var bar = document.getElementById(NS + "-fdrives");
			if (!bar) return;
			bar.innerHTML = "<span style='font-size:11px;color:#6b7280;flex:none'>磁盘:</span>";
			fetch("remote-file/drives").then(function (r) { return r.json(); }).then(function (d) {
				if (!d.ok) return;
				fileState.desktop = d.desktop;
				var html = bar.innerHTML;
				d.drives.forEach(function (dv) {
					html += '<button data-drive="' + encodeURIComponent(dv.path) + '" style="background:#0f766e;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;flex:none">' + dv.name + '</button>';
				});
				html += '<button data-drive="' + encodeURIComponent(d.desktop) + '" style="background:#7c3aed;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;flex:none">🖥 桌面</button>';
				bar.innerHTML = html;
				bar.querySelectorAll("button[data-drive]").forEach(function (btn) {
					btn.onclick = function () { loadFileList(decodeURIComponent(btn.getAttribute("data-drive"))); };
				});
			}).catch(function () {});
		}
		function buildFileModal() {
			var modal = document.createElement("div");
			modal.id = NS + "-filemodal";
			modal.style.cssText = "position:fixed;inset:0;z-index:2147483100;background:#fff;color:#1f2937;display:none;flex-direction:column;font-family:system-ui,-apple-system,'Segoe UI',sans-serif";
			modal.innerHTML =
				'<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#0f766e;color:#fff">' +
				'<button id="' + NS + '-fup" title="上级目录" style="background:none;border:none;color:#fff;font-size:16px;cursor:pointer;padding:4px 8px">⬆</button>' +
				'<div id="' + NS + '-fpath" style="flex:1;font-size:12px;word-break:break-all;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">D:\\</div>' +
				'<button id="' + NS + '-fclose" title="关闭" style="background:none;border:none;color:#fff;font-size:16px;cursor:pointer;padding:4px 8px">✖</button>' +
				'</div>' +
				'<div id="' + NS + '-fdrives" style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:#f0fdfa;border-bottom:1px solid #e5e7eb;overflow-x:auto"></div>' +
				'<div id="' + NS + '-flist" style="flex:1;overflow-y:auto;padding:4px 8px"></div>' +
				'<div style="display:flex;gap:8px;padding:10px 12px;border-top:1px solid #e5e7eb">' +
				'<button id="' + NS + '-fupload" style="flex:1;background:#0f766e;color:#fff;border:none;border-radius:8px;padding:10px;font-size:14px;cursor:pointer">⬆ 上传</button>' +
				'<button id="' + NS + '-fdownload" style="flex:1;background:#2563eb;color:#fff;border:none;border-radius:8px;padding:10px;font-size:14px;cursor:pointer">⬇ 下载</button>' +
				'<button id="' + NS + '-frefresh" style="flex:1;background:#6b7280;color:#fff;border:none;border-radius:8px;padding:10px;font-size:14px;cursor:pointer">🔄 刷新</button>' +
				'</div>' +
				'<input id="' + NS + '-ffile" type="file" multiple accept="*/*" style="display:none">';
			document.body.appendChild(modal);
			document.getElementById(NS + "-fclose").onclick = function () {
				modal.style.display = "none";
				var gear = document.getElementById(NS + "-gear");
				if (gear) gear.style.display = "flex";
			};
			document.getElementById(NS + "-fup").onclick = function () { if (fileState.parent) loadFileList(fileState.parent); };
			document.getElementById(NS + "-fupload").onclick = function () {
				// 优先用 File System Access API：直接打开系统文件管理器（不走相机/媒体选择器）
				if (window.showOpenFilePicker) {
					showOpenFilePicker({ multiple: true }).then(function (handles) {
						return Promise.all(handles.map(function (h) { return h.getFile(); }));
					}).then(function (files) { uploadFiles(files); }).catch(function () {});
					return;
				}
				document.getElementById(NS + "-ffile").click();
			};
			document.getElementById(NS + "-ffile").onchange = function () { uploadFiles(this.files); this.value = ""; };
			document.getElementById(NS + "-fdownload").onclick = downloadSelected;
			document.getElementById(NS + "-frefresh").onclick = function () { loadFileList(fileState.path); };
		}
		function loadFileList(path) {
			var list = document.getElementById(NS + "-flist");
			if (!list) return;
			fileState.path = path;
			fileState.sels = {};  // 切换目录清空选择
			updateSelCount();
			document.getElementById(NS + "-fpath").textContent = path;
			list.innerHTML = '<div style="padding:24px;text-align:center;color:#6b7280">加载中…</div>';
			fetch("remote-file/list?path=" + encodeURIComponent(path)).then(function (r) { return r.json(); }).then(function (d) {
				if (!d.ok) { list.innerHTML = '<div style="padding:24px;color:#dc2626">加载失败: ' + escHtml(d.error || "") + '</div>'; return; }
				fileState.parent = d.parent;
				var html = "";
				d.entries.forEach(function (e) {
					var icon = e.isDir ? "📁" : "📄";
					var size = e.isDir ? "" : fmtSize(e.size);
					var full = d.path + "\\" + e.name;
					html += '<div data-path="' + encodeURIComponent(full) + '" data-dir="' + e.isDir + '" style="display:flex;align-items:center;gap:10px;padding:10px 8px;border-bottom:1px solid #f3f4f6;cursor:pointer">' + icon + ' <span style="flex:1;font-size:14px">' + escHtml(e.name) + '</span> <span style="font-size:12px;color:#6b7280">' + size + '</span></div>';
				});
				if (!d.entries.length) html = '<div style="padding:24px;color:#9ca3af;text-align:center">（空目录）</div>';
				list.innerHTML = html;
				list.querySelectorAll("div[data-path]").forEach(function (row) {
					row.onclick = function () {
						var isDir = row.getAttribute("data-dir") === "true";
						var p = decodeURIComponent(row.getAttribute("data-path"));
						if (isDir) loadFileList(p);
						else {
							// 多选切换
							if (fileState.sels[p]) delete fileState.sels[p];
							else fileState.sels[p] = true;
							list.querySelectorAll("div[data-path]").forEach(function (r2) {
								var pp = decodeURIComponent(r2.getAttribute("data-path"));
								if (fileState.sels[pp]) { r2.style.background = "#eff6ff"; r2.style.borderLeft = "3px solid #2563eb"; }
								else { r2.style.background = ""; r2.style.borderLeft = ""; }
							});
							updateSelCount();
						}
					};
				});
			}).catch(function () { list.innerHTML = '<div style="padding:24px;color:#dc2626">网络错误</div>'; });
		}
		function askDownloadMode(count, onZip, onEach) {
			var old = document.getElementById(NS + "-askmodal");
			if (old) old.remove();
			var m = document.createElement("div");
			m.id = NS + "-askmodal";
			m.style.cssText = "position:fixed;inset:0;z-index:2147483200;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center";
			m.innerHTML =
				'<div style="background:#fff;border-radius:12px;padding:20px;width:280px;max-width:85vw;font-family:system-ui,-apple-system,sans-serif;color:#1f2937">' +
				'<div style="font-size:15px;font-weight:600;margin-bottom:6px">已选 ' + count + ' 个文件</div>' +
				'<div style="font-size:13px;color:#6b7280;margin-bottom:16px">请选择下载方式</div>' +
				'<button id="' + NS + '-askzip" style="display:block;width:100%;background:#2563eb;color:#fff;border:none;border-radius:8px;padding:11px;font-size:14px;cursor:pointer;margin-bottom:8px">📦 打包成 zip 下载</button>' +
				'<button id="' + NS + '-askeach" style="display:block;width:100%;background:#0f766e;color:#fff;border:none;border-radius:8px;padding:11px;font-size:14px;cursor:pointer">📄 逐个单独下载</button>' +
				'<button id="' + NS + '-askcancel" style="display:block;width:100%;background:transparent;color:#6b7280;border:none;border-radius:8px;padding:8px;font-size:13px;cursor:pointer;margin-top:6px">取消</button>' +
				'</div>';
			document.body.appendChild(m);
			document.getElementById(NS + "-askzip").onclick = function () { m.remove(); onZip(); };
			document.getElementById(NS + "-askeach").onclick = function () { m.remove(); onEach(); };
			document.getElementById(NS + "-askcancel").onclick = function () { m.remove(); };
		}
		function updateSelCount() {
			// 不显示数量，按钮始终为 下载
			var dbtn = document.getElementById(NS + "-fdownload");
			if (dbtn) dbtn.textContent = "⬇ 下载";
		}
		// 消息提示组件：标题 + 详情 + 关闭按钮（替代 alert）
function showMsg(title, detail) {
	var old = document.getElementById(NS + "-msg");
	if (old) old.remove();
	var m = document.createElement("div");
	m.id = NS + "-msg";
	m.style.cssText = "position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:2147483650;background:#0f172a;color:#fff;border:1px solid #334155;border-radius:10px;padding:14px 18px;max-width:80vw;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,.4);font-family:system-ui,sans-serif";
	m.innerHTML = '<div style="font-weight:600;font-size:14px;margin-bottom:4px">' + title + '</div>' +
		(detail ? '<div style="color:#cbd5e1;white-space:pre-line">' + detail + '</div>' : '') +
		'<button id="' + NS + '-msgx" style="position:absolute;top:6px;right:8px;background:none;border:none;color:#94a3b8;font-size:16px;cursor:pointer;padding:4px">✕</button>';
	document.body.appendChild(m);
	document.getElementById(NS + "-msgx").onclick = function () { m.remove(); };
	setTimeout(function () { try { m.remove(); } catch (_) {} }, 8000);
}
function isApkApp() { return /DshRemoteApp/i.test(navigator.userAgent); }
		function saveBlob(blob, name) {
			var url = URL.createObjectURL(blob);
			var a = document.createElement("a");
			a.href = url;
			a.download = name;
			document.body.appendChild(a);
			a.click();
			setTimeout(function () { try { URL.revokeObjectURL(url); a.remove(); } catch (_) {} }, 4000);
		}
		// APK WebView 下载：直接 HTTP 地址（系统下载管理器只接受 http/https，WebView 下载监听自动加认证头）
		function apkDownload(path) {
			window.location.href = "remote-file/download?path=" + encodeURIComponent(path);
		}
		function downloadSelected() {
			var paths = Object.keys(fileState.sels);
			if (!paths.length) { showMsg("提示", "请先点选文件（可多选）"); return; }
			var dbtn = document.getElementById(NS + "-fdownload");
			if (dbtn) { dbtn.textContent = "⬇ 下载中…"; dbtn.disabled = true; }
			var saveLoc = isApkApp() ? "已保存到手机 Download/deepseek 目录" : "已保存到浏览器下载目录";
			var done = function (okCount, totalCount) {
				if (dbtn) { dbtn.textContent = "⬇ 下载"; dbtn.disabled = false; }
				updateSelCount();
				if (okCount > 0) showMsg("下载成功", okCount + " 个文件下载成功\n" + saveLoc);
				else if (totalCount > 0) showMsg("下载失败", "下载失败，请重试");
			};
			if (paths.length === 1) {
				if (isApkApp()) { apkDownload(paths[0]); done(1, 1); return; }
				// 单选：原名直接下载
				fetch("remote-file/download?path=" + encodeURIComponent(paths[0]))
					.then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); })
					.then(function (blob) { saveBlob(blob, paths[0].split(/[\\/]/).pop()); done(1, 1); })
					.catch(function (e) { done(0, 1); });
				return;
			}
			// 多选：自定义对话框选「打包」或「逐个」
			askDownloadMode(paths.length, function () {
				if (isApkApp()) { window.location.href = "remote-file/zip?files=" + encodeURIComponent(JSON.stringify(paths)); done(paths.length, paths.length); return; }
				fetch("remote-file/zip?files=" + encodeURIComponent(JSON.stringify(paths)))
					.then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); })
					.then(function (blob) { saveBlob(blob, "下载文件.zip"); done(paths.length, paths.length); })
					.catch(function (e) { done(0, paths.length); });
			}, function () {
				// 逐个单独下载（顺序执行，间隔避免浏览器拦截）
				var i = 0;
				var okCount = 0;
				(function next() {
					if (i >= paths.length) { done(okCount, paths.length); return; }
					var p = paths[i++];
					if (dbtn) dbtn.textContent = "⬇ 下载中 (" + i + "/" + paths.length + ")";
					if (isApkApp()) { apkDownload(p); okCount++; setTimeout(next, 1200); return; }
					fetch("remote-file/download?path=" + encodeURIComponent(p))
						.then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); })
						.then(function (blob) { saveBlob(blob, p.split(/[\\/]/).pop()); okCount++; setTimeout(next, 900); })
						.catch(function () { setTimeout(next, 900); });
				})();
			});
		}
function uploadFiles(files) {
			if (!files || !files.length) return;
			var dir = fileState.path;
			var total = files.length;
			var remaining = total;
			var okCount = 0;
			var ubtn = document.getElementById(NS + "-fupload");
			if (ubtn) { ubtn.textContent = "⬆ 上传中…"; ubtn.disabled = true; }
			var finish = function () {
				if (ubtn) { ubtn.textContent = "⬆ 上传"; ubtn.disabled = false; }
				if (okCount > 0) showMsg("上传成功", okCount + " 个文件上传成功");
				else showMsg("上传失败", "上传失败，请重试");
				loadFileList(dir);
			};
			for (var i = 0; i < files.length; i++) {
				(function (file) {
					fetch("remote-file/upload?path=" + encodeURIComponent(dir) + "&name=" + encodeURIComponent(file.name), { method: "POST", body: file })
						.then(function (r) { return r.json(); })
						.then(function (d) { if (d && d.ok !== false) okCount++; if (--remaining === 0) finish(); })
						.catch(function () { if (--remaining === 0) finish(); });
				})(files[i]);
			}
		}
		function fmtSize(n) {
			if (n >= 1073741824) return (n / 1073741824).toFixed(1) + " GB";
			if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
			if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
			return n + " B";
		}
		function escHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

		function apply(ctx) {
			installHistoryCap(ctx);
			if (isMobile()) { addMobileScreenButton(); addSettingsGear(); return; } // 手机端：历史限制 + 屏幕按钮 + 齿轮，不显示远程面板
			loadState();
			buildPanel();
			document.getElementById(NS + "-url").value = state.url;
			document.getElementById(NS + "-body").style.display = state.open ? "flex" : "none";
			document.getElementById(NS + "-toggle").textContent = state.open ? "收起" : "展开";
		}

		exports.apply = apply;
		exports.inject = ["connection"];

		return module.exports;
	}
});
