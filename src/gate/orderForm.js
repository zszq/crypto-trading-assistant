import { expect } from '../core/guard.js';
import { num } from '../utils/number.js';

// 读取下单区。只读不写：结构不对应时抛 StructureError，由 guard 处理。
// 区分“结构不对应”（抛错）和“正常的缺省状态”（如市价单没有价格框、未填数量，返回 NaN）
export function readOrderForm() {
  const boxes = document.querySelectorAll('.dealbox');
  expect(boxes.length === 1, `下单区 .dealbox 应有 1 个，实际 ${boxes.length} 个`);
  const dealbox = boxes[0];

  const qtyInputs = dealbox.querySelectorAll('input[name="f_order"]');
  expect(qtyInputs.length === 1, `数量输入框 input[name="f_order"] 应有 1 个，实际 ${qtyInputs.length} 个`);
  const qtyInput = qtyInputs[0];
  const unitEl = expect(qtyInput.closest('label')?.querySelector('span.truncate'), '数量单位 span.truncate 未找到');
  const wrapper = expect(qtyInput.closest('.mantine-InputWrapper-root'), '数量输入框外层 .mantine-InputWrapper-root 未找到');
  // 面板插在“可用”行之前，这一行找不到说明下单区布局变了
  const anchor = expect(
    [...dealbox.children].find((el) => /^可用/.test(el.textContent.trim())),
    '下单区“可用”行未找到'
  );

  // 开仓/平仓共用同一个下单区；平仓不改变均价，只在“开仓”标签下预估
  const orderModule = expect(dealbox.closest('.react-grid-item'), '下单区所在模块 .react-grid-item 未找到');
  const openTab = expect(orderModule.querySelector('#tab-long[role="tab"]'), '“开仓”标签 #tab-long 未找到');
  expect(orderModule.querySelector('#tab-short[role="tab"]'), '“平仓”标签 #tab-short 未找到');
  const isOpen = openTab.getAttribute('aria-selected') === 'true';

  const base = { dealbox, qtyInput, anchor, isOpen, price: NaN, priceStr: '', qtyLong: NaN, qtyShort: NaN, unit: '' };
  if (!isOpen) return base;

  // 取数量框之前、离它最近的可见文本框作为委托价：限价单里只有价格框，
  // 条件单里是“触发价、委托价”顺序，最近的那个正好是委托价。市价单没有价格框，属正常情况
  const before = [...dealbox.querySelectorAll('input')].filter(
    (i) =>
      i !== qtyInput &&
      i.type !== 'checkbox' &&
      i.offsetParent &&
      i.compareDocumentPosition(qtyInput) & Node.DOCUMENT_POSITION_FOLLOWING
  );
  const priceInput = before[before.length - 1];
  if (!priceInput) return base;
  base.priceStr = priceInput.value;
  base.price = num(priceInput.value);
  if (!(base.price > 0)) return base;

  const raw = qtyInput.value.trim();
  // 用滑块按百分比下单时，数量框里是“25%”，真实数量在框下方的提示里：
  // “≈ 190,638 / 184,885 WIF”，绿色是开多数量、红色是开空数量，两者不同，必须分开取。
  // 非百分比模式下这行显示的是 USDT 成本，不能当数量用，所以只在 % 时读取
  if (raw.endsWith('%')) {
    if (!(num(raw) > 0)) return base; // 0% 时提示行可能不存在
    const hint = expect(wrapper.querySelector('.mantine-InputWrapper-error'), '百分比数量提示行未找到');
    const add = expect(hint.querySelector('.font-add-color'), '百分比提示中的开多数量 .font-add-color 未找到');
    const dec = expect(hint.querySelector('.font-dec-color'), '百分比提示中的开空数量 .font-dec-color 未找到');
    const unit = expect((hint.textContent.trim().match(/\S+$/) || [''])[0], '百分比提示中的单位未找到');
    return { ...base, qtyLong: num(add.textContent), qtyShort: num(dec.textContent), unit };
  }

  const qty = num(raw);
  return { ...base, qtyLong: qty, qtyShort: qty, unit: unitEl.textContent.trim() };
}
