import { TICK_MS } from '../config.js';
import { every, expect, listen, onCleanup, run } from '../core/guard.js';
import { getContract, isSupportedUnit, toCoin } from '../gate/contract.js';
import { readOrderForm } from '../gate/orderForm.js';
import { readPositions } from '../gate/positions.js';
import { readLiquidationData } from '../gate/liquidationData.js';
import { ensurePanel, hidePanel, renderPanel, renderBreakEvenLine, renderClosingBreakEvenLine, renderLine, renderLiquidationLine, renderNotice } from '../ui/avgPanel.js';
import { isPositive } from '../utils/number.js';
import { estimateLiquidation } from '../utils/liquidation.js';

const BUY_COLOR = 'var(--color-function-trade-buy, #2ebd85)';
const SELL_COLOR = 'var(--color-function-trade-sell, #f6465d)';

let lastKey = '';

function hide() {
  hidePanel();
  lastKey = '';
}

function render(el, key, html, status = '') {
  if (key === lastKey && el.lastElementChild.innerHTML) return;
  lastKey = key;
  renderPanel(el, html, status);
}

// 先完整读取并校验页面结构，全部通过后才写 DOM：
// 结构不对应时在读取阶段就抛错，保证不会基于读错的数据渲染任何东西
function tick() {
  const ctx = expect(getContract(), '无法从地址栏解析合约名');
  const form = readOrderForm();
  // 没填数量时直接返回，不读仓位区，空闲时几乎没有开销
  if (!form.isOpen || !isPositive(form.price) || !(isPositive(form.qtyLong) || isPositive(form.qtyShort))) return hide();

  if (!isSupportedUnit(form.unit, ctx)) {
    const el = ensurePanel();
    el.style.display = 'flex';
    return render(el, `unit:${form.unit}`, renderNotice(`数量单位为 ${form.unit} 时不预估均价`));
  }

  const pos = readPositions(ctx);
  // 百分比模式下多空数量不同，所以按方向各自换算
  const qtyLong = toCoin(form.qtyLong, form.unit, ctx);
  const qtyShort = toCoin(form.qtyShort, form.unit, ctx);
  // 只显示已有仓位那个方向：没有仓位时“开仓后均价”就是委托价本身，没有信息量
  const showLong = pos.long && isPositive(form.qtyLong);
  const showShort = pos.short && isPositive(form.qtyShort);
  // 没有可预估的方向时整个面板不显示，不留空白占位
  if (!showLong && !showShort) return hide();
  const risk = readLiquidationData(ctx, form);
  const preview = (side, qty) => risk.notice ? { notice: risk.notice, loading: risk.loading } : estimateLiquidation({
    positions: pos, side, price: form.price, qty, ...risk,
  });
  const liquidationLong = showLong ? preview('long', qtyLong) : null;
  const liquidationShort = showShort ? preview('short', qtyShort) : null;
  const key = JSON.stringify([ctx.name, form.price, qtyLong, qtyShort, pos, liquidationLong, liquidationShort]);

  // 以下开始写 DOM
  const el = ensurePanel();
  el.style.display = 'flex';

  const html =
    renderBreakEvenLine(pos) +
    (showLong ? renderLine('开多', BUY_COLOR, pos.long, form.price, qtyLong) +
      renderLiquidationLine('开多', BUY_COLOR, liquidationLong,
        renderClosingBreakEvenLine('开多', 'inherit', pos, 'long', form.price, qtyLong)) : '') +
    (showShort ? renderLine('开空', SELL_COLOR, pos.short, form.price, qtyShort) +
      renderLiquidationLine('开空', SELL_COLOR, liquidationShort,
        renderClosingBreakEvenLine('开空', 'inherit', pos, 'short', form.price, qtyShort)) : '');
  if (key !== lastKey) {
    // 页面结构随 Gate 改版会变，出问题时在控制台看实际读到的值最快定位
    console.debug('[均价预估]', { price: form.priceStr, unit: form.unit, qtyLong, qtyShort, pos });
  }
  render(el, key, html, risk.loading ? risk.notice : '');
}

export function initAvgPreview() {
  // 结构暂时不对应（宽限期内）时，面板回到隐藏状态，不展示可能读错的数据
  every('avgPreview', tick, TICK_MS, hide);
  // 手动输入时立即刷新，不等下一次轮询；放到下一帧再读，确保 React 已经处理完这次输入
  let frame;
  listen(document, 'input', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => run('avgPreview', tick, hide));
  }, true);
  onCleanup(() => cancelAnimationFrame(frame));
}
