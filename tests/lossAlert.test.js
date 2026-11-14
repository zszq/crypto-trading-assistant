import test from 'node:test';
import assert from 'node:assert/strict';
import { readUnrealizedPnl } from '../src/gate/unrealizedPnl.js';
import { initLossAlert } from '../src/features/lossAlert.js';
import { isDisabled, stopSilently, StructureError } from '../src/core/guard.js';

function page() {
  const state = { amount: '0.00 USDT', loggedIn: true, labelCount: 1, valueCount: 1 };
  const nodes = new Map();
  const control = { textContent: '开多', getClientRects: () => [{}] };
  const box = { querySelectorAll: () => [{ ...control, textContent: state.loggedIn ? '开多' : '登录' }] };
  const label = {
    textContent: '未实现盈亏',
    parentElement: {
      querySelectorAll(selector) {
        assert.equal(selector, '.order-right-trans-container');
        return Array.from({ length: state.valueCount }, () => ({ textContent: state.amount }));
      },
    },
  };
  const document = {
    querySelector(selector) {
      assert.equal(selector, '.dealbox');
      return box;
    },
    querySelectorAll(selector) {
      if (selector === 'a[href*="/login"], a[href*="/signin"]') return [];
      assert.equal(selector, '.asset-container_new span.underline-dotted', '只读取资产汇总，不能累计可被过滤的仓位行');
      return Array(state.labelCount).fill(label);
    },
    getElementById: (id) => nodes.get(id),
    createElement: () => ({
      style: {},
      setAttribute(name, value) { this[name] = value; },
      appendChild(child) { this.textContent = (this.textContent || '') + child.textContent; },
      remove() { nodes.delete(this.id); },
    }),
    documentElement: { appendChild: (node) => nodes.set(node.id, node) },
  };
  return { state, nodes, document };
}

test('汇总盈亏：解析正负、零、千分位及 Unicode 负号，保留小数精度', () => {
  const { state, document } = page();
  globalThis.document = document;
  const examples = [
    ['0.00 USDT', '0'],
    ['+123.45 USDT', '123.45'],
    ['-1,234.56 USDT', '-1234.56'],
    [' −100.000000000000000001\u00a0USDT ', '-100.000000000000000001'],
  ];
  for (const [text, expected] of examples) {
    state.amount = text;
    assert.equal(readUnrealizedPnl().toFixed(), expected);
  }
});

test('汇总盈亏：缺失、重复、占位、错币种及附带百分比不能当成正常金额', () => {
  const { state, document } = page();
  globalThis.document = document;
  for (const amount of ['', '-- USDT', 'NaN USDT', '-200 BTC', '-200 USDT (-20%)', '-1,00 USDT', '≈ -200 USDT']) {
    state.amount = amount;
    assert.throws(readUnrealizedPnl, StructureError, amount);
  }
  state.amount = '-200 USDT';
  for (const key of ['labelCount', 'valueCount']) {
    for (const count of [0, 2]) {
      state[key] = count;
      assert.throws(readUnrealizedPnl, StructureError, `${key} = ${count}`);
    }
    state[key] = 1;
  }
});

test('亏损提醒：严格大于 100、恢复后移除、无重复横幅，异常恢复和退出登录均清理', () => {
  const { state, nodes, document } = page();
  globalThis.document = document;
  globalThis.getComputedStyle = () => ({ visibility: 'visible' });
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const timers = new Map();
  let nextId = 0;
  globalThis.setInterval = (fn, ms) => {
    assert.equal(ms, 300);
    timers.set(++nextId, fn);
    return nextId;
  };
  globalThis.clearInterval = (id) => timers.delete(id);
  const refresh = (amount) => {
    state.amount = amount;
    for (const tick of [...timers.values()]) tick();
  };
  try {
    // 启动时已经超限也必须立即提醒，不依赖下单区输入。
    state.amount = '-100.01 USDT';
    initLossAlert();
    const banner = nodes.get('tm-gate-loss-alert');
    assert.ok(banner);
    assert.equal(banner.role, 'alert');
    assert.match(banner.textContent, /超过 100 USDT/);
    assert.doesNotMatch(banner.textContent, /100\.01/, '提醒不暴露具体账户金额');
    assert.match(banner.style.cssText, /position:fixed;top:0/);
    assert.match(banner.style.cssText, /background:#d9304f/);
    refresh('-200 USDT');
    assert.equal(nodes.get(banner.id), banner, '超限期间复用横幅');
    assert.equal(nodes.size, 1);

    for (const amount of ['-100 USDT', '-99.99 USDT', '0 USDT', '200 USDT']) {
      refresh(amount);
      assert.equal(nodes.size, 0, amount);
    }
    refresh('-100.000000000000000001 USDT');
    assert.equal(nodes.size, 1, '阈值比较不能丢失精度');
    state.labelCount = 0;
    refresh('-200 USDT');
    assert.equal(nodes.size, 0, '短暂结构异常立即移除过期提醒');
    assert.equal(isDisabled(), false, '短暂异常仍可恢复');
    state.labelCount = 1;
    refresh('-200 USDT');
    assert.equal(nodes.size, 1, '结构恢复后重新提醒');

    state.loggedIn = false;
    refresh('-200 USDT');
    assert.equal(nodes.size, 0, '退出登录移除提醒');
    assert.equal(timers.size, 0, '退出登录停止读取');
    assert.equal(isDisabled(), true);
  } finally {
    stopSilently();
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
