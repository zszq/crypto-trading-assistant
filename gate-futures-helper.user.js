// ==UserScript==
// @name         Gate 合约助手
// @namespace    http://tampermonkey.net/
// @version      1.6.0
// @author       zl
// @description  Gate USDT 永续合约：限价下单时预估开仓后的持仓均价
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
	var BANNER_ID = "tm-gate-helper-banner";
	function showBanner(reason) {
		if (document.getElementById(BANNER_ID)) return;
		const bar = document.createElement("div");
		bar.id = BANNER_ID;
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
	var StructureError = class extends Error {};
	function expect(cond, message) {
		if (!cond) throw new StructureError(message);
		return cond;
	}
	var GRACE_MS = 3e3;
	var disabled = false;
	var cleanups = [];
	var failingSince = {};
	function onCleanup(fn) {
		cleanups.push(fn);
	}
	function disable(reason) {
		if (disabled) return;
		disabled = true;
		console.error("[Gate 合约助手] 已停用：", reason);
		cleanups.reverse().forEach((fn) => {
			try {
				fn();
			} catch (e) {}
		});
		showBanner(reason);
	}
	function run(name, fn, onFail) {
		if (disabled) return;
		try {
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
	var TOGGLES_ID = "tm-blur-toggles";
	var STORE_KEY = "blurModules";
	var MODULES = [
		{
			key: "order",
			label: "开仓"
		},
		{
			key: "positions",
			label: "仓位"
		},
		{
			key: "assets",
			label: "资产"
		}
	];
	var ORDER = ".react-grid-item:has(.dealbox)";
	var POSITIONS = ".react-grid-item:has(.scroll-table-bottom-box)";
	var ASSETS = ".react-grid-item:has(.asset-container_new)";
	var TARGETS = {
		order: {
			box: ORDER,
			inner: "> .h-full > *"
		},
		positions: {
			box: POSITIONS,
			inner: ".scroll-table-bottom-box > :last-child:not(:first-child)",
			revealOnSelf: true
		},
		assets: {
			box: ASSETS,
			inner: ".asset-container_new > :not(.rgl-drag-zone):not(.assets-title)"
		}
	};
	function verifyBlurStructure() {
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
		expect(document.querySelector(`${ORDER} ${TARGETS.order.inner}`), "开仓模块内容区（.react-grid-item > .h-full）未找到");
		expect(document.querySelector(".asset-container_new > .assets-title"), "资产模块标题 .assets-title 未找到");
		expect(document.querySelector(`${ASSETS} ${TARGETS.assets.inner}`), "资产模块内容区未找到");
		return anchor;
	}
	function buildCss() {
		const SHOW = ":is(:hover, :focus-within)";
		return Object.entries(TARGETS).map(([key, { box, inner, revealOnSelf }]) => {
			const blurred = `html.tm-blur-${key} ${box} ${inner}`;
			return `
${blurred} { filter: blur(6px); transition: filter .15s; }
${revealOnSelf ? `${blurred}${SHOW}` : `html.tm-blur-${key} ${box}${SHOW} ${inner}`} { filter: none; transition: none; }`;
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
		MODULES.forEach(({ key }) => document.documentElement.classList.toggle(`tm-blur-${key}`, state[key]));
	}
	function createToggles(state) {
		const box = document.createElement("div");
		box.id = TOGGLES_ID;
		box.innerHTML = "<span>模糊</span>" + MODULES.map(({ key, label }) => `<label><input type="checkbox" data-key="${key}">${label}</label>`).join("");
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
	function initPrivacyBlur() {
		addStyle(buildCss());
		const state = loadState();
		applyState(state);
		onCleanup(() => MODULES.forEach(({ key }) => document.documentElement.classList.remove(`tm-blur-${key}`)));
		onCleanup(() => document.getElementById(TOGGLES_ID)?.remove());
		every("privacyBlur", () => {
			const anchor = verifyBlurStructure();
			if (!anchor || anchor.previousElementSibling?.id === TOGGLES_ID) return;
			document.getElementById(TOGGLES_ID)?.remove();
			anchor.before(createToggles(state));
		}, 500);
	}
	var PANEL_ID = "tm-avg-preview";
	var CONTRACT_API = "https://api.gateio.ws/api/v4/futures/usdt/contracts/";
	var num = (s) => {
		const v = parseFloat(String(s ?? "").replace(/,/g, ""));
		return Number.isFinite(v) ? v : NaN;
	};
	var decimalsOf = (s) => (String(s).split(".")[1] || "").replace(/\D.*$/, "").length;
	function getContract() {
		const m = location.pathname.match(/futures\/USDT\/([A-Z0-9]+_USDT)/i);
		if (!m) return null;
		const name = m[1].toUpperCase();
		return {
			name,
			base: name.split("_")[0],
			display: name.replace("_", "")
		};
	}
	var RETRY_MS = 3e4;
	var multiplierCache = {};
	function getMultiplier(contract) {
		const c = multiplierCache[contract];
		if (typeof c === "number") return c;
		if (c && (c.loading || Date.now() - c.failedAt < RETRY_MS)) return NaN;
		multiplierCache[contract] = { loading: true };
		const fail = () => multiplierCache[contract] = { failedAt: Date.now() };
		_GM_xmlhttpRequest({
			method: "GET",
			url: CONTRACT_API + contract,
			timeout: 1e4,
			onload: (r) => {
				const v = (() => {
					try {
						return num(JSON.parse(r.responseText).quanto_multiplier);
					} catch (e) {
						return NaN;
					}
				})();
				if (v > 0) multiplierCache[contract] = v;
				else fail();
			},
			onerror: fail,
			ontimeout: fail
		});
		return NaN;
	}
	var isSupportedUnit = (unit, ctx) => !unit || unit === ctx.base || unit === "张";
	function toCoin(qty, unit, ctx) {
		if (!unit || unit === ctx.base) return qty;
		if (unit === "张") return qty * getMultiplier(ctx.name);
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
		if (!(base.price > 0)) return base;
		const raw = qtyInput.value.trim();
		if (raw.endsWith("%")) {
			if (!(num(raw) > 0)) return base;
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
	var sideOf = (texts) => texts.includes("多") ? "long" : texts.includes("空") ? "short" : null;
	function readPositions(ctx) {
		const result = {
			long: null,
			short: null
		};
		const add = (where, name, side, sizeText, entryText) => {
			const entry = num(entryText);
			const size = Math.abs(num(sizeText));
			expect(name, `${where}中合约名未找到`);
			expect(side, `${where}中多/空方向未找到`);
			expect(entry > 0, `${where}中开仓均价无法解析：“${entryText}”`);
			expect(size > 0, `${where}中数量无法解析：“${sizeText}”`);
			if (name !== ctx.display) return;
			const unit = (sizeText.match(/[^\d.,\s-]+$/) || [""])[0];
			result[side] = {
				entry,
				entryText,
				size: isSupportedUnit(unit, ctx) ? toCoin(size, unit, ctx) : NaN
			};
		};
		document.querySelectorAll("table.position-table").forEach((table) => {
			expect(table.querySelector("th.size") && table.querySelector("th.entry_price"), "仓位列表表头“数量/开仓均价”列未找到");
			table.querySelectorAll("tbody tr").forEach((tr) => {
				if (tr.cells.length <= 1) return;
				const badges = [...tr.querySelectorAll(".mantine-Badge-label")].map((b) => b.textContent.trim());
				add("仓位列表", tr.querySelector("td span.text-b10")?.textContent.replace(/\s/g, ""), sideOf(badges), expect(tr.querySelector("td.size"), "仓位列表中数量单元格 td.size 未找到").textContent.trim(), expect(tr.querySelector("td.entry_price"), "仓位列表中开仓均价单元格 td.entry_price 未找到").textContent.trim());
			});
		});
		document.querySelectorAll("span.underline-dashed").forEach((label) => {
			if (label.textContent.trim() !== "开仓均价" || label.closest("table")) return;
			if (!label.closest(".scroll-table-bottom-box")) return;
			let card = label.parentElement;
			while (card && !/^[A-Z0-9]+USDT\n/.test(card.innerText)) card = card.parentElement;
			expect(card, "仓位卡片未找到（以合约名开头的容器）");
			const lines = card.innerText.split("\n").map((s) => s.trim());
			const qtyIdx = lines.indexOf("数量");
			expect(qtyIdx > 0, "仓位卡片中“数量”标签未找到");
			add("仓位卡片", lines[0], sideOf(lines.slice(0, qtyIdx)), lines[qtyIdx + 1] || "", lines[lines.indexOf("开仓均价") + 1] || "");
		});
		return result;
	}
	var STARTUP_TIMEOUT_MS = 2e4;
	var POLL_MS = 500;
	function isLoggedOut() {
		const dealbox = document.querySelector(".dealbox");
		return !!dealbox && [...dealbox.querySelectorAll("button")].some((b) => /^(登录|注册)$/.test(b.textContent.trim()));
	}
	function verifyStructure() {
		const ctx = expect(getContract(), "无法从地址栏解析合约名");
		readOrderForm();
		readPositions(ctx);
		verifyBlurStructure();
	}
	function startWhenReady(features) {
		const deadline = Date.now() + STARTUP_TIMEOUT_MS;
		const id = setInterval(() => {
			if (isLoggedOut()) {
				clearInterval(id);
				console.info("[Gate 合约助手] 未登录，脚本不启用");
				return;
			}
			try {
				verifyStructure();
			} catch (e) {
				if (!(e instanceof StructureError)) {
					clearInterval(id);
					return disable(`脚本异常：${e?.message || e}`);
				}
				if (Date.now() < deadline) return;
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
	}
	var getPanel = () => document.getElementById(PANEL_ID);
	function hidePanel() {
		const panel = getPanel();
		if (panel) panel.style.display = "none";
	}
	onCleanup(() => getPanel()?.remove());
	function ensurePanel(dealbox, anchor) {
		let panel = getPanel();
		if (panel && panel.parentElement === dealbox && panel.nextElementSibling === anchor) return panel;
		panel?.remove();
		panel = document.createElement("div");
		panel.id = PANEL_ID;
		panel.style.cssText = [
			"margin:8px 0 4px",
			"padding:6px 8px",
			"border-radius:6px",
			"font-size:12px",
			"line-height:20px",
			"background:var(--color-cmpt-tag-gray, rgba(128,128,128,.12))",
			"color:var(--color-text-text-secondary, #8d93a6)"
		].join(";");
		dealbox.insertBefore(panel, anchor);
		return panel;
	}
	var esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;"
	})[c]);
	var row = (left, right, title = "") => `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px" title="${esc(title)}">${left}${right}</div>`;
	function renderLine(label, color, pos, price, qty, digits) {
		const left = `<span style="color:${color};white-space:nowrap">${label}后均价</span>`;
		if (!Number.isFinite(pos.size) || !Number.isFinite(qty)) return row(left, "<span>换算中…</span>");
		const avg = (pos.entry * pos.size + price * qty) / (pos.size + qty);
		const pct = (avg - pos.entry) / pos.entry * 100;
		return row(left, `<span style="text-align:right;white-space:nowrap"><b style="color:var(--color-text-text-primary,inherit)">${avg.toFixed(digits)}</b> ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</span>`, `原均价 ${pos.entryText}`);
	}
	var renderNotice = (text) => row(`<span>${esc(text)}</span>`, "");
	var BUY_COLOR = "var(--color-function-trade-buy, #2ebd85)";
	var SELL_COLOR = "var(--color-function-trade-sell, #f6465d)";
	var lastKey = "";
	function hide() {
		hidePanel();
		lastKey = "";
	}
	function render(el, key, html) {
		if (key === lastKey && el.innerHTML) return;
		lastKey = key;
		el.innerHTML = html;
	}
	function tick() {
		const ctx = expect(getContract(), "无法从地址栏解析合约名");
		const form = readOrderForm();
		if (!form.isOpen || !(form.price > 0) || !(form.qtyLong > 0 || form.qtyShort > 0)) return hide();
		if (!isSupportedUnit(form.unit, ctx)) {
			const el = ensurePanel(form.dealbox, form.anchor);
			el.style.display = "";
			return render(el, `unit:${form.unit}`, renderNotice(`数量单位为 ${form.unit} 时不预估均价`));
		}
		const pos = readPositions(ctx);
		const qtyLong = toCoin(form.qtyLong, form.unit, ctx);
		const qtyShort = toCoin(form.qtyShort, form.unit, ctx);
		const showLong = pos.long && form.qtyLong > 0;
		const showShort = pos.short && form.qtyShort > 0;
		if (!showLong && !showShort) return hide();
		const key = JSON.stringify([
			ctx.name,
			form.price,
			qtyLong,
			qtyShort,
			pos
		]);
		const el = ensurePanel(form.dealbox, form.anchor);
		el.style.display = "";
		const digits = Math.min(Math.max(decimalsOf(form.priceStr), decimalsOf(pos.long?.entryText || ""), decimalsOf(pos.short?.entryText || "")) + 2, 10);
		const html = (showLong ? renderLine("开多", BUY_COLOR, pos.long, form.price, qtyLong, digits) : "") + (showShort ? renderLine("开空", SELL_COLOR, pos.short, form.price, qtyShort, digits) : "");
		if (key !== lastKey) console.debug("[均价预估]", {
			price: form.priceStr,
			unit: form.unit,
			qtyLong,
			qtyShort,
			pos
		});
		render(el, key, html);
	}
	function initAvgPreview() {
		every("avgPreview", tick, 300, hide);
		listen(document, "input", () => requestAnimationFrame(() => run("avgPreview", tick, hide)), true);
	}
	startWhenReady([initAvgPreview, initPrivacyBlur]);
})();
