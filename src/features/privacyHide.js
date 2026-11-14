import { GM_getValue, GM_setValue } from '$';
import { addStyle, every, expect, onCleanup } from '../core/guard.js';

// 隐私隐藏：开仓 / 仓位 / 资产模块及可用余额行可完全隐藏，鼠标移入或输入框聚焦时显示。
// 保留已有存储键，避免隐私设置在升级后失效。
//
// 实现上全部用 CSS：开关状态挂在 <html> 的类名上，模块用 :has() 识别。
// React 重渲染会替换模块内部节点，把状态放在 <html> 上才不会丢；
// Gate 的类名多是打包 hash，只用语义化的 class/结构来定位

const TOGGLES_ID = 'tm-hide-toggles';
const STORE_KEY = 'blurModules';

const MODULES = [
  { key: 'order', label: '开仓' },
  { key: 'positions', label: '仓位' },
  { key: 'assets', label: '资产' },
  { key: 'available', label: '可用' },
];

// 各模块所在的 grid 块；Gate 类名多为打包 hash，只能靠语义 class 和结构识别
const ORDER = '.react-grid-item:has(.dealbox)';
const POSITIONS = '.react-grid-item:has(.scroll-table-bottom-box)';
const ASSETS = '.react-grid-item:has(.asset-container_new)';
const AVAILABLE = '#multiCurrencyMarginModeFuturesStep1';

// revealOnSelf：只有鼠标移到被隐藏的内容本身（或其中输入框聚焦）才显示；
// 否则移入整个模块就显示
const TARGETS = {
  order: { box: ORDER, inner: '> .h-full > *' },
  // 各标签页结构都是“标签栏 + 1~2 行按钮/筛选 + 数据区”，数据区总在最后
  // （列表是 .table-scroll-window，详情卡片是 .flex-1），只隐藏它，按钮行保持可用。
  // 开关就在这个模块的标签栏里，按模块判断的话，碰开关/点完开关留下焦点都会露出仓位，所以只看数据区本身
  // :not(:first-child) 保证永远不会落到标签栏（开关所在行）上
  positions: {
    box: POSITIONS,
    inner: '.scroll-table-bottom-box > :last-child:not(:first-child)',
    revealOnSelf: true,
  },
  // 标题栏和拖拽区保持清晰，便于认出模块、拖动布局
  assets: { box: ASSETS, inner: '.asset-container_new > :not(.rgl-drag-zone):not(.assets-title)' },
  // 单独隐藏整行内容，保留行本身的命中区域；悬停其他下单控件时不会露出余额。
  available: { box: AVAILABLE, inner: '> *' },
};

// 只读校验：CSS 依赖的结构都必须存在，否则隐藏会静默失效（以为隐藏了其实没有）。
// 返回开关的插入锚点；当前标签页本来就没有“仅显示当前市场”时返回 null
export function verifyPrivacyStructure() {
  const boxes = document.querySelectorAll('.scroll-table-bottom-box');
  expect(boxes.length === 1, `仓位区 .scroll-table-bottom-box 应有 1 个，实际 ${boxes.length} 个`);
  const bottom = boxes[0];
  expect(bottom.closest('.react-grid-item'), '仓位区所在模块 .react-grid-item 未找到');
  // 至少要有“标签栏 + 数据区”，否则没有可隐藏的内容
  expect(bottom.children.length >= 2, '仓位区缺少数据区');

  // “资金流水”“负债管理”等标签页本来就没有“仅显示当前市场”，且 Gate 会记住上次的标签页，
  // 所以只在“仓位”标签选中时要求它存在。选中标签靠 text-c-text-1 识别，
  // 必须恰好一个，这样该类名改版时会报错而不是静默放过
  const tabs = [...(bottom.firstElementChild.firstElementChild?.children || [])];
  const active = tabs.filter((t) => t.classList.contains('text-c-text-1'));
  expect(active.length === 1, `仓位区选中的标签应有 1 个，实际 ${active.length} 个`);
  const onPositionsTab = /^仓位(\(\d+\))?$/.test(active[0].textContent.trim());

  const span = [...bottom.firstElementChild.querySelectorAll('.mantine-Checkbox-label span')].find(
    (s) => s.textContent.trim() === '仅显示当前市场'
  );
  const anchor = span?.closest('.mantine-Checkbox-root') || null;
  if (onPositionsTab) expect(anchor, '“仓位”标签下“仅显示当前市场”复选框未找到');
  expect(document.querySelector(`${ORDER} ${TARGETS.order.inner}`), '开仓模块内容区（.react-grid-item > .h-full）未找到');
  expect(document.querySelector('.asset-container_new > .assets-title'), '资产模块标题 .assets-title 未找到');
  expect(document.querySelector(`${ASSETS} ${TARGETS.assets.inner}`), '资产模块内容区未找到');
  const availableRows = document.querySelectorAll(AVAILABLE);
  expect(availableRows.length === 1, `可用余额行 ${AVAILABLE} 应有 1 个，实际 ${availableRows.length} 个`);
  const available = availableRows[0];
  expect(available.children.length === 2 && available.firstElementChild.textContent.trim() === '可用', '可用余额行标签或结构不对应');
  expect(available.querySelectorAll(':scope > div > span.text-end').length === 1, '可用余额行金额区域缺失或重复');
  return anchor;
}

// opacity: 0 能完全隐藏内容，同时保留布局和鼠标命中区域，才可以通过悬停恢复。
// 显示不做过渡，避免鼠标移入就点击时仍看不清；仅在移出时保留渐变。
function buildCss() {
  const SHOW = ':is(:hover, :focus-within)';
  return Object.entries(TARGETS).map(([key, { box, inner, revealOnSelf }]) => {
    const hidden = `html.tm-hide-${key} ${box} ${inner}`;
    const shown = revealOnSelf ? `${hidden}${SHOW}` : `html.tm-hide-${key} ${box}${SHOW} ${inner}`;
    return `
${hidden} { opacity: 0; transition: opacity .15s; }
${shown} {
  opacity: 1;
  transition: none;
}`;
  }).join('\n') + `
#${TOGGLES_ID} { display: flex; align-items: center; gap: 8px; font-size: 12px; white-space: nowrap;
  color: var(--color-text-text-secondary, #8d93a6); }
#${TOGGLES_ID} label { display: inline-flex; align-items: center; gap: 3px; cursor: pointer; }
#${TOGGLES_ID} input { margin: 0; width: 12px; height: 12px; cursor: pointer;
  accent-color: var(--color-text-text-primary, currentColor); }`;
}

function loadState() {
  const saved = GM_getValue(STORE_KEY, null);
  // 默认全部关闭：隐藏会影响看盘操作，由用户按需开启
  return Object.fromEntries(MODULES.map(({ key }) => [key, !!saved?.[key]]));
}

function applyState(state) {
  MODULES.forEach(({ key }) => document.documentElement.classList.toggle(`tm-hide-${key}`, state[key]));
}

function createToggles(state) {
  const box = document.createElement('div');
  box.id = TOGGLES_ID;
  box.innerHTML =
    '<span>隐藏</span>' +
    MODULES.map(({ key, label }) => `<label><input type="checkbox" data-key="${key}">${label}</label>`).join('');
  box.querySelectorAll('input').forEach((input) => {
    input.checked = state[input.dataset.key];
    input.addEventListener('change', () => {
      state[input.dataset.key] = input.checked;
      GM_setValue(STORE_KEY, state);
      applyState(state);
    });
  });
  return box;
}

export function initPrivacyHide() {
  addStyle(buildCss());
  const state = loadState();
  applyState(state);
  // 停用时取消所有隐藏、移除开关，页面恢复原样
  onCleanup(() => MODULES.forEach(({ key }) => document.documentElement.classList.remove(`tm-hide-${key}`)));
  onCleanup(() => document.getElementById(TOGGLES_ID)?.remove());

  // 仓位栏切换标签/合约时可能被 React 重建，所以持续校验结构并补插开关
  every(
    'privacyHide',
    () => {
      const anchor = verifyPrivacyStructure();
      // 当前标签页没有锚点：不插开关（隐藏仍按已保存的状态生效）
      if (!anchor || anchor.previousElementSibling?.id === TOGGLES_ID) return;
      document.getElementById(TOGGLES_ID)?.remove();
      anchor.before(createToggles(state));
    },
    500
  );
}
