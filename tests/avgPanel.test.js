import test from 'node:test';
import assert from 'node:assert/strict';
import { ensurePanel, hidePanel, renderPanel, renderLiquidationLine } from '../src/ui/avgPanel.js';
import { stopSilently } from '../src/core/guard.js';

class Target {
  listeners = new Map();
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }
  emit(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) handler(event);
  }
}

test('浮动面板：标题拖拽限制四边，刷新保留标题，缩窗及内容增高后仍可找回，并完整清理', () => {
  const viewport = { clientWidth: 1200, clientHeight: 800 };
  const document = new Target();
  const window = new Target();
  let observer;
  const nodes = [];
  const createNode = () => {
    const style = {
      set cssText(value) {
        for (const rule of value.split(';')) {
          const [name, text] = rule.split(':');
          this[name.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = text;
        }
      },
    };
    const node = {
      style, children: [], innerHTML: '', height: 160, captured: null,
      append(...children) { this.children.push(...children); },
      appendChild(child) { child.parentElement = this; this.children.push(child); },
      contains(target) { return this === target || this.children.some((child) => child.contains(target)); },
      get firstElementChild() { return this.children[0]; },
      get lastElementChild() { return this.children.at(-1); },
      getBoundingClientRect() {
        const width = Math.min(Number.parseFloat(this.style.width), viewport.clientWidth);
        const height = Math.min(this.height, viewport.clientHeight);
        return {
          width, height,
          left: this.style.left === undefined ? viewport.clientWidth - 300 - width : Number.parseFloat(this.style.left),
          top: Number.parseFloat(this.style.top),
        };
      },
      setPointerCapture(id) { this.captured = id; },
      hasPointerCapture(id) { return this.captured === id; },
      releasePointerCapture() { this.captured = null; },
      remove() { this.parentElement = null; },
    };
    nodes.push(node);
    return node;
  };
  Object.assign(document, {
    documentElement: viewport,
    body: createNode(),
    createElement: createNode,
    getElementById: (id) => nodes.find((node) => node.id === id && node.parentElement),
  });
  globalThis.document = document;
  globalThis.window = window;
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe(node) { this.node = node; }
    disconnect() { this.node = null; }
  };

  try {
    const panel = ensurePanel();
    const title = panel.firstElementChild;
    assert.equal(title.textContent, '合约助手');
    assert.equal(panel.style.border, '1px solid #697386');
    assert.equal(panel.style.top, '0px');
    assert.equal(panel.style.right, '300px');
    assert.equal(ensurePanel(), panel, '轮询不重复创建面板或监听');
    const start = (target = title, button = 0) => {
      const rect = panel.getBoundingClientRect();
      document.emit('pointerdown', {
        target, button, pointerId: 1,
        clientX: rect.left + 10, clientY: rect.top + 10, preventDefault() {},
      });
    };
    const move = (clientX, clientY, pointerId = 1) => document.emit('pointermove', { pointerId, clientX, clientY });
    start(panel.lastElementChild);
    move(-1000, -1000);
    assert.equal(panel.style.left, undefined, '数据区不能触发拖拽');
    start(title, 2);
    assert.equal(title.captured, null, '右键不能触发拖拽');
    start(title.lastElementChild);
    const loadingHtml = renderLiquidationLine('开多', '#2ebd85', { loading: true, notice: '读取风险参数中…' });
    renderPanel(panel, loadingHtml, '读取风险参数中…');
    assert.equal(title.lastElementChild.textContent, '读取风险参数中…');
    assert.doesNotMatch(panel.lastElementChild.innerHTML, /读取风险参数/);
    assert.match(panel.lastElementChild.innerHTML, /开多后预估强平价/);
    const readyHtml = renderLiquidationLine('开多', '#2ebd85', { lower: 123.45 });
    assert.equal((loadingHtml.match(/<div /g) || []).length, (readyHtml.match(/<div /g) || []).length, '加载与完成时数据区行数保持一致');
    renderPanel(panel, readyHtml);
    assert.equal(title.lastElementChild.textContent, '', '加载结束清除标题栏状态');
    assert.match(panel.lastElementChild.innerHTML, /123\.45/);
    assert.match(renderLiquidationLine('开多', '#2ebd85', { notice: '行情接口暂不可用' }), /行情接口暂不可用/, '保留真实错误说明');
    renderPanel(panel, '<div>新的均价和强平价</div>');
    assert.equal(panel.firstElementChild, title);
    assert.equal(title.captured, 1, '数据刷新不能打断正在进行的拖拽');
    move(-1000, -1000, 2);
    assert.equal(panel.style.left, undefined, '忽略其他指针');
    move(-1000, -1000);
    assert.equal(panel.style.left, '0px');
    assert.equal(panel.style.top, '0px');
    move(5000, 5000);
    assert.equal(panel.style.left, '880px');
    assert.equal(panel.style.top, '640px');
    document.emit('pointerup', { pointerId: 1 });
    assert.equal(title.captured, null);
    move(50, 50);
    assert.equal(panel.style.left, '880px', '松手后停止拖拽');

    viewport.clientWidth = 500;
    viewport.clientHeight = 300;
    window.emit('resize');
    assert.equal(panel.style.left, '180px');
    assert.equal(panel.style.top, '140px');
    panel.height = 250;
    observer.callback();
    assert.equal(panel.style.top, '50px', '内容增高时防止面板底部越界');
    start();
    document.emit('pointercancel', { pointerId: 1 });
    assert.equal(title.captured, null);
    start();
    hidePanel();
    assert.equal(panel.style.display, 'none');
    assert.equal(title.captured, null, '隐藏时释放指针');
    viewport.clientWidth = 200;
    viewport.clientHeight = 100;
    panel.style.display = 'flex';
    observer.callback();
    assert.equal(panel.style.left, '0px');
    assert.equal(panel.style.top, '0px', '重新显示时回到小窗口内');
  } finally {
    stopSilently();
  }
  assert.equal(document.getElementById('tm-avg-preview'), undefined);
  assert.equal(observer.node, null);
  for (const target of [document, window]) {
    assert.ok([...target.listeners.values()].every((handlers) => handlers.size === 0), '停用后移除全部监听');
  }
});
