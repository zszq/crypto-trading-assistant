import { TICK_MS } from '../config.js';
import { getContract, toCoin } from '../gate/contract.js';
import { readOrderForm } from '../gate/orderForm.js';
import { readPositions } from '../gate/positions.js';
import { ensurePanel, hidePanel, renderLine } from '../ui/avgPanel.js';
import { decimalsOf } from '../utils/number.js';

const BUY_COLOR = 'var(--color-function-trade-buy, #2ebd85)';
const SELL_COLOR = 'var(--color-function-trade-sell, #f6465d)';

let lastKey = '';

function hide() {
  hidePanel();
  lastKey = '';
}

function tick() {
  const ctx = getContract();
  const form = ctx && readOrderForm();
  if (!form || !(form.price > 0) || !(form.qty > 0)) return hide();

  const qty = toCoin(form.qty, form.unit, form.price, ctx);
  const pos = readPositions(ctx);
  // 没有仓位时“开仓后均价”就是委托价本身，显示出来没有信息量
  if (!pos.long && !pos.short) return hide();

  const key = JSON.stringify([ctx.name, form.price, qty, form.unit, pos]);
  const el = ensurePanel(form.dealbox, form.qtyInput);
  el.style.display = '';
  if (key === lastKey && el.innerHTML) return;
  lastKey = key;
  // 页面结构随 Gate 改版会变，出问题时在控制台看实际读到的值最快定位
  console.debug('[均价预估]', { price: form.priceStr, qty: form.qty, unit: form.unit, qtyCoin: qty, pos });

  if (!Number.isFinite(qty)) {
    el.innerHTML = `单位 ${form.unit} 暂无法换算`;
    return;
  }
  // 均价多给 2 位小数，避免小额加仓时看不出变化
  const digits = Math.min(
    Math.max(decimalsOf(form.priceStr), decimalsOf(pos.long?.entryText || ''), decimalsOf(pos.short?.entryText || '')) + 2,
    10
  );
  // 只显示已有仓位那个方向，另一方向开仓均价就是委托价，不必展示
  el.innerHTML =
    (pos.long ? renderLine('开多', BUY_COLOR, pos.long, form.price, qty, digits) : '') +
    (pos.short ? renderLine('开空', SELL_COLOR, pos.short, form.price, qty, digits) : '');
}

export function initAvgPreview() {
  setInterval(tick, TICK_MS);
  // 手动输入时立即刷新，不等下一次轮询；放到下一帧再读，确保 React 已经处理完这次输入
  document.addEventListener('input', () => requestAnimationFrame(tick), true);
}
