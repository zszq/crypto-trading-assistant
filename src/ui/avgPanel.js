import { PANEL_ID } from '../config.js';

export const getPanel = () => document.getElementById(PANEL_ID);

export function hidePanel() {
  const panel = getPanel();
  if (panel) panel.style.display = 'none';
}

export function ensurePanel(dealbox, qtyInput) {
  let panel = getPanel();
  // React 重渲染可能把节点挤掉或换掉 dealbox，所以每次校验挂载位置
  if (panel && dealbox.contains(panel)) return panel;
  panel?.remove();
  panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText = [
    'margin:8px 0 4px',
    'padding:6px 8px',
    'border-radius:6px',
    'font-size:12px',
    'line-height:20px',
    'background:var(--color-cmpt-tag-gray, rgba(128,128,128,.12))',
    'color:var(--color-text-text-secondary, #8d93a6)',
  ].join(';');
  // 放在“可用”那行之前，也就是数量和滑块下面，下单时视线正好经过
  const anchor = [...dealbox.children].find((el) => /^可用/.test(el.textContent.trim()));
  if (anchor) dealbox.insertBefore(panel, anchor);
  else qtyInput.closest('.dealbox > *')?.after(panel);
  return panel;
}

// 面板里的文字来自页面，拼进 HTML 前转义
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const row = (left, right, title = '') =>
  `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px" title="${esc(title)}">${left}${right}</div>`;

export function renderLine(label, color, pos, price, qty, digits) {
  const left = `<span style="color:${color};white-space:nowrap">${label}后均价</span>`;
  // “张”要等合约乘数接口返回
  if (!Number.isFinite(pos.size) || !Number.isFinite(qty)) return row(left, '<span>换算中…</span>');
  const avg = (pos.entry * pos.size + price * qty) / (pos.size + qty);
  const pct = ((avg - pos.entry) / pos.entry) * 100;
  const right = `<span style="text-align:right;white-space:nowrap"><b style="color:var(--color-text-text-primary,inherit)">${avg.toFixed(digits)}</b> ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</span>`;
  return row(left, right, `原均价 ${pos.entryText}`);
}

export const renderNotice = (text) => row(`<span>${esc(text)}</span>`, '');

// 占位行：没有仓位时不显示内容，但保留一行高度，避免面板出现/消失时把下单按钮顶上顶下
export const renderPlaceholder = () => row('<span>&nbsp;</span>', '');
