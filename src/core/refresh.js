import { TICK_MS } from '../config.js';
import { every, isDisabled, listen, onCleanup, run } from './guard.js';

const OWN_UI = '#tm-avg-preview, #tm-hide-toggles, #tm-gate-loss-alert, #tm-gate-helper-banner';
const elementOf = (node) => node.nodeType === 1 ? node : node.parentElement;
const isOwn = (node) => !!elementOf(node)?.closest(OWN_UI);

function isPageMutation(record) {
  if (isOwn(record.target)) return false;
  if (record.type !== 'childList') return true;
  return [...record.addedNodes, ...record.removedNodes].some((node) => !isOwn(node));
}

// 观察实际依赖的模块；页面级观察只负责发现模块替换，不对行情区的每次文字变化重算。
export function refreshOnPageChange(name, tick, { selector, events = [], onFail, immediate = false }) {
  let roots = [];
  let scheduled = false;
  let frame;
  let stopped = false;
  const schedule = () => {
    if (stopped || isDisabled() || scheduled) return;
    scheduled = true;
    const flush = () => {
      scheduled = false;
      if (!stopped) run(name, refresh, onFail);
    };
    // 盈亏提醒走微任务，避免后台标签页暂停动画帧后迟迟不检测；输入预估等下一帧再读 React。
    if (immediate) queueMicrotask(flush);
    else frame = requestAnimationFrame(flush);
  };
  const local = new MutationObserver((records) => {
    if (records.some(isPageMutation)) schedule();
  });
  const structure = new MutationObserver((records) => {
    const relevant = records.some((record) => isPageMutation(record) &&
      [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === 1 &&
        (node.matches(selector) || node.querySelector(selector) || elementOf(record.target)?.closest(selector))));
    if (relevant) schedule();
  });
  function refresh() {
    const next = [...document.querySelectorAll(selector)];
    if (next.length !== roots.length || next.some((node, index) => node !== roots[index])) {
      local.disconnect();
      roots = next;
      roots.forEach((node) => local.observe(node, {
        subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ['class', 'style', 'value', 'aria-selected', 'aria-busy'],
      }));
    }
    tick();
  }
  onCleanup(() => {
    stopped = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    local.disconnect();
    structure.disconnect();
    roots = [];
  });
  structure.observe(document.body, { childList: true, subtree: true });
  events.forEach((type) => listen(document, type, (event) => {
    if (!isOwn(event.target) && elementOf(event.target)?.closest(selector)) schedule();
  }, true));
  listen(document, 'visibilitychange', () => {
    if (!document.hidden) schedule();
  });
  listen(window, 'focus', schedule);
  // .value 属性变化不一定产生 DOM mutation，公共接口完成后也需要重新计算，因此保留轮询。
  every(name, refresh, TICK_MS, onFail);
  run(name, refresh, onFail);
}
