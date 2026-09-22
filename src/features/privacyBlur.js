import { GM_getValue, GM_setValue } from '$';

// 隐私模糊：资产 / 开仓 / 仓位三个模块可按需模糊，鼠标移入或输入框聚焦时显示。
// 开关放在仓位栏“仅显示当前市场”前面，勾选的模块才模糊，默认都不勾选。
//
// 实现上全部用 CSS：开关状态挂在 <html> 的类名上，模块用 :has() 识别。
// React 重渲染会替换模块内部节点，把状态放在 <html> 上才不会丢；
// Gate 的类名多是打包 hash，只用语义化的 class/结构来定位

const TOGGLES_ID = 'tm-blur-toggles';
const STORE_KEY = 'blurModules';

const MODULES = [
  { key: 'order', label: '开仓' },
  { key: 'positions', label: '仓位' },
  { key: 'assets', label: '资产' },
];

// 各模块所在的 grid 块；Gate 类名多为打包 hash，只能靠语义 class 和结构识别
const ORDER = '.react-grid-item:has(.dealbox)';
// 仓位模块通过“包含我们插入的开关”来识别，其他特征都不稳定
const POSITIONS = `.react-grid-item:has(#${TOGGLES_ID})`;
const ASSETS = '.react-grid-item:has(.asset-container_new)';

// revealOnSelf：只有鼠标移到被模糊的内容本身（或其中输入框聚焦）才显示；
// 否则移入整个模块就显示
const TARGETS = {
  order: { box: ORDER, inner: '> .h-full > *' },
  // 各标签页结构都是“标签栏 + 1~2 行按钮/筛选 + 数据区”，数据区总在最后
  // （列表是 .table-scroll-window，详情卡片是 .flex-1），只模糊它，按钮行保持可用。
  // 开关就在这个模块的标签栏里，按模块判断的话，碰开关/点完开关留下焦点都会露出仓位，所以只看数据区本身
  positions: {
    box: POSITIONS,
    inner: `.scroll-table-bottom-box > :last-child:not(:has(#${TOGGLES_ID}))`,
    revealOnSelf: true,
  },
  // 标题栏和拖拽区保持清晰，便于认出模块、拖动布局
  assets: { box: ASSETS, inner: '.asset-container_new > :not(.rgl-drag-zone):not(.assets-title)' },
};

// 显示必须是瞬时的：过渡期间内容还是糊的，鼠标刚移入就点击会在看不清时误操作；
// 只在移出时保留渐变
function buildCss() {
  const SHOW = ':is(:hover, :focus-within)';
  return Object.entries(TARGETS)
    .map(([key, { box, inner, revealOnSelf }]) => {
      const blurred = `html.tm-blur-${key} ${box} ${inner}`;
      const shown = revealOnSelf ? `${blurred}${SHOW}` : `html.tm-blur-${key} ${box}${SHOW} ${inner}`;
      return `
${blurred} { filter: blur(6px); transition: filter .15s; }
${shown} { filter: none; transition: none; }`;
    })
    .join('\n') +
    `
#${TOGGLES_ID} { display: flex; align-items: center; gap: 8px; font-size: 12px; white-space: nowrap;
  color: var(--color-text-text-secondary, #8d93a6); }
#${TOGGLES_ID} label { display: inline-flex; align-items: center; gap: 3px; cursor: pointer; }
#${TOGGLES_ID} input { margin: 0; width: 12px; height: 12px; cursor: pointer;
  accent-color: var(--color-text-text-primary, currentColor); }`;
}

function loadState() {
  const saved = GM_getValue(STORE_KEY, null);
  // 默认全部关闭：模糊会影响看盘操作，由用户按需开启
  return Object.fromEntries(MODULES.map(({ key }) => [key, !!saved?.[key]]));
}

function applyState(state) {
  MODULES.forEach(({ key }) => document.documentElement.classList.toggle(`tm-blur-${key}`, state[key]));
}

function createToggles(state) {
  const box = document.createElement('div');
  box.id = TOGGLES_ID;
  box.innerHTML =
    '<span>模糊</span>' +
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

// “仅显示当前市场”所在的 Mantine 复选框根节点，开关插在它前面
function findAnchor() {
  const span = [...document.querySelectorAll('.mantine-Checkbox-label span')].find(
    (s) => s.textContent.trim() === '仅显示当前市场'
  );
  return span?.closest('.mantine-Checkbox-root');
}

export function initPrivacyBlur() {
  const style = document.createElement('style');
  style.textContent = buildCss();
  (document.head || document.documentElement).appendChild(style);

  const state = loadState();
  applyState(state);

  // 仓位栏是异步渲染的，切换标签/合约时也可能被 React 重建，所以持续检查并补插
  // 出错时静默跳过：开关插不进去只是少了功能，不能让异常影响页面
  setInterval(() => {
    try {
      const anchor = findAnchor();
      if (!anchor || anchor.previousElementSibling?.id === TOGGLES_ID) return;
      document.getElementById(TOGGLES_ID)?.remove();
      anchor.before(createToggles(state));
    } catch (e) {
      // ignore
    }
  }, 500);
}
