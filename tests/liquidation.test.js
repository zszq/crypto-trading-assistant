import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateLiquidation, hedgeMaintenance, maintenanceMargin, normalizeTiers, positionPnl } from '../src/utils/liquidation.js';
import { fieldNumber, isLiquidationLabel, isMarginLabel, parseOrderRisk, parsePositionRisk, readOrderRisk } from '../src/gate/riskFields.js';
import { PANEL_ID } from '../src/config.js';

const tier = (limit, rate, deduction = 0, leverage = 100) => ({ risk_limit: String(limit), maintenance_rate: String(rate), deduction: String(deduction), leverage_max: String(leverage) });
const tiers = normalizeTiers([tier(1000000, 0.004), tier(2000000, 0.005, 1000), tier(5000000, 0.007, 5000)]);
const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);
const settings = (mode = 'cross', leverage = 10) => ({ marginMode: mode, leverageLong: leverage, leverageShort: leverage });

test('官方梯度示例：180 万仓位的维持保证金为 9100 USDT，含平仓费', () => {
  const official = normalizeTiers([tier(1000000, 0.004), tier(1500000, 0.0045, 500), tier(2000000, 0.005, 1250)]);
  near(maintenanceMargin(1800000, official, 0.00075), 9100);
  near(maintenanceMargin(1000000, official, 0.00075), 4750);
  near(maintenanceMargin(1000000 + 1e-5, official, 0.00075), 4750, 1e-6);
});

test('拒绝缺档、缺失扣除数、不连续档位和超出最大风险限额的数据', () => {
  assert.equal(normalizeTiers([]), null);
  assert.equal(normalizeTiers([tier(1000, 0.01), tier(2000, 0.02, 0)]), null);
  assert.equal(normalizeTiers([{ risk_limit: '1000', maintenance_rate: '0.01', leverage_max: '10' }]), null);
  assert.ok(Number.isNaN(maintenanceMargin(5000001, tiers, 0.00075)));
});

test('官方逐仓示例：BTC 多仓约 54587.4；加仓保留原保证金并追加初始保证金', () => {
  const entry = 60415;
  const size = 0.0131;
  const margin = 79.73722738;
  const fee = 0.00075;
  const liquidation = (entry - margin / size) / (1 - 0.004 - fee);
  near(liquidation, 54587.4, 0.1);
  const qty = 0.002;
  const price = 61000;
  const addedMargin = qty * price / 20 + qty * price * fee;
  const result = estimateLiquidation({ positions: { long: { entry, size, liquidation, marginMode: 'isolated' } }, side: 'long', price, qty,
    settings: settings('isolated', 20), market: { tiers, fee, mark: 61000 } });
  const expected = (entry * size + price * qty - margin - addedMargin) / ((size + qty) * (1 - 0.004 - fee));
  near(result.lower, expected);
  assert.equal(result.upper, null);
});

test('逐仓空仓：追加保证金包含空仓预留平仓费，不重复扣除开仓费', () => {
  const entry = 100, size = 10, margin = 100, qty = 2, price = 98, fee = 0.00075;
  const liquidation = (entry + margin / size) / (1 + 0.004 + fee);
  const result = estimateLiquidation({ positions: { short: { entry, size, liquidation, marginMode: 'isolated' } }, side: 'short', price, qty,
    settings: settings('isolated'), market: { tiers, fee, mark: 100 } });
  const addedMargin = qty * price / 10 + qty * price * fee * 1.1;
  near(result.upper, (entry * size + price * qty + margin + addedMargin) / ((size + qty) * (1 + 0.004 + fee)));
});

test('全仓：加仓不凭空增加账户保证金；当前强平价更新后预估同步变化', () => {
  const input = { positions: { long: { entry: 100, size: 10, liquidation: 80, marginMode: 'cross' } }, side: 'long', price: 100, qty: 2,
    settings: settings(), market: { tiers, fee: 0.00075, mark: 100 } };
  const margin = 10 * 100 - 10 * 80 * (1 - 0.00475);
  const result = estimateLiquidation(input);
  near(result.lower, (1200 - margin + 200 * 0.00075) / (12 * (1 - 0.00475)));
  input.positions.long.liquidation = 85;
  assert.ok(estimateLiquidation(input).lower > result.lower);
});

test('双向全仓：用官方对冲维持保证金模型，分别模拟单边订单', () => {
  const local = normalizeTiers([tier(1000000, 0.005)]);
  const positions = {
    long: { entry: 2611.55, size: 0.03, liquidation: 2212.86, marginMode: 'cross' },
    short: { entry: 2611.85, size: 0.01, liquidation: 2212.86, marginMode: 'cross' },
  };
  const fee = 0.00075;
  const market = { tiers: local, fee, mark: 2611.53 };
  near(hedgeMaintenance(positions, 2594, local, fee), 2594 * (0.03 * 0.00575 + 0.01 * 0.00075));
  const margin = hedgeMaintenance(positions, 2212.86, local, fee) - positionPnl(positions, 2212.86);
  for (const side of ['long', 'short']) {
    const result = estimateLiquidation({ positions, side, price: 2600, qty: 0.005, settings: settings(), market });
    const next = structuredClone(positions);
    next[side].entry = (next[side].entry * next[side].size + 2600 * 0.005) / (next[side].size + 0.005);
    next[side].size += 0.005;
    near(margin - 2600 * 0.005 * fee + positionPnl(next, result.lower) - hedgeMaintenance(next, result.lower, local, fee), 0);
  }
});

test('加仓跨风险档位时仍满足权益等于梯度维持保证金', () => {
  const local = normalizeTiers([tier(1000, 0.01, 0, 50), tier(5000, 0.02, 10, 25)]);
  const positions = { long: { entry: 100, size: 9, liquidation: 80, marginMode: 'cross' } };
  const market = { tiers: local, fee: 0.001, mark: 100 };
  const result = estimateLiquidation({ positions, side: 'long', price: 100, qty: 6, settings: settings(), market });
  assert.ok(result.lower * 15 > 1000);
  const margin = hedgeMaintenance(positions, 80, local, 0.001) - positionPnl(positions, 80) - 0.6;
  near(margin + 15 * (result.lower - 100) - maintenanceMargin(result.lower * 15, local, 0.001), 0);
});

test('数据缺失、混合模式、分仓强平价不一致时不给数字', () => {
  const input = { positions: { long: { entry: 100, size: 10, liquidation: 80, marginMode: 'cross' } }, side: 'long', price: 100, qty: 2,
    settings: settings(), market: { tiers, fee: 0.00075, mark: 100 } };
  assert.match(estimateLiquidation({ ...input, settings: settings('isolated') }).notice, /不一致/);
  assert.match(estimateLiquidation({ ...input, qty: NaN }).notice, /完整/);
  input.positions.short = { entry: 100, size: 5, liquidation: 120, marginMode: 'cross' };
  assert.match(estimateLiquidation(input).notice, /不一致/);
  input.positions = { long: { entry: 100, size: 10, marginMode: 'cross' } };
  assert.match(estimateLiquidation(input).notice, /缺少/);
});

test('无正值边界、杠杆缺失和加仓超档位会说明原因', () => {
  const input = { positions: { long: { entry: 100, size: 1, margin: 300, marginMode: 'isolated' } }, side: 'long', price: 100, qty: 1,
    settings: settings('isolated'), market: { tiers, fee: 0.00075, mark: 100 } };
  assert.match(estimateLiquidation(input).notice, /无强平价/);
  assert.match(estimateLiquidation({ ...input, settings: settings('isolated', NaN) }).notice, /杠杆/);
  assert.match(estimateLiquidation({ ...input, settings: settings('isolated', 200) }).notice, /档位/);
});

test('字段解析兼容中文卡片、千分位及多空两套杠杆；缺字段不猜值', () => {
  assert.deepEqual(parsePositionRisk('多 逐仓 20X', '1,234.56 USDT', '54,587.40'), {
    marginMode: 'isolated', margin: 1234.56, liquidation: 54587.4, liquidationText: '54,587.40',
  });
  assert.equal(parseOrderRisk('全仓\n20X\n10X\n开仓').leverageShort, 10);
  assert.equal(parseOrderRisk('逐仓\n25X').leverageShort, 25);
  assert.equal(parseOrderRisk('全仓\n逐仓').marginMode, null);
  assert.ok(Number.isNaN(fieldNumber('--')));
  assert.ok(Number.isNaN(fieldNumber('USDT 100')));
  assert.ok(isLiquidationLabel('预估强平价（USDT）'));
  assert.ok(isMarginLabel('保证金 (USDT)'));
  assert.equal(isMarginLabel('保证金率'), false);
});

test('切回支持的模式后，旧面板提示不会再次把预估锁为不支持', () => {
  const element = (text = '', children = [], id = '') => ({
    nodeType: 1, id, text, childNodes: children,
    style: { display: 'block', visibility: 'visible' },
    get innerText() {
      return [this.text, ...this.childNodes.filter((child) => child.style.display !== 'none').map((child) => child.innerText)].join('\n');
    },
    querySelector(selector) {
      return this.childNodes.find((child) => `#${child.id}` === selector) ||
        this.childNodes.map((child) => child.querySelector(selector)).find(Boolean) || null;
    },
  });
  const header = element('组合保证金\n20X');
  const panel = element('开多后预估强平价\n暂无法预估\n暂不支持组合或多币种保证金', [], PANEL_ID);
  const hiddenMenu = element('组合保证金\n全仓\n100X');
  hiddenMenu.style.display = 'none';
  const root = element('', [header, element('', [hiddenMenu, panel])]);
  const previousStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (node) => node.style;
  try {
    assert.ok(readOrderRisk(root).unsupported);
    header.text = '逐仓\n20X';
    assert.ok(parseOrderRisk(root.innerText).unsupported, '原来的整块读取会受旧提示影响');
    const settings = readOrderRisk(root);
    assert.equal(settings.unsupported, false);
    assert.equal(settings.marginMode, 'isolated');
    assert.equal(settings.leverageLong, 20);
    const result = estimateLiquidation({
      positions: { long: { entry: 100, size: 1, margin: 10, marginMode: 'isolated' } },
      side: 'long', price: 100, qty: 1, settings,
      market: { tiers, fee: 0.00075, mark: 100 },
    });
    assert.ok(result.lower > 0, '不清空数量即可恢复数值预估');
    header.text = '全仓\n20X';
    panel.text = '双向全仓强平数据不一致';
    assert.equal(readOrderRisk(root).marginMode, 'cross');
    header.text = '逐仓\n20X';
    assert.equal(readOrderRisk(root).marginMode, 'isolated', '旧的全仓提示不应污染逐仓模式');
  } finally {
    if (previousStyle === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = previousStyle;
  }
});
