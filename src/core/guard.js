import { showBanner } from '../ui/banner.js';
import { readAccountState } from '../gate/account.js';

// 统一管理脚本的生命周期：所有定时任务、事件监听、插入的节点都经由这里登记，
// 一旦发现页面结构与代码不对应，就整体停用并清理干净，页面恢复原样。
// 这是交易页面，宁可功能失效，也不能在读错结构的情况下继续操作

export class StructureError extends Error {}

// 数据加载和结构改版需要不同的等待时长，避免慢请求被 3 秒的结构宽限误判。
export class PendingError extends StructureError {}

// 断言页面结构；不成立时抛出 StructureError。返回 cond 本身，便于 const el = expect(query(), '...')
export function expect(cond, message) {
  if (!cond) throw new StructureError(message);
  return cond;
}

// 切换合约/标签时 React 会短暂处于中间状态，结构不符需持续超过这个时长才判定为改版
const GRACE_MS = 3000;
const DATA_WAIT_MS = 20000;

let disabled = false;
let accountPendingSince = null;
const cleanups = [];
const failingSince = {};

export const isDisabled = () => disabled;

export function onCleanup(fn) {
  cleanups.push(fn);
}

function stop(reason, notify) {
  if (disabled) return;
  disabled = true;
  if (notify) console.error('[Gate 合约助手] 已停用：', reason);
  // 逆序清理（后插入的先移除）；单步失败不影响其余步骤
  cleanups.reverse().forEach((fn) => {
    try {
      fn();
    } catch (e) {
      // ignore
    }
  });
  if (notify) showBanner(reason);
}

export const disable = (reason) => stop(reason, true);
// 退出登录不是页面改版：撤销脚本全部副作用，不插入错误横幅。
export const stopSilently = () => stop('', false);

// 执行一次任务：非结构异常说明代码本身有问题，直接停用；
// 结构异常先调用 onFail（让功能回到“什么都不做”的状态），持续超过宽限期再停用
export function run(name, fn, onFail) {
  if (disabled) return;
  try {
    const account = readAccountState();
    if (account === 'loggedOut') return stopSilently();
    if (account !== 'loggedIn') {
      onFail?.();
      // 页面可能先撤掉交易按钮、稍后才显示登录入口；不能让旧的隐私隐藏状态和界面无限残留。
      accountPendingSince ??= Date.now();
      delete failingSince[name];
      if (Date.now() - accountPendingSince >= DATA_WAIT_MS) stopSilently();
      return;
    }
    accountPendingSince = null;
    fn();
    delete failingSince[name];
  } catch (e) {
    if (!(e instanceof StructureError)) return disable(`脚本异常：${e?.message || e}`);
    try {
      onFail?.(e);
    } catch (_) {
      // ignore
    }
    const pending = e instanceof PendingError;
    if (failingSince[name]?.pending !== pending) failingSince[name] = { at: Date.now(), pending };
    if (Date.now() - failingSince[name].at >= (pending ? DATA_WAIT_MS : GRACE_MS)) disable(e.message);
  }
}

export function every(name, fn, ms, onFail) {
  const id = setInterval(() => run(name, fn, onFail), ms);
  onCleanup(() => clearInterval(id));
}

export function listen(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  onCleanup(() => target.removeEventListener(type, handler, options));
}

export function addStyle(css) {
  const style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
  onCleanup(() => style.remove());
}
