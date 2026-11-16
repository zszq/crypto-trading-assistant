import { expect, PendingError } from '../core/guard.js';
import { refreshOnPageChange } from '../core/refresh.js';
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
let lastState = '';

function setState(reason) {
  if (reason === lastState) return;
  lastState = reason;
  console.debug('[均价预估] 状态：', reason);
}

function hide(reason) {
  hidePanel();
  lastKey = '';
  setState(reason);
}

function render(el, key, html, status = '') {
  const cacheKey = JSON.stringify([key, status]);
  if (cacheKey === lastKey && el.lastElementChild.innerHTML) return;
  renderPanel(el, html, status);
  lastKey = cacheKey;
}

function notice(text) {
  const el = ensurePanel();
  el.style.display = 'flex';
  render(el, `notice:${text}`, renderNotice(text));
  setState(text);
}

function onFail(error) {
  if (error instanceof PendingError) return notice(error.message);
  // 结构错误可能带有原始字段值，状态日志只记录类别，避免输出账户数据。
  hide(error ? '页面结构暂时不对应' : '等待确认登录状态');
}

// 先完整读取并校验页面结构，全部通过后才写 DOM：
// 结构不对应时在读取阶段就抛错，保证不会基于读错的数据渲染任何东西
function tick() {
  const ctx = expect(getContract(), '无法从地址栏解析合约名');
  const form = readOrderForm();
  // 没填数量时直接返回，不读仓位区，空闲时几乎没有开销
  if (!form.isOpen) return hide('当前为平仓模式');
  if (!isPositive(form.price) || !(isPositive(form.qtyLong) || isPositive(form.qtyShort))) return hide('未填写有效委托价格或数量');

  if (!isSupportedUnit(form.unit, ctx)) {
    return notice(`数量单位为 ${form.unit} 时不预估均价`);
  }

  const pos = readPositions(ctx);
  if (pos.status === 'unavailable') return notice(pos.notice);
  // 百分比模式下多空数量不同，所以按方向各自换算
  const qtyLong = toCoin(form.qtyLong, form.unit, ctx);
  const qtyShort = toCoin(form.qtyShort, form.unit, ctx);
  // 只显示已有仓位那个方向：没有仓位时“开仓后均价”就是委托价本身，没有信息量
  const showLong = pos.long && isPositive(form.qtyLong);
  const showShort = pos.short && isPositive(form.qtyShort);
  // 没有可预估的方向时整个面板不显示，不留空白占位
  if (!showLong && !showShort) return hide('当前合约没有可预估的持仓方向');
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
  render(el, key, html, risk.loading ? risk.notice : '');
  setState('预估已显示');
}

export function initAvgPreview() {
  refreshOnPageChange('avgPreview', tick, {
    selector: '.react-grid-item:has(.dealbox), .scroll-table-bottom-box, .asset-container_new',
    events: ['input', 'change', 'click', 'pointerup'],
    onFail,
  });
}
