window.__ModuleLoader__.load({
	id: "dsh-remote-control-desktop",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var NS = "dsh-remote";
		var ENTRY_TEXT = "远程访问";
		// 对外入口（手机经穿透走这里）。**默认值只是兜底**：真正的端口在启动时由
		// /dsh-remote/info 念给客户端（用户在设置面板里能把 listenPort 改成别的）。
		var API = "http://127.0.0.1:8090";
		var INFO_URL = "/dsh-remote/info";   // 挂在 DSH web server 上，走相对路径永远可达
		var apiInfo = null;                  // 最近一次 info 结果（activeListenPort / settings）
		var apiReady = null;                 // 解析端口的 promise（全流程只发一次）
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
				// ---- 主题色板：运行时探测 DSH 当前主题，镜像到 <html data-dsr-theme> ----
				// 不依赖 --dsw-alias-*：DSH 里部分 token（bg-elevated / fill-l2 / accent-* / danger）
				// 压根没有定义，或会解析成 unset/transparent，结果就是深色主题下一块深一块浅。
				// 这里用显式两套颜色，和 dsh-session-manager 的处理方式一致。
				":root[data-dsr-theme=light]{--dsr-bg:#fff;--dsr-fg:#1f2329;--dsr-fg2:#5b6169;--dsr-fg3:#8a9099;--dsr-bd:rgba(0,0,0,.12);--dsr-surface:#f5f6f8;--dsr-input:#fff;--dsr-hover:rgba(38,49,72,.06);--dsr-fill:rgba(38,49,72,.07);--dsr-track:rgba(38,49,72,.22);--dsr-accent:#2563eb;--dsr-accent-soft:rgba(37,99,235,.18);--dsr-accent-fg:#fff;--dsr-danger:#d92d20;--dsr-link:#2563eb;--dsr-mask:rgba(15,23,42,.42);--dsr-shadow:0 24px 70px rgba(0,0,0,.28),0 4px 14px rgba(0,0,0,.10)}",
				":root[data-dsr-theme=dark]{--dsr-bg:#1f1f23;--dsr-fg:#ececec;--dsr-fg2:#b8bbc1;--dsr-fg3:#8d9096;--dsr-bd:rgba(255,255,255,.14);--dsr-surface:#26262b;--dsr-input:#191a1d;--dsr-hover:rgba(255,255,255,.08);--dsr-fill:rgba(255,255,255,.10);--dsr-track:rgba(255,255,255,.26);--dsr-accent:#4c7dfa;--dsr-accent-soft:rgba(76,125,250,.30);--dsr-accent-fg:#fff;--dsr-danger:#f97066;--dsr-link:#7aa2ff;--dsr-mask:rgba(0,0,0,.62);--dsr-shadow:0 24px 70px rgba(0,0,0,.62),0 4px 14px rgba(0,0,0,.42)}",
				// ---- 遮罩 + 全屏式弹窗 ----
				"#" + NS + "-mask{position:fixed;inset:0;z-index:2147482998;background:var(--dsr-mask);opacity:0;pointer-events:none;transition:opacity .18s ease}",
				"#" + NS + "-mask.dshr-open{opacity:1;pointer-events:auto}",
				"#" + NS + "{position:fixed;z-index:2147483000;left:50%;top:50%;width:min(880px,94vw);max-height:min(92vh,780px);display:flex;flex-direction:column;overflow:hidden;border-radius:16px;background:var(--dsr-bg);color:var(--dsr-fg);border:1px solid var(--dsr-bd);box-shadow:var(--dsr-shadow);font-family:system-ui,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;font-size:13px;line-height:1.55;opacity:0;transform:translate(-50%,-46%) scale(.975);pointer-events:none;transition:opacity .18s ease,transform .2s cubic-bezier(.2,.9,.3,1.1)}",
				"#" + NS + ".dshr-open{opacity:1;transform:translate(-50%,-50%) scale(1);pointer-events:auto}",
				"#" + NS + " *{box-sizing:border-box}",
				"#" + NS + "-head{display:flex;align-items:center;gap:9px;padding:14px 20px;flex:none;border-bottom:1px solid var(--dsr-bd);background:0 0}",
				"#" + NS + "-title{flex:1;font-weight:600;font-size:14.5px;display:flex;align-items:center;gap:8px;color:var(--dsr-fg)}",
				"#" + NS + "-title svg{opacity:.9}",
				"." + NS + "-x{cursor:pointer;border:none;background:0 0;color:var(--dsr-fg3);width:30px;height:30px;border-radius:9px;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0;transition:background .14s,color .14s}",
				"." + NS + "-x:hover{background:var(--dsr-hover);color:var(--dsr-fg)}",
				"#" + NS + "-body{padding:20px;overflow-y:auto;flex:1 1 auto;display:grid;grid-template-columns:300px minmax(0,1fr);gap:22px;align-items:start}",
				"." + NS + "-col{display:flex;flex-direction:column;gap:18px;min-width:0}",
				"." + NS + "-sec{display:flex;flex-direction:column;gap:8px}",
				"." + NS + "-lbl{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsr-fg3)}",
				"." + NS + "-hint{font-size:11px;color:var(--dsr-fg3);line-height:1.6}",
				"." + NS + "-hint code{background:var(--dsr-fill);color:var(--dsr-fg2);border-radius:4px;padding:1px 5px;font-size:10.5px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}",
				"." + NS + "-flex{display:flex;gap:8px;align-items:center}",
				"#" + NS + "-url{flex:1;min-width:0;font-size:12.5px;padding:10px 12px;border-radius:9px;border:1px solid var(--dsr-bd);background:var(--dsr-input);color:var(--dsr-fg);outline:none;transition:border-color .15s,box-shadow .15s}",
				"#" + NS + "-url::placeholder{color:var(--dsr-fg3)}",
				"#" + NS + "-url:focus{border-color:var(--dsr-accent);box-shadow:0 0 0 3px var(--dsr-accent-soft)}",
				"#" + NS + " button." + NS + "-btn{cursor:pointer;border:1px solid var(--dsr-bd);border-radius:9px;padding:10px 15px;font-size:12.5px;font-weight:600;background:var(--dsr-surface);color:var(--dsr-fg);white-space:nowrap;font-family:inherit;transition:background .15s}",
				"#" + NS + " button." + NS + "-btn:hover{background:var(--dsr-hover)}",
				"#" + NS + " button." + NS + "-primary{background:var(--dsr-accent);border-color:transparent;color:var(--dsr-accent-fg)}",
				"#" + NS + " button." + NS + "-primary:hover{filter:brightness(1.08)}",
				// 二维码（主角）
				"." + NS + "-qrcard{display:flex;flex-direction:column;align-items:center;gap:10px;padding:18px 14px;border-radius:14px;border:1px solid var(--dsr-bd);background:var(--dsr-surface)}",
				"#" + NS + "-qr{display:flex;align-items:center;justify-content:center;width:236px;height:236px;border-radius:10px;background:#fff;overflow:hidden}",
				"#" + NS + "-qr img{width:236px;height:236px;display:block}",
				"." + NS + "-qrempty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:0 18px;text-align:center;color:var(--dsr-fg3);font-size:12px;line-height:1.65}",
				"." + NS + "-qrempty svg{opacity:.4}",
				"." + NS + "-qrcap{font-size:11.5px;color:var(--dsr-fg3)}",
				"." + NS + "-qrurl{font-size:10.5px;word-break:break-all;text-align:center;color:var(--dsr-link);text-decoration:none;max-width:100%}",
				// 开关行
				"." + NS + "-swrow{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;border:1px solid var(--dsr-bd);background:var(--dsr-surface);cursor:pointer;user-select:none;transition:background .15s}",
				"." + NS + "-swrow:hover{background:var(--dsr-hover)}",
				"." + NS + "-swtxt{flex:1;font-size:12.5px;display:flex;align-items:center;gap:7px;min-width:0;color:var(--dsr-fg)}",
				"." + NS + "-sw{position:relative;flex:none;width:34px;height:20px;border-radius:999px;background:var(--dsr-track);transition:background .18s}",
				"." + NS + "-sw i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .18s cubic-bezier(.3,.8,.4,1.2)}",
				"." + NS + "-sw.on{background:var(--dsr-accent)}",
				"." + NS + "-sw.on i{transform:translateX(14px)}",
				"." + NS + "-sw.warn{background:var(--dsr-danger)}",
				"." + NS + "-sw.busy{opacity:.5}",
				"." + NS + "-sub{font-size:11px;color:var(--dsr-fg3);margin:-3px 0 0 2px}",
				// APK
				"." + NS + "-apkcard{display:flex;align-items:center;gap:14px;padding:12px;border-radius:12px;border:1px solid var(--dsr-bd);background:var(--dsr-surface)}",
				"#" + NS + "-apk{flex:none;width:110px;height:110px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:#fff;overflow:hidden}",
				"#" + NS + "-apk img{width:110px;height:110px;display:block}",
				"#" + NS + "-apk a{font-size:11px;color:var(--dsr-link);text-decoration:none}",
				"." + NS + "-apkinfo{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--dsr-fg)}",
				"#" + NS + "-warn{font-size:11.5px;color:var(--dsr-danger);display:none}",
				"#" + NS + "-detected{font-size:11px;color:var(--dsr-fg3);display:flex;align-items:center;gap:5px}",
				// 说明
				"." + NS + "-help{border-top:1px solid var(--dsr-bd);padding-top:11px}",
				"." + NS + "-help summary{cursor:pointer;font-size:11.5px;color:var(--dsr-fg3);list-style:none;display:flex;align-items:center;gap:6px}",
				"." + NS + "-help summary::-webkit-details-marker{display:none}",
				"." + NS + "-help summary:before{content:'▸';display:inline-block;transition:transform .15s}",
				"." + NS + "-help[open] summary:before{transform:rotate(90deg)}",
				"#" + NS + "-status{font-size:11.5px;color:var(--dsr-fg2);white-space:pre-wrap;line-height:1.7;padding-top:8px}",
				// ---- 侧边栏底部入口（走官方 sidebar.footer.action slot，与「会话管理」同机制）----
				"." + NS + "-footer{padding:0 8px 2px}",
				"." + NS + "-footerBtn{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border:none;border-radius:8px;background:0 0;color:inherit;opacity:.85;font:inherit;font-size:13px;line-height:1.4;cursor:pointer;text-align:left;transition:background .15s,opacity .15s}",
				"." + NS + "-footerBtn:hover{background:var(--dsr-hover);opacity:1}",
				"." + NS + "-footerBtn.is-rail{width:36px;height:36px;padding:0;justify-content:center;gap:0}",
				"." + NS + "-footerIcon{display:inline-flex;align-items:center;justify-content:center;flex:none}",
				"." + NS + "-footerLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
				// ---- 窄屏：整屏 ----
				"@media (max-width:820px){#" + NS + "{left:0;top:0;width:100vw;height:100vh;max-height:none;border-radius:0;border:none;transform:translate(0,0) scale(.98)}#" + NS + ".dshr-open{transform:none}#" + NS + "-body{grid-template-columns:1fr;padding:16px;gap:16px}#" + NS + "-qr,#" + NS + "-qr img{width:min(236px,58vw);height:min(236px,58vw)}}"
			].join("");
			var el = document.createElement("style");
			el.id = NS + "-style";
			el.textContent = s;
			document.head.appendChild(el);
		}

		// ================= 主题跟随 =================
		// DSH 的 --dsw-alias-* 不可靠：bg-elevated / fill-l2 / accent-* / danger 等根本没有定义，
		// 或者会解析成 unset/transparent。所以照 dsh-session-manager 的做法：
		// 运行时探测当前主题 → 镜像到 <html data-dsr-theme>，由我们自己的两套色板驱动样式。
		var THEME_ATTR = "data-dsr-theme";

		function readDshTheme() {
			try {
				var html = document.documentElement, body = document.body;
				if (body && body.hasAttribute("data-ds-dark-theme")) return "dark";
				var els = [html, body].filter(Boolean);
				var dark = /\b(dark|dim)\b/i, light = /\b(light|bright)\b/i;
				for (var i = 0; i < els.length; i++) {
					var el = els[i];
					var v = ["class", "theme", "data-theme", "data-bs-theme", "color-scheme", "data-color-mode", "data-mode"]
						.map(function (n) { return String(el.getAttribute(n) || ""); }).join(" ");
					if (dark.test(v)) return "dark";
					if (light.test(v)) return "light";
				}
				for (var j = 0; j < els.length; j++) {
					var sc = String(getComputedStyle(els[j]).colorScheme || "").toLowerCase();
					if (sc.indexOf("dark") >= 0) return "dark";
					if (sc.indexOf("light") >= 0) return "light";
				}
				var bg = body ? getComputedStyle(body).backgroundColor : "";
				var m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/i);
				if (m) {
					// 全透明背景不能拿来判断主题（否则 rgba(0,0,0,0) 会被当成纯黑）
					var alpha = m[4] === undefined ? 1 : Number(m[4]);
					if (alpha >= 0.5) {
						var lum = (Number(m[1]) * 299 + Number(m[2]) * 587 + Number(m[3]) * 114) / 1000;
						return lum < 128 ? "dark" : "light";
					}
				}
			} catch (_) {}
			return "light";
		}

		function applyTheme() {
			try { document.documentElement.setAttribute(THEME_ATTR, readDshTheme()); } catch (_) {}
		}

		function watchTheme() {
			applyTheme();
			if (typeof MutationObserver !== "function") return;
			try {
				var ob = new MutationObserver(function () { applyTheme(); });
				var opt = {
					attributes: true,
					attributeFilter: ["class", "theme", "data-theme", "data-bs-theme", "data-ds-dark-theme", "data-color-mode", "data-mode", "color-scheme", "style"]
				};
				if (document.documentElement) ob.observe(document.documentElement, opt);
				if (document.body) ob.observe(document.body, opt);
			} catch (_) {}
		}

		// ================= 端口解析：先问 info，再走所有接口 =================
		/**
		 * 启动第一步：向 DSH web server 的 /dsh-remote/info 问「本插件现在监听哪个端口」。
		 * 以前这里把 8090 写死，用户一改 listenPort，整个客户端的 fetch 就全打到旧端口上。
		 * 请求失败就 fail-open 退回 8090：接口异常不能让整个插件不可用。
		 */
		function initApi() {
			if (apiReady) return apiReady;
			apiReady = Promise.resolve().then(function () {
				return fetch(INFO_URL, { cache: "no-store" });
			}).then(function (r) {
				if (!r || !r.ok) throw new Error("HTTP " + (r && r.status));
				return r.json();
			}).then(function (d) {
				var p = d && Number(d.activeListenPort);
				if (p && p > 0 && p < 65536) API = "http://127.0.0.1:" + p;
				else if (d && Number(d.savedListenPort) > 0) API = "http://127.0.0.1:" + Number(d.savedListenPort);
				apiInfo = d || null;
				return apiInfo;
			}).catch(function (e) {
				console.log("[dsh-remote] info 路由不可用，退回 " + API + "：" + (e && e.message));
				apiInfo = null;
				return null;
			});
			return apiReady;
		}
		/** 所有后台接口调用前先等端口解析完（已解析过就是同步命中）。 */
		function ready() { return initApi(); }
		function activePort() { return (apiInfo && Number(apiInfo.activeListenPort)) || 8090; }
		/** 读全量信息（设置卡片用）；info 不可用时退回旧接口，只拿得到三个布尔键。 */
		function loadInfo() {
			return initApi().then(function (d) {
				if (d && d.settings) return d;
				return fetch(API + "/remote-settings").then(function (r) { return r.json(); }).then(function (s) {
					return { activeListenPort: activePort(), savedListenPort: null, settings: s || {}, degraded: true };
				}).catch(function () { return null; });
			});
		}
		/** 写设置：优先 info 路由（它才认 listenPort），失败退回旧的 /remote-settings。 */
		function saveInfo(patch) {
			return fetch(INFO_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) })
				.then(function (r) {
					if (!r || !r.ok) throw new Error("HTTP " + (r && r.status));
					return r.json();
				})
				.then(function (d) { if (d && d.settings) { apiInfo = d; return d; } return loadInfo(); })
				.catch(function () {
					return fetch(API + "/remote-settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) })
						.then(function () { return loadInfo(); });
				});
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
				el.style.color = d.host ? "var(--dsr-accent)" : "var(--dsr-fg3)";
			}).catch(function () {});
		}
		function refreshSettings() {
			return ready().then(function () { return fetch(API + "/remote-settings"); }).then(function (r) { return r.json(); }).then(function (s) {
				setSwitch("ctrl", !!s.controlEnabled);
				setSwitch("comp", !!s.compression);
				setSwitch("hide", s.hideSidebarEntry !== true);
				var c = $("ctrl"), m = $("comp"), hv = $("hide");
				if (c) c.textContent = s.controlEnabled ? "🖥  远程控制已开启" : "🖥  远程控制已关闭";
				if (m) m.textContent = s.compression ? "🗜  压缩画质已开启" : "🗜  压缩画质已关闭";
				if (hv) hv.textContent = s.hideSidebarEntry === true ? "👁  侧边栏入口已隐藏" : "👁  侧边栏入口已显示";
				// 服务端状态与本地不一致时才真的摘/挂，避免弹层每次打开都重复挂载
				var hiddenNow = s.hideSidebarEntry === true;
				if (hiddenNow !== entryHidden) applyEntryHidden(hiddenNow);
			}).catch(function () {
				var c = $("ctrl");
				if (c) c.textContent = "🖥  设置读取失败";
			});
		}
		function toggleSetting(key, done) {
			return ready().then(function () {
				return fetch(API + "/remote-settings").then(function (r) { return r.json(); }).then(function (s) {
					var next = {}; next[key] = !s[key];
					return fetch(API + "/remote-settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
				});
			}).then(function () { refreshSettings(); return done ? fetch(API + "/remote-settings").then(function (r) { return r.json(); }) : null; }).then(function (s) {
				if (done) { try { done(s); } catch (_) {} }
			}).catch(function () {});
		}
		function refreshNoLock() {
			return ready().then(function () {
				var lockP = fetch(API + "/remote-screen/lockstate").then(function (r) { return r.json(); }).catch(function () { return { locked: false }; });
				var setP = fetch(API + "/remote-settings").then(function (r) { return r.json(); }).catch(function () { return {}; });
				return Promise.all([lockP, setP]).then(function (a) {
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
			}).catch(function () {});
		}
		/** 防锁屏 toggle：可显式指定目标值（设置面板复用），不传则取反（弹层老行为）。 */
		function toggleNoLock(next) {
			var sw = $("nolock-sw");
			if (sw) sw.className = NS + "-sw busy";
			return ready().then(function () {
				return fetch(API + "/remote-settings").then(function (r) { return r.json(); }).then(function (s) {
					var target = typeof next === "boolean" ? next : !s.noLock;
					// 必须走 /remote-nolock：那边的实现带唤醒/保持唤醒副作用，不能另写一份
					return fetch(API + "/remote-nolock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: target }) });
				});
			}).then(function () { return refreshNoLock(); }).catch(function () { return refreshNoLock(); });
		}
		/** 规范化用户填的地址：https//x → https://x；裸域名 → https://域名 */
		function normalizeUrl(raw) {
			var v = String(raw || "").trim();
			if (!v) return "";
			var m = v.match(/^(https?):?\/\//i);
			if (m) return m[1].toLowerCase() + "://" + v.slice(m[0].length);
			if (v.indexOf("://") < 0) return "https://" + v;
			return v;
		}

		/** 二维码由本机 8092 生成（/remote-qr），不再依赖境外图片服务。 */
		function qrSrc(text, size) {
			return API + "/remote-qr?data=" + encodeURIComponent(text) + "&size=" + (size || 320);
		}

		function renderQr(overrideUrl) {
			var url = overrideUrl === undefined ? state.url : overrideUrl;
			var box = $("qr"), cap = $("qrcap"), link = $("qrurl");
			if (box) {
				if (!url) {
					box.innerHTML = '<div class="' + NS + '-qrempty">' + ICON_SVG +
						'<span>填入公网访问地址后<br>这里会生成二维码</span></div>';
				} else {
					box.innerHTML = '<img src="' + qrSrc(url, 320) + '" alt="访问二维码">';
				}
			}
			if (cap) cap.textContent = url ? "手机扫码直达" : "等待填入地址";
			if (link) {
				if (url) { link.style.display = "block"; link.textContent = url; link.href = url; }
				else { link.style.display = "none"; link.textContent = ""; link.removeAttribute("href"); }
			}
			var apkBox = $("apk"), apkLink = $("apklink");
			if (apkBox) {
				if (!url) {
					apkBox.innerHTML = '<div class="' + NS + '-qrempty" style="font-size:11px;padding:0 8px"><span>填入地址后显示</span></div>';
				} else {
					var base = url.replace(/\/$/, "") + "/remote-apk-page";
					apkBox.innerHTML = '<img src="' + qrSrc(base, 220) + '" alt="APP 二维码">';
					if (apkLink) { apkLink.href = base; apkLink.style.display = "inline"; }
				}
				if (!url && apkLink) apkLink.style.display = "none";
			}
		}

		// ================= 弹层 =================
		function buildPopover() {
			if (popEl && document.body.contains(popEl)) return popEl;
			injectStyles();

			if (!document.getElementById(NS + "-mask")) {
				var mask = document.createElement("div");
				mask.id = NS + "-mask";
				mask.addEventListener("click", function () { closePopover(); });
				document.body.appendChild(mask);
			}

			var p = document.createElement("div");
			p.id = NS;
			p.setAttribute("role", "dialog");
			p.setAttribute("aria-modal", "true");
			p.setAttribute("aria-label", "远程访问");
			p.innerHTML =
				'<div id="' + NS + '-head">' +
					'<span id="' + NS + '-title">' + ICON_SVG + '远程访问</span>' +
					'<button class="' + NS + '-x" id="' + NS + '-close" type="button" title="关闭（Esc）" aria-label="关闭">✕</button>' +
				'</div>' +
				'<div id="' + NS + '-body">' +

					'<div class="' + NS + '-col">' +
						'<div class="' + NS + '-qrcard">' +
							'<div id="' + NS + '-qr"></div>' +
							'<div class="' + NS + '-qrcap" id="' + NS + '-qrcap"></div>' +
							'<a class="' + NS + '-qrurl" id="' + NS + '-qrurl" target="_blank" rel="noopener"></a>' +
						'</div>' +
					'</div>' +

					'<div class="' + NS + '-col">' +
						'<div class="' + NS + '-sec">' +
							'<div class="' + NS + '-lbl">公网访问地址</div>' +
							'<div class="' + NS + '-flex">' +
								'<input id="' + NS + '-url" placeholder="https://你的公网域名" spellcheck="false">' +
								'<button id="' + NS + '-save" class="' + NS + '-btn ' + NS + '-primary" type="button">保存</button>' +
							'</div>' +
							'<div class="' + NS + '-hint">穿透工具需转发到本机 <code>127.0.0.1:' + activePort() + '</code></div>' +
							'<div id="' + NS + '-warn" class="' + NS + '-hint" style="display:none;color:var(--dsr-danger)">⚠ 该地址不是 https://，部分穿透工具的 http 地址不支持 WebSocket，会话可能不显示</div>' +
							'<div id="' + NS + '-detected"></div>' +
						'</div>' +

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
							// 只控制界面入口是否挂载；远程访问服务（8090）与手机端不受影响
							'<div class="' + NS + '-swrow" id="' + NS + '-hide-row">' +
								'<span class="' + NS + '-swtxt" id="' + NS + '-hide">👁  侧边栏入口</span>' +
								'<span class="' + NS + '-sw" id="' + NS + '-hide-sw"><i></i></span>' +
							'</div>' +
							'<div class="' + NS + '-sub" id="' + NS + '-lockstate"></div>' +
						'</div>' +

						'<div class="' + NS + '-sec">' +
							'<div class="' + NS + '-lbl">安卓 App</div>' +
							'<div class="' + NS + '-apkcard">' +
								'<div id="' + NS + '-apk"></div>' +
								'<div class="' + NS + '-apkinfo">' +
									'<div>扫码安装内置安卓客户端</div>' +
									'<div class="' + NS + '-hint">WebView 包装，提供远程访问 / 上传 / 下载</div>' +
									'<a id="' + NS + '-apklink" target="_blank" rel="noopener" style="display:none">或在电脑上打开下载页 →</a>' +
								'</div>' +
							'</div>' +
						'</div>' +

						'<details class="' + NS + '-help">' +
							'<summary>使用说明</summary>' +
							'<div id="' + NS + '-status">' +
								'1. 用任意内网穿透工具（cpolar / frp / ngrok 等）\n   把公网 URL 转发到本机 127.0.0.1:' + activePort() + '\n' +
								'2. 手机开移动数据打开上面的网址（或直接扫码）\n' +
								'3. 若隧道设置了认证，浏览器会提示输入\n   （由穿透工具配置，非本插件）\n' +
								'4. 即可远程使用本机 Harness' +
							'</div>' +
						'</details>' +
					'</div>' +

				'</div>';
			document.body.appendChild(p);
			popEl = p;
			// 内联兜底（照 dsh-session-manager 的做法）：保证底色不透明、
			// 且文字色与底色同源，即使宿主有别的规则或 token 解析异常也不会半边深半边浅。
			try {
				p.style.setProperty("background", "var(--dsr-bg)", "important");
				p.style.setProperty("color", "var(--dsr-fg)", "important");
			} catch (_) {}

			$("close").addEventListener("click", function () { closePopover(); });
			$("save").addEventListener("click", function () { applyUrl(true); });
			$("url").addEventListener("keydown", function (e) { if (e.key === "Enter") applyUrl(true); });
			// 输入即预览二维码，不必先点保存（这正是之前二维码空着的坑）
			var inputTimer = null;
			$("url").addEventListener("input", function () {
				if (inputTimer) clearTimeout(inputTimer);
				inputTimer = setTimeout(function () { renderQr(normalizeUrl($("url").value)); }, 350);
			});
			$("ctrl-row").addEventListener("click", function () { toggleSetting("controlEnabled"); });
			$("comp-row").addEventListener("click", function () { toggleSetting("compression"); });
			$("nolock-row").addEventListener("click", function () { toggleNoLock(); });
			$("hide-row").addEventListener("click", function () {
				toggleSetting("hideSidebarEntry", function (s) { applyEntryHidden(!!s.hideSidebarEntry); });
			});
			return p;
		}

		function applyUrl(persist) {
			var raw = normalizeUrl($("url").value);
			$("url").value = raw;
			if (persist) { state.url = raw; saveState(); }
			renderQr(raw);
			var warn = $("warn");
			if (warn) warn.style.display = (raw && raw.indexOf("https://") !== 0) ? "block" : "none";
		}

		function openPopover() {
			buildPopover();
			if ($("url")) $("url").value = state.url;
			var mask = document.getElementById(NS + "-mask");
			if (mask) mask.classList.add("dshr-open");
			popEl.classList.add("dshr-open");
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
			var mask = document.getElementById(NS + "-mask");
			if (mask) mask.classList.remove("dshr-open");
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
		/** 元素是否真的显示在视口里（用于判断挂载是否成功，不然会「什么都不显示也不报错」） */
		function isVisible(el) {
			if (!el || !document.body.contains(el)) return false;
			var r = el.getBoundingClientRect();
			if (!(r.width >= 40 && r.height >= 14)) return false;
			return r.bottom > 0 && r.right > 0 &&
				r.top < (window.innerHeight || 0) + 400 &&
				r.left < (window.innerWidth || 0);
		}

		function findNativeFooterRow() {
			// 不预先限定容器：旧写法用 [aria-label=会话][role=navigation] 选侧栏，
			// 那个选择器太宽泛，可能选中「会话列表」而非侧栏本体，一旦选错，
			// 克隆与降级两条路都会悄无声息地失败。这里直接全文按文字找。
			var nodes = document.querySelectorAll("button,[role=button],a,div,span");
			for (var i = nodes.length - 1; i >= 0; i--) {
				var el = nodes[i];
				if (el.children.length > 1) continue;
				if (el.closest && el.closest("#" + NS)) continue;   // 别把自己的面板算进去
				var t = (el.textContent || "").trim();
				if (t !== "会话管理" && t !== "Session manager" && t !== "Sessions") continue;
				// 往上找「行」容器：取第一个够格的祖先就停（不能一直爬到侧栏那种大容器），
				// 并用文字长度护栏——行内文字只应比标签多一个图标字形，否则说明爬过头了。
				var row = el, chosen = null;
				for (var k = 0; k < 4 && row && row !== document.body; k++) {
					var rect = row.getBoundingClientRect();
					var txt = (row.textContent || "").trim();
					if (rect.width >= 120 && rect.height >= 18 && rect.height <= 64 && txt.length <= t.length + 2) { chosen = row; break; }
					if (txt.length > t.length + 2) break;   // 已经包含别的文字了，再往上只会更大
					row = row.parentNode;
				}
				return { row: chosen || el, text: t };
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
			b.style.cssText = "display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;margin:0 0 2px;cursor:pointer;border:none;border-radius:8px;background:0 0;color:var(--dsr-fg2);font:inherit;font-size:13px;text-align:left";
			b.onmouseenter = function () { b.style.background = "var(--dsr-hover)"; };
			b.onmouseleave = function () { b.style.background = "0 0"; };
			b.innerHTML = ICON_SVG + "<span>  " + ENTRY_TEXT + "</span>";
			return b;
		}

		var entryMode = null;   // slot | clone | search | fab
		var entryDisposer = null;   // 官方 slot 注册返回的注销函数（隐藏入口时要用）
		var entryHidden = false;    // 用户设置：隐藏侧边栏入口
		var bootCtx = null;         // apply 时的 ctx，切换显隐后复用
		var settingsSectionOk = false;  // 设置分区是否注册成功：成功时就不需要保底齿轮

		/**
		 * 官方 slot：和「会话管理」完全同一个位置、同一套机制。
		 * 它还会传 props.wide 告诉我们侧栏是展开还是折叠成 56px 轨道，
		 * 折叠时只画图标，避免中文竖排换行——这些细节 DOM hack 拿不到。
		 */
		function mountEntryViaSlot(ctx) {
			if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function" || typeof ctx.slots.register !== "function") return false;
			var React;
			try { React = require("react"); } catch (e) { return false; }
			if (!React || typeof React.createElement !== "function") return false;
			var h = React.createElement;
			function RemoteFooterAction(props) {
				var wide = !!(props && props.wide);
				return h("div", { className: NS + "-footer" },
					h("button", {
						type: "button",
						className: NS + "-footerBtn" + (wide ? "" : " is-rail"),
						"aria-label": ENTRY_TEXT,
						title: wide ? undefined : ENTRY_TEXT,
						onClick: function (e) { if (e && e.preventDefault) e.preventDefault(); togglePopover(); }
					},
						h("span", { className: NS + "-footerIcon", dangerouslySetInnerHTML: { __html: ICON_SVG } }),
						wide ? h("span", { className: NS + "-footerLabel" }, ENTRY_TEXT) : null
					)
				);
			}
			try {
				var offSlot = ctx.slots.inject("sidebar.footer.action", function () {
					return ctx.slots.register({
						name: "sidebar.footer.action",
						id: "dsh-remote-control-desktop-footer",
						order: 29,          // 「会话管理」是 30，我们排在它上面
						locale: NS
					}, RemoteFooterAction);
				});
				if (typeof offSlot === "function") entryDisposer = offSlot;
				console.log("[dsh-remote] 入口已通过官方 sidebar.footer.action slot 注册");
				return true;
			} catch (e) {
				console.log("[dsh-remote] slot 注册失败，改用 DOM 兜底: " + (e && e.message));
				return false;
			}
		}

		function removeDomEntry() {
			if (entryEl && entryEl.parentNode) { try { entryEl.parentNode.removeChild(entryEl); } catch (_) {} }
			entryEl = null;
		}

		/**
		 * 把入口彻底摘掉：官方 slot 注册的注销函数 + DOM 兜底节点都要清。
		 * 隐藏开关打开、或用户在弹层里切换时调用；不清 entryMode 会让 mountEntry 以为还挂着。
		 */
		function unmountEntry() {
			if (entryDisposer) { try { entryDisposer(); } catch (_) {} entryDisposer = null; }
			removeDomEntry();
			entryMode = null;
		}

		/**
		 * 兜底唤回入口：**只在「设置 → 远程访问」没能注册成功时**才出现。
		 * 设置分区正常时，改回来的路就在设置里，不需要在界面上多挂一个齿轮
		 * （用户明确表示不想要这个常驻按钮）。注册失败时它仍然存在，
		 * 保证「隐藏入口」不会把用户锁在门外。
		 */
		function syncRecoverGear() {
			var existing = document.getElementById(NS + "-recover");
			if (!entryHidden || settingsSectionOk) {
				if (existing && existing.parentNode) { try { existing.parentNode.removeChild(existing); } catch (_) {} }
				return;
			}
			if (existing) return;
			var g = document.createElement("button");
			g.id = NS + "-recover";
			g.textContent = "⚙";
			g.title = "远程访问设置";
			g.setAttribute("aria-label", "远程访问设置");
			g.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483050;width:34px;height:34px;border-radius:50%;border:none;background:rgba(15,118,110,.75);color:#fff;font-size:15px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)";
			g.addEventListener("click", function (e) { e.preventDefault(); togglePopover(); });
			document.body.appendChild(g);
		}

		/** 按设置显示/隐藏入口（切换开关后立即生效，不必刷新页面）。 */
		function applyEntryHidden(hidden) {
			entryHidden = hidden === true;
			if (entryHidden) unmountEntry();
			else if (bootCtx) { try { mountEntry(bootCtx); } catch (_) {} }
			try { syncRecoverGear(); } catch (e) { console.log("[dsh-remote] 唤回齿轮失败: " + (e && e.message)); }
		}

		/** 克隆「会话管理」那一行并换掉图标与文案。 */
		function tryCloneNativeRow() {
			var found = findNativeFooterRow();
			if (!found || !found.row || !found.row.parentNode) return null;
			var native = found.row;
			var el = native.cloneNode(true);
			el.removeAttribute("id");
			el.removeAttribute("href");
			el.removeAttribute("data-testid");
			el.removeAttribute("aria-label");
			el.removeAttribute("title");

			// 1) 文案：定位到原文字节点原地替换，保留原生字号与颜色
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

			// 2) 图标：原生若用图标字体（没有 svg）也必须补上
			var iconHost = null;
			if (label) {
				var sib = label.previousElementSibling, guard = 0;
				while (sib && guard++ < 4) {
					var raw = (sib.textContent || "").trim();
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
			native.parentNode.insertBefore(el, native);
			if (!isVisible(el)) { try { el.parentNode.removeChild(el); } catch (_) {} return null; }
			return el;
		}

		/** 插到侧栏搜索框后面（本插件手机端一直在用的位置）。 */
		function trySearchAnchor() {
			var el = buildFallbackEntry();
			var searchBtn = document.querySelector('button[class*="searchButton"], [class*="searchButton"]');
			var anchor = searchBtn ? (searchBtn.closest('[class*="_search"]') || searchBtn) : null;
			if (!anchor || !anchor.parentNode) return null;
			anchor.parentNode.insertBefore(el, anchor.nextSibling);
			if (!isVisible(el)) { try { el.parentNode.removeChild(el); } catch (_) {} return null; }
			return el;
		}

		function finalizeEntry(el) {
			entryEl = el;
			entryEl.id = NS + "-entry";
			entryEl.setAttribute("title", ENTRY_TEXT);
			entryEl.setAttribute("aria-label", ENTRY_TEXT);
			entryEl.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); togglePopover(); });
		}

		// ================= 设置 → 远程访问 =================
		// 固定入口：侧边栏入口被隐藏后，这是唯一能把它改回来的地方（否则只能改 json 文件）。
		// 与 webdav 插件同一套做法：通过官方 settings.section 槽位注册一个设置分区。
		function mountSettingsSection(ctx) {
			// 每个提前返回都打日志：否则「设置里没出现这一项」时完全无从判断，
			// 是槽位不可用、react 拿不到，还是注册本身失败了。
			if (!ctx || !ctx.slots) { console.log("[dsh-remote] 设置分区跳过：ctx.slots 不存在"); return false; }
			if (typeof ctx.slots.inject !== "function" || typeof ctx.slots.register !== "function") {
				console.log("[dsh-remote] 设置分区跳过：slots.inject/register 不可用");
				return false;
			}
			var React;
			try { React = require("react"); } catch (e) {
				console.log("[dsh-remote] 设置分区跳过：require('react') 失败 - " + (e && e.message));
				return false;
			}
			if (!React || typeof React.createElement !== "function") {
				console.log("[dsh-remote] 设置分区跳过：react 没有 createElement");
				return false;
			}
			var h = React.createElement;
			// hooks 不可用时退回「callback ref 直接改按钮文案」的写法，不依赖组件状态
			var hasHooks = typeof React.useState === "function" && typeof React.useEffect === "function";
			console.log("[dsh-remote] 设置分区：react hooks=" + hasHooks);

			// ---- 卡片里复用的几个小样式（亮/暗主题都靠 DSH token + 兜底色自适应） ----
			function switchStyle(on, disabled) {
				return {
					flex: "none", minWidth: "58px", height: "28px", borderRadius: "14px", border: "none",
					cursor: disabled ? "default" : "pointer", fontSize: "12px", fontWeight: 600,
					opacity: disabled ? 0.6 : 1,
					background: on ? "var(--dsw-alias-brand-primary, #4f6ef7)" : "var(--dsw-alias-interactive-bg-hover, #e5e7eb)",
					color: on ? "#fff" : "var(--dsw-alias-label-primary, #1f2328)"
				};
			}
			function smallBtnStyle(busy) {
				return {
					flex: "none", height: "28px", borderRadius: "8px", padding: "0 12px",
					border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35))",
					background: "transparent", color: "inherit", fontFamily: "inherit",
					fontSize: "12px", fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1
				};
			}
			/** 一行：左侧标题+说明（可选灰字提示），右侧控件。 */
			function Row(props) {
				return h("div", {
					style: {
						display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
						padding: "9px 0",
						borderTop: props.first ? "none" : "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.18))"
					}
				},
					h("div", { style: { minWidth: 0 } },
						h("div", { style: { fontSize: "13px", fontWeight: 600 } }, props.title),
						props.desc ? h("div", { style: { fontSize: "12px", opacity: 0.7, marginTop: "2px", lineHeight: "18px" } }, props.desc) : null,
						props.hint ? h("div", { style: { fontSize: "11.5px", opacity: 0.55, marginTop: "2px" } }, props.hint) : null
					),
					h("div", { style: { flex: "none" } }, props.control)
				);
			}
			/** 开关按钮（文案只有一个来源：当前值）。 */
			function ToggleBtn(props) {
				return h("button", {
					type: "button", onClick: props.onClick, disabled: props.disabled, "aria-pressed": props.on === true,
					style: switchStyle(props.on === true, props.disabled)
				}, props.on === null ? "…" : (props.on ? "已开启" : "已关闭"));
			}

			function RemoteSettingsCard() {
				// 一次拿全量状态（info 路由），四行开关 + 端口都从这份数据渲染
				var infoState = React.useState(null);
				var info = infoState[0], setInfo = infoState[1];
				var busyState = React.useState("");     // 正在保存哪一行（同一时间只允许一个）
				var busy = busyState[0], setBusy = busyState[1];
				var portState = React.useState("");     // 端口输入框内容
				var portText = portState[0], setPortText = portState[1];
				var msgState = React.useState(null);    // 端口保存提示 {text, bad}
				var msg = msgState[0], setMsg = msgState[1];

				/** 把服务端返回的全量状态落到卡片；输入框只在空的时候初始化，避免打断用户输入 */
				function applyInfo(d) {
					if (!d) return;
					setInfo(d);
					var showPort = d.savedListenPort || d.activeListenPort || 8090;
					if (!portText) setPortText(String(showPort));
				}

				React.useEffect(function () {
					var alive = true;
					loadInfo().then(function (d) { if (alive) applyInfo(d); });
					return function () { alive = false; };
				}, []);

				var st = (info && info.settings) || {};
				var hideEntry = st.hideSidebarEntry === true;
				var activePortNow = (info && Number(info.activeListenPort)) || 8090;

				/** 两个入口（卡片 / 弹层）不能各说各话：写完顺手刷新弹层的开关状态 */
				function syncPopover() {
					try { refreshSettings(); } catch (_) {}
					try { refreshNoLock(); } catch (_) {}
				}
				/** 写一项设置；返回新的全量状态（失败为 null）。 */
				function pushPatch(patch) {
					if (busy) return Promise.resolve(null);
					setBusy(Object.keys(patch)[0] || "busy");
					return saveInfo(patch).then(function (d) {
						applyInfo(d);
						syncPopover();
						return d;
					}).catch(function () { return null; }).then(function (d) {
						setBusy("");
						return d;
					});
				}
				function toggleBool(key, rowKey) {
					var next = !st[key];
					var patch = {};
					patch[key] = next;
					pushPatch(patch).then(function () {
						if (key === "hideSidebarEntry") { try { applyEntryHidden(next); } catch (_) {} }
					});
				}

				function savePort() {
					if (busy) return;
					var n = parseInt(String(portText || "").trim(), 10);
					if (!(n >= 1 && n <= 65535)) { setMsg({ text: "端口需为 1–65535 的整数", bad: true }); return; }
					setMsg(null);
					pushPatch({ listenPort: n }).then(function (d) {
						var saved = d && d.savedListenPort ? Number(d.savedListenPort) : null;
						if (saved !== n) { setMsg({ text: "保存失败：设置接口不可用（" + INFO_URL + "）", bad: true }); return; }
						setPortText(String(n));
						var act = d && Number(d.activeListenPort);
						// 端口只存不热切：这里必须说清楚「现在还没生效」
						setMsg({ text: act === n ? "已保存；该端口当前已在生效。" : "已保存，重启 DSH 后生效", bad: false });
					});
				}

				var rows = [];
				// 1) 侧边栏入口（反向键：开关表示「显示」，存的是 hideSidebarEntry）
				rows.push(h(Row, {
					key: "entry", first: true,
					title: "在侧边栏显示「远程访问」入口",
					desc: "关掉后入口立即消失，手机端访问与远程服务不受影响；随时可回到这里重新打开。",
					control: h(ToggleBtn, {
						on: info ? !hideEntry : null,
						disabled: !!busy || !info,
						onClick: function () { toggleBool("hideSidebarEntry", "hideSidebarEntry"); }
					})
				}));
				// 2) 远程控制
				rows.push(h(Row, {
					key: "ctrl",
					title: "远程控制",
					desc: "允许手机端把鼠标 / 键盘操作注入本机；关掉后只能看画面。",
					control: h(ToggleBtn, {
						on: info ? st.controlEnabled === true : null,
						disabled: !!busy || !info,
						onClick: function () { toggleBool("controlEnabled", "controlEnabled"); }
					})
				}));
				// 3) 压缩画质
				rows.push(h(Row, {
					key: "comp",
					title: "压缩画质",
					desc: "开启后画面压缩更激进，弱网更流畅；关闭则画质优先、占用带宽更高。",
					control: h(ToggleBtn, {
						on: info ? st.compression === true : null,
						disabled: !!busy || !info,
						onClick: function () { toggleBool("compression", "compression"); }
					})
				}));
				// 4) 防锁屏：必须走 /remote-nolock（带唤醒副作用），不能写进 info 的 POST
				rows.push(h(Row, {
					key: "nolock",
					title: "防锁屏",
					desc: "保持电脑唤醒、不进入锁屏；锁屏会导致远程画面黑屏。",
					control: h(ToggleBtn, {
						on: info ? st.noLock === true : null,
						disabled: !!busy || !info,
						onClick: function () {
							if (busy || !info) return;
							var target = !(st.noLock === true);
							setBusy("noLock");
							toggleNoLock(target).then(function () { return loadInfo(); })
								.then(function (d) { applyInfo(d); })
								.catch(function () {})
								.then(function () { setBusy(""); });
						}
					})
				}));
				// 5) 监听端口：数字输入 + 保存，保存只写盘，重启 DSH 才生效
				rows.push(h(Row, {
					key: "port",
					title: "监听端口",
					desc: "远程访问服务监听的端口，穿透工具需转发到同一端口。保存后重启 DSH 才生效。",
					hint: "当前生效：" + activePortNow,
					control: h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
						h("input", {
							type: "number", min: 1, max: 65535, inputMode: "numeric",
							value: portText,
							"aria-label": "监听端口",
							disabled: !info,
							onChange: function (e) { setPortText(e && e.target ? e.target.value : ""); },
							onKeyDown: function (e) { if (e && e.key === "Enter") savePort(); },
							style: {
								width: "88px", height: "28px", borderRadius: "8px", padding: "0 8px",
								border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35))",
								background: "transparent", color: "inherit", fontFamily: "inherit",
								fontSize: "12px", textAlign: "right"
							}
						}),
						h("button", { type: "button", onClick: savePort, disabled: !!busy || !info, style: smallBtnStyle(!!busy || !info) }, "保存")
					)
				}));

				var children = [h("div", {
					key: "rows", style: { display: "flex", flexDirection: "column", padding: "0 0 2px" }
				}, rows)];
				if (msg) {
					children.push(h("div", {
						key: "msg",
						style: {
							fontSize: "12px", marginTop: "2px", lineHeight: "18px",
							color: msg.bad ? "var(--dsr-danger, var(--dsw-alias-label-danger, #d92d20))" : "var(--dsr-fg3, var(--dsw-alias-label-tertiary, #8a9099))"
						}
					}, msg.text));
				}
				return h("div", { style: { display: "flex", flexDirection: "column" } }, children);
			}

			// 无 hooks 时的兜底卡片：用 callback ref 直接改按钮文案，不依赖组件状态
			// （这条路径只在 React 不带 hooks 时才会走到；新增的四行依赖 useState，
			//   所以这里保留原来的单行入口开关，不硬塞状态化控件。）
			function PlainCard() {
				function bind(el) {
					if (!el) return;
					function paint(shown) {
						el.textContent = shown ? "已开启" : "已关闭";
						el.setAttribute("aria-pressed", shown ? "true" : "false");
					}
					paint(true);
					loadInfo().then(function (d) {
						var s = (d && d.settings) || {};
						paint(s.hideSidebarEntry !== true);
					}).catch(function () {});
					el.onclick = function () {
						loadInfo().then(function (d) {
							var s = (d && d.settings) || {};
							var next = !(s.hideSidebarEntry !== true);
							return saveInfo({ hideSidebarEntry: !next })
								.then(function () { paint(next); applyEntryHidden(!next); });
						}).catch(function () {});
					};
				}
				return h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "4px 0" } },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: { fontSize: "13px", fontWeight: 600 } }, "在侧边栏显示「远程访问」入口"),
						h("div", { style: { fontSize: "12px", opacity: 0.7, marginTop: "2px" } }, "关掉后入口立即消失，手机端与 8090 服务不受影响。")
					),
					h("button", { type: "button", ref: bind, style: { flex: "none", minWidth: "58px", height: "28px", borderRadius: "14px", border: "none", cursor: "pointer", fontSize: "12px", fontWeight: 600 } }, "…")
				);
			}

			try {
				// 与 dsh-webdav 完全同构：inject 包在 ctx.effect 里，注册才会落在本插件的
				// effect scope 上、随插件卸载回收（beauticode「背景」会重排设置页 DOM，
				// 用官方同款写法最不容易被它的 DOM 手术影响）。
				// order 取 125（WebDAV 网盘是 120、背景是 130）：不要用 130，导航若拿 order 当
				// React key，重复会被静默丢弃 —— 这正是「设置里找不到」的一种可能。
				var registerSection = function () {
					return ctx.slots.inject("settings.section", function () {
						return ctx.slots.register({
							name: "settings.section",
							id: "dsh-remote-settings",
							order: 125,
							label: function () { return "远程访问"; },
						}, hasHooks ? RemoteSettingsCard : PlainCard);
					});
				};
				var dispose = typeof ctx.effect === "function" ? ctx.effect(registerSection, "dsh-remote: settings section") : registerSection();
				settingsSectionOk = true;   // 有设置分区就不需要保底齿轮
				console.log("[dsh-remote] 设置分区「远程访问」已注册，disposer=" + typeof dispose);
				return true;
			} catch (e) {
				console.log("[dsh-remote] 设置分区注册失败: " + (e && e.message));
				return false;
			}
		}

		function mountEntry(ctx) {
			if (entryHidden) return entryMode;   // 用户选择隐藏入口：任何兜底挂载都要停
			injectStyles();

			// 1) 官方 slot 优先
			if (entryMode !== "slot" && mountEntryViaSlot(ctx)) {
				entryMode = "slot";
				removeDomEntry();
				return entryMode;
			}
			if (entryMode === "slot") return entryMode;

			// 已经用可靠方式挂上就不再动（FAB 例外：后面若找到更好的锚点要升级）
			if (entryEl && entryMode && entryMode !== "fab" && document.body.contains(entryEl) && isVisible(entryEl)) return entryMode;

			var el = tryCloneNativeRow();
			if (el) { removeDomEntry(); finalizeEntry(el); entryMode = "clone"; return entryMode; }

			el = trySearchAnchor();
			if (el) { removeDomEntry(); finalizeEntry(el); entryMode = "search"; return entryMode; }

			if (entryEl && document.body.contains(entryEl)) return entryMode || "fab";

			// 2) 保底：右下角胶囊按钮（position:fixed，任何布局下都看得见）
			el = buildFallbackEntry();
			el.style.cssText += ";position:fixed;right:16px;bottom:16px;width:auto;min-width:46px;height:46px;padding:0 14px;border-radius:23px;background:var(--dsr-accent);color:var(--dsr-accent-fg);justify-content:center;box-shadow:0 6px 18px rgba(0,0,0,.28);z-index:2147483000";
			el.innerHTML = ICON_SVG + "<span>" + ENTRY_TEXT + "</span>";
			el.title = ENTRY_TEXT + "（侧边栏入口未找到，已退化为悬浮按钮）";
			document.body.appendChild(el);
			finalizeEntry(el);
			entryMode = "fab";
			console.log("[dsh-remote] 侧边栏入口未找到，已退化为右下角悬浮按钮");
			return entryMode;
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
			b.style.cssText = "cursor:pointer;width:36px;height:36px;color:var(--dsr-fg2);background:0 0;border:none;border-radius:50%;display:inline-flex;justify-content:center;align-items:center;padding:0;flex:none;margin:0 0 12px";
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
			watchTheme();   // 先跟随主题，弹窗与入口才会立刻是对的颜色

			// 侧边栏入口：优先官方 slot，其次 DOM 兜底。
			// 先读一次设置再挂：用户选了「隐藏入口」时不该先闪出来再消失。
			// 读不到设置就按显示处理（fail-open）——入口不能因为接口异常而消失。
			bootCtx = ctx;
			// 设置分区与入口隐藏无关，必须无条件注册：它是隐藏入口后唯一的改回途径
			try { mountSettingsSection(ctx); } catch (e) { console.log("[dsh-remote] 设置分区挂载失败:", e && e.message); }
			// 先问 info 拿到真正在监听的端口（重启前改过 listenPort 就靠这一步），
			// 解析完再把 API 基址用到后面的接口上；info 不可用时 initApi 内部已退回 8090。
			initApi().then(function () {
				return fetch(API + "/remote-settings");
			}).then(function (r) { return r.json(); }).then(function (s) {
				applyEntryHidden(s && s.hideSidebarEntry === true);
			}).catch(function () {
				try { mountEntry(ctx); } catch (e) { console.log("[dsh-remote] 入口挂载失败:", e && e.message); }
			});
			// 启动阶段密集重试（slot 与侧栏都还没就绪），之后转为低频守护：
			// 既防 React 重渲染冲掉 DOM 兜底，也留机会把 FAB 升级成正规入口。
			var tries = 0;
			var entryTimer = setInterval(function () {
				tries++;
				try { mountEntry(ctx); } catch (e) {}
				if (entryMode === "slot") { clearInterval(entryTimer); entryTimer = null; return; }
				if (tries > 20 && entryEl && document.body.contains(entryEl)) {
					clearInterval(entryTimer);
					entryTimer = setInterval(function () {
						try { mountEntry(ctx); } catch (e) {}
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
				// 弹窗是居中的，尺寸变化由 CSS 自适应处理，这里无需重新定位
				if (popEl && popEl.classList.contains("dshr-open")) renderQr();
			});

			return function dispose() {
				if (entryTimer) clearInterval(entryTimer);
				if (lockTimer) clearInterval(lockTimer);
				// slot 注册要在卸载时注销，否则热重载后会堆叠出多个「远程访问」入口
				try { if (entryDisposer) { entryDisposer(); entryDisposer = null; } } catch (_) {}
				try { var rg = document.getElementById(NS + "-recover"); if (rg && rg.parentNode) rg.parentNode.removeChild(rg); } catch (_) {}
				try { if (entryEl && entryEl.parentNode) entryEl.parentNode.removeChild(entryEl); } catch (_) {}
				try { if (popEl && popEl.parentNode) popEl.parentNode.removeChild(popEl); } catch (_) {}
				try { var mk = document.getElementById(NS + "-mask"); if (mk && mk.parentNode) mk.parentNode.removeChild(mk); } catch (_) {}
			};
		}

		exports.apply = apply;
		exports.inject = ["connection", "slots"];

		return module.exports;
	}
});
