import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshOnPageChange } from '../src/core/refresh.js';
import { stopSilently } from '../src/core/guard.js';

class Target {
  listeners = new Map();
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  emit(type, target) { for (const handler of this.listeners.get(type) || []) handler({ target }); }
}

test('刷新调度：合并交互和 DOM 变化、重绑替换模块、排除自身写入、后台检测及完整清理', () => {
  const saved = new Map(['document', 'window', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame',
    'setInterval', 'clearInterval', 'queueMicrotask', 'getComputedStyle'].map((key) => [key, globalThis[key]]));
  const frames = new Map();
  const timers = new Map();
  const microtasks = [];
  const observers = [];
  let id = 0;
  let calls = 0;
  let alerts = 0;
  const node = (relevant = true, own = false) => ({
    nodeType: 1,
    matches: () => relevant,
    querySelector: () => null,
    closest: (selector) => selector === '.watched' ? relevant : own,
  });
  let root = node();
  const own = node(false, true);
  const other = node(false);
  const document = new Target();
  const window = new Target();
  Object.assign(document, {
    body: other, hidden: false,
    querySelector: () => ({ querySelectorAll: () => [{ textContent: '开多', getClientRects: () => [{}] }] }),
    querySelectorAll: (selector) => selector === '.watched' ? [root] : [],
  });
  Object.assign(globalThis, {
    document, window,
    getComputedStyle: () => ({ visibility: 'visible' }),
    MutationObserver: class {
      nodes = new Map();
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target, options) { this.nodes.set(target, options); }
      disconnect() { this.nodes.clear(); }
    },
    requestAnimationFrame: (callback) => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: (key) => frames.delete(key),
    setInterval: (callback, ms) => { assert.equal(ms, 300); timers.set(++id, callback); return id; },
    clearInterval: (key) => timers.delete(key),
    queueMicrotask: (callback) => microtasks.push(callback),
  });
  const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback());
  };
  const mutation = (target = root, type = 'characterData', addedNodes = [], removedNodes = []) => ({ target, type, addedNodes, removedNodes });
  try {
    refreshOnPageChange('preview', () => calls++, { selector: '.watched', events: ['input', 'change', 'click', 'pointerup'] });
    const [local, structure] = observers;
    assert.equal(calls, 1, '初始化立即检测');
    assert.ok(local.nodes.has(root));
    assert.equal(structure.nodes.get(other).characterData, undefined, '全页面只观察节点替换');
    local.callback([mutation(own), mutation(root, 'childList', [own])]);
    structure.callback([mutation(other, 'childList', [other])]);
    document.emit('input', own);
    document.emit('click', other);
    assert.equal(frames.size, 0, '自身面板和无关页面变化不会触发刷新');

    local.callback([mutation()]);
    local.callback([mutation(root, 'attributes')]);
    for (const type of ['input', 'change', 'click', 'pointerup']) document.emit(type, root);
    assert.equal(frames.size, 1, '连续变更合并成一帧，不持续推迟检测');
    flushFrames();
    assert.equal(calls, 2, '不需要等到轮询');

    const previous = root;
    root = node();
    structure.callback([mutation(other, 'childList', [root], [previous])]);
    flushFrames();
    assert.equal(calls, 3);
    assert.equal(local.nodes.has(previous), false);
    assert.ok(local.nodes.has(root), 'React 替换整个模块后重新观察新节点');

    for (const timer of timers.values()) timer();
    assert.equal(calls, 4, '属性改值未产生事件时仍有轮询兜底');
    document.hidden = true;
    document.emit('visibilitychange', document);
    assert.equal(frames.size, 0);
    document.hidden = false;
    document.emit('visibilitychange', document);
    window.emit('focus', window);
    flushFrames();
    assert.equal(calls, 5, '返回页面后主动重读');

    refreshOnPageChange('alert', () => alerts++, { selector: '.watched', immediate: true });
    assert.equal(alerts, 1);
    document.hidden = true;
    observers[2].callback([mutation()]);
    observers[2].callback([mutation()]);
    assert.equal(frames.size, 0);
    assert.equal(microtasks.length, 1, '后台提醒不等待动画帧');
    microtasks.shift()();
    assert.equal(alerts, 2);

    local.callback([mutation()]);
    observers[2].callback([mutation()]);
    assert.equal(frames.size, 1);
    stopSilently();
    assert.equal(frames.size, 0);
    assert.equal(timers.size, 0);
    assert.ok(observers.every((observer) => observer.nodes.size === 0));
    microtasks.shift()();
    assert.equal(alerts, 2, '已排队微任务在停用后不能写入页面');
    assert.ok([document, window].every((target) => [...target.listeners.values()].every((handlers) => handlers.size === 0)));
  } finally {
    stopSilently();
    for (const [key, value] of saved) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
