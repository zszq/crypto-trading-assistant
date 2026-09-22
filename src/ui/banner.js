const BANNER_ID = 'tm-gate-helper-banner';

// 停用提示横幅。只在停用时出现，可关闭；关闭不会重新启用脚本
export function showBanner(reason) {
  if (document.getElementById(BANNER_ID)) return;
  const bar = document.createElement('div');
  bar.id = BANNER_ID;
  bar.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'right:0',
    'z-index:2147483647',
    'display:flex',
    'align-items:center',
    'gap:12px',
    'padding:8px 16px',
    'background:#d9304f',
    'color:#fff',
    'font-size:13px',
    'line-height:20px',
    'box-shadow:0 2px 8px rgba(0,0,0,.2)',
  ].join(';');
  const text = document.createElement('span');
  text.style.flex = '1';
  // 用 textContent 而不是 innerHTML：原因里可能带页面文字
  text.textContent = `⚠ Gate 合约助手已停用，未对页面做任何操作。原因：${reason}。页面结构可能已改版，请更新脚本后再使用。`;
  const close = document.createElement('button');
  close.textContent = '×';
  close.title = '关闭提示（脚本仍保持停用）';
  close.style.cssText =
    'border:0;background:transparent;color:#fff;font-size:18px;line-height:20px;cursor:pointer;padding:0 4px';
  close.addEventListener('click', () => bar.remove());
  bar.append(text, close);
  document.documentElement.appendChild(bar);
}
