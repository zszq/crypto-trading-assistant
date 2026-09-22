import { verifyBlurStructure } from '../features/privacyBlur.js';
import { getContract } from '../gate/contract.js';
import { readOrderForm } from '../gate/orderForm.js';
import { readPositions } from '../gate/positions.js';
import { disable, expect, StructureError } from './guard.js';

// 页面是异步渲染的，启动时最多等这么久让结构就绪；超时仍不对应则判定为改版
const STARTUP_TIMEOUT_MS = 20000;
const POLL_MS = 500;

// 未登录时下单区只有“登录/注册”按钮，脚本无用武之地，静默退出（不算改版）
function isLoggedOut() {
  const dealbox = document.querySelector('.dealbox');
  return !!dealbox && [...dealbox.querySelectorAll('button')].some((b) => /^(登录|注册)$/.test(b.textContent.trim()));
}

// 启动前只读校验所有依赖的结构，全部对应才启动功能
function verifyStructure() {
  const ctx = expect(getContract(), '无法从地址栏解析合约名');
  readOrderForm();
  readPositions(ctx);
  verifyBlurStructure();
}

export function startWhenReady(features) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  const id = setInterval(() => {
    if (isLoggedOut()) {
      clearInterval(id);
      console.info('[Gate 合约助手] 未登录，脚本不启用');
      return;
    }
    try {
      verifyStructure();
    } catch (e) {
      if (!(e instanceof StructureError)) {
        clearInterval(id);
        return disable(`脚本异常：${e?.message || e}`);
      }
      if (Date.now() < deadline) return;
      clearInterval(id);
      return disable(e.message);
    }
    clearInterval(id);
    try {
      features.forEach((init) => init());
    } catch (e) {
      disable(`启动失败：${e?.message || e}`);
    }
  }, POLL_MS);
}
