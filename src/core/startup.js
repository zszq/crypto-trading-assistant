import { verifyPrivacyStructure } from '../features/privacyHide.js';
import { getContract } from '../gate/contract.js';
import { readOrderForm } from '../gate/orderForm.js';
import { readPositions } from '../gate/positions.js';
import { readAccountState } from '../gate/account.js';
import { readUnrealizedPnl } from '../gate/unrealizedPnl.js';
import { disable, expect, isDisabled, onCleanup, stopSilently, StructureError } from './guard.js';

// 页面是异步渲染的，启动时最多等这么久让结构就绪；超时仍不对应则判定为改版
const STARTUP_TIMEOUT_MS = 20000;
const POLL_MS = 500;

// 启动前只读校验所有依赖的结构，全部对应才启动功能
function verifyStructure() {
  const ctx = expect(getContract(), '无法从地址栏解析合约名');
  readOrderForm();
  readPositions(ctx);
  verifyPrivacyStructure();
  readUnrealizedPnl();
}

export function startWhenReady(features) {
  const accountDeadline = Date.now() + STARTUP_TIMEOUT_MS;
  let structureDeadline;
  const id = setInterval(() => {
    const account = readAccountState();
    if (account !== 'loggedIn') {
      // 首屏可能先渲染登录入口再恢复会话；等待期间仍不读取持仓或请求接口。
      if (Date.now() >= accountDeadline) stopSilently();
      return;
    }
    structureDeadline ??= Date.now() + STARTUP_TIMEOUT_MS;
    try {
      verifyStructure();
    } catch (e) {
      if (!(e instanceof StructureError)) {
        clearInterval(id);
        return disable(`脚本异常：${e?.message || e}`);
      }
      if (Date.now() < structureDeadline) return;
      clearInterval(id);
      return disable(e.message);
    }
    clearInterval(id);
    try {
      for (const init of features) {
        if (isDisabled()) break;
        init();
      }
    } catch (e) {
      disable(`启动失败：${e?.message || e}`);
    }
  }, POLL_MS);
  onCleanup(() => clearInterval(id));
}
