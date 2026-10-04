window.__ModuleLoader__.load({
	id: "dsh-remote-control-desktop",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var NS = "dsh-remote";
		var ENTRY_TEXT = "远程访问";
		var API = "http://127.0.0.1:8090";   // 对外入口（手机经穿透走这里）
		var state = { url: "" };
		var entryEl = null;      // 侧边栏入口行
		var popEl = null;        // 弹层根节点
		var lockTimer = null;

		var ICON_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/></svg>';

		function loadState() {
			try {
				var s = JSON.parse(localStorage.getItem(NS) || "{}");
				state.url = s.url || "";
			} catch (e) {}
		}
		function saveState() {
			try { localStorage.setItem(NS, JSON.stringify(state)); } catch (e) {}
		}
		function $(id) { return document.getElementById(NS + "-" + id); }
		function isMobile() {
			if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) return true;
			return navigator.maxTouchPoints > 0 && window.innerWidth < 900;
		}
		function isApkApp() { return /DshRemoteApp/i.test(navigator.userAgent); }

		// ================= 样式（全部走 DSH 设计变量，自动适配亮/暗主题） =================
		function injectStyles() {
			if (document.getElementById(NS + "-style")) return;
			var s = [
				// ---- 弹层 ----
				"#" + NS + "{--dr-bd:var(--dsw-alias-border-l2,rgba(0,0,0,.10));position:fixed;z-index:2147483000;width:324px;max-width:calc(100vw - 20px);max-height:min(78vh,760px);display:flex;flex-direction:column;overflow:hidden;border-radius:14px;background:var(--dsw-alias-bg-elevated,#fff);color:var(--dsw-alias-label-primary,#111827);border:1px solid var(--dr-bd);box-shadow:0 16px 48px rgba(0,0,0,.24),0 2px 10px rgba(0,0,0,.08);font-family:system-ui,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;font-size:13px;line-height:1.55;opacity:0;transform:translateY(8px) scale(.98);pointer-events:none;transition:opacity .16s ease,transform .16s cubic-bezier(.2,.9,.3,1.15)}",
				"#" + NS + ".dshr-open{opacity:1;transform:none;pointer-events:auto}",
				"#" + NS + " *{box-sizing:border-box}",
				"#" + NS + "-head{display:flex;align-items:center;gap:8px;padding:12px 14px;flex:none;border-bottom:1px solid var(--dr-bd);background:var(--dsw-alias-bg-layer-1,transparent)}",
				"#" + NS + "-title{flex:1;font-weight:600;font-size:13.5px;display:flex;align-items:center;gap:7px}",
				"#" + NS + "-title svg{opacity:.85}",
				"." + NS + "-x{cursor:pointer;border:none;background:0 0;color:var(--dsw-alias-label-tertiary,#9ca3af);width:26px;height:26px;border-radius:8px;font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0;transition:background .14s,color .14s}",
				"." + NS + "-x:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#111827)}",
				"#" + NS + "-body{padding:14px;overflow-y:auto;flex:1 1 auto;display:flex;flex-direction:column;gap:15px}",
				"." + NS + "-sec{display:flex;flex-direction:column;gap:8px}",
				"." + NS + "-lbl{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#6b7280)}",
				"." + NS + "-hint{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280)}",
				"." + NS + "-hint code{background:var(--dsw-alias-fill-l2,rgba(127,127,127,.14));border-radius:4px;padding:1px 5px;font-size:10.5px;font-family:var(--dsw-alias-font-mono,ui-monospace,monospace)}",
				"." + NS + "-flex{display:flex;gap:8px;align-items:center}",
				"#" + NS + "-url{flex:1;min-width:0;font-size:12.5px;padding:9px 11px;border-radius:9px;border:1px solid var(--dr-bd);background:var(--dsw-alias-bg-base,#fff);color:inherit;outline:none;transition:border-color .15s,box-shadow .15s}",
				"#" + NS + "-url:focus{border-color:var(--dsw-alias-accent-primary,#2563eb);box-shadow:0 0 0 3px var(--dsw-alias-accent-soft,rgba(37,99,235,.16))}",
				"#" + NS + " button." + NS + "-btn{cursor:pointer;border:1px solid transparent;border-radius:9px;padding:9px 13px;font-size:12.5px;font-weight:600;background:var(--dsw-alias-fill-l2,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#111827);white-space:nowrap;font-family:inherit;transition:filter .15s}",
				"#" + NS + " button." + NS + "-btn:hover{filter:brightness(.95)}",
				"#" + NS + " button." + NS + "-primary{background:var(--dsw-alias-button-primary-fill,#059669);color:var(--dsw-alias-label-primary-inverted,#fff)}",
				// 开关行
				"." + NS + "-swrow{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:10px;border:1px solid var(--dr-bd);background:var(--dsw-alias-bg-layer-1,transparent);cursor:pointer;user-select:none;transition:background .15s}",
				"." + NS + "-swrow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}",
				"." + NS + "-swtxt{flex:1;font-size:12.5px;display:flex;align-items:center;gap:7px;min-width:0}",
				"." + NS + "-sw{position:relative;flex:none;width:34px;height:20px;border-radius:999px;background:var(--dsw-alias-fill-l3,rgba(127,127,127,.32));transition:background .18s}",
				"." + NS + "-sw i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .18s cubic-bezier(.3,.8,.4,1.2)}",
				"." + NS + "-sw.on{background:var(--dsw-alias-brand-primary,#059669)}",
				"." + NS + "-sw.on i{transform:translateX(14px)}",
				"." + NS + "-sw.warn{background:var(--dsw-alias-danger,#dc2626)}",
				"." + NS + "-sw.busy{opacity:.5}",
				"." + NS + "-sub{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280);margin:-3px 0 0 2px}",
				// 二维码
				"." + NS + "-qr{display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px;border-radius:11px;border:1px dashed var(--dr-bd);background:var(--dsw-alias-bg-base,#fff)}",
				"." + NS + "-qr img{width:180px;height:180px;border-radius:8px;background:#fff;display:block}",
				"." + NS + "-qr:empty{display:none}",
				"." + NS + "-qrapk img{width:132px;height:132px}",
				"." + NS + "-qr a{font-size:11px;word-break:break-all;text-align:center;color:var(--dsw-alias-link,#2563eb);text-decoration:none}",
				"#" + NS + "-warn{font-size:11.5px;color:var(--dsw-alias-danger,#dc2626);display:none}",
				"#" + NS + "-detected{font-size:11px;color:var(--dsw-alias-brand-primary,#059669);display:flex;align-items:center;gap:5px}",
				// 说明
				"." + NS + "-help{border-top:1px solid var(--dr-bd);padding-top:11px}",
				"." + NS + "-help summary{cursor:pointer;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#6b7280);list-style:none;display:flex;align-items:center;gap:6px}",
				"." + NS + "-help summary::-webkit-details-marker{display:none}",
				"." + NS + "-help summary:before{content:'▸';display:inline-block;transition:transform .15s}",
				"." + NS + "-help[open] summary:before{transform:rotate(90deg)}",
				"#" + NS + "-status{font-size:11.5px;color:var(--dsw-alias-label-secondary,#6b7280);white-space:pre-wrap;line-height:1.7;padding-top:8px}",
				// ---- 手机：底部抽屉 ----
				"@media (max-width:640px){#" + NS + "{left:10px;right:10px;width:auto;max-width:none;bottom:10px;top:auto!important;max-height:82vh}}"
			].join("");
			var el = document.createElement("style");
			el.id = NS + "-style";
			el.textContent = s;
			document.head.appendChild(el);
		}

		// ================= 后台接口 =================
		function setSwitch(name, on, extra) {
			var sw = $(name + "-sw");
			if (!sw) return;
			sw.className = NS + "-sw" + (on ? " on" : "") + (extra ? " " + extra : "");
		}
		function refreshDetected() {
			fetch(API + "/remote-addr").then(function (r) { return r.json(); }).then(function (d) {
				var el = $("detected");
				if (!el) return;
				el.textContent = d.host ? "✓ 检测到手机访问域名：" + d.host : "等待手机访问…";
				el.style.color = d.host ? "var(--dsw-alias-brand-primary,#059669)" : "var(--dsw-alias-label-tertiary,#6b7280)";
			}).catch(function () {});
		}
		function refreshSettings() {
			fetch(API + "/remote-settings").then(function (r) { return r.json(); }).then(function (s) {
				setSwitch("ctrl", !!s.controlEnabled);
				setSwitch("comp", !!s.compression);
				var c = $("ctrl"), m = $("comp");
				if (c) c.textContent = s.controlEnabled ? "🖥  远程控制已开启" : "🖥  远程控制已关闭";
				if (m) m.textContent = s.compression ? "🗜  压缩画质已开启" : "🗜  压缩画质已关闭";
			}).catch(function () {
				var c = $("ctrl");
				if (c) c.textContent = "🖥  设置读取失败";
			});
		}
		function toggleSetting(key) {
			fetch(API + "/remote-settings").then(function (r) { return r.json(); }).then(function (s) {
				var next = {}; next[key] = !s[key];
				return fetch(API + "/remote-settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
			}).then(function () { refreshSettings(); }).catch(function () {});
		}
		function refreshNoLock() {
			var lockP = fetch(API + "/remote-screen/lockstate").then(function (r) { return r.json(); }).catch(function () { return { locked: false }; });
			var setP = fetch(API + "/remote-settings").then(function (r) { return r.json(); }).catch(function () { return {}; });
			Promise.all([lockP, setP]).then(function (a) {
				var locked = !!a[0].locked, noLock = !!a[1].noLock;
				setSwitch("nolock", noLock, locked && !noLock ? "warn" : "");
				var t = $("nolock");
				if (t) t.textContent = noLock ? "🔓  防锁屏已开启" : "🔒  防锁屏已关闭";
				var st = $("lockstate");
				if (st) {
					st.textContent = noLock
						? (locked ? "电脑当前已锁屏，解锁后保持不锁" : "电脑保持唤醒，远程操控畅通")
						: (locked ? "电脑当前已锁屏 · 需在本机解锁" : "电脑当前未锁屏");
				}
			});
		}
		function toggleNoLock() {
			var sw = $("nolock-sw");
			if (sw) sw.className = NS + "-sw busy";
			fetch(API + "/remote-settings").then(function (r) { return r.json(); }).then(function (s) {
				return fetch(API + "/remote-nolock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: !s.noLock }) });
			}).then(function () { refreshNoLock(); }).catch(function () { refreshNoLock(); });
		}
		function renderQr() {
			var box = $("qr");
			if (box) {
				if (!state.url) box.innerHTML = "";
				else box.innerHTML =
					'<img src="https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=' + encodeURIComponent(state.url) + '" alt="二维码">' +
					'<a href="' + state.url + '" target="_blank" rel="noopener">' + state.url + '</a>';
			}
			var apkBox = $("apk");
			if (apkBox) {
				if (!state.url) { apkBox.innerHTML = '<div class="' + NS + '-hint">保存地址后显示下载二维码</div>'; }
				else {
					var base = state.url.replace(/\/$/, "") + "/remote-apk-page";
					apkBox.innerHTML =
						'<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(base) + '" alt="APP 二维码">' +
						'<a href="' + base + '" target="_blank" rel="noopener">打开 APP 下载页</a>';
				}
			}
		}

		// ================= 弹层 =================
		function buildPopover() {
			if (popEl && document.body.contains(popEl)) return popEl;
			injectStyles();
			var p = document.createElement("div");
			p.id = NS;
			p.setAttribute("role", "dialog");
			p.setAttribute("aria-label", "远程访问");
			p.innerHTML =
				'<div id="' + NS + '-head">' +
					'<span id="' + NS + '-title">' + ICON_SVG + '远程访问</span>' +
					'<button class="' + NS + '-x" id="' + NS + '-close" type="button" title="关闭" aria-label="关闭">✕</button>' +
				'</div>' +
				'<div id="' + NS + '-body">' +

					'<div class="' + NS + '-sec">' +
						'<div class="' + NS + '-lbl">公网访问地址</div>' +
						'<div class="' + NS + '-flex">' +
							'<input id="' + NS + '-url" placeholder="https://你的公网域名" spellcheck="false">' +
							'<button id="' + NS + '-save" class="' + NS + '-btn ' + NS + '-primary" type="button">保存</button>' +
						'</div>' +
						'<div class="' + NS + '-hint">穿透工具需转发到本机 <code>127.0.0.1:8090</code></div>' +
						'<div id="' + NS + '-warn" class="' + NS + '-hint" style="display:none;color:var(--dsw-alias-danger,#dc2626)">⚠ 该地址不是 https://，部分穿透工具的 http 地址不支持 WebSocket，会话可能不显示</div>' +
						'<div id="' + NS + '-detected"></div>' +
					'</div>' +

					'<div id="' + NS + '-qr" class="' + NS + '-qr"></div>' +

					'<div class="' + NS + '-sec">' +
						'<div class="' + NS + '-lbl">控制开关</div>' +
						'<div class="' + NS + '-swrow" id="' + NS + '-ctrl-row">' +
							'<span class="' + NS + '-swtxt" id="' + NS + '-ctrl">🖥  远程控制</span>' +
							'<span class="' + NS + '-sw" id="' + NS + '-ctrl-sw"><i></i></span>' +
						'</div>' +
						'<div class="' + NS + '-swrow" id="' + NS + '-comp-row">' +
							'<span class="' + NS + '-swtxt" id="' + NS + '-comp">🗜  压缩画质</span>' +
							'<span class="' + NS + '-sw" id="' + NS + '-comp-sw"><i></i></span>' +
						'</div>' +
						'<div class="' + NS + '-swrow" id="' + NS + '-nolock-row">' +
							'<span class="' + NS + '-swtxt" id="' + NS + '-nolock">🔒  防锁屏</span>' +
							'<span class="' + NS + '-sw" id="' + NS + '-nolock-sw"><i></i></span>' +
						'</div>' +
						'<div class="' + NS + '-sub" id="' + NS + '-lockstate"></div>' +
					'</div>' +

					'<div class="' + NS + '-sec">' +
						'<div class="' + NS + '-lbl">安卓 App</div>' +
						'<div id="' + NS + '-apk" class="' + NS + '-qr ' + NS + '-qrapk"></div>' +
					'</div>' +

					'<details class="' + NS + '-help">' +
						'<summary>使用说明</summary>' +
						'<div id="' + NS + '-status">' +
							'1. 用任意内网穿透工具（cpolar / frp / ngrok 等）\n   把公网 URL 转发到本机 127.0.0.1:8090\n' +
							'2. 手机开移动数据打开上面的网址\n' +
							'3. 若隧道设置了认证，浏览器会提示输入\n   （由穿透工具配置，非本插件）\n' +
							'4. 即可远程使用本机 Harness' +
						'</div>' +
					'</details>' +

				'</div>';
			document.body.appendChild(p);
			popEl = p;

			$("close").addEventListener("click", function () { closePopover(); });
			$("save").addEventListener("click", function () {
				var raw = $("url").value.trim();
				// 协议头智能修复：https//x（缺冒号）→ https://x；裸域名 x → https://x
				if (raw) {
					var m = raw.match(/^(https?):?\/\//i);
					if (m) raw = m[1].toLowerCase() + "://" + raw.slice(m[0].length);
					else if (raw.indexOf("://") < 0) raw = "https://" + raw;
				}
				state.url = raw;
				$("url").value = raw;
				saveState();
				renderQr();
				var warn = $("warn");
				if (warn) warn.style.display = (state.url && state.url.indexOf("https://") !== 0) ? "block" : "none";
			});
			$("url").addEventListener("keydown", function (e) { if (e.key === "Enter") $("save").click(); });
			$("ctrl-row").addEventListener("click", function () { toggleSetting("controlEnabled"); });
			$("comp-row").addEventListener("click", function () { toggleSetting("compression"); });
			$("nolock-row").addEventListener("click", function () { toggleNoLock(); });
			return p;
		}

		function positionPopover() {
			if (!popEl) return;
			if (window.innerWidth <= 640) { popEl.style.left = ""; popEl.style.top = ""; return; }  // 交给媒体查询做底部抽屉
			var W = popEl.offsetWidth || 324, H = popEl.offsetHeight || 420;
			var r = entryEl && document.body.contains(entryEl) ? entryEl.getBoundingClientRect() : null;
			var left = r ? r.right + 12 : window.innerWidth - W - 16;
			var top = r ? r.top - 6 : 64;
			left = Math.max(8, Math.min(left, window.innerWidth - W - 8));
			top = Math.max(8, Math.min(top, window.innerHeight - H - 8));
			popEl.style.left = Math.round(left) + "px";
			popEl.style.top = Math.round(top) + "px";
		}

		function openPopover() {
			buildPopover();
			if ($("url")) $("url").value = state.url;
			popEl.classList.add("dshr-open");
			positionPopover();
			renderQr();
			refreshSettings();
			refreshNoLock();
			refreshDetected();
			if (lockTimer) clearInterval(lockTimer);
			lockTimer = setInterval(function () {
				if (popEl && popEl.classList.contains("dshr-open")) refreshNoLock();
				else { clearInterval(lockTimer); lockTimer = null; }
			}, 4000);
		}

		function closePopover(silent) {
			if (popEl) popEl.classList.remove("dshr-open");
			if (lockTimer) { clearInterval(lockTimer); lockTimer = null; }
		}

		function togglePopover() {
			if (popEl && popEl.classList.contains("dshr-open")) closePopover();
			else openPopover();
		}

		// ================= 侧边栏入口 =================
		// 做法：克隆原生「会话管理」那一行，再改图标与文字。
		// 好处是 100% 继承 DSH 自己的样式、间距、hover 效果，不必去猜被压缩的类名。
		function findNativeFooterRow() {
			var sidebar = document.querySelector("[data-dsh-sidebar],[data-testid=sidebar],.dsw-sidebar,[aria-label=会话][role=navigation]");
			var scope = sidebar || document.body;
			var nodes = scope.querySelectorAll("button,[role=button],a,div,span");
			for (var i = nodes.length - 1; i >= 0; i--) {
				var el = nodes[i];
				if (el.children.length > 1) continue;
				var t = (el.textContent || "").trim();
				if (t !== "会话管理" && t !== "Session manager" && t !== "Sessions" && t !== "会话") continue;
				// 往上找一个「成行」的容器：一直爬到最外层仍保持行高的祖先，
				// 避免只克隆到文字 span，导致入口丢失图标与内边距。
				var row = el, best = null;
				for (var k = 0; k < 4 && row && row !== scope; k++) {
					var rect = row.getBoundingClientRect();
					if (rect.width >= 120 && rect.height >= 18 && rect.height <= 64) best = row;
					row = row.parentNode;
				}
				return { row: best || el, text: t };
			}
			return null;
		}

		/** 在克隆出来的子树里，找出原本承载那段文字的节点。 */
		function findLabelNode(root, text) {
			var found = null;
			(function walk(node) {
				if (found) return;
				var kids = node.children || [];
				for (var i = 0; i < kids.length; i++) {
					var c = kids[i];
					if (c.children.length === 0) {
						if ((c.textContent || "").trim() === text) { found = c; return; }
					} else {
						walk(c);
						if (found) return;
					}
				}
			})(root);
			return found;
		}

		/** 造一个和原生同尺寸的图标节点。 */
		function makeIcon() {
			var holder = document.createElement("span");
			holder.innerHTML = ICON_SVG;
			var svg = holder.firstChild;
			if (svg) svg.style.flex = "none";
			return svg || holder;
		}

		function buildFallbackEntry() {
			var b = document.createElement("button");
			b.type = "button";
			b.style.cssText = "display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;margin:0 0 2px;cursor:pointer;border:none;border-radius:8px;background:0 0;color:var(--dsw-alias-label-secondary,#6b7280);font:inherit;font-size:13px;text-align:left";
			b.onmouseenter = function () { b.style.background = "var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))"; };
			b.onmouseleave = function () { b.style.background = "0 0"; };
			b.innerHTML = ICON_SVG + "<span>  " + ENTRY_TEXT + "</span>";
			return b;
		}

		function mountEntry() {
			if (entryEl && document.body.contains(entryEl)) return true;
			injectStyles();
			var found = findNativeFooterRow();
			var el;
			if (found && found.row && found.row.parentNode) {
				var native = found.row;
				el = native.cloneNode(true);
				el.removeAttribute("id");
				el.removeAttribute("href");
				el.removeAttribute("data-testid");
				el.removeAttribute("aria-label");
				el.removeAttribute("title");

				// 1) 文案：定位到原文字节点，原地替换，保留原生字号/颜色
				var label = findLabelNode(el, found.text);
				if (label) label.textContent = ENTRY_TEXT;
				else {
					var done = false;
					(function walk(node) {
						for (var i = 0; i < node.childNodes.length; i++) {
							var c = node.childNodes[i];
							if (c.nodeType === 3 && c.nodeValue && c.nodeValue.trim()) {
								if (!done) { c.nodeValue = ENTRY_TEXT; done = true; } else c.nodeValue = "";
							} else if (c.nodeType === 1) walk(c);
						}
					})(el);
					if (!done) el.appendChild(document.createTextNode(ENTRY_TEXT));
				}

				// 2) 图标：原生若是图标字体（没有 svg），也必须补上，否则这里会变成空白
				var iconHost = null;
				if (label) {
					var sib = label.previousElementSibling, guard = 0;
					while (sib && guard++ < 4) {
						var raw = (sib.textContent || "").trim();
						// svg / 无文字占位 / 图标字体的单个字形（1~2 字符），都视为图标位
						if (String(sib.tagName).toLowerCase() === "svg" || !raw || raw.length <= 2) { iconHost = sib; break; }
						sib = sib.previousElementSibling;
					}
				}
				if (!iconHost) iconHost = el.querySelector("svg");
				var icon = makeIcon();
				if (iconHost && iconHost.parentNode) iconHost.parentNode.replaceChild(icon, iconHost);
				else if (label && label.parentNode) label.parentNode.insertBefore(icon, label);
				else el.insertBefore(icon, el.firstChild);

				el.style.cursor = "pointer";
				native.parentNode.insertBefore(el, native);   // 放在「会话管理」上面
			} else {
				el = buildFallbackEntry();
				var sidebar = document.querySelector("[data-dsh-sidebar],[data-testid=sidebar],.dsw-sidebar,[aria-label=会话][role=navigation]");
				var host = null;
				if (sidebar) {
					// 找侧栏里最靠下的一个块级容器当宿主
					var kids = sidebar.querySelectorAll("div,section,footer,nav");
					for (var j = kids.length - 1; j >= 0; j--) {
						var rr = kids[j].getBoundingClientRect();
						if (rr.width > 120 && rr.height > 24 && rr.bottom > window.innerHeight - 220 && rr.height < window.innerHeight * 0.7) { host = kids[j]; break; }
					}
				}
				if (host) host.appendChild(el);
				else {
					el.style.cssText += ";position:fixed;right:16px;bottom:16px;width:46px;height:46px;border-radius:50%;background:var(--dsw-alias-brand-primary,#059669);color:#fff;justify-content:center;box-shadow:0 6px 18px rgba(0,0,0,.28);z-index:2147483000";
					document.body.appendChild(el);
				}
			}
			entryEl = el;
			entryEl.id = NS + "-entry";
			entryEl.setAttribute("title", ENTRY_TEXT);
			entryEl.setAttribute("aria-label", ENTRY_TEXT);
			entryEl.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); togglePopover(); });
			return true;
		}

		// ================= 手机端既有按钮 =================
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

		// 手机端：屏幕 + 文件 两个按钮，插到侧边栏搜索按钮下面
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
					var anchor = searchBtn.closest('[class$="_search"]') || searchBtn;
					if (anchor && anchor.parentNode) {
						// 若「远程访问」入口已在同一容器，接在它后面，避免顺序被打乱
						var after = (entryEl && entryEl.parentNode === anchor.parentNode) ? entryEl : anchor;
						anchor.parentNode.insertBefore(b, after.nextSibling);
						anchor.parentNode.insertBefore(fb, b.nextSibling);
						placed = true;
						return;
					}
				}
				if (tries > 50 && !placed) {
					b.style.cssText = "position:fixed;right:16px;bottom:80px;z-index:2147483000;width:44px;height:44px;border-radius:50%;background:#059669;color:#fff;border:none;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.3)";
					document.body.appendChild(b);
					fb.style.cssText = "position:fixed;right:16px;bottom:132px;z-index:2147483000;width:44px;height:44px;border-radius:50%;background:#7c3aed;color:#fff;border:none;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.3)";
					document.body.appendChild(fb);
					placed = true;
				}
			}
			tryPlace();
			setInterval(tryPlace, 200);
		}

		// ================= 文件传输 =================
		var fileState = { path: "D:\\", parent: null, sels: {} };
		function openFileBrowser() {
			var modal = document.getElementById(NS + "-filemodal");
			if (!modal) buildFileModal();
			modal = document.getElementById(NS + "-filemodal");
			modal.style.display = "flex";
			closePopover(true);
			var gear = document.getElementById(NS + "-gear");
			if (gear) gear.style.display = "none";
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
			fileState.sels = {};
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
			var dbtn = document.getElementById(NS + "-fdownload");
			if (dbtn) dbtn.textContent = "⬇ 下载";
		}
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
		function saveBlob(blob, name) {
			var url = URL.createObjectURL(blob);
			var a = document.createElement("a");
			a.href = url;
			a.download = name;
			document.body.appendChild(a);
			a.click();
			setTimeout(function () { try { URL.revokeObjectURL(url); a.remove(); } catch (_) {} }, 4000);
		}
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
				fetch("remote-file/download?path=" + encodeURIComponent(paths[0]))
					.then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); })
					.then(function (blob) { saveBlob(blob, paths[0].split(/[\\/]/).pop()); done(1, 1); })
					.catch(function (e) { done(0, 1); });
				return;
			}
			askDownloadMode(paths.length, function () {
				if (isApkApp()) { window.location.href = "remote-file/zip?files=" + encodeURIComponent(JSON.stringify(paths)); done(paths.length, paths.length); return; }
				fetch("remote-file/zip?files=" + encodeURIComponent(JSON.stringify(paths)))
					.then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); })
					.then(function (blob) { saveBlob(blob, "下载文件.zip"); done(paths.length, paths.length); })
					.catch(function (e) { done(0, paths.length); });
			}, function () {
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
			var remaining = files.length;
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

		// ================= 启动 =================
		function apply(ctx) {
			installHistoryCap(ctx);
			loadState();

			// 侧边栏入口（原生行克隆；找不到就退化为自绘按钮）
			try { mountEntry(); } catch (e) { console.log("[dsh-remote] 入口挂载失败:", e && e.message); }
			// 启动阶段密集重试（页面还没渲染完），稳定后转为低频守护，防 React 重渲染把它冲掉
			var tries = 0;
			var entryTimer = setInterval(function () {
				tries++;
				try { mountEntry(); } catch (e) {}
				if (tries > 20 && entryEl && document.body.contains(entryEl)) {
					clearInterval(entryTimer);
					entryTimer = setInterval(function () {
						if (entryEl && document.body.contains(entryEl)) return;
						try { mountEntry(); } catch (e) {}
					}, 1500);
				}
			}, 300);

			if (isMobile()) { addMobileScreenButton(); addSettingsGear(); }

			// 点外部 / Esc 关闭
			document.addEventListener("mousedown", function (e) {
				if (!popEl || !popEl.classList.contains("dshr-open")) return;
				if (popEl.contains(e.target)) return;
				if (entryEl && entryEl.contains(e.target)) return;
				closePopover();
			}, true);
			document.addEventListener("touchstart", function (e) {
				if (!popEl || !popEl.classList.contains("dshr-open")) return;
				if (popEl.contains(e.target)) return;
				if (entryEl && entryEl.contains(e.target)) return;
				closePopover();
			}, true);
			document.addEventListener("keydown", function (e) {
				if (e.key === "Escape") closePopover();
			});
			window.addEventListener("resize", function () {
				if (popEl && popEl.classList.contains("dshr-open")) positionPopover();
			});

			return function dispose() {
				if (entryTimer) clearInterval(entryTimer);
				if (lockTimer) clearInterval(lockTimer);
				try { if (entryEl && entryEl.parentNode) entryEl.parentNode.removeChild(entryEl); } catch (_) {}
				try { if (popEl && popEl.parentNode) popEl.parentNode.removeChild(popEl); } catch (_) {}
			};
		}

		exports.apply = apply;
		exports.inject = ["connection"];

		return module.exports;
	}
});
