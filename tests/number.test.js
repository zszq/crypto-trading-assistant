import test from 'node:test';
import assert from 'node:assert/strict';
import { Big, divide, formatPrice, isDecimal, num, weightedEntry } from '../src/utils/number.js';
import { calculateBreakEven, estimateBreakEven } from '../src/utils/breakEven.js';
import { estimateLiquidation, normalizeTiers } from '../src/utils/liquidation.js';
import { renderBreakEvenLine, renderClosingBreakEvenLine, renderLine, renderLiquidationLine } from '../src/ui/avgPanel.js';

test('价格按有效小数截断，覆盖 5/6/7 个前导零、整数、负数及科学计数法', () => {
  for (const [input, expected] of [
    ['1.23456789', '1.234567'], ['123456789.12345699', '123456789.123456'],
    ['0.12345699', '0.123456'], ['0.00000123456789', '0.00000123456'],
    ['0.000000123456789', '0.0000001234'], ['0.0000000123456789', '0.0{7}1234'],
    ['0.000000008432156', '0.0{8}8432'], ['0.000000009999999', '0.0{8}9999'],
    ['-1.23456789', '-1.234567'], ['-0.000000008432156', '-0.0{8}8432'],
    ['1.0000000123456', '1.0{7}1234'], ['8.432156e-9', '0.0{8}8432'],
    ['0', '0'], ['-0', '0'], ['100', '100'], ['1.2300', '1.23'],
    ['0.000000001', '0.0{8}1'], [NaN, '—'], [Infinity, '—'],
  ]) assert.equal(formatPrice(input), expected, String(input));
});

test('读取和计算保留超过 Number 安全精度的大数及极小价差', () => {
  assert.equal(num('9,007,199,254,740,993.123456789 USDT').toFixed(), '9007199254740993.123456789');
  assert.equal(num('0.1').plus('0.2').toFixed(), '0.3');
  assert.equal(num('1e-30').times('0.1').toFixed(), '0.0000000000000000000000000000001');
  assert.equal(isDecimal('--'), false);
  assert.equal(isDecimal(NaN), false);
  assert.equal(isDecimal(Infinity), false);
  assert.equal(formatPrice(Infinity), '—');
  const pos = { size: num('9007199254740993'), entry: num('1.000000000000000001') };
  assert.equal(weightedEntry(pos, pos.entry, '0.1').toFixed(), pos.entry.toFixed());
  const result = calculateBreakEven({
    long: { size: num('1.000000000000000001'), entry: num('100') },
    short: { size: num('1'), entry: num('100') },
  });
  assert.equal(result.price.toFixed(), '100', '微小净仓位不能被当成等量对冲');
  assert.ok(calculateBreakEven({ long: { size: '1e400', entry: '100' }, short: { size: '1', entry: '120' } }).price.gt(0));
});

test('计算链及所有价格行无需隐式转换为 Number，格式一致且不污染原值', () => {
  const original = Big.prototype.valueOf;
  Big.prototype.valueOf = () => { throw new Error('禁止隐式数值转换'); };
  try {
    const price = num('0.000000008432156');
    const pos = { entry: price, size: num('1'), margin: num('0.000000001'), marginMode: 'isolated' };
    const positions = { long: pos };
    const entry = weightedEntry(pos, price, num('2'));
    assert.equal(entry.toFixed(), price.toFixed());
    const closing = estimateBreakEven({ positions, side: 'long', price, qty: num('2') });
    assert.equal(closing.price.toFixed(), price.toFixed());
    const tiers = normalizeTiers([{ risk_limit: '100', maintenance_rate: '0.004', deduction: '0', leverage_max: '100' }]);
    const result = estimateLiquidation({ positions, side: 'long', price, qty: num('2'),
      settings: { marginMode: 'isolated', leverageLong: num('10') }, market: { tiers, fee: num('0.00075'), mark: price } });
    assert.ok(result.lower.gt(0));
    for (const html of [
      renderLine('开多', 'green', pos, price, num('2')),
      renderBreakEvenLine(positions),
      renderClosingBreakEvenLine('开多', 'green', positions, 'long', price, num('2')),
      renderLiquidationLine('开多', 'green', { lower: price, upper: price }),
    ]) assert.ok(html.includes('0.0{8}8432'));
    assert.equal(price.toFixed(), '0.000000008432156');
  } finally {
    Big.prototype.valueOf = original;
  }
});


test('除法随数量级保留有效数字，不把极小价格截成零', () => {
  assert.equal(divide('8e-150', '2').toFixed(), num('4e-150').toFixed());
  const third = divide('1e-150', '3');
  assert.ok(third.gt(0));
  assert.ok(third.times(3).minus('1e-150').abs().lt('1e-245'));
  assert.equal(num('0.1').plus('0.2').toFixed(), '0.3');
});
