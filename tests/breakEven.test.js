import { num } from '../src/utils/number.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBreakEven, estimateBreakEven } from '../src/utils/breakEven.js';
import { positionPnl } from '../src/utils/liquidation.js';
import { renderBreakEvenLine, renderClosingBreakEvenLine, renderLiquidationLine } from '../src/ui/avgPanel.js';

const position = (size, entry) => ({ size, entry });

test('单向持仓直接取开仓均价，不依赖数量换算', () => {
  assert.deepEqual(calculateBreakEven({ long: position(NaN, 100), short: null }), { price: num(100) });
  assert.deepEqual(calculateBreakEven({ long: null, short: position(NaN, 120) }), { price: num(120) });
  assert.deepEqual(calculateBreakEven({ long: null, short: null }), { notice: '暂无持仓' });
});

test('双向持仓：净多和净空的平衡价都令合计盈亏为零', () => {
  for (const [long, short, expected] of [
    [position(3, 100), position(1, 120), 90],
    [position(1, 100), position(3, 120), 130],
    [position(0.3, 100), position(0.1, 120), 90],
  ]) {
    const positions = { long, short };
    const { price } = calculateBreakEven(positions);
    assert.ok(price.minus(expected).abs().lt('1e-10'));
    assert.ok(positionPnl(positions, price).abs().lt('1e-90'));
  }
});

test('等量对冲区分全价位平衡、锁盈和锁亏，并精确换算数量', () => {
  assert.deepEqual(calculateBreakEven({ long: position(1, 100), short: position(1, 100) }), { notice: '任意价格均平衡' });
  assert.deepEqual(calculateBreakEven({ long: position(1, 100), short: position(1, 120) }), { notice: '无平衡价（锁盈）' });
  assert.deepEqual(calculateBreakEven({ long: position(1, 120), short: position(1, 100) }), { notice: '无平衡价（锁亏）' });
  assert.deepEqual(calculateBreakEven({ long: position(num('0.1').plus('0.2'), 100), short: position(0.3, 120) }), { notice: '无平衡价（锁盈）' });
});

test('同价加仓形成等量对冲时，均价舍入误差不应误报锁盈或锁亏', () => {
  for (const entry of [0.1, 100.1, 1e-8]) {
    for (const side of ['long', 'short']) {
      const other = side === 'long' ? 'short' : 'long';
      const positions = { [side]: position(1, entry), [other]: position(3, entry) };
      assert.deepEqual(estimateBreakEven({ positions, side, price: entry, qty: 2 }), { notice: '任意价格均平衡' });
    }
  }
});

test('均价容差不会抹去真实的微小价差', () => {
  for (const [lower, upper] of [[0.1, 0.1000000001], [100.1, 100.1000000001], [1e-8, 1e-8 + 1e-16]]) {
    assert.deepEqual(calculateBreakEven({ long: position(3, lower), short: position(3, upper) }), { notice: '无平衡价（锁盈）' });
    assert.deepEqual(calculateBreakEven({ long: position(3, upper), short: position(3, lower) }), { notice: '无平衡价（锁亏）' });
  }
});

test('不显示无法换算、非正数的平衡价格', () => {
  for (const size of [NaN, Infinity, 0, -1]) {
    assert.deepEqual(calculateBreakEven({ long: position(size, 100), short: position(1, 120) }), { notice: '换算中…' });
  }
  for (const [long, short] of [
    [position(2, 50), position(1, 120)],
    [position(2, 60), position(1, 120)],
  ]) {
    assert.deepEqual(calculateBreakEven({ long, short }), { notice: '无正数平衡价' });
  }
});

test('盈亏平衡价行按统一规则显示，并说明当前持仓与费用口径', () => {
  const html = renderBreakEvenLine({ long: position(3, 100), short: position(1, 120) });
  assert.match(html, />当前盈亏平衡价<\/span>/);
  assert.match(html, />90<\/b>/);
  assert.match(html, /不含本次委托、手续费和资金费/);
  const pending = renderBreakEvenLine({ long: position(NaN, 100), short: position(1, 120) });
  assert.match(pending, /换算中…/);
  assert.doesNotMatch(pending, /NaN|Infinity/);
});

test('分别模拟开多和开空后平仓，原持仓与新增仓位的合计盈亏为零', () => {
  const positions = Object.freeze({ long: Object.freeze(position(3, 100)), short: Object.freeze(position(1, 120)) });
  // 两个方向使用不同数量，覆盖百分比下单的多空数量差异。
  for (const [side, qty, expected] of [['long', 1, 290 / 3], ['short', 3, 150]]) {
    const { price } = estimateBreakEven({ positions, side, price: 110, qty });
    assert.ok(price.minus(expected).abs().lt('1e-10'));
    const addedPnl = side === 'long' ? num(qty).times(price.minus(110)) : num(qty).times(num(110).minus(price));
    assert.ok(positionPnl(positions, price).plus(addedPnl).abs().lt('1e-90'));
  }
  for (const side of ['long', 'short']) {
    assert.deepEqual(estimateBreakEven({ positions: { [side]: position(2, 100) }, side, price: 130, qty: 1 }), { price: num(110) });
  }
});

test('加仓后等量对冲和数量换算中的提示延用当前持仓规则', () => {
  const positions = { long: position(1, 100), short: position(2, 120) };
  assert.deepEqual(estimateBreakEven({ positions, side: 'long', price: 140, qty: 1 }), { notice: '任意价格均平衡' });
  assert.deepEqual(estimateBreakEven({ positions, side: 'long', price: 120, qty: 1 }), { notice: '无平衡价（锁盈）' });
  assert.deepEqual(estimateBreakEven({ positions, side: 'long', price: 160, qty: 1 }), { notice: '无平衡价（锁亏）' });
  assert.deepEqual(estimateBreakEven({ positions, side: 'long', price: 120, qty: NaN }), { notice: '换算中…' });
  assert.deepEqual(estimateBreakEven({ positions: { long: position(NaN, 100) }, side: 'long', price: 120, qty: 1 }), { notice: '换算中…' });
  assert.deepEqual(estimateBreakEven({ positions, side: 'long', price: 0, qty: 1 }), { notice: '等待完整价格和数量' });
});

test('对应平仓价紧跟强平价，强平价不可用时仍显示独立计算的平仓价', () => {
  for (const [side, label] of [['long', '开多'], ['short', '开空']]) {
    const closingLine = renderClosingBreakEvenLine(label, '#123456', { [side]: position(2, 100) }, side, 130, 1);
    const html = renderLiquidationLine(label, '#123456', { notice: '行情接口暂不可用' }, closingLine);
    assert.match(closingLine, />110<\/b>/);
    assert.match(closingLine, /同一价格全部平仓/);
    assert.match(closingLine, /不含手续费和资金费/);
    const rows = html.match(/<div\b[^>]*>.*?<\/div>/g);
    assert.match(rows[0], new RegExp(`${label}后预估强平价`));
    assert.match(rows[1], new RegExp(`${label}后盈亏平衡价`));
    assert.match(rows[2], /行情接口暂不可用/);
  }
});
