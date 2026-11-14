import { LOSS_ALERT_THRESHOLD, TICK_MS } from '../config.js';
import { every, onCleanup, run } from '../core/guard.js';
import { readUnrealizedPnl } from '../gate/unrealizedPnl.js';
import { hideLossBanner, showLossBanner } from '../ui/lossBanner.js';

function tick() {
  const pnl = readUnrealizedPnl();
  if (pnl.lt(-LOSS_ALERT_THRESHOLD)) showLossBanner();
  else hideLossBanner();
}

export function initLossAlert() {
  onCleanup(hideLossBanner);
  // 不依赖下单输入或当前仓位标签；切换页面结构时立即撤掉旧提醒，避免展示过期结果。
  every('lossAlert', tick, TICK_MS, hideLossBanner);
  run('lossAlert', tick, hideLossBanner);
}
