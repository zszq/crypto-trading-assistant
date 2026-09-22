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
  const unitEl = qtyInput.closest('label')?.querySelector('span.truncate');
  return {
    dealbox,
    qtyInput,
    priceStr: priceInput.value,
    price: num(priceInput.value),
    qty: num(qtyInput.value),
    unit: unitEl ? unitEl.textContent.trim() : '',
  };
}
