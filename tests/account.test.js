import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { readAccountState } from '../src/gate/account.js';
import { every, isDisabled, listen, onCleanup, run } from '../src/core/guard.js';

const control = (text, hidden = false, top = 10) => ({
  textContent: text,
  getClientRects: () => hidden ? [] : [{}],
  getBoundingClientRect: () => ({ top }),
});

function documentFor(controls = [], links = [], boxExists = true) {
  const box = { querySelectorAll: () => controls, querySelector: () => ({}) };
  return {
    querySelector: () => boxExists ? box : null,
    querySelectorAll: () => links,
  };
}

globalThis.getComputedStyle = () => ({ visibility: 'visible' });

test('未登录：识别按钮、链接、组合提示及英文，不把隐藏登录入口当作退出', () => {
  for (const text of ['登录', '注册', '登录 / 注册', 'Log in', 'Sign Up']) {
    globalThis.document = documentFor([control(text), control('开多')]);
    assert.equal(readAccountState(), 'loggedOut');
  }
  globalThis.document = documentFor([control('开多'), control('登录', true)]);
  assert.equal(readAccountState(), 'loggedIn');
  globalThis.document = documentFor([control('开多')], [control('登录')]);
  assert.equal(readAccountState(), 'loggedOut');
  globalThis.document = documentFor([], [], false);
  assert.equal(readAccountState(), 'pending');
});

test('登录识别兼容开仓和平仓按钮，表单出现但账号未就绪不能启动', () => {
  for (const text of ['开多', '开空', '平多', '平空', '买入/开多', '卖出（做空）', '买入平空', '卖出/平多']) {
    globalThis.document = documentFor([control(text)]);
    assert.equal(readAccountState(), 'loggedIn', text);
  }
  globalThis.document = documentFor([]);
  assert.equal(readAccountState(), 'pending');
});

test('数量框缺失不改变已登录状态，表单结构留给结构校验处理', () => {
  const box = {
    querySelectorAll: () => [control('开多')],
    querySelector: () => assert.fail('账号检测不应依赖数量框'),
  };
  globalThis.document = { querySelector: () => box, querySelectorAll: () => [] };
  assert.equal(readAccountState(), 'loggedIn');
});

test('安装产物：未登录和身份未知时不读取其他结构、不请求接口、不读设置、不写 DOM', () => {
  const script = readFileSync(new URL('../gate-futures-helper.user.js', import.meta.url), 'utf8');
  for (const auth of ['loggedOut', 'pending']) {
    let now = 0;
    const timers = new Map();
    let id = 0;
    const document = documentFor(auth === 'loggedOut' ? [control('登录')] : []);
    const query = document.querySelector;
    document.querySelector = (selector) => {
      assert.equal(selector, '.dealbox', '登录确认前不允许读取其他页面结构');
      return query(selector);
    };
    document.getElementById = () => null;
    document.createElement = () => assert.fail('未登录不允许写 DOM');
    vm.runInNewContext(script, {
      document, getComputedStyle, Date: { now: () => now },
      setInterval: (fn) => { timers.set(++id, fn); return id; },
      clearInterval: (key) => timers.delete(key),
      GM_getValue: () => assert.fail('未登录不读取设置'),
      GM_setValue: () => assert.fail('未登录不写设置'),
      GM_xmlhttpRequest: () => assert.fail('未登录不请求接口'),
      console,
    });
    assert.equal(timers.size, 1);
    for (now = 0; now <= 20500; now += 500) {
      for (const tick of [...timers.values()]) tick();
    }
    assert.equal(timers.size, 0, '未登录/身份未知超时后应停止轮询');
  }
});

test('安装产物：已登录但数量框缺失时，启动超时后显示具体结构错误', () => {
  const script = readFileSync(new URL('../gate-futures-helper.user.js', import.meta.url), 'utf8');
  const timers = new Map();
  const banners = [];
  let now = 0;
  let id = 0;
  const box = {
    querySelectorAll: (selector) => selector === 'input[name="f_order"]' ? [] : [control('开多')],
    querySelector: () => null,
  };
  const document = {
    querySelector: () => box,
    querySelectorAll: (selector) => selector === '.dealbox' ? [box] : [],
    getElementById: () => null,
    createElement: () => ({ style: {}, children: [], append(...nodes) { this.children.push(...nodes); }, addEventListener() {} }),
    documentElement: { appendChild: (node) => banners.push(node) },
  };
  vm.runInNewContext(script, {
    document, getComputedStyle, Date: { now: () => now }, location: { pathname: '/zh/futures/USDT/BTC_USDT' },
    setInterval: (fn) => { timers.set(++id, fn); return id; },
    clearInterval: (key) => timers.delete(key),
    GM_getValue: () => assert.fail('校验失败不应启用功能'),
    GM_xmlhttpRequest: () => assert.fail('表单不完整不应发起请求'),
    console: { error() {} },
  });
  for (const tick of [...timers.values()]) tick();
  assert.equal(timers.size, 1, '结构宽限期内继续等待页面就绪');
  assert.equal(banners.length, 0);
  now = 20000;
  for (const tick of [...timers.values()]) tick();
  assert.equal(timers.size, 0);
  assert.equal(banners.length, 1, '不能静默当作账号未知退出');
  assert.match(banners[0].children[0].textContent, /f_order/);
});

test('安装产物：首屏先出现登录入口时继续等待，会话恢复后才开始结构校验', () => {
  const script = readFileSync(new URL('../gate-futures-helper.user.js', import.meta.url), 'utf8');
  const timers = new Map();
  let loggedIn = false;
  let structureReads = 0;
  let now = 0;
  const box = {
    querySelectorAll: () => [{ ...control(loggedIn ? '开多' : '登录') }],
  };
  vm.runInNewContext(script, {
    document: {
      querySelector: () => box,
      querySelectorAll: (selector) => {
        if (selector === '.dealbox') { structureReads++; return []; }
        return [];
      },
      getElementById: () => null,
    },
    location: { pathname: '/zh/futures/USDT/BTC_USDT' },
    getComputedStyle, Date: { now: () => now },
    setInterval: (fn) => { timers.set(1, fn); return 1; },
    clearInterval: (id) => timers.delete(id),
    GM_getValue: () => assert.fail('结构未就绪不能读取设置'),
    GM_xmlhttpRequest: () => assert.fail('结构未就绪不能请求接口'),
  });
  for (const tick of [...timers.values()]) tick();
  assert.equal(structureReads, 0);
  assert.equal(timers.size, 1, '登录入口可能是首屏临时状态，不能立即停止等待');
  now = 5000;
  loggedIn = true;
  for (const tick of [...timers.values()]) tick();
  assert.equal(structureReads, 1, '恢复后进入只读结构校验');
  assert.equal(timers.size, 1);
});

test('运行中退出登录：不再执行功能，清理计时器、事件和所有登记副作用', () => {
  globalThis.document = documentFor([control('开多')]);
  let calls = 0;
  run('test', () => calls++);
  assert.equal(calls, 1);
  let removed = false;
  let cleaned = false;
  const target = { addEventListener() {}, removeEventListener: () => { removed = true; } };
  listen(target, 'input', () => {});
  every('testTimer', () => calls++, 60000);
  onCleanup(() => { cleaned = true; });
  globalThis.document = documentFor([control('登录')]);
  run('test', () => calls++);
  assert.equal(calls, 1);
  assert.ok(isDisabled());
  assert.ok(removed);
  assert.ok(cleaned);
  run('test', () => calls++);
  assert.equal(calls, 1);
});

test('运行中账号持续未知：立即隐藏旧结果，等待 20 秒后静默清理', async () => {
  const guard = await import('../src/core/guard.js?pending-account-test');
  const originalNow = Date.now;
  let now = 100;
  let hidden = false;
  let cleaned = false;
  Date.now = () => now;
  try {
    guard.onCleanup(() => { cleaned = true; });
    globalThis.document = documentFor([]);
    guard.run('unknown', () => assert.fail('未知账号不能运行功能'), () => { hidden = true; });
    assert.ok(hidden);
    assert.equal(cleaned, false);
    now += 3000;
    guard.run('unknown', () => assert.fail('未知账号不能运行功能'));
    assert.equal(cleaned, false, '慢于 3 秒的页面切换仍保留恢复机会');
    now += 17000;
    guard.run('unknown', () => assert.fail('未知账号不能运行功能'));
    assert.ok(cleaned);
    assert.ok(guard.isDisabled());
  } finally {
    Date.now = originalNow;
  }
});

test('运行中账号短暂未知超过 3 秒：恢复后继续执行，不沿用此前的结构失败计时', async () => {
  const guard = await import('../src/core/guard.js?recover-account-test');
  const originalNow = Date.now;
  let now = 100;
  let calls = 0;
  Date.now = () => now;
  try {
    globalThis.document = documentFor([control('开多')]);
    guard.run('recover', () => { throw new guard.StructureError('临时缺少字段'); });
    now += 500;
    globalThis.document = documentFor([]);
    guard.run('recover', () => assert.fail('账号未知时不能读取数据'));
    now += 5000;
    globalThis.document = documentFor([control('开多')]);
    guard.run('recover', () => { throw new guard.StructureError('临时缺少字段'); });
    assert.equal(guard.isDisabled(), false);
    guard.run('recover', () => calls++);
    assert.equal(calls, 1);
  } finally {
    guard.stopSilently();
    Date.now = originalNow;
  }
});

test('持仓加载等待可恢复，加载超时仍整体停用；真正结构异常保留 3 秒宽限', async () => {
  const originalNow = Date.now;
  const originalError = console.error;
  let now = 100;
  Date.now = () => now;
  console.error = () => {};
  try {
    for (const recover of [true, false]) {
      const guard = await import(`../src/core/guard.js?pending-data-test-${recover}`);
      const banners = [];
      let cleaned = false;
      let failure;
      globalThis.document = {
        ...documentFor([control('开多')]),
        getElementById: () => null,
        createElement: () => ({ style: {}, append() {}, addEventListener() {} }),
        documentElement: { appendChild: (node) => banners.push(node) },
      };
      guard.onCleanup(() => { cleaned = true; });
      const pending = () => { throw new guard.PendingError('持仓数据加载中…'); };
      guard.run('positions', pending, (error) => { failure = error; });
      assert.ok(failure instanceof guard.PendingError);
      now += 5000;
      guard.run('positions', pending);
      assert.equal(cleaned, false);
      if (recover) {
        guard.run('positions', () => {});
        now += 20000;
        guard.run('positions', pending);
        assert.equal(guard.isDisabled(), false, '成功读取后重置等待期限');
        guard.run('positions', () => { throw new guard.StructureError('表头改版'); });
        now += 3000;
        guard.run('positions', () => { throw new guard.StructureError('表头改版'); });
      } else {
        now += 15000;
        guard.run('positions', pending);
      }
      assert.ok(cleaned);
      assert.ok(guard.isDisabled());
      assert.equal(banners.length, 1);
    }
  } finally {
    Date.now = originalNow;
    console.error = originalError;
  }
});

test('运行中已登录但数量框缺失：保留结构宽限和错误横幅，并清理功能', async () => {
  const guard = await import('../src/core/guard.js?missing-quantity-test');
  const originalNow = Date.now;
  const originalError = console.error;
  const banners = [];
  let now = 100;
  let calls = 0;
  let cleaned = false;
  const box = { querySelectorAll: () => [control('开多')], querySelector: () => null };
  globalThis.document = {
    querySelector: () => box, querySelectorAll: () => [], getElementById: () => null,
    createElement: () => ({ style: {}, children: [], append(...nodes) { this.children.push(...nodes); }, addEventListener() {} }),
    documentElement: { appendChild: (node) => banners.push(node) },
  };
  Date.now = () => now;
  console.error = () => {};
  const check = () => {
    calls++;
    guard.expect(box.querySelector('input[name="f_order"]'), '数量输入框 input[name="f_order"] 未找到');
  };
  try {
    guard.onCleanup(() => { cleaned = true; });
    guard.run('form', check);
    assert.equal(calls, 1, '账号检测应放行到结构校验');
    assert.equal(guard.isDisabled(), false);
    now += 3000;
    guard.run('form', check);
    assert.equal(calls, 2);
    assert.ok(guard.isDisabled());
    assert.ok(cleaned);
    assert.equal(banners.length, 1);
    assert.match(banners[0].children[0].textContent, /f_order/);
  } finally {
    Date.now = originalNow;
    console.error = originalError;
  }
});
