import { TICK_MS } from '../config.js';
import { every, expect, listen, run } from '../core/guard.js';
import { getContract, isSupportedUnit, toCoin } from '../gate/contract.js';
import { readOrderForm } from '../gate/orderForm.js';
import { readPositions } from '../gate/positions.js';
import { ensurePanel, hidePanel, renderLine, renderNotice, renderPlaceholder } from '../ui/avgPanel.js';
import { decimalsOf } from '../utils/number.js';

const BUY_COLOR = 'var(--color-function-trade-buy, #2ebd85)';
const SELL_COLOR = 'var(--color-function-trade-sell, #f6465d)';

let lastKey = '';

function hide() {
  hidePanel();
  lastKey = '';
}

function render(el, key, html, visible) {
  if (key === lastKey && el.innerHTML) return;
  lastKey = key;
  el.innerHTML = html;
  // 用 visibility 而不是 display：没仓位时面板仍占位，下单按钮位置不随仓位变化跳动
  el.style.visibility = visible ? '' : 'hidden';
}

// 先完整读取并校验页面结构，全部通过后才写 DOM：
// 结构不对应时在读取阶段就抛错，保证不会基于读错的数据渲染任何东西
function tick() {
  const ctx = expect(getContract(), '无法从地址栏解析合约名');
  const form = readOrderForm();
  // 面板是否占位只由用户输入决定（开仓标签、有价格且填了数量），不受仓位数据刷新影响，
  // 这样成交/平仓导致仓位变化时，按钮不会在点击瞬间移动。
  // 没填数量时直接返回，不读仓位区，空闲时几乎没有开销
  if (!form.isOpen || !(form.price > 0) || !(form.qtyLong > 0 || form.qtyShort > 0)) return hide();

  if (!isSupportedUnit(form.unit, ctx)) {
    const el = ensurePanel(form.dealbox, form.anchor);
    el.style.display = '';
    return render(el, `unit:${form.unit}`, renderNotice(`数量单位为 ${form.unit} 时不预估均价`), true);
  }

  const pos = readPositions(ctx);
  // 百分比模式下多空数量不同，所以按方向各自换算
  const qtyLong = toCoin(form.qtyLong, form.unit, ctx);
  const qtyShort = toCoin(form.qtyShort, form.unit, ctx);
  // 只显示已有仓位那个方向：没有仓位时“开仓后均价”就是委托价本身，没有信息量
  const showLong = pos.long && form.qtyLong > 0;
  const showShort = pos.short && form.qtyShort > 0;
  const key = JSON.stringify([ctx.name, form.price, qtyLong, qtyShort, pos]);

  // 以下开始写 DOM
  const el = ensurePanel(form.dealbox, form.anchor);
  el.style.display = '';
  if (!showLong && !showShort) return render(el, key, renderPlaceholder(), false);

  // 均价多给 2 位小数，避免小额加仓时看不出变化
  const digits = Math.min(
    Math.max(decimalsOf(form.priceStr), decimalsOf(pos.long?.entryText || ''), decimalsOf(pos.short?.entryText || '')) + 2,
    10
  );
  const html =
    (showLong ? renderLine('开多', BUY_COLOR, pos.long, form.price, qtyLong, digits) : '') +
    (showShort ? renderLine('开空', SELL_COLOR, pos.short, form.price, qtyShort, digits) : '');
  if (key !== lastKey) {
    // 页面结构随 Gate 改版会变，出问题时在控制台看实际读到的值最快定位
    console.debug('[均价预估]', { price: form.priceStr, unit: form.unit, qtyLong, qtyShort, pos });
  }
  render(el, key, html, true);
}

export function initAvgPreview() {
  // 结构暂时不对应（宽限期内）时，面板回到隐藏状态，不展示可能读错的数据
  every('avgPreview', tick, TICK_MS, hide);
  // 手动输入时立即刷新，不等下一次轮询；放到下一帧再读，确保 React 已经处理完这次输入
  listen(document, 'input', () => requestAnimationFrame(() => run('avgPreview', tick, hide)), true);
}
