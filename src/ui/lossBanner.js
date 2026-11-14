import { LOSS_ALERT_THRESHOLD } from '../config.js';

const BANNER_ID = 'tm-gate-loss-alert';

export function hideLossBanner() {
  document.getElementById(BANNER_ID)?.remove();
}

export function showLossBanner() {
  if (document.getElementById(BANNER_ID)) return;
  const bar = document.createElement('div');
  bar.id = BANNER_ID;
  bar.setAttribute('role', 'alert');
  bar.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'right:0',
    'z-index:2147483647',
    'box-sizing:border-box',
    'padding:6px 12px',
    'background:#d9304f',
    'color:#fff',
    'font-size:13px',
    'font-weight:600',
    'line-height:20px',
    'text-align:center',
    'box-shadow:0 2px 8px rgba(0,0,0,.25)',
    // 横幅遮住的区域需要拦截鼠标命中，避免触发下方导航或按钮的悬停提示。
    'pointer-events:auto',
  ].join(';');
  // 不展示具体金额，避免在启用资产隐私隐藏时泄露实时账户数值。
  bar.textContent = `⚠ 所有仓位未实现亏损已超过 ${LOSS_ALERT_THRESHOLD} USDT，机会很多，注意止损！`;
  const emphasis = document.createElement('strong');
  emphasis.textContent = '（只做确定性高的的行情！）';
  emphasis.style.cssText = 'color:#ffff00;font-weight:800';
  bar.appendChild(emphasis);
  document.documentElement.appendChild(bar);
}
