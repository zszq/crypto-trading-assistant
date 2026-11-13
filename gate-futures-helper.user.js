// ==UserScript==
// @name         Gate 合约助手
// @namespace    http://tampermonkey.net/
// @version      1.7.0
// @author       zl
// @description  Gate USDT 永续合约：登录后预估加仓均价与强平价，支持模块隐私模糊
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
${blurred} { opacity: 0; transition: opacity .15s; }
${revealOnSelf ? `${blurred}${SHOW}` : `html.tm-blur-${key} ${box}${SHOW} ${inner}`} {
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
			return details?.name === ctx.name && multiplier > 0 ? qty * multiplier : NaN;
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
		const leverages = [...String(text).matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:[xX×]|倍)(?=$|[^a-zA-Z])/g)].map((m) => Number(m[1]));
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
			const size = Math.abs(num(sizeText));
			expect(name, `${where}中合约名未找到`);
			expect(side, `${where}中多/空方向未找到`);
			expect(entry > 0, `${where}中开仓均价无法解析：“${entryText}”`);
			expect(size > 0, `${where}中数量无法解析：“${sizeText}”`);
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
	var STARTUP_TIMEOUT_MS = 2e4;
	var POLL_MS = 500;
	function verifyStructure() {
		const ctx = expect(getContract(), "无法从地址栏解析合约名");
		readOrderForm();
		readPositions(ctx);
		verifyBlurStructure();
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
			limit: Number.parseFloat(tier.risk_limit),
			rate: Number.parseFloat(tier.maintenance_rate),
			deduction: Number.parseFloat(tier.deduction),
			leverageMax: Number.parseFloat(tier.leverage_max)
		})).sort((a, b) => a.limit - b.limit);
		let previous = {
			limit: 0,
			rate: 0,
			deduction: 0
		};
		for (const tier of tiers) {
			if (!Object.values(tier).every(Number.isFinite) || !(tier.limit > previous.limit && tier.rate >= previous.rate && tier.rate < 1 && tier.deduction >= 0 && tier.leverageMax >= 1)) return null;
			const deduction = previous.deduction + previous.limit * (tier.rate - previous.rate);
			if (Math.abs(tier.deduction - deduction) > Math.max(.01, deduction * 1e-8)) return null;
			previous = tier;
		}
		return tiers;
	}
	function maintenanceMargin(value, tiers, fee) {
		const tier = tiers.find((item) => value <= item.limit * (1 + 1e-12));
		if (!tier || !(value >= 0)) return NaN;
		return Math.max(0, value * tier.rate - tier.deduction) + value * fee;
	}
	function positionPnl(positions, price) {
		return (positions.long ? positions.long.size * (price - positions.long.entry) : 0) + (positions.short ? positions.short.size * (positions.short.entry - price) : 0);
	}
	function hedgeMaintenance(positions, price, tiers, fee) {
		const long = positions.long?.size || 0;
		const short = positions.short?.size || 0;
		return Math.max(maintenanceMargin(long * price, tiers, fee), maintenanceMargin(short * price, tiers, fee)) + Math.min(long, short) * price * fee;
	}
	function findBoundaries(positions, margin, market) {
		const { tiers, fee, mark } = market;
		const maxPrice = tiers[tiers.length - 1].limit / Math.max(positions.long?.size || 0, positions.short?.size || 0);
		const balance = (price) => margin + positionPnl(positions, price) - hedgeMaintenance(positions, price, tiers, fee);
		if (!(maxPrice >= mark)) return { notice: "仓位超出风险档位范围" };
		if (!(balance(mark) > 0)) return { notice: "当前标记价已触及强平条件" };
		const bisect = (a, b) => {
			const positiveAtA = balance(a) > 0;
			for (let i = 0; i < 64; i++) {
				const mid = (a + b) / 2;
				if (balance(mid) > 0 === positiveAtA) a = mid;
				else b = mid;
			}
			return (a + b) / 2;
		};
		const lower = balance(0) < 0 ? bisect(0, mark) : null;
		const upper = balance(maxPrice) <= 0 ? bisect(mark, maxPrice) : null;
		return lower || upper ? {
			lower,
			upper
		} : { notice: "风险档位内无强平价" };
	}
	var validPosition = (pos) => pos && Number.isFinite(pos.entry) && pos.entry > 0 && Number.isFinite(pos.size) && pos.size > 0;
	var notice = (text) => ({ notice: text });
	function estimateLiquidation({ positions, side, price, qty, settings, market }) {
		const pos = positions[side];
		if (!market || !validPosition(pos) || !Number.isFinite(qty) || !(qty > 0) || !Number.isFinite(price) || !(price > 0)) return notice("等待完整价格和数量");
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
			if (!(a > 0 && b > 0) || Math.abs(a - b) > Math.max(a, b) * 1e-5) return notice("双向全仓强平数据不一致");
		}
		let margin;
		if (pos.liquidation > 0 && Number.isFinite(pos.liquidation)) margin = hedgeMaintenance(current, pos.liquidation, market.tiers, market.fee) - positionPnl(current, pos.liquidation);
		else if (isolated && Number.isFinite(pos.margin) && pos.margin >= 0) margin = pos.margin;
		else return notice("缺少当前强平价或逐仓保证金");
		if (!Number.isFinite(margin)) return notice("当前强平价超出风险档位范围");
		const notional = qty * price;
		let explanation;
		if (isolated) {
			const leverage = side === "long" ? settings.leverageLong : settings.leverageShort;
			if (!(Number.isFinite(leverage) && leverage >= 1)) return notice("未读取到当前杠杆");
			const tier = market.tiers.find((item) => (pos.size + qty) * Math.max(price, market.mark) <= item.limit);
			if (!tier || leverage > tier.leverageMax * (1 + 1e-8)) return notice("加仓规模超过当前杠杆档位");
			const closeReserve = notional * market.fee * (side === "short" ? 1 + 1 / leverage : 1);
			margin += notional / leverage + closeReserve;
			explanation = "逐仓：保留原仓保证金，按当前杠杆追加初始保证金及预留平仓费。";
		} else {
			margin -= notional * market.fee;
			explanation = "全仓：由当前强平价反推有效保证金，保持其他仓位当前盈亏和维持保证金不变，扣除新开仓费。";
		}
		return {
			...findBoundaries({
				...current,
				[side]: {
					size: pos.size + qty,
					entry: (pos.size * pos.entry + notional) / (pos.size + qty)
				}
			}, margin, market),
			explanation: `${explanation}假设本次按委托价全部成交，仅模拟当前方向的一笔加仓。按公开 Taker 费率 ${(market.fee * 100).toFixed(4)}% 近似，实际费率、成交、资金费及页面价格舍入可能造成差异。`
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
		const fee = Number.parseFloat(contract.taker_fee_rate);
		const mark = Number.parseFloat(contract.mark_price);
		if (contract.name !== ctx.name || contract.type !== "direct" || !Number.isFinite(mark) || !(mark > 0) || !(fee >= 0 && fee < .1) || !normalized) return {
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
		if (!long || !short) return { price: (long || short).entry };
		if (![long.size, short.size].every((size) => Number.isFinite(size) && size > 0)) return { notice: "换算中…" };
		const netSize = long.size - short.size;
		const netCost = long.size * long.entry - short.size * short.entry;
		if (Math.abs(netSize) <= Math.max(long.size, short.size) * Number.EPSILON * 4) {
			const entryTolerance = Math.max(long.entry, short.entry) * Number.EPSILON * 4;
			if (Math.abs(long.entry - short.entry) <= entryTolerance) return { notice: "任意价格均平衡" };
			return { notice: short.entry > long.entry ? "无平衡价（锁盈）" : "无平衡价（锁亏）" };
		}
		const price = netCost / netSize;
		return Number.isFinite(price) && price > 0 ? { price } : { notice: "无正数平衡价" };
	}
	function estimateBreakEven({ positions, side, price, qty }) {
		const pos = positions[side];
		if (!pos || !Number.isFinite(price) || !(price > 0) || !Number.isFinite(pos.entry) || !(pos.entry > 0)) return { notice: "等待完整价格和数量" };
		if (![pos.size, qty].every((size) => Number.isFinite(size) && size > 0)) return { notice: "换算中…" };
		const size = pos.size + qty;
		const entry = (pos.size * pos.entry + qty * price) / size;
		if (!Number.isFinite(size) || !Number.isFinite(entry)) return { notice: "暂无法预估" };
		return calculateBreakEven({
			...positions,
			[side]: {
				size,
				entry
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
			"top:0px",
			"right:300px",
			"z-index:2147483646",
			"width:320px",
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
	function renderBreakEvenResult(label, color, result, digits, title) {
		const value = result.notice || result.price.toFixed(digits);
		return row(`<span style="color:${color};white-space:nowrap">${label}</span>`, `<span style="text-align:right;white-space:nowrap"><b style="color:var(--color-text-text-primary,inherit)">${esc(value)}</b></span>`, title);
	}
	function renderBreakEvenLine(positions, digits) {
		return renderBreakEvenResult("盈亏平衡价", "inherit", calculateBreakEven(positions), digits, "当前持仓合计未实现盈亏为零的价格，不含本次委托、手续费和资金费；等量多空持仓的合计盈亏不随价格变化");
	}
	function renderClosingBreakEvenLine(label, color, positions, side, price, qty, digits) {
		return renderBreakEvenResult(`${label}后盈亏平衡价`, color, estimateBreakEven({
			positions,
			side,
			price,
			qty
		}), digits, `假设本次${label}按委托价全部成交后，多空持仓以同一价格全部平仓时合计盈亏为零的价格，不含手续费和资金费；仅模拟当前方向的一笔加仓`);
	}
	function renderLine(label, color, pos, price, qty, digits) {
		const left = `<span style="color:${color};white-space:nowrap">${label}后均价</span>`;
		if (!Number.isFinite(pos.size) || !Number.isFinite(qty)) return row(left, "<span>换算中…</span>");
		return row(left, `<span style="text-align:right;white-space:nowrap"><b style="color:var(--color-text-text-primary,inherit)">${((pos.entry * pos.size + price * qty) / (pos.size + qty)).toFixed(digits)}</b></span>`, `原均价 ${pos.entryText}`);
	}
	function renderLiquidationLine(label, color, result, digits, followingLine = "") {
		const left = `<span style="color:${color};white-space:nowrap">${label}后预估强平价</span>`;
		const values = [result.lower, result.upper].filter((value) => Number.isFinite(value) && value > 0);
		const value = values.length === 2 ? `↓ ${values[0].toFixed(digits)} / ↑ ${values[1].toFixed(digits)}` : values.length ? `≈ ${values[0].toFixed(digits)}` : result.loading ? "—" : "暂无法预估";
		const notice = result.loading ? "" : result.notice;
		const title = [notice, result.explanation].filter(Boolean).join("；");
		return row(left, `<span style="text-align:right">${esc(value)}</span>`, title) + followingLine + (notice ? row(`<span style="font-size:11px">${esc(notice)}</span>`, "") : "");
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
	function tick() {
		const ctx = expect(getContract(), "无法从地址栏解析合约名");
		const form = readOrderForm();
		if (!form.isOpen || !(form.price > 0) || !(form.qtyLong > 0 || form.qtyShort > 0)) return hide();
		if (!isSupportedUnit(form.unit, ctx)) {
			const el = ensurePanel();
			el.style.display = "flex";
			return render(el, `unit:${form.unit}`, renderNotice(`数量单位为 ${form.unit} 时不预估均价`));
		}
		const pos = readPositions(ctx);
		const qtyLong = toCoin(form.qtyLong, form.unit, ctx);
		const qtyShort = toCoin(form.qtyShort, form.unit, ctx);
		const showLong = pos.long && form.qtyLong > 0;
		const showShort = pos.short && form.qtyShort > 0;
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
		const digits = Math.min(Math.max(decimalsOf(form.priceStr), decimalsOf(pos.long?.entryText || ""), decimalsOf(pos.short?.entryText || "")) + 2, 10);
		const html = renderBreakEvenLine(pos, digits) + (showLong ? renderLine("开多", BUY_COLOR, pos.long, form.price, qtyLong, digits) + renderLiquidationLine("开多", BUY_COLOR, liquidationLong, digits, renderClosingBreakEvenLine("开多", BUY_COLOR, pos, "long", form.price, qtyLong, digits)) : "") + (showShort ? renderLine("开空", SELL_COLOR, pos.short, form.price, qtyShort, digits) + renderLiquidationLine("开空", SELL_COLOR, liquidationShort, digits, renderClosingBreakEvenLine("开空", SELL_COLOR, pos, "short", form.price, qtyShort, digits)) : "");
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
		every("avgPreview", tick, 300, hide);
		let frame;
		listen(document, "input", () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => run("avgPreview", tick, hide));
		}, true);
		onCleanup(() => cancelAnimationFrame(frame));
	}
	startWhenReady([initAvgPreview, initPrivacyBlur]);
})();
