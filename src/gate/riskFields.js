import { num } from '../utils/number.js';
import { PANEL_ID } from '../config.js';

export function parseMarginMode(text) {
  const modes = [...String(text).matchAll(/全仓|逐仓|\bcross\b|\bisolated\b/gi)]
    .map(([mode]) => /全仓|cross/i.test(mode) ? 'cross' : 'isolated');
  const unique = [...new Set(modes)];
  return unique.length === 1 ? unique[0] : null;
}

// 金额和价格都必须从字段值开头读取，不能把“USDT”“调整”等文字中的数字当成资金。
export function fieldNumber(text) {
  const value = String(text ?? '').trim().replace(/,/g, '');
  return /^[+-]?\d+(?:\.\d+)?(?:\s|$|USDT)/i.test(value) ? num(value) : NaN;
}

export function parsePositionRisk(modeText, marginText, liquidationText) {
  return {
    marginMode: parseMarginMode(modeText),
    margin: fieldNumber(marginText),
    liquidation: fieldNumber(liquidationText),
    liquidationText: String(liquidationText || '').trim(),
  };
}

export const isLiquidationLabel = (text) => /^(?:预估)?强平(?:价|价格)(?:\(USDT\))?$/.test(text.replace(/\s/g, '').replace(/（/g, '(').replace(/）/g, ')'));
export const isMarginLabel = (text) => /^(?:仓位)?保证金(?:\(USDT\))?$/.test(text.replace(/\s/g, '').replace(/（/g, '(').replace(/）/g, ')'));

export function parseOrderRisk(text) {
  const leverages = [...String(text).matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:[xX×]|倍)(?=$|[^a-zA-Z])/g)].map((m) => num(m[1]));
  return {
    marginMode: parseMarginMode(text),
    leverageLong: leverages.length === 1 || leverages.length === 2 ? leverages[0] : NaN,
    leverageShort: leverages.length === 1 ? leverages[0] : leverages.length === 2 ? leverages[1] : NaN,
    unsupported: /组合保证金|多币种保证金|跨币种保证金/.test(text),
  };
}

export function readOrderRisk(root) {
  const panelSelector = `#${PANEL_ID}`;
  const read = (node) => {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1 || node.id === PANEL_ID) return '';
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return '';
    // 只拆分包含脚本面板的祖先路径，其余子树保留 innerText 的可见性和排版语义。
    // 不能直接读取整个模块，否则自身的“不支持”提示会反过来锁住模式识别。
    if (!node.querySelector(panelSelector)) return node.innerText;
    return [...node.childNodes].map(read).join('\n');
  };
  return parseOrderRisk(read(root));
}
