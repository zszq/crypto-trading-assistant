// ==UserScript==
// @name         Gate 合约助手
// @namespace    http://tampermonkey.net/
// @version      1.5.0
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
	var PANEL_ID = "tm-avg-preview";
	var CONTRACT_API = "https://api.gateio.ws/api/v4/futures/usdt/contracts/";
	var _GM_getValue = (() => typeof GM_getValue != "undefined" ? GM_getValue : void 0)();
	var _GM_setValue = (() => typeof GM_setValue != "undefined" ? GM_setValue : void 0)();
	var _GM_xmlhttpRequest = (() => typeof GM_xmlhttpRequest != "undefined" ? GM_xmlhttpRequest : void 0)();
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
		const dealbox = document.querySelector(".dealbox");
		if (!dealbox) return null;
		const qtyInput = dealbox.querySelector("input[name=\"f_order\"]");
		if (!qtyInput) return null;
		const before = [...dealbox.querySelectorAll("input")].filter((i) => i !== qtyInput && i.type !== "checkbox" && i.offsetParent && i.compareDocumentPosition(qtyInput) & Node.DOCUMENT_POSITION_FOLLOWING);
		const priceInput = before[before.length - 1];
		if (!priceInput) return {
			dealbox,
			qtyInput
		};
		const base = {
			dealbox,
			qtyInput,
			priceStr: priceInput.value,
			price: num(priceInput.value)
		};
		if (qtyInput.value.trim().endsWith("%")) {
			const hint = qtyInput.closest(".mantine-InputWrapper-root")?.querySelector(".mantine-InputWrapper-error");
			return {
				...base,
				qtyLong: num(hint?.querySelector(".font-add-color")?.textContent),
				qtyShort: num(hint?.querySelector(".font-dec-color")?.textContent),
				unit: (hint?.textContent.trim().match(/\S+$/) || [""])[0]
			};
		}
		const unitEl = qtyInput.closest("label")?.querySelector("span.truncate");
		const qty = num(qtyInput.value);
		return {
			...base,
			qtyLong: qty,
			qtyShort: qty,
			unit: unitEl ? unitEl.textContent.trim() : ""
		};
	}
	var sideOf = (texts) => texts.includes("多") ? "long" : texts.includes("空") ? "short" : null;
	function readPositions(ctx) {
		const result = {
			long: null,
			short: null
		};
		const add = (name, side, sizeText, entryText) => {
			if (name !== ctx.display || !side) return;
			const entry = num(entryText);
			const size = Math.abs(num(sizeText));
			const unit = (sizeText.match(/[^\d.,\s-]+$/) || [""])[0];
			if (!(entry > 0) || !(size > 0)) return;
			result[side] = {
				entry,
				entryText,
				size: isSupportedUnit(unit, ctx) ? toCoin(size, unit, ctx) : NaN
			};
		};
		document.querySelectorAll("table.position-table tbody tr").forEach((tr) => {
			const badges = [...tr.querySelectorAll(".mantine-Badge-label")].map((b) => b.textContent.trim());
			add(tr.querySelector("td span.text-b10")?.textContent.replace(/\s/g, ""), sideOf(badges), tr.querySelector("td.size")?.textContent.trim() || "", tr.querySelector("td.entry_price")?.textContent.trim() || "");
		});
		document.querySelectorAll("span.underline-dashed").forEach((label) => {
			if (label.textContent.trim() !== "开仓均价" || label.closest("table")) return;
			let card = label.parentElement;
			while (card && !/^[A-Z0-9]+USDT\n/.test(card.innerText)) card = card.parentElement;
			if (!card) return;
			const lines = card.innerText.split("\n").map((s) => s.trim());
			const after = (key) => lines[lines.indexOf(key) + 1] || "";
			add(lines[0], sideOf(lines.slice(0, lines.indexOf("数量"))), after("数量"), after("开仓均价"));
		});
		return result;
	}
	var getPanel = () => document.getElementById(PANEL_ID);
	function hidePanel() {
		const panel = getPanel();
		if (panel) panel.style.display = "none";
	}
	function ensurePanel(dealbox, qtyInput) {
		let panel = getPanel();
		if (panel && dealbox.contains(panel)) return panel;
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
		const anchor = [...dealbox.children].find((el) => /^可用/.test(el.textContent.trim()));
		if (anchor) dealbox.insertBefore(panel, anchor);
		else qtyInput.closest(".dealbox > *")?.after(panel);
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
	var renderPlaceholder = () => row("<span>&nbsp;</span>", "");
	var BUY_COLOR = "var(--color-function-trade-buy, #2ebd85)";
	var SELL_COLOR = "var(--color-function-trade-sell, #f6465d)";
	var lastKey = "";
	function hide() {
		hidePanel();
		lastKey = "";
	}
	function render(el, key, html, visible) {
		if (key === lastKey && el.innerHTML) return;
		lastKey = key;
		el.innerHTML = html;
		el.style.visibility = visible ? "" : "hidden";
	}
	function tick() {
		const ctx = getContract();
		const form = ctx && readOrderForm();
		if (!form || !(form.price > 0) || !(form.qtyLong > 0 || form.qtyShort > 0)) return hide();
		const el = ensurePanel(form.dealbox, form.qtyInput);
		el.style.display = "";
		if (!isSupportedUnit(form.unit, ctx)) return render(el, `unit:${form.unit}`, renderNotice(`数量单位为 ${form.unit} 时不预估均价`), true);
		const pos = readPositions(ctx);
		const qtyLong = toCoin(form.qtyLong, form.unit, ctx);
		const qtyShort = toCoin(form.qtyShort, form.unit, ctx);
		const showLong = pos.long && form.qtyLong > 0;
		const showShort = pos.short && form.qtyShort > 0;
		const key = JSON.stringify([
			ctx.name,
			form.price,
			qtyLong,
			qtyShort,
			pos
		]);
		if (!showLong && !showShort) return render(el, key, renderPlaceholder(), false);
		const digits = Math.min(Math.max(decimalsOf(form.priceStr), decimalsOf(pos.long?.entryText || ""), decimalsOf(pos.short?.entryText || "")) + 2, 10);
		const html = (showLong ? renderLine("开多", BUY_COLOR, pos.long, form.price, qtyLong, digits) : "") + (showShort ? renderLine("开空", SELL_COLOR, pos.short, form.price, qtyShort, digits) : "");
		if (key !== lastKey) console.debug("[均价预估]", {
			price: form.priceStr,
			unit: form.unit,
			qtyLong,
			qtyShort,
			pos
		});
		render(el, key, html, true);
	}
	var lastError = "";
	function safeTick() {
		try {
			tick();
		} catch (e) {
			if (String(e) !== lastError) {
				lastError = String(e);
				console.warn("[均价预估] 出错，已隐藏面板", e);
			}
			try {
				hide();
			} catch (_) {}
		}
	}
	function initAvgPreview() {
		setInterval(safeTick, 300);
		document.addEventListener("input", () => requestAnimationFrame(safeTick), true);
	}
	function initModalFix() {
		document.addEventListener("click", (e) => {
			if (!e.target.closest("button[label=\"市价\"]")) return;
			const checkModal = setInterval(() => {
				const modal = document.querySelector(".mantine-GateModal-inner");
				if (modal) {
					modal.style.justifyContent = "unset";
					clearInterval(checkModal);
				}
			}, 100);
			setTimeout(() => clearInterval(checkModal), 5e3);
		});
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
	var TARGETS = {
		order: {
			box: ".react-grid-item:has(.dealbox)",
			inner: "> .h-full > *"
		},
		positions: {
			box: `.react-grid-item:has(#${TOGGLES_ID})`,
			inner: `.scroll-table-bottom-box > :last-child:not(:has(#${TOGGLES_ID}))`,
			revealOnSelf: true
		},
		assets: {
			box: ".react-grid-item:has(.asset-container_new)",
			inner: ".asset-container_new > :not(.rgl-drag-zone):not(.assets-title)"
		}
	};
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
	function findAnchor() {
		return [...document.querySelectorAll(".mantine-Checkbox-label span")].find((s) => s.textContent.trim() === "仅显示当前市场")?.closest(".mantine-Checkbox-root");
	}
	function initPrivacyBlur() {
		const style = document.createElement("style");
		style.textContent = buildCss();
		(document.head || document.documentElement).appendChild(style);
		const state = loadState();
		applyState(state);
		setInterval(() => {
			try {
				const anchor = findAnchor();
				if (!anchor || anchor.previousElementSibling?.id === TOGGLES_ID) return;
				document.getElementById(TOGGLES_ID)?.remove();
				anchor.before(createToggles(state));
			} catch (e) {}
		}, 500);
	}
	initAvgPreview();
	initModalFix();
	initPrivacyBlur();
})();
