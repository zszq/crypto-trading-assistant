// ==UserScript==
// @name         Gate 合约助手
// @namespace    http://tampermonkey.net/
// @version      1.7.0
// @author       zl
// @description  Gate USDT 永续合约：登录后预估加仓均价与强平价，支持亏损提醒和模块隐私隐藏
// @match        https://www.gate.com/*futures/USDT/*
// @match        https://www.gate.io/*futures/USDT/*
// @connect      api.gateio.ws
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
	"use strict";
	var _GM_getValue = (() => typeof GM_getValue != "undefined" ? GM_getValue : void 0)();
	var _GM_setValue = (() => typeof GM_setValue != "undefined" ? GM_setValue : void 0)();
	var _GM_xmlhttpRequest = (() => typeof GM_xmlhttpRequest != "undefined" ? GM_xmlhttpRequest : void 0)();
	var BANNER_ID$1 = "tm-gate-helper-banner";
	function showBanner(reason) {
		if (document.getElementById(BANNER_ID$1)) return;
		const bar = document.createElement("div");
		bar.id = BANNER_ID$1;
		bar.style.cssText = [
			"position:fixed",
			"top:0",
			"left:0",
			"right:0",
			"z-index:2147483647",
			"display:flex",
			"align-items:center",
			"gap:12px",
			"padding:8px 16px",
			"background:#d9304f",
			"color:#fff",
			"font-size:13px",
			"line-height:20px",
			"box-shadow:0 2px 8px rgba(0,0,0,.2)"
		].join(";");
		const text = document.createElement("span");
		text.style.flex = "1";
		text.textContent = `⚠ Gate 合约助手已停用，未对页面做任何操作。原因：${reason}。页面结构可能已改版，请更新脚本后再使用。`;
		const close = document.createElement("button");
		close.textContent = "×";
		close.title = "关闭提示（脚本仍保持停用）";
		close.style.cssText = "border:0;background:transparent;color:#fff;font-size:18px;line-height:20px;cursor:pointer;padding:0 4px";
		close.addEventListener("click", () => bar.remove());
		bar.append(text, close);
		document.documentElement.appendChild(bar);
	}
	var AUTH_TEXT = /^(?:登录|注册|立即登录|立即注册|登录\s*[\/／或|·]\s*注册|log\s*in|sign\s*in|sign\s*up|register)$/i;
	var visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
	function readAccountState() {
		const box = document.querySelector(".dealbox");
		const controls = box ? [...box.querySelectorAll("button, a, [role=\"button\"]")].filter(visible) : [];
		if (controls.some((el) => AUTH_TEXT.test(el.textContent.replace(/\s+/g, " ").trim()))) return "loggedOut";
		if ([...document.querySelectorAll("a[href*=\"/login\"], a[href*=\"/signin\"]")].some((el) => visible(el) && el.getBoundingClientRect().top < 160 && AUTH_TEXT.test(el.textContent.trim()))) return "loggedOut";
		if (!box) return "pending";
		return controls.some((el) => /^(?:开多|开空|平多|平空|买入\s*[/／(（]?\s*(?:[开做]多|平空)|卖出\s*[/／(（]?\s*(?:[开做]空|平多))/.test(el.textContent.trim())) ? "loggedIn" : "pending";
	}
	var StructureError = class extends Error {};
	function expect(cond, message) {
		if (!cond) throw new StructureError(message);
		return cond;
	}
	var GRACE_MS = 3e3;
	var disabled = false;
	var accountPendingSince = null;
	var cleanups = [];
	var failingSince = {};
	var isDisabled = () => disabled;
	function onCleanup(fn) {
		cleanups.push(fn);
	}
	function stop(reason, notify) {
		if (disabled) return;
		disabled = true;
		if (notify) console.error("[Gate 合约助手] 已停用：", reason);
		cleanups.reverse().forEach((fn) => {
			try {
				fn();
			} catch (e) {}
		});
		if (notify) showBanner(reason);
	}
	var disable = (reason) => stop(reason, true);
	var stopSilently = () => stop("", false);
	function run(name, fn, onFail) {
		if (disabled) return;
		try {
			const account = readAccountState();
			if (account === "loggedOut") return stopSilently();
			if (account !== "loggedIn") {
				onFail?.();
				accountPendingSince ??= Date.now();
				if (Date.now() - accountPendingSince >= GRACE_MS) stopSilently();
				return;
			}
			accountPendingSince = null;
			fn();
			delete failingSince[name];
		} catch (e) {
			if (!(e instanceof StructureError)) return disable(`脚本异常：${e?.message || e}`);
			try {
				onFail?.();
			} catch (_) {}
			failingSince[name] ??= Date.now();
			if (Date.now() - failingSince[name] >= GRACE_MS) disable(e.message);
		}
	}
	function every(name, fn, ms, onFail) {
		const id = setInterval(() => run(name, fn, onFail), ms);
		onCleanup(() => clearInterval(id));
	}
	function listen(target, type, handler, options) {
		target.addEventListener(type, handler, options);
		onCleanup(() => target.removeEventListener(type, handler, options));
	}
	function addStyle(css) {
		const style = document.createElement("style");
		style.textContent = css;
		(document.head || document.documentElement).appendChild(style);
		onCleanup(() => style.remove());
	}
	var TOGGLES_ID = "tm-hide-toggles";
	var STORE_KEY = "blurModules";
	var MODULES = [
		{
			key: "positions",
			label: "仓位"
		},
		{
			key: "assets",
			label: "资产"
		},
		{
			key: "available",
			label: "可用"
		}
	];
	var POSITIONS = ".react-grid-item:has(.scroll-table-bottom-box)";
	var ASSETS = ".react-grid-item:has(.asset-container_new)";
	var AVAILABLE = "#multiCurrencyMarginModeFuturesStep1";
	var TARGETS = {
		positions: {
			box: POSITIONS,
			inner: ".scroll-table-bottom-box > :last-child:not(:first-child)",
			revealOnSelf: true
		},
		assets: {
			box: ASSETS,
			inner: ".asset-container_new"
		},
		available: {
			box: AVAILABLE,
			inner: "> *"
		}
	};
	function verifyPrivacyStructure() {
		const boxes = document.querySelectorAll(".scroll-table-bottom-box");
		expect(boxes.length === 1, `仓位区 .scroll-table-bottom-box 应有 1 个，实际 ${boxes.length} 个`);
		const bottom = boxes[0];
		expect(bottom.closest(".react-grid-item"), "仓位区所在模块 .react-grid-item 未找到");
		expect(bottom.children.length >= 2, "仓位区缺少数据区");
		const active = [...bottom.firstElementChild.firstElementChild?.children || []].filter((t) => t.classList.contains("text-c-text-1"));
		expect(active.length === 1, `仓位区选中的标签应有 1 个，实际 ${active.length} 个`);
		const onPositionsTab = /^仓位(\(\d+\))?$/.test(active[0].textContent.trim());
		const anchor = [...bottom.firstElementChild.querySelectorAll(".mantine-Checkbox-label span")].find((s) => s.textContent.trim() === "仅显示当前市场")?.closest(".mantine-Checkbox-root") || null;
		if (onPositionsTab) expect(anchor, "“仓位”标签下“仅显示当前市场”复选框未找到");
		expect(document.querySelector(".asset-container_new > .assets-title"), "资产模块标题 .assets-title 未找到");
		expect(document.querySelector(`${ASSETS} ${TARGETS.assets.inner}`), "资产模块内容区未找到");
		const availableRows = document.querySelectorAll(AVAILABLE);
		expect(availableRows.length === 1, `可用余额行 ${AVAILABLE} 应有 1 个，实际 ${availableRows.length} 个`);
		const available = availableRows[0];
		expect(available.children.length === 2 && available.firstElementChild.textContent.trim() === "可用", "可用余额行标签或结构不对应");
		expect(available.querySelectorAll(":scope > div > span.text-end").length === 1, "可用余额行金额区域缺失或重复");
		return anchor;
	}
	function buildCss() {
		const SHOW = ":is(:hover, :focus-within)";
		return Object.entries(TARGETS).map(([key, { box, inner, revealOnSelf }]) => {
			const hidden = `html.tm-hide-${key} ${box} ${inner}`;
			return `
${hidden} { opacity: 0; transition: opacity .15s; }
${revealOnSelf ? `${hidden}${SHOW}` : `html.tm-hide-${key} ${box}${SHOW} ${inner}`} {
  opacity: 1;
  transition: none;
}`;
		}).join("\n") + `
#${TOGGLES_ID} { display: flex; align-items: center; gap: 8px; font-size: 12px; white-space: nowrap;
  color: var(--color-text-text-secondary, #8d93a6); }
#${TOGGLES_ID} label { display: inline-flex; align-items: center; gap: 3px; cursor: pointer; }
#${TOGGLES_ID} input { margin: 0; width: 12px; height: 12px; cursor: pointer;
  accent-color: var(--color-text-text-primary, currentColor); }`;
	}
	function loadState() {
		const saved = _GM_getValue(STORE_KEY, null);
		return Object.fromEntries(MODULES.map(({ key }) => [key, !!saved?.[key]]));
	}
	function applyState(state) {
		MODULES.forEach(({ key }) => document.documentElement.classList.toggle(`tm-hide-${key}`, state[key]));
	}
	function createToggles(state) {
		const box = document.createElement("div");
		box.id = TOGGLES_ID;
		box.innerHTML = MODULES.map(({ key, label }) => `<label><input type="checkbox" data-key="${key}">${label}</label>`).join("");
		box.querySelectorAll("input").forEach((input) => {
			input.checked = state[input.dataset.key];
			input.addEventListener("change", () => {
				state[input.dataset.key] = input.checked;
				_GM_setValue(STORE_KEY, state);
				applyState(state);
			});
		});
		return box;
	}
	function initPrivacyHide() {
		addStyle(buildCss());
		const state = loadState();
		applyState(state);
		onCleanup(() => MODULES.forEach(({ key }) => document.documentElement.classList.remove(`tm-hide-${key}`)));
		onCleanup(() => document.getElementById(TOGGLES_ID)?.remove());
		every("privacyHide", () => {
			const anchor = verifyPrivacyStructure();
			if (!anchor || anchor.previousElementSibling?.id === TOGGLES_ID) return;
			document.getElementById(TOGGLES_ID)?.remove();
			anchor.before(createToggles(state));
		}, 500);
	}
	var PANEL_ID = "tm-avg-preview";
	var CONTRACT_API = "https://api.gateio.ws/api/v4/futures/usdt/contracts/";
	var DP = 20;
	var RM = 1;
	var MAX_DP = 1e6;
	var MAX_POWER = 1e6;
	var NE = -7;
	var PE = 21;
	var STRICT = false;
	var NAME = "[big.js] ";
	var INVALID = NAME + "Invalid ";
	var INVALID_DP = INVALID + "decimal places";
	var INVALID_RM = INVALID + "rounding mode";
	var DIV_BY_ZERO = NAME + "Division by zero";
	var P = {};
	var UNDEFINED = void 0;
	var NUMERIC = /^-?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;
	function _Big_() {
		function Big(n) {
			var x = this;
			if (!(x instanceof Big)) return n === UNDEFINED && arguments.length === 0 ? _Big_() : new Big(n);
			if (n instanceof Big) {
				x.s = n.s;
				x.e = n.e;
				x.c = n.c.slice();
			} else {
				if (typeof n !== "string") {
					if (Big.strict === true && typeof n !== "bigint") throw TypeError(INVALID + "value");
					n = n === 0 && 1 / n < 0 ? "-0" : String(n);
				}
				parse(x, n);
			}
			x.constructor = Big;
		}
		Big.prototype = P;
		Big.DP = DP;
		Big.RM = RM;
		Big.NE = NE;
		Big.PE = PE;
		Big.strict = STRICT;
		Big.roundDown = 0;
		Big.roundHalfUp = 1;
		Big.roundHalfEven = 2;
		Big.roundUp = 3;
		return Big;
	}
	function parse(x, n) {
		var e, i, nl;
		if (!NUMERIC.test(n)) throw Error(INVALID + "number");
		x.s = n.charAt(0) == "-" ? (n = n.slice(1), -1) : 1;
		if ((e = n.indexOf(".")) > -1) n = n.replace(".", "");
		if ((i = n.search(/e/i)) > 0) {
			if (e < 0) e = i;
			e += +n.slice(i + 1);
			n = n.substring(0, i);
		} else if (e < 0) e = n.length;
		nl = n.length;
		for (i = 0; i < nl && n.charAt(i) == "0";) ++i;
		if (i == nl) x.c = [x.e = 0];
		else {
			for (; nl > 0 && n.charAt(--nl) == "0";);
			x.e = e - i - 1;
			x.c = [];
			for (e = 0; i <= nl;) x.c[e++] = +n.charAt(i++);
		}
		return x;
	}
	function round(x, sd, rm, more) {
		var xc = x.c;
		if (rm === UNDEFINED) rm = x.constructor.RM;
		if (rm !== 0 && rm !== 1 && rm !== 2 && rm !== 3) throw Error(INVALID_RM);
		if (sd < 1) {
			more = rm === 3 && (more || !!xc[0]) || sd === 0 && (rm === 1 && xc[0] >= 5 || rm === 2 && (xc[0] > 5 || xc[0] === 5 && (more || xc[1] !== UNDEFINED)));
			xc.length = 1;
			if (more) {
				x.e = x.e - sd + 1;
				xc[0] = 1;
			} else xc[0] = x.e = 0;
		} else if (sd < xc.length) {
			more = rm === 1 && xc[sd] >= 5 || rm === 2 && (xc[sd] > 5 || xc[sd] === 5 && (more || xc[sd + 1] !== UNDEFINED || xc[sd - 1] & 1)) || rm === 3 && (more || !!xc[0]);
			xc.length = sd;
			if (more) for (; ++xc[--sd] > 9;) {
				xc[sd] = 0;
				if (sd === 0) {
					++x.e;
					xc.unshift(1);
					break;
				}
			}
			for (sd = xc.length; !xc[--sd];) xc.pop();
		}
		return x;
	}
	function stringify(x, doExponential, isNonzero) {
		var e = x.e, s = x.c.join(""), n = s.length;
		if (doExponential) s = s.charAt(0) + (n > 1 ? "." + s.slice(1) : "") + (e < 0 ? "e" : "e+") + e;
		else if (e < 0) {
			for (; ++e;) s = "0" + s;
			s = "0." + s;
		} else if (e > 0) {
			if (++e > n) for (e -= n; e--;) s += "0";
			else if (e < n) s = s.slice(0, e) + "." + s.slice(e);
		} else if (n > 1) s = s.charAt(0) + "." + s.slice(1);
		return x.s < 0 && isNonzero ? "-" + s : s;
	}
	P.abs = function() {
		var x = new this.constructor(this);
		x.s = 1;
		return x;
	};
	P.cmp = function(y) {
		var isneg, x = this, xc = x.c, yc = (y = new x.constructor(y)).c, i = x.s, j = y.s, k = x.e, l = y.e;
		if (!xc[0] || !yc[0]) return !xc[0] ? !yc[0] ? 0 : -j : i;
		if (i != j) return i;
		isneg = i < 0;
		if (k != l) return k > l ^ isneg ? 1 : -1;
		j = (k = xc.length) < (l = yc.length) ? k : l;
		for (i = -1; ++i < j;) if (xc[i] != yc[i]) return xc[i] > yc[i] ^ isneg ? 1 : -1;
		return k == l ? 0 : k > l ^ isneg ? 1 : -1;
	};
	P.div = function(y) {
		var x = this, Big = x.constructor, a = x.c, b = (y = new Big(y)).c, k = x.s == y.s ? 1 : -1, dp = Big.DP;
		if (dp !== ~~dp || dp < 0 || dp > MAX_DP) throw Error(INVALID_DP);
		if (!b[0]) throw Error(DIV_BY_ZERO);
		if (!a[0]) {
			y.s = k;
			y.c = [y.e = 0];
			return y;
		}
		var bl, bt, n, cmp, ri, bz = b.slice(), ai = bl = b.length, al = a.length, r = a.slice(0, bl), rl = r.length, q = y, qc = q.c = [], qi = 0, p = dp + (q.e = x.e - y.e) + 1;
		q.s = k;
		k = p < 0 ? 0 : p;
		bz.unshift(0);
		for (; rl++ < bl;) r.push(0);
		do {
			for (n = 0; n < 10; n++) {
				if (bl != (rl = r.length)) cmp = bl > rl ? 1 : -1;
				else for (ri = -1, cmp = 0; ++ri < bl;) if (b[ri] != r[ri]) {
					cmp = b[ri] > r[ri] ? 1 : -1;
					break;
				}
				if (cmp < 0) {
					for (bt = rl == bl ? b : bz; rl;) {
						if (r[--rl] < bt[rl]) {
							ri = rl;
							for (; ri && !r[--ri];) r[ri] = 9;
							--r[ri];
							r[rl] += 10;
						}
						r[rl] -= bt[rl];
					}
					for (; !r[0];) r.shift();
				} else break;
			}
			qc[qi++] = cmp ? n : ++n;
			if (r[0] && cmp) r[rl] = a[ai] || 0;
			else r = [a[ai]];
		} while ((ai++ < al || r[0] !== UNDEFINED) && k--);
		if (!qc[0] && qi != 1) {
			qc.shift();
			q.e--;
			p--;
		}
		if (qi > p) round(q, p, Big.RM, r[0] !== UNDEFINED);
		return q;
	};
	P.eq = function(y) {
		return this.cmp(y) === 0;
	};
	P.gt = function(y) {
		return this.cmp(y) > 0;
	};
	P.gte = function(y) {
		return this.cmp(y) > -1;
	};
	P.lt = function(y) {
		return this.cmp(y) < 0;
	};
	P.lte = function(y) {
		return this.cmp(y) < 1;
	};
	P.minus = P.sub = function(y) {
		var i, j, t, xlty, x = this, Big = x.constructor, a = x.s, b = (y = new Big(y)).s;
		if (a != b) {
			y.s = -b;
			return x.plus(y);
		}
		var xc = x.c.slice(), xe = x.e, yc = y.c, ye = y.e;
		if (!xc[0] || !yc[0]) {
			if (yc[0]) y.s = -b;
			else if (xc[0]) y = new Big(x);
			else y.s = 1;
			return y;
		}
		if (a = xe - ye) {
			if (xlty = a < 0) {
				a = -a;
				t = xc;
			} else {
				ye = xe;
				t = yc;
			}
			t.reverse();
			for (b = a; b--;) t.push(0);
			t.reverse();
		} else {
			j = ((xlty = xc.length < yc.length) ? xc : yc).length;
			for (a = b = 0; b < j; b++) if (xc[b] != yc[b]) {
				xlty = xc[b] < yc[b];
				break;
			}
		}
		if (xlty) {
			t = xc;
			xc = yc;
			yc = t;
			y.s = -y.s;
		}
		if ((b = (j = yc.length) - (i = xc.length)) > 0) for (; b--;) xc[i++] = 0;
		for (b = i; j > a;) {
			if (xc[--j] < yc[j]) {
				for (i = j; i && !xc[--i];) xc[i] = 9;
				--xc[i];
				xc[j] += 10;
			}
			xc[j] -= yc[j];
		}
		for (; xc[--b] === 0;) xc.pop();
		for (; xc[0] === 0;) {
			xc.shift();
			--ye;
		}
		if (!xc[0]) {
			y.s = 1;
			xc = [ye = 0];
		}
		y.c = xc;
		y.e = ye;
		return y;
	};
	P.mod = function(y) {
		var ygtx, x = this, Big = x.constructor, a = x.s, b = (y = new Big(y)).s;
		if (!y.c[0]) throw Error(DIV_BY_ZERO);
		x.s = y.s = 1;
		ygtx = y.cmp(x) == 1;
		x.s = a;
		y.s = b;
		if (ygtx) return new Big(x);
		a = Big.DP;
		b = Big.RM;
		Big.DP = Big.RM = 0;
		x = x.div(y);
		Big.DP = a;
		Big.RM = b;
		return this.minus(x.times(y));
	};
	P.neg = function() {
		var x = new this.constructor(this);
		x.s = -x.s;
		return x;
	};
	P.plus = P.add = function(y) {
		var e, k, t, x = this, Big = x.constructor;
		y = new Big(y);
		if (x.s != y.s) {
			y.s = -y.s;
			return x.minus(y);
		}
		var xe = x.e, xc = x.c, ye = y.e, yc = y.c;
		if (!xc[0] || !yc[0]) {
			if (!yc[0]) {
				if (xc[0]) y = new Big(x);
				else y.s = x.s;
			}
			return y;
		}
		xc = xc.slice();
		if (e = xe - ye) {
			if (e > 0) {
				ye = xe;
				t = yc;
			} else {
				e = -e;
				t = xc;
			}
			t.reverse();
			for (; e--;) t.push(0);
			t.reverse();
		}
		if (xc.length - yc.length < 0) {
			t = yc;
			yc = xc;
			xc = t;
		}
		e = yc.length;
		for (k = 0; e; xc[e] %= 10) k = (xc[--e] = xc[e] + yc[e] + k) / 10 | 0;
		if (k) {
			xc.unshift(k);
			++ye;
		}
		for (e = xc.length; xc[--e] === 0;) xc.pop();
		y.c = xc;
		y.e = ye;
		return y;
	};
	P.pow = function(n) {
		var x = this, one = new x.constructor("1"), y = one, isneg = n < 0;
		if (n !== ~~n || n < -1e6 || n > MAX_POWER) throw Error(INVALID + "exponent");
		if (isneg) n = -n;
		for (;;) {
			if (n & 1) y = y.times(x);
			n >>= 1;
			if (!n) break;
			x = x.times(x);
		}
		return isneg ? one.div(y) : y;
	};
	P.prec = function(sd, rm) {
		if (sd !== ~~sd || sd < 1 || sd > MAX_DP) throw Error(INVALID + "precision");
		return round(new this.constructor(this), sd, rm);
	};
	P.round = function(dp, rm) {
		if (dp === UNDEFINED) dp = 0;
		else if (dp !== ~~dp || dp < -1e6 || dp > MAX_DP) throw Error(INVALID_DP);
		return round(new this.constructor(this), dp + this.e + 1, rm);
	};
	P.sqrt = function() {
		var r, c, t, x = this, Big = x.constructor, s = x.s, e = x.e, half = new Big("0.5");
		if (!x.c[0]) return new Big(x);
		if (s < 0) throw Error(NAME + "No square root");
		s = Math.sqrt(+stringify(x, true, true));
		if (s === 0 || s === 1 / 0) {
			c = x.c.join("");
			if (!(c.length + e & 1)) c += "0";
			s = Math.sqrt(c);
			e = ((e + 1) / 2 | 0) - (e < 0 || e & 1);
			r = new Big((s == 1 / 0 ? "5e" : (s = s.toExponential()).slice(0, s.indexOf("e") + 1)) + e);
		} else r = new Big(s + "");
		e = r.e + (Big.DP += 4);
		do {
			t = r;
			r = half.times(t.plus(x.div(t)));
		} while (t.c.slice(0, e).join("") !== r.c.slice(0, e).join(""));
		return round(r, (Big.DP -= 4) + r.e + 1, Big.RM);
	};
	P.times = P.mul = function(y) {
		var c, x = this, Big = x.constructor, xc = x.c, yc = (y = new Big(y)).c, a = xc.length, b = yc.length, i = x.e, j = y.e;
		y.s = x.s == y.s ? 1 : -1;
		if (!xc[0] || !yc[0]) {
			y.c = [y.e = 0];
			return y;
		}
		y.e = i + j;
		if (a < b) {
			c = xc;
			xc = yc;
			yc = c;
			j = a;
			a = b;
			b = j;
		}
		for (c = new Array(j = a + b); j--;) c[j] = 0;
		for (i = b; i--;) {
			b = 0;
			for (j = a + i; j > i;) {
				b = c[j] + yc[i] * xc[j - i - 1] + b;
				c[j--] = b % 10;
				b = b / 10 | 0;
			}
			c[j] = b;
		}
		if (b) ++y.e;
		else c.shift();
		for (i = c.length; !c[--i];) c.pop();
		y.c = c;
		return y;
	};
	P.toExponential = function(dp, rm) {
		var x = this, n = x.c[0];
		if (dp !== UNDEFINED) {
			if (dp !== ~~dp || dp < 0 || dp > MAX_DP) throw Error(INVALID_DP);
			x = round(new x.constructor(x), ++dp, rm);
			for (; x.c.length < dp;) x.c.push(0);
		}
		return stringify(x, true, !!n);
	};
	P.toFixed = function(dp, rm) {
		var x = this, n = x.c[0];
		if (dp !== UNDEFINED) {
			if (dp !== ~~dp || dp < 0 || dp > MAX_DP) throw Error(INVALID_DP);
			x = round(new x.constructor(x), dp + x.e + 1, rm);
			for (dp = dp + x.e + 1; x.c.length < dp;) x.c.push(0);
		}
		return stringify(x, false, !!n);
	};
	P.toJSON = P.toString = function() {
		var x = this, Big = x.constructor;
		return stringify(x, x.e <= Big.NE || x.e >= Big.PE, !!x.c[0]);
	};
	if (typeof Symbol !== "undefined") P[Symbol.for("nodejs.util.inspect.custom")] = P.toJSON;
	P.toNumber = function() {
		var n = +stringify(this, true, true);
		if (this.constructor.strict === true && !this.eq(n.toString())) throw Error(NAME + "Imprecise conversion");
		return n;
	};
	P.toPrecision = function(sd, rm) {
		var x = this, Big = x.constructor, n = x.c[0];
		if (sd !== UNDEFINED) {
			if (sd !== ~~sd || sd < 1 || sd > MAX_DP) throw Error(INVALID + "precision");
			x = round(new Big(x), sd, rm);
			for (; x.c.length < sd;) x.c.push(0);
		}
		return stringify(x, sd <= x.e || x.e <= Big.NE || x.e >= Big.PE, !!n);
	};
	P.valueOf = function() {
		var x = this, Big = x.constructor;
		if (Big.strict === true) throw Error(NAME + "valueOf disallowed");
		return stringify(x, x.e <= Big.NE || x.e >= Big.PE, true);
	};
	var Big = _Big_()();
	Big.RM = Big.roundDown;
	var DIVISION_DIGITS = 100;
	function num(value) {
		if (value instanceof Big) return value;
		const match = String(value ?? "").trim().replace(/,/g, "").match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
		return match ? new Big(match[0]) : NaN;
	}
	var isDecimal = (value) => {
		return num(value) instanceof Big;
	};
	var isPositive = (value) => isDecimal(value) && num(value).gt(0);
	var max = (a, b) => num(a).gte(num(b)) ? num(a) : num(b);
	var min = (a, b) => num(a).lte(num(b)) ? num(a) : num(b);
	function divide(a, b) {
		const dividend = num(a);
		const divisor = num(b);
		const Division = Big();
		Division.DP = Math.max(DIVISION_DIGITS, DIVISION_DIGITS + divisor.e - dividend.e);
		Division.RM = Big.roundDown;
		return new Big(new Division(dividend).div(divisor));
	}
	function weightedEntry(pos, price, qty) {
		return divide(num(pos.entry).times(pos.size).plus(num(price).times(qty)), num(pos.size).plus(qty));
	}
	var PRICE_FORMAT = Object.freeze({
		normalDigits: 6,
		tinyDigits: 4,
		tinyZeroThreshold: 5,
		compactZeroThreshold: 6
	});
	function formatPrice(value) {
		if (!isDecimal(value)) return "—";
		const price = num(value);
		const zeros = (price.abs().toFixed().split(".")[1] || "").match(/^0*/)[0].length;
		const digits = zeros > PRICE_FORMAT.tinyZeroThreshold ? PRICE_FORMAT.tinyDigits : PRICE_FORMAT.normalDigits;
		return price.round(zeros + digits, Big.roundDown).toFixed().replace(/\.(0+)([1-9]\d*)$/, (match, leading, rest) => leading.length > PRICE_FORMAT.compactZeroThreshold ? `.0{${leading.length}}${rest}` : match);
	}
	var cache = new Map();
	var requests = new Set();
	var RETRY_MS = 3e4;
	onCleanup(() => {
		requests.forEach((request) => request.abort?.());
		requests.clear();
		cache.clear();
	});
	function readPublicData(url, ttl = 3e4) {
		if (isDisabled()) return { status: "unavailable" };
		const now = Date.now();
		const old = cache.get(url);
		if (old?.data && now - old.at < ttl) return {
			status: "ready",
			data: old.data
		};
		if (old?.loading) return { status: "loading" };
		if (old?.failedAt && now - old.failedAt < RETRY_MS) return { status: "unavailable" };
		const entry = { loading: true };
		cache.set(url, entry);
		let request;
		const finish = (data) => {
			requests.delete(request);
			if (isDisabled() || cache.get(url) !== entry) return;
			cache.set(url, data ? {
				data,
				at: Date.now()
			} : { failedAt: Date.now() });
		};
		request = _GM_xmlhttpRequest({
			method: "GET",
			url,
			anonymous: true,
			timeout: 1e4,
			onload: (response) => {
				try {
					finish(response.status >= 200 && response.status < 300 ? JSON.parse(response.responseText) : null);
				} catch (_) {
					finish(null);
				}
			},
			onerror: () => finish(null),
			ontimeout: () => finish(null),
			onabort: () => finish(null)
		});
		if (entry === cache.get(url)) requests.add(request);
		return { status: "loading" };
	}
	function getContract() {
		let path;
		try {
			path = decodeURIComponent(location.pathname);
		} catch (e) {
			return null;
		}
		const m = path.match(/futures\/USDT\/([^/_\s]+_USDT)/i);
		if (!m) return null;
		const name = m[1].toUpperCase();
		return {
			name,
			base: name.split("_")[0],
			display: name.replace("_", "")
		};
	}
	var readContractDetails = (contract) => readPublicData(CONTRACT_API + encodeURIComponent(contract));
	var isSupportedUnit = (unit, ctx) => !unit || unit === ctx.base || unit === "张";
	function toCoin(qty, unit, ctx) {
		if (!unit || unit === ctx.base) return qty;
		if (unit === "张") {
			const details = readContractDetails(ctx.name).data;
			const multiplier = num(details?.quanto_multiplier);
			return details?.name === ctx.name && isPositive(multiplier) && isPositive(qty) ? num(qty).times(multiplier) : NaN;
		}
		return NaN;
	}
	function readOrderForm() {
		const boxes = document.querySelectorAll(".dealbox");
		expect(boxes.length === 1, `下单区 .dealbox 应有 1 个，实际 ${boxes.length} 个`);
		const dealbox = boxes[0];
		const qtyInputs = dealbox.querySelectorAll("input[name=\"f_order\"]");
		expect(qtyInputs.length === 1, `数量输入框 input[name="f_order"] 应有 1 个，实际 ${qtyInputs.length} 个`);
		const qtyInput = qtyInputs[0];
		const unitEl = expect(qtyInput.closest("label")?.querySelector("span.truncate"), "数量单位 span.truncate 未找到");
		const wrapper = expect(qtyInput.closest(".mantine-InputWrapper-root"), "数量输入框外层 .mantine-InputWrapper-root 未找到");
		const anchor = expect([...dealbox.children].find((el) => /^可用/.test(el.textContent.trim())), "下单区“可用”行未找到");
		const orderModule = expect(dealbox.closest(".react-grid-item"), "下单区所在模块 .react-grid-item 未找到");
		const openTab = expect(orderModule.querySelector("#tab-long[role=\"tab\"]"), "“开仓”标签 #tab-long 未找到");
		expect(orderModule.querySelector("#tab-short[role=\"tab\"]"), "“平仓”标签 #tab-short 未找到");
		const isOpen = openTab.getAttribute("aria-selected") === "true";
		const base = {
			dealbox,
			qtyInput,
			anchor,
			isOpen,
			price: NaN,
			priceStr: "",
			qtyLong: NaN,
			qtyShort: NaN,
			unit: ""
		};
		if (!isOpen) return base;
		const before = [...dealbox.querySelectorAll("input")].filter((i) => i !== qtyInput && i.type !== "checkbox" && i.offsetParent && i.compareDocumentPosition(qtyInput) & Node.DOCUMENT_POSITION_FOLLOWING);
		const priceInput = before[before.length - 1];
		if (!priceInput) return base;
		base.priceStr = priceInput.value;
		base.price = num(priceInput.value);
		if (!isPositive(base.price)) return base;
		const raw = qtyInput.value.trim();
		if (raw.endsWith("%")) {
			if (!isPositive(num(raw))) return base;
			const hint = expect(wrapper.querySelector(".mantine-InputWrapper-error"), "百分比数量提示行未找到");
			const add = expect(hint.querySelector(".font-add-color"), "百分比提示中的开多数量 .font-add-color 未找到");
			const dec = expect(hint.querySelector(".font-dec-color"), "百分比提示中的开空数量 .font-dec-color 未找到");
			const unit = expect((hint.textContent.trim().match(/\S+$/) || [""])[0], "百分比提示中的单位未找到");
			return {
				...base,
				qtyLong: num(add.textContent),
				qtyShort: num(dec.textContent),
				unit
			};
		}
		const qty = num(raw);
		return {
			...base,
			qtyLong: qty,
			qtyShort: qty,
			unit: unitEl.textContent.trim()
		};
	}
	function parseMarginMode(text) {
		const modes = [...String(text).matchAll(/全仓|逐仓|\bcross\b|\bisolated\b/gi)].map(([mode]) => /全仓|cross/i.test(mode) ? "cross" : "isolated");
		const unique = [...new Set(modes)];
		return unique.length === 1 ? unique[0] : null;
	}
	function fieldNumber(text) {
		const value = String(text ?? "").trim().replace(/,/g, "");
		return /^[+-]?\d+(?:\.\d+)?(?:\s|$|USDT)/i.test(value) ? num(value) : NaN;
	}
	function parsePositionRisk(modeText, marginText, liquidationText) {
		return {
			marginMode: parseMarginMode(modeText),
			margin: fieldNumber(marginText),
			liquidation: fieldNumber(liquidationText),
			liquidationText: String(liquidationText || "").trim()
		};
	}
	var isLiquidationLabel = (text) => /^(?:预估)?强平(?:价|价格)(?:\(USDT\))?$/.test(text.replace(/\s/g, "").replace(/（/g, "(").replace(/）/g, ")"));
	var isMarginLabel = (text) => /^(?:仓位)?保证金(?:\(USDT\))?$/.test(text.replace(/\s/g, "").replace(/（/g, "(").replace(/）/g, ")"));
	function parseOrderRisk(text) {
		const leverages = [...String(text).matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:[xX×]|倍)(?=$|[^a-zA-Z])/g)].map((m) => num(m[1]));
		return {
			marginMode: parseMarginMode(text),
			leverageLong: leverages.length === 1 || leverages.length === 2 ? leverages[0] : NaN,
			leverageShort: leverages.length === 1 ? leverages[0] : leverages.length === 2 ? leverages[1] : NaN,
			unsupported: /组合保证金|多币种保证金|跨币种保证金/.test(text)
		};
	}
	function readOrderRisk(root) {
		const panelSelector = `#${PANEL_ID}`;
		const read = (node) => {
			if (node.nodeType === 3) return node.textContent;
			if (node.nodeType !== 1 || node.id === "tm-avg-preview") return "";
			const style = getComputedStyle(node);
			if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return "";
			if (!node.querySelector(panelSelector)) return node.innerText;
			return [...node.childNodes].map(read).join("\n");
		};
		return parseOrderRisk(read(root));
	}
	var sideOf = (texts) => texts.includes("多") ? "long" : texts.includes("空") ? "short" : null;
	function readPositions(ctx) {
		const result = {
			long: null,
			short: null
		};
		const add = (where, name, side, sizeText, entryText, risk) => {
			const entry = num(entryText);
			const size = isDecimal(num(sizeText)) ? num(sizeText).abs() : NaN;
			expect(name, `${where}中合约名未找到`);
			expect(side, `${where}中多/空方向未找到`);
			expect(isPositive(entry), `${where}中开仓均价无法解析：“${entryText}”`);
			expect(isPositive(size), `${where}中数量无法解析：“${sizeText}”`);
			if (name !== ctx.display) return;
			const unit = (sizeText.match(/[^\d.,\s-]+$/) || [""])[0];
			expect(!result[side], `${where}中同方向有多个仓位，无法确认加仓归属`);
			result[side] = {
				entry,
				entryText,
				size: isSupportedUnit(unit, ctx) ? toCoin(size, unit, ctx) : NaN,
				...risk
			};
		};
		document.querySelectorAll("table.position-table").forEach((table) => {
			expect(table.querySelector("th.size") && table.querySelector("th.entry_price"), "仓位列表表头“数量/开仓均价”列未找到");
			const headers = [...table.querySelectorAll("thead th")];
			const liqIndex = headers.findIndex((th) => isLiquidationLabel(th.textContent));
			const marginIndex = headers.findIndex((th) => isMarginLabel(th.textContent));
			table.querySelectorAll("tbody tr").forEach((tr) => {
				if (tr.cells.length <= 1) return;
				const badges = [...tr.querySelectorAll(".mantine-Badge-label")].map((b) => b.textContent.trim());
				add("仓位列表", tr.querySelector("td span.text-b10")?.textContent.replace(/\s/g, ""), sideOf(badges), expect(tr.querySelector("td.size"), "仓位列表中数量单元格 td.size 未找到").textContent.trim(), expect(tr.querySelector("td.entry_price"), "仓位列表中开仓均价单元格 td.entry_price 未找到").textContent.trim(), parsePositionRisk(tr.innerText, tr.cells[marginIndex]?.innerText, tr.cells[liqIndex]?.innerText));
			});
		});
		document.querySelectorAll("span.underline-dashed").forEach((label) => {
			if (label.textContent.trim() !== "开仓均价" || label.closest("table")) return;
			if (!label.closest(".scroll-table-bottom-box")) return;
			let card = label.parentElement;
			while (card && !/^\S+USDT\n/.test(card.innerText)) card = card.parentElement;
			expect(card, "仓位卡片未找到（以合约名开头的容器）");
			const lines = card.innerText.split("\n").map((s) => s.trim());
			const qtyIdx = lines.indexOf("数量");
			expect(qtyIdx > 0, "仓位卡片中“数量”标签未找到");
			const field = (matches) => {
				const index = lines.findIndex(matches);
				return index >= 0 ? lines[index + 1] : "";
			};
			add("仓位卡片", lines[0], sideOf(lines.slice(0, qtyIdx)), lines[qtyIdx + 1] || "", lines[lines.indexOf("开仓均价") + 1] || "", parsePositionRisk(lines.slice(0, qtyIdx).join(" "), field(isMarginLabel), field(isLiquidationLabel)));
		});
		return result;
	}
	function readUnrealizedPnl() {
		const labels = [...document.querySelectorAll(".asset-container_new span.underline-dotted")].filter((label) => label.textContent.trim() === "未实现盈亏");
		expect(labels.length === 1, `资产区“未实现盈亏”应有 1 个，实际 ${labels.length} 个`);
		const values = labels[0].parentElement.querySelectorAll(".order-right-trans-container");
		expect(values.length === 1, "未实现盈亏数值容器应有 1 个");
		const text = values[0].textContent.trim().replace(/−/g, "-");
		expect(/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?\s*USDT$/.test(text), "未实现盈亏不是有效的 USDT 金额");
		return num(text.replace(/^\+/, ""));
	}
	var STARTUP_TIMEOUT_MS = 2e4;
	var POLL_MS = 500;
	function verifyStructure() {
		const ctx = expect(getContract(), "无法从地址栏解析合约名");
		readOrderForm();
		readPositions(ctx);
		verifyPrivacyStructure();
		readUnrealizedPnl();
	}
	function startWhenReady(features) {
		const accountDeadline = Date.now() + STARTUP_TIMEOUT_MS;
		let structureDeadline;
		const id = setInterval(() => {
			const account = readAccountState();
			if (account === "loggedOut") return stopSilently();
			if (account !== "loggedIn") {
				if (Date.now() >= accountDeadline) stopSilently();
				return;
			}
			structureDeadline ??= Date.now() + STARTUP_TIMEOUT_MS;
			try {
				verifyStructure();
			} catch (e) {
				if (!(e instanceof StructureError)) {
					clearInterval(id);
					return disable(`脚本异常：${e?.message || e}`);
				}
				if (Date.now() < structureDeadline) return;
				clearInterval(id);
				return disable(e.message);
			}
			clearInterval(id);
			try {
				features.forEach((init) => init());
			} catch (e) {
				disable(`启动失败：${e?.message || e}`);
			}
		}, POLL_MS);
		onCleanup(() => clearInterval(id));
	}
	function normalizeTiers(raw) {
		if (!Array.isArray(raw) || !raw.length) return null;
		const tiers = raw.map((tier) => ({
			limit: num(tier.risk_limit),
			rate: num(tier.maintenance_rate),
			deduction: num(tier.deduction),
			leverageMax: num(tier.leverage_max)
		})).sort((a, b) => isDecimal(a.limit) && isDecimal(b.limit) ? a.limit.cmp(b.limit) : 0);
		let previous = {
			limit: num(0),
			rate: num(0),
			deduction: num(0)
		};
		for (const tier of tiers) {
			if (!Object.values(tier).every(isDecimal) || !(tier.limit.gt(previous.limit) && tier.rate.gte(previous.rate) && tier.rate.lt(1) && tier.deduction.gte(0) && tier.leverageMax.gte(1))) return null;
			const deduction = previous.deduction.plus(previous.limit.times(tier.rate.minus(previous.rate)));
			if (tier.deduction.minus(deduction).abs().gt(max("0.01", deduction.times("1e-8")))) return null;
			previous = tier;
		}
		return tiers;
	}
	function maintenanceMargin(value, tiers, fee) {
		value = num(value);
		if (!isDecimal(value) || value.lt(0)) return NaN;
		const tier = tiers.find((item) => value.lte(item.limit));
		if (!tier) return NaN;
		return max(0, value.times(tier.rate).minus(tier.deduction)).plus(value.times(fee));
	}
	var positionCost = (pos) => num(pos.cost ?? num(pos.size).times(pos.entry));
	function positionPnl(positions, price) {
		price = num(price);
		return (positions.long ? num(positions.long.size).times(price).minus(positionCost(positions.long)) : num(0)).plus(positions.short ? positionCost(positions.short).minus(num(positions.short.size).times(price)) : 0);
	}
	function hedgeMaintenance(positions, price, tiers, fee) {
		const long = num(positions.long?.size ?? 0);
		const short = num(positions.short?.size ?? 0);
		const longMargin = maintenanceMargin(long.times(price), tiers, fee);
		const shortMargin = maintenanceMargin(short.times(price), tiers, fee);
		if (![longMargin, shortMargin].every(isDecimal)) return NaN;
		return max(longMargin, shortMargin).plus(min(long, short).times(price).times(fee));
	}
	function findBoundaries(positions, marginNumerator, marginDivisor, market) {
		const { tiers, fee, mark } = market;
		const long = num(positions.long?.size ?? 0);
		const short = num(positions.short?.size ?? 0);
		const largest = max(long, short);
		if (largest.times(mark).gt(tiers[tiers.length - 1].limit)) return { notice: "仓位超出风险档位范围" };
		const netSize = long.minus(short);
		const equityBase = marginNumerator.minus(positions.long ? positionCost(positions.long).times(marginDivisor) : 0).plus(positions.short ? positionCost(positions.short).times(marginDivisor) : 0);
		if (!equityBase.plus(netSize.times(mark).times(marginDivisor)).minus(hedgeMaintenance(positions, mark, tiers, fee).times(marginDivisor)).gt(0)) return { notice: "当前标记价已触及强平条件" };
		const feeSlope = long.plus(short).times(fee);
		let lower = null;
		let upper = null;
		let previousLimit = num(0);
		for (const tier of tiers) {
			for (const active of [false, true]) {
				const maintenanceSlope = active ? largest.times(tier.rate) : num(0);
				const deduction = active ? tier.deduction.times(marginDivisor) : num(0);
				const denominator = maintenanceSlope.plus(feeSlope).minus(netSize).times(marginDivisor);
				if (denominator.eq(0)) continue;
				const price = divide(equityBase.plus(deduction), denominator);
				if (!price.gt(0)) continue;
				const value = largest.times(price);
				if (value.lt(previousLimit) || value.gt(tier.limit)) continue;
				const baseMargin = value.times(tier.rate).minus(tier.deduction);
				if (active ? baseMargin.lt(0) : baseMargin.gt(0)) continue;
				if (denominator.lt(0) && price.lt(mark)) lower = lower ? max(lower, price) : price;
				if (denominator.gt(0) && price.gt(mark)) upper = upper ? min(upper, price) : price;
			}
			previousLimit = tier.limit;
		}
		return lower || upper ? {
			lower,
			upper
		} : { notice: "风险档位内无强平价" };
	}
	var validPosition = (pos) => pos && isPositive(pos.entry) && isPositive(pos.size);
	var notice = (text) => ({ notice: text });
	function estimateLiquidation({ positions, side, price, qty, settings, market }) {
		const pos = positions[side];
		if (!market || !validPosition(pos) || !isPositive(qty) || !isPositive(price)) return notice("等待完整价格和数量");
		if (settings.unsupported) return notice("暂不支持组合或多币种保证金");
		if (!pos.marginMode || !settings.marginMode) return notice("未读取到保证金模式");
		if (pos.marginMode !== settings.marginMode) return notice("下单与持仓保证金模式不一致");
		const isolated = pos.marginMode === "isolated";
		const current = {
			long: null,
			short: null
		};
		for (const direction of isolated ? [side] : ["long", "short"]) {
			const item = positions[direction];
			if (!item) continue;
			if (!item.marginMode) return notice("另一方向的保证金模式不明");
			if (item.marginMode !== pos.marginMode) continue;
			if (!validPosition(item)) return notice("持仓数量换算中…");
			current[direction] = item;
		}
		if (current.long && current.short) {
			const a = current.long.liquidation;
			const b = current.short.liquidation;
			if (![a, b].every(isPositive) || num(a).minus(b).abs().gt(max(a, b).times("1e-5"))) return notice("双向全仓强平数据不一致");
		}
		let margin;
		if (isPositive(pos.liquidation)) {
			margin = hedgeMaintenance(current, pos.liquidation, market.tiers, market.fee);
			if (isDecimal(margin)) margin = margin.minus(positionPnl(current, pos.liquidation));
		} else if (isolated && isDecimal(pos.margin) && num(pos.margin).gte(0)) margin = num(pos.margin);
		else return notice("缺少当前强平价或逐仓保证金");
		if (!isDecimal(margin)) return notice("当前强平价超出风险档位范围");
		const notional = num(qty).times(price);
		let marginNumerator = margin;
		let marginDivisor = num(1);
		let explanation;
		if (isolated) {
			const leverage = side === "long" ? settings.leverageLong : settings.leverageShort;
			if (!(isDecimal(leverage) && num(leverage).gte(1))) return notice("未读取到当前杠杆");
			const tier = market.tiers.find((item) => num(pos.size).plus(qty).times(max(price, market.mark)).lte(item.limit));
			if (!tier || num(leverage).gt(tier.leverageMax)) return notice("加仓规模超过当前杠杆档位");
			marginDivisor = num(leverage);
			const reserveNumerator = notional.times(market.fee).times(side === "short" ? marginDivisor.plus(1) : marginDivisor);
			marginNumerator = margin.times(marginDivisor).plus(notional).plus(reserveNumerator);
			explanation = "逐仓：保留原仓保证金，按当前杠杆追加初始保证金及预留平仓费。";
		} else {
			marginNumerator = margin.minus(notional.times(market.fee));
			explanation = "全仓：由当前强平价反推有效保证金，保持其他仓位当前盈亏和维持保证金不变，扣除新开仓费。";
		}
		return {
			...findBoundaries({
				...current,
				[side]: {
					size: num(pos.size).plus(qty),
					entry: weightedEntry(pos, price, qty),
					cost: positionCost(pos).plus(notional)
				}
			}, marginNumerator, marginDivisor, market),
			explanation: `${explanation}假设本次按委托价全部成交，仅模拟当前方向的一笔加仓。按公开 Taker 费率 ${num(market.fee).times(100).toFixed(4)}% 近似，实际费率、成交、资金费及页面价格舍入可能造成差异。`
		};
	}
	function readLiquidationData(ctx, form) {
		const settings = readOrderRisk(form.dealbox.closest(".react-grid-item"));
		const assetText = document.querySelector(".asset-container_new")?.innerText || "";
		settings.unsupported ||= /组合保证金|多币种保证金|跨币种保证金/.test(assetText);
		const details = readContractDetails(ctx.name);
		const tiers = readPublicData(CONTRACT_API.replace(/contracts\/$/, "risk_limit_tiers?contract=") + encodeURIComponent(ctx.name));
		const unavailable = [details.status, tiers.status].includes("unavailable");
		if (details.status !== "ready" || tiers.status !== "ready") return {
			settings,
			loading: !unavailable,
			notice: unavailable ? "行情接口暂不可用" : "读取风险参数中…"
		};
		const contract = details.data;
		const normalized = normalizeTiers(tiers.data);
		const fee = num(contract.taker_fee_rate);
		const mark = num(contract.mark_price);
		if (contract.name !== ctx.name || contract.type !== "direct" || !isPositive(mark) || !isDecimal(fee) || !(fee.gte(0) && fee.lt("0.1")) || !normalized) return {
			settings,
			notice: "合约风险参数不完整"
		};
		return {
			settings,
			market: {
				fee,
				mark,
				tiers: normalized
			}
		};
	}
	function calculateBreakEven({ long, short }) {
		if (!long && !short) return { notice: "暂无持仓" };
		if (!long || !short) return { price: num((long || short).entry) };
		if (![long.size, short.size].every(isPositive)) return { notice: "换算中…" };
		const netSize = num(long.size).minus(short.size);
		const netCost = num(long.cost ?? num(long.size).times(long.entry)).minus(short.cost ?? num(short.size).times(short.entry));
		if (netSize.eq(0)) {
			if (netCost.eq(0)) return { notice: "任意价格均平衡" };
			return { notice: netCost.lt(0) ? "无平衡价（锁盈）" : "无平衡价（锁亏）" };
		}
		const price = divide(netCost, netSize);
		return price.gt(0) ? { price } : { notice: "无正数平衡价" };
	}
	function estimateBreakEven({ positions, side, price, qty }) {
		const pos = positions[side];
		if (!pos || !isPositive(price) || !isPositive(pos.entry)) return { notice: "等待完整价格和数量" };
		if (![pos.size, qty].every(isPositive)) return { notice: "换算中…" };
		const size = num(pos.size).plus(qty);
		const entry = weightedEntry(pos, price, qty);
		const cost = num(pos.size).times(pos.entry).plus(num(qty).times(price));
		return calculateBreakEven({
			...positions,
			[side]: {
				size,
				entry,
				cost
			}
		});
	}
	var drag = null;
	var resizeObserver;
	var dragInitialized = false;
	var getPanel = () => document.getElementById(PANEL_ID);
	function hidePanel() {
		stopDrag();
		const panel = getPanel();
		if (panel) panel.style.display = "none";
	}
	onCleanup(() => {
		stopDrag();
		resizeObserver?.disconnect();
		getPanel()?.remove();
	});
	function movePanel(panel, left, top) {
		const rect = panel.getBoundingClientRect();
		const viewport = document.documentElement;
		panel.style.left = `${Math.max(0, Math.min(left, viewport.clientWidth - rect.width))}px`;
		panel.style.top = `${Math.max(0, Math.min(top, viewport.clientHeight - rect.height))}px`;
		panel.style.right = "auto";
	}
	function keepPanelInViewport() {
		const panel = getPanel();
		if (!panel || panel.style.display === "none") return;
		const { left, top } = panel.getBoundingClientRect();
		movePanel(panel, left, top);
	}
	function stopDrag() {
		if (!drag) return;
		const { title, pointerId } = drag;
		drag = null;
		title.style.cursor = "grab";
		if (title.hasPointerCapture(pointerId)) title.releasePointerCapture(pointerId);
	}
	function initDrag() {
		if (dragInitialized) return;
		dragInitialized = true;
		listen(document, "pointerdown", (event) => {
			const panel = getPanel();
			const title = panel?.firstElementChild;
			if (!title?.contains(event.target) || event.button !== 0 || drag) return;
			const rect = panel.getBoundingClientRect();
			title.setPointerCapture(event.pointerId);
			drag = {
				title,
				pointerId: event.pointerId,
				offsetX: event.clientX - rect.left,
				offsetY: event.clientY - rect.top
			};
			title.style.cursor = "grabbing";
			event.preventDefault();
		});
		listen(document, "pointermove", (event) => {
			if (!drag || event.pointerId !== drag.pointerId) return;
			const panel = getPanel();
			if (!panel) return stopDrag();
			movePanel(panel, event.clientX - drag.offsetX, event.clientY - drag.offsetY);
		});
		const endDrag = (event) => {
			if (event.pointerId === drag?.pointerId) stopDrag();
		};
		listen(document, "pointerup", endDrag);
		listen(document, "pointercancel", endDrag);
		listen(document, "lostpointercapture", endDrag);
		listen(window, "blur", stopDrag);
		listen(window, "resize", keepPanelInViewport);
		resizeObserver = new ResizeObserver(keepPanelInViewport);
	}
	function renderPanel(panel, html, status = "") {
		panel.firstElementChild.lastElementChild.textContent = status;
		panel.lastElementChild.innerHTML = html;
	}
	function ensurePanel() {
		let panel = getPanel();
		if (panel && panel.parentElement === document.body) return panel;
		stopDrag();
		panel?.remove();
		panel = document.createElement("div");
		panel.id = PANEL_ID;
		panel.style.cssText = [
			"position:fixed",
			"top:100px",
			"right:310px",
			"z-index:2147483646",
			"width:300px",
			"max-width:100%",
			"max-height:100vh",
			"display:flex",
			"flex-direction:column",
			"box-sizing:border-box",
			"padding:8px 12px",
			"border-radius:6px",
			"border:1px solid #697386",
			"font-size:12px",
			"line-height:20px",
			"background:var(--color-bg-primary, #18191c)",
			"color:var(--color-text-text-secondary, #8d93a6)",
			"box-shadow:0 2px 12px rgba(0,0,0,.25)"
		].join(";");
		const title = document.createElement("div");
		title.textContent = "合约助手";
		title.title = "按住拖动面板";
		title.style.cssText = [
			"display:flex",
			"justify-content:space-between",
			"align-items:center",
			"gap:8px",
			"white-space:nowrap",
			"flex-shrink:0",
			"padding-bottom:6px",
			"margin-bottom:6px",
			"border-bottom:1px solid var(--color-line-border, #697386)",
			"font-weight:600",
			"color:var(--color-text-text-primary, #e8eaf0)",
			"cursor:grab",
			"user-select:none",
			"touch-action:none"
		].join(";");
		const status = document.createElement("span");
		status.style.cssText = [
			"min-width:0",
			"overflow:hidden",
			"text-overflow:ellipsis",
			"font-size:11px",
			"font-weight:400",
			"color:var(--color-text-text-secondary, #8d93a6)"
		].join(";");
		title.append(status);
		const content = document.createElement("div");
		content.style.cssText = "min-height:0;overflow:auto";
		panel.append(title, content);
		document.body.appendChild(panel);
		initDrag();
		resizeObserver.disconnect();
		resizeObserver.observe(panel);
		return panel;
	}
	var esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;"
	})[c]);
	var row = (left, right, title = "") => `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px" title="${esc(title)}">${left}${right}</div>`;
	function renderBreakEvenResult(label, color, result, title) {
		const value = result.notice || formatPrice(result.price);
		return row(`<span style="color:${color};white-space:nowrap">${label}</span>`, `<span style="color:${color};text-align:right;white-space:nowrap">${esc(value)}</span>`, title);
	}
	function renderBreakEvenLine(positions) {
		return renderBreakEvenResult("当前盈亏平衡价", "inherit", calculateBreakEven(positions), "当前持仓合计未实现盈亏为零的价格，不含本次委托、手续费和资金费；等量多空持仓的合计盈亏不随价格变化");
	}
	function renderClosingBreakEvenLine(label, color, positions, side, price, qty) {
		return renderBreakEvenResult(`${label}后盈亏平衡价`, color, estimateBreakEven({
			positions,
			side,
			price,
			qty
		}), `假设本次${label}按委托价全部成交后，多空持仓以同一价格全部平仓时合计盈亏为零的价格，不含手续费和资金费；仅模拟当前方向的一笔加仓`);
	}
	function renderLine(label, color, pos, price, qty) {
		const left = `<span style="color:${color};white-space:nowrap">${label}后均价</span>`;
		if (!isPositive(pos.size) || !isPositive(qty)) return row(left, "<span>换算中…</span>");
		return row(left, `<span style="text-align:right;white-space:nowrap;color:var(--color-text-text-primary,inherit)">${formatPrice(weightedEntry(pos, price, qty))}</span>`, `原均价 ${formatPrice(pos.entry)}`);
	}
	function renderLiquidationLine(label, color, result, followingLine = "") {
		const left = `<span style="color:${color};white-space:nowrap">${label}后预估强平价</span>`;
		const values = [result.lower, result.upper].filter(isPositive);
		const value = values.length === 2 ? `↓ ${formatPrice(values[0])} / ↑ ${formatPrice(values[1])}` : values.length ? `≈ ${formatPrice(values[0])}` : result.loading ? "—" : "暂无法预估";
		const notice = result.loading ? "" : result.notice;
		const title = [notice, result.explanation].filter(Boolean).join("；");
		return row(left, `<span style="text-align:right;color:var(--color-text-text-primary,inherit)">${esc(value)}</span>`, title) + followingLine + (notice ? row(`<span style="font-size:11px">${esc(notice)}</span>`, "") : "");
	}
	var renderNotice = (text) => row(`<span>${esc(text)}</span>`, "");
	var BUY_COLOR = "var(--color-function-trade-buy, #2ebd85)";
	var SELL_COLOR = "var(--color-function-trade-sell, #f6465d)";
	var lastKey = "";
	function hide() {
		hidePanel();
		lastKey = "";
	}
	function render(el, key, html, status = "") {
		if (key === lastKey && el.lastElementChild.innerHTML) return;
		lastKey = key;
		renderPanel(el, html, status);
	}
	function tick$1() {
		const ctx = expect(getContract(), "无法从地址栏解析合约名");
		const form = readOrderForm();
		if (!form.isOpen || !isPositive(form.price) || !(isPositive(form.qtyLong) || isPositive(form.qtyShort))) return hide();
		if (!isSupportedUnit(form.unit, ctx)) {
			const el = ensurePanel();
			el.style.display = "flex";
			return render(el, `unit:${form.unit}`, renderNotice(`数量单位为 ${form.unit} 时不预估均价`));
		}
		const pos = readPositions(ctx);
		const qtyLong = toCoin(form.qtyLong, form.unit, ctx);
		const qtyShort = toCoin(form.qtyShort, form.unit, ctx);
		const showLong = pos.long && isPositive(form.qtyLong);
		const showShort = pos.short && isPositive(form.qtyShort);
		if (!showLong && !showShort) return hide();
		const risk = readLiquidationData(ctx, form);
		const preview = (side, qty) => risk.notice ? {
			notice: risk.notice,
			loading: risk.loading
		} : estimateLiquidation({
			positions: pos,
			side,
			price: form.price,
			qty,
			...risk
		});
		const liquidationLong = showLong ? preview("long", qtyLong) : null;
		const liquidationShort = showShort ? preview("short", qtyShort) : null;
		const key = JSON.stringify([
			ctx.name,
			form.price,
			qtyLong,
			qtyShort,
			pos,
			liquidationLong,
			liquidationShort
		]);
		const el = ensurePanel();
		el.style.display = "flex";
		const html = renderBreakEvenLine(pos) + (showLong ? renderLine("开多", BUY_COLOR, pos.long, form.price, qtyLong) + renderLiquidationLine("开多", BUY_COLOR, liquidationLong, renderClosingBreakEvenLine("开多", "inherit", pos, "long", form.price, qtyLong)) : "") + (showShort ? renderLine("开空", SELL_COLOR, pos.short, form.price, qtyShort) + renderLiquidationLine("开空", SELL_COLOR, liquidationShort, renderClosingBreakEvenLine("开空", "inherit", pos, "short", form.price, qtyShort)) : "");
		if (key !== lastKey) console.debug("[均价预估]", {
			price: form.priceStr,
			unit: form.unit,
			qtyLong,
			qtyShort,
			pos
		});
		render(el, key, html, risk.loading ? risk.notice : "");
	}
	function initAvgPreview() {
		every("avgPreview", tick$1, 300, hide);
		let frame;
		listen(document, "input", () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => run("avgPreview", tick$1, hide));
		}, true);
		onCleanup(() => cancelAnimationFrame(frame));
	}
	var BANNER_ID = "tm-gate-loss-alert";
	function hideLossBanner() {
		document.getElementById(BANNER_ID)?.remove();
	}
	function showLossBanner() {
		if (document.getElementById(BANNER_ID)) return;
		const bar = document.createElement("div");
		bar.id = BANNER_ID;
		bar.setAttribute("role", "alert");
		bar.style.cssText = [
			"position:fixed",
			"top:0",
			"left:0",
			"right:0",
			"z-index:2147483647",
			"box-sizing:border-box",
			"padding:6px 12px",
			"background:#d9304f",
			"color:#fff",
			"font-size:13px",
			"font-weight:600",
			"line-height:20px",
			"text-align:center",
			"box-shadow:0 2px 8px rgba(0,0,0,.25)",
			"pointer-events:auto"
		].join(";");
		bar.textContent = `⚠ 所有仓位亏损已超过 100 USDT，机会很多，及时止损！`;
		const emphasis = document.createElement("strong");
		emphasis.textContent = "（只做确定性高的的行情！）";
		emphasis.style.cssText = "color:#ffff00;font-weight:800";
		bar.appendChild(emphasis);
		document.documentElement.appendChild(bar);
	}
	function tick() {
		if (readUnrealizedPnl().lt(-100)) showLossBanner();
		else hideLossBanner();
	}
	function initLossAlert() {
		onCleanup(hideLossBanner);
		every("lossAlert", tick, 300, hideLossBanner);
		run("lossAlert", tick, hideLossBanner);
	}
	startWhenReady([
		initAvgPreview,
		initPrivacyHide,
		initLossAlert
	]);
})();
