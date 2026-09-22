import { num } from '../utils/number.js';

export function readOrderForm() {
  const dealbox = document.querySelector('.dealbox');
  if (!dealbox) return null;
  const qtyInput = dealbox.querySelector('input[name="f_order"]');
  if (!qtyInput) return null;
  // 取数量框之前、离它最近的可见文本框作为委托价：限价单里只有价格框，
  // 条件单里是“触发价、委托价”顺序，最近的那个正好是委托价。
  // 不按“价格”文字定位、也不取块里第一个 input，是因为那样可能拿到隐藏的/不随输入变化的框
  const before = [...dealbox.querySelectorAll('input')].filter(
    (i) =>
      i !== qtyInput &&
      i.type !== 'checkbox' &&
      i.offsetParent &&
      i.compareDocumentPosition(qtyInput) & Node.DOCUMENT_POSITION_FOLLOWING
  );
  const priceInput = before[before.length - 1];
  // 市价单没有价格框
  if (!priceInput) return { dealbox, qtyInput };
  const base = { dealbox, qtyInput, priceStr: priceInput.value, price: num(priceInput.value) };

  // 用滑块按百分比下单时，数量框里是“25%”，真实数量在框下方的提示里：
  // “≈ 190,638 / 184,885 WIF”，绿色是开多数量、红色是开空数量，两者不同，必须分开取。
  // 非百分比模式下这行显示的是 USDT 成本，不能当数量用，所以只在 % 时读取
  if (qtyInput.value.trim().endsWith('%')) {
    const hint = qtyInput.closest('.mantine-InputWrapper-root')?.querySelector('.mantine-InputWrapper-error');
    return {
      ...base,
      qtyLong: num(hint?.querySelector('.font-add-color')?.textContent),
      qtyShort: num(hint?.querySelector('.font-dec-color')?.textContent),
      unit: (hint?.textContent.trim().match(/\S+$/) || [''])[0],
    };
  }

  const unitEl = qtyInput.closest('label')?.querySelector('span.truncate');
  const qty = num(qtyInput.value);
  return { ...base, qtyLong: qty, qtyShort: qty, unit: unitEl ? unitEl.textContent.trim() : '' };
}
