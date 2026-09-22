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
  const anchor = [...dealbox.children].find((el) => /^可用/.test(el.innerText.trim()));
  if (anchor) dealbox.insertBefore(panel, anchor);
  else qtyInput.closest('.dealbox > *')?.after(panel);
  return panel;
}

export function renderLine(label, color, pos, price, qty, digits) {
  let value;
  let diff = '';
  let title = '';
  if (!Number.isFinite(pos.size)) {
    value = '换算中…';
  } else {
    const avg = (pos.entry * pos.size + price * qty) / (pos.size + qty);
    const pct = ((avg - pos.entry) / pos.entry) * 100;
    value = avg.toFixed(digits);
    diff = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
    title = `原均价 ${pos.entryText}`;
  }
  // 下单栏很窄，标签不换行，避免“开多后均价”被拆成两行
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px" title="${title}">
    <span style="color:${color};white-space:nowrap">${label}后均价</span>
    <span style="text-align:right;white-space:nowrap"><b style="color:var(--color-text-text-primary,inherit)">${value}</b> ${diff}</span>
  </div>`;
}
