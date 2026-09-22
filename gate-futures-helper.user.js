// ==UserScript==
// @name         Gate 合约助手
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @author       zl
// @description  Gate USDT 永续合约：限价下单时预估开仓后的持仓均价
// @match        https://www.gate.com/*futures/USDT/*
// @match        https://www.gate.io/*futures/USDT/*
// @connect      api.gateio.ws
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
	"use strict";
	var PANEL_ID = "tm-avg-preview";
	var CONTRACT_API = "https://api.gateio.ws/api/v4/futures/usdt/contracts/";
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
	var multiplierCache = {};
	function getMultiplier(contract) {
		const c = multiplierCache[contract];
		if (c !== void 0) return c === "loading" ? NaN : c;
		multiplierCache[contract] = "loading";
		_GM_xmlhttpRequest({
			method: "GET",
			url: CONTRACT_API + contract,
			onload: (r) => {
				try {
					multiplierCache[contract] = num(JSON.parse(r.responseText).quanto_multiplier);
				} catch (e) {
					delete multiplierCache[contract];
				}
			},
			onerror: () => delete multiplierCache[contract]
		});
		return NaN;
	}
	function toCoin(qty, unit, price, ctx) {
		if (!unit || unit === ctx.base) return qty;
		if (unit === "张") return qty * getMultiplier(ctx.name);
		if (unit === "USDT") return price > 0 ? qty / price : NaN;
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
		const unitEl = qtyInput.closest("label")?.querySelector("span.truncate");
		return {
			dealbox,
			qtyInput,
			priceStr: priceInput.value,
			price: num(priceInput.value),
			qty: num(qtyInput.value),
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
				size: toCoin(size, unit, entry, ctx)
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
		const anchor = [...dealbox.children].find((el) => /^可用/.test(el.innerText.trim()));
		if (anchor) dealbox.insertBefore(panel, anchor);
		else qtyInput.closest(".dealbox > *")?.after(panel);
		return panel;
	}
	function renderLine(label, color, pos, price, qty, digits) {
		let value;
		let diff = "";
		let title = "";
		if (!Number.isFinite(pos.size)) value = "换算中…";
		else {
			const avg = (pos.entry * pos.size + price * qty) / (pos.size + qty);
			const pct = (avg - pos.entry) / pos.entry * 100;
			value = avg.toFixed(digits);
			diff = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
			title = `原均价 ${pos.entryText}`;
		}
		return `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px" title="${title}">
    <span style="color:${color};white-space:nowrap">${label}后均价</span>
    <span style="text-align:right;white-space:nowrap"><b style="color:var(--color-text-text-primary,inherit)">${value}</b> ${diff}</span>
  </div>`;
	}
	var BUY_COLOR = "var(--color-function-trade-buy, #2ebd85)";
	var SELL_COLOR = "var(--color-function-trade-sell, #f6465d)";
	var lastKey = "";
	function hide() {
		hidePanel();
		lastKey = "";
	}
	function tick() {
		const ctx = getContract();
		const form = ctx && readOrderForm();
		if (!form || !(form.price > 0) || !(form.qty > 0)) return hide();
		const qty = toCoin(form.qty, form.unit, form.price, ctx);
		const pos = readPositions(ctx);
		if (!pos.long && !pos.short) return hide();
		const key = JSON.stringify([
			ctx.name,
			form.price,
			qty,
			form.unit,
			pos
		]);
		const el = ensurePanel(form.dealbox, form.qtyInput);
		el.style.display = "";
		if (key === lastKey && el.innerHTML) return;
		lastKey = key;
		console.debug("[均价预估]", {
			price: form.priceStr,
			qty: form.qty,
			unit: form.unit,
			qtyCoin: qty,
			pos
		});
		if (!Number.isFinite(qty)) {
			el.innerHTML = `单位 ${form.unit} 暂无法换算`;
			return;
		}
		const digits = Math.min(Math.max(decimalsOf(form.priceStr), decimalsOf(pos.long?.entryText || ""), decimalsOf(pos.short?.entryText || "")) + 2, 10);
		el.innerHTML = (pos.long ? renderLine("开多", BUY_COLOR, pos.long, form.price, qty, digits) : "") + (pos.short ? renderLine("开空", SELL_COLOR, pos.short, form.price, qty, digits) : "");
	}
	function initAvgPreview() {
		setInterval(tick, 300);
		document.addEventListener("input", () => requestAnimationFrame(tick), true);
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
	initAvgPreview();
	initModalFix();
})();
