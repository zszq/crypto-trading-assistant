import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { PendingError, StructureError } from '../src/core/guard.js';
import { readOrderForm } from '../src/gate/orderForm.js';

// Tampermonkey API 由构建插件注入；只读解析测试不能发起真实网络请求。
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '$') return {
      url: 'data:text/javascript,export const GM_xmlhttpRequest = () => { throw new Error("Unexpected request"); };',
      shortCircuit: true,
    };
    return next(specifier, context);
  },
});
const { readPositions } = await import('../src/gate/positions.js');
hook.deregister();

function page() {
  const state = { title: '仓位(1)', active: true, text: '', busy: false, tables: [], labels: [] };
  const content = {
    matches: () => state.busy,
    querySelector: () => null,
    querySelectorAll: (selector) => selector === 'table.position-table' ? state.tables : state.labels,
    get textContent() { return state.text; },
  };
  const bottom = {
    children: [{}, content], lastElementChild: content, closest: () => ({}),
    firstElementChild: { firstElementChild: { children: [{
      classList: { contains: () => state.active },
      get textContent() { return state.title; },
    }] } },
  };
  globalThis.document = {
    querySelectorAll: (selector) => {
      assert.equal(selector, '.scroll-table-bottom-box', '只读取已确认的仓位区域');
      return [bottom];
    },
  };
  return { state, bottom };
}

function table(name = 'BTCUSDT', side = '多', headers = true) {
  return {
    querySelector: () => headers ? {} : null,
    querySelectorAll: (selector) => selector === 'thead th' ? [] : [{
      cells: [{}, {}, {}], innerText: '全仓',
      querySelectorAll: () => [{ textContent: side }],
      querySelector: (field) => ({ textContent: field === 'td span.text-b10' ? name : field === 'td.size' ? '2 BTC' : '100' }),
    }],
  };
}

const ctx = { name: 'BTC_USDT', display: 'BTCUSDT', base: 'BTC' };

test('仓位：区分其他标签、空白加载、明确无仓位和当前合约无仓位，不复用旧数据', () => {
  const { state } = page();
  assert.throws(() => readPositions(ctx), PendingError, '空白中间帧不能当作空仓');
  state.tables = [table()];
  const positions = readPositions(ctx);
  assert.equal(positions.status, 'ready');
  assert.equal(positions.long.entry.toFixed(), '100');
  assert.equal(positions.long.size.toFixed(), '2');
  state.title = '仓位(0)';
  assert.throws(() => readPositions(ctx), PendingError, '空仓计数与残留持仓行冲突时继续等待');
  state.title = '资金流水';
  const unavailable = readPositions(ctx);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.long, null, '其他标签下即使残留旧行也不能继续计算');
  assert.match(unavailable.notice, /切回/);
  state.title = '仓位(1)';
  state.busy = true;
  assert.throws(() => readPositions(ctx), PendingError, '加载状态下不能使用残留持仓');
  state.busy = false;
  state.tables = [];
  assert.throws(() => readPositions(ctx), PendingError, '移除持仓后不复用旧值');
  state.title = '仓位(0)';
  assert.equal(readPositions(ctx).status, 'ready');
  state.title = '仓位(1)';
  state.text = '暂无数据';
  assert.equal(readPositions(ctx).long, null, '过滤后显示的空列表也属于已确认的空仓');
  state.text = '';
  state.tables = [table('ETHUSDT')];
  assert.equal(readPositions(ctx).long, null, '已解析其他合约，当前合约可确认为无仓位');
});

test('仓位：列表结构变化和选中标签异常仍报结构错误，中文卡片和双向持仓正常解析', () => {
  const { state, bottom } = page();
  state.tables = [table('BTCUSDT', '多', false)];
  assert.throws(() => readPositions(ctx), StructureError);
  state.tables = [table(), table('BTCUSDT', '空')];
  assert.ok(readPositions(ctx).short);
  state.active = false;
  assert.throws(() => readPositions(ctx), StructureError);
  state.active = true;
  state.tables = [];
  state.labels = [{
    textContent: '开仓均价',
    closest: (selector) => selector === 'table' ? null : bottom,
    parentElement: { innerText: '龙虾USDT\n全仓\n多\n数量\n2 龙虾\n开仓均价\n100\n强平价\n50\n仓位保证金\n10' },
  }];
  const positions = readPositions({ name: '龙虾_USDT', display: '龙虾USDT', base: '龙虾' });
  assert.equal(positions.long.size.toFixed(), '2');
  assert.equal(positions.long.liquidation.toFixed(), '50');
});

test('仓位：完整空表无需计数或占位文案，缺少 tbody 和明确加载状态仍继续等待', () => {
  const { state, bottom } = page();
  state.title = '仓位';
  let hasBody = true;
  const emptyTable = {
    matches: (selector) => selector === 'table.position-table',
    querySelector: (selector) => selector === 'tbody' ? (hasBody ? {} : null) :
      ['th.size', 'th.entry_price'].includes(selector) ? {} : null,
    querySelectorAll: () => [],
    textContent: '',
  };
  state.tables = [emptyTable];
  assert.deepEqual(readPositions(ctx), { long: null, short: null, status: 'ready' });
  state.title = '仓位(2)';
  assert.equal(readPositions(ctx).long, null, '总持仓计数不等于当前筛选结果');
  state.busy = true;
  assert.throws(() => readPositions(ctx), PendingError);
  state.busy = false;
  hasBody = false;
  assert.throws(() => readPositions(ctx), PendingError, '表格尚未挂载完不能当作已就绪');
  hasBody = true;
  bottom.lastElementChild = emptyTable;
  assert.equal(readPositions(ctx).status, 'ready', '数据区本身为 table 时也正常读取');
});

test('下单读取：浮窗不再依赖旧的可用余额插入锚点，限价、百分比、市价和平仓保持原行为', () => {
  let open = true;
  let priceVisible = true;
  let raw = '2';
  const price = { value: '100', type: 'text', offsetParent: {}, compareDocumentPosition: () => 4 };
  const qty = {
    get value() { return raw; },
    closest: (selector) => selector === 'label' ? { querySelector: () => ({ textContent: 'BTC' }) } : {
      querySelector: () => ({
        textContent: '≈ 1 / 2 BTC',
        querySelector: (field) => ({ textContent: field === '.font-add-color' ? '1' : '2' }),
      }),
    },
  };
  const box = {
    closest: () => ({ querySelector: () => ({ getAttribute: () => String(open) }) }),
    querySelectorAll: (selector) => selector === 'input[name="f_order"]' ? [qty] : priceVisible ? [price, qty] : [qty],
  };
  globalThis.document = { querySelectorAll: () => [box] };
  const originalNode = globalThis.Node;
  globalThis.Node = { DOCUMENT_POSITION_FOLLOWING: 4 };
  try {
    assert.equal(readOrderForm().qtyLong.toFixed(), '2');
    raw = '25%';
    assert.equal(readOrderForm().qtyLong.toFixed(), '1');
    assert.equal(readOrderForm().qtyShort.toFixed(), '2');
    priceVisible = false;
    assert.ok(Number.isNaN(readOrderForm().price));
    open = false;
    assert.equal(readOrderForm().isOpen, false);
  } finally {
    if (originalNode === undefined) delete globalThis.Node;
    else globalThis.Node = originalNode;
  }
});
