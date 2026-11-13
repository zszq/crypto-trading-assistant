import { formatPrice, isPositive, weightedEntry } from '../utils/number.js';
import { PANEL_ID } from '../config.js';
import { listen, onCleanup } from '../core/guard.js';
import { calculateBreakEven, estimateBreakEven } from '../utils/breakEven.js';

let drag = null;
let resizeObserver;
let dragInitialized = false;

export const getPanel = () => document.getElementById(PANEL_ID);

export function hidePanel() {
  stopDrag();
  const panel = getPanel();
  if (panel) panel.style.display = 'none';
}

// 脚本停用时移除面板，页面恢复原样
onCleanup(() => {
  stopDrag();
  resizeObserver?.disconnect();
  getPanel()?.remove();
});

function movePanel(panel, left, top) {
  const rect = panel.getBoundingClientRect();
  const viewport = document.documentElement;
  panel.style.left = `${Math.max(0, Math.min(left, viewport.clientWidth - rect.width))}px`;
  panel.style.top = `${Math.max(0, Math.min(top, viewport.clientHeight - rect.height))}px`;
  panel.style.right = 'auto';
}

function keepPanelInViewport() {
  const panel = getPanel();
  if (!panel || panel.style.display === 'none') return;
  const { left, top } = panel.getBoundingClientRect();
  movePanel(panel, left, top);
}

function stopDrag() {
  if (!drag) return;
  const { title, pointerId } = drag;
  drag = null;
  title.style.cursor = 'grab';
  if (title.hasPointerCapture(pointerId)) title.releasePointerCapture(pointerId);
}

function initDrag() {
  if (dragInitialized) return;
  dragInitialized = true;
  // 捕获指针后，即使鼠标移出标题栏也能继续拖动并可靠结束。
  listen(document, 'pointerdown', (event) => {
    const panel = getPanel();
    const title = panel?.firstElementChild;
    if (!title?.contains(event.target) || event.button !== 0 || drag) return;
    const rect = panel.getBoundingClientRect();
    title.setPointerCapture(event.pointerId);
    drag = { title, pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    title.style.cursor = 'grabbing';
    event.preventDefault();
  });
  listen(document, 'pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const panel = getPanel();
    if (!panel) return stopDrag();
    movePanel(panel, event.clientX - drag.offsetX, event.clientY - drag.offsetY);
  });
  const endDrag = (event) => {
    if (event.pointerId === drag?.pointerId) stopDrag();
  };
  listen(document, 'pointerup', endDrag);
  listen(document, 'pointercancel', endDrag);
  listen(document, 'lostpointercapture', endDrag);
  listen(window, 'blur', stopDrag);
  listen(window, 'resize', keepPanelInViewport);
  // 内容增高、面板重新显示或窗口缩小时，都重新限制位置，避免标题栏留在屏幕外。
  resizeObserver = new ResizeObserver(keepPanelInViewport);
}

export function renderPanel(panel, html, status = '') {
  // 只替换数据区，保留标题栏节点及正在进行的指针捕获。
  panel.firstElementChild.lastElementChild.textContent = status;
  panel.lastElementChild.innerHTML = html;
}

export function ensurePanel() {
  let panel = getPanel();
  // 挂在 body 下，避免受下单模块的重渲染、溢出裁剪和隐私隐藏影响。
  if (panel && panel.parentElement === document.body) return panel;
  stopDrag();
  panel?.remove();
  panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText = [
    'position:fixed',
    'top:100px',
    'right:310px',
    'z-index:2147483646',
    'width:300px',
    'max-width:100%',
    'max-height:100vh',
    'display:flex',
    'flex-direction:column',
    'box-sizing:border-box',
    'padding:8px 12px',
    'border-radius:6px',
    'border:1px solid #697386',
    'font-size:12px',
    'line-height:20px',
    'background:var(--color-bg-primary, #18191c)',
    'color:var(--color-text-text-secondary, #8d93a6)',
    'box-shadow:0 2px 12px rgba(0,0,0,.25)',
  ].join(';');
  const title = document.createElement('div');
  title.textContent = '合约助手';
  title.title = '按住拖动面板';
  title.style.cssText = [
    'display:flex',
    'justify-content:space-between',
    'align-items:center',
    'gap:8px',
    'white-space:nowrap',
    'flex-shrink:0',
    'padding-bottom:6px',
    'margin-bottom:6px',
    'border-bottom:1px solid var(--color-line-border, #697386)',
    'font-weight:600',
    'color:var(--color-text-text-primary, #e8eaf0)',
    'cursor:grab',
    'user-select:none',
    'touch-action:none',
  ].join(';');
  const status = document.createElement('span');
  status.style.cssText = [
    'min-width:0',
    'overflow:hidden',
    'text-overflow:ellipsis',
    'font-size:11px',
    'font-weight:400',
    'color:var(--color-text-text-secondary, #8d93a6)',
  ].join(';');
  title.append(status);
  const content = document.createElement('div');
  content.style.cssText = 'min-height:0;overflow:auto';
  panel.append(title, content);
  document.body.appendChild(panel);
  initDrag();
  resizeObserver.disconnect();
  resizeObserver.observe(panel);
  return panel;
}

// 面板里的文字来自页面，拼进 HTML 前转义
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const row = (left, right, title = '') =>
  `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px" title="${esc(title)}">${left}${right}</div>`;

function renderBreakEvenResult(label, color, result, title) {
  const value = result.notice || formatPrice(result.price);
  const left = `<span style="color:${color};white-space:nowrap">${label}</span>`;
  const right = `<span style="text-align:right;white-space:nowrap"><b style="color:var(--color-text-text-primary,inherit)">${esc(value)}</b></span>`;
  return row(left, right, title);
}

export function renderBreakEvenLine(positions) {
  return renderBreakEvenResult('盈亏平衡价', 'inherit', calculateBreakEven(positions),
    '当前持仓合计未实现盈亏为零的价格，不含本次委托、手续费和资金费；等量多空持仓的合计盈亏不随价格变化');
}

export function renderClosingBreakEvenLine(label, color, positions, side, price, qty) {
  return renderBreakEvenResult(`${label}后盈亏平衡价`, color, estimateBreakEven({ positions, side, price, qty }),
    `假设本次${label}按委托价全部成交后，多空持仓以同一价格全部平仓时合计盈亏为零的价格，不含手续费和资金费；仅模拟当前方向的一笔加仓`);
}

export function renderLine(label, color, pos, price, qty) {
  const left = `<span style="color:${color};white-space:nowrap">${label}后均价</span>`;
  // “张”要等合约乘数接口返回
  if (!isPositive(pos.size) || !isPositive(qty)) return row(left, '<span>换算中…</span>');
  const avg = weightedEntry(pos, price, qty);
  const right = `<span style="text-align:right;white-space:nowrap"><b style="color:var(--color-text-text-primary,inherit)">${formatPrice(avg)}</b></span>`;
  return row(left, right, `原均价 ${formatPrice(pos.entry)}`);
}

export function renderLiquidationLine(label, color, result, followingLine = '') {
  const left = `<span style="color:${color};white-space:nowrap">${label}后预估强平价</span>`;
  const values = [result.lower, result.upper].filter(isPositive);
  const value = values.length === 2
    ? `↓ ${formatPrice(values[0])} / ↑ ${formatPrice(values[1])}`
    : values.length ? `≈ ${formatPrice(values[0])}` : result.loading ? '—' : '暂无法预估';
  // 加载提示放在固定高度的标题栏，数据区保留强平价行，避免请求刷新时反复增减行数。
  const notice = result.loading ? '' : result.notice;
  const title = [notice, result.explanation].filter(Boolean).join('；');
  const right = `<span style="text-align:right">${esc(value)}</span>`;
  // 强平价的错误说明放在价格行之后，让对应的平仓价始终紧跟强平价。
  return row(left, right, title) + followingLine + (notice ? row(`<span style="font-size:11px">${esc(notice)}</span>`, '') : '');
}

export const renderNotice = (text) => row(`<span>${esc(text)}</span>`, '');
