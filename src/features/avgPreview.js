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
  if (!form || !(form.price > 0)) return hide();

  const pos = readPositions(ctx);
  // 百分比模式下多空数量不同，所以按方向各自换算
  const qtyLong = toCoin(form.qtyLong, form.unit, form.price, ctx);
  const qtyShort = toCoin(form.qtyShort, form.unit, form.price, ctx);
  // 只显示已有仓位那个方向：没有仓位时“开仓后均价”就是委托价本身，没有信息量
  const showLong = pos.long && form.qtyLong > 0;
  const showShort = pos.short && form.qtyShort > 0;
  if (!showLong && !showShort) return hide();

  const key = JSON.stringify([ctx.name, form.price, qtyLong, qtyShort, pos]);
  const el = ensurePanel(form.dealbox, form.qtyInput);
  el.style.display = '';
  if (key === lastKey && el.innerHTML) return;
  lastKey = key;
  // 页面结构随 Gate 改版会变，出问题时在控制台看实际读到的值最快定位
  console.debug('[均价预估]', { price: form.priceStr, unit: form.unit, qtyLong, qtyShort, pos });

  // 均价多给 2 位小数，避免小额加仓时看不出变化
  const digits = Math.min(
    Math.max(decimalsOf(form.priceStr), decimalsOf(pos.long?.entryText || ''), decimalsOf(pos.short?.entryText || '')) + 2,
    10
  );
  el.innerHTML =
    (showLong ? renderLine('开多', BUY_COLOR, pos.long, form.price, qtyLong, digits) : '') +
    (showShort ? renderLine('开空', SELL_COLOR, pos.short, form.price, qtyShort, digits) : '');
}

export function initAvgPreview() {
  setInterval(tick, TICK_MS);
  // 手动输入时立即刷新，不等下一次轮询；放到下一帧再读，确保 React 已经处理完这次输入
  document.addEventListener('input', () => requestAnimationFrame(tick), true);
}
