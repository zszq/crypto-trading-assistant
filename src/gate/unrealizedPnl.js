import { expect } from '../core/guard.js';
import { num } from '../utils/number.js';

export function readUnrealizedPnl() {
  // 仅读取资产区的汇总字段，避免把仓位列表中单个合约的盈亏当成全部仓位盈亏。
  const labels = [...document.querySelectorAll('.asset-container_new span.underline-dotted')]
    .filter((label) => label.textContent.trim() === '未实现盈亏');
  expect(labels.length === 1, `资产区“未实现盈亏”应有 1 个，实际 ${labels.length} 个`);
  const values = labels[0].parentElement.querySelectorAll('.order-right-trans-container');
  expect(values.length === 1, '未实现盈亏数值容器应有 1 个');
  const text = values[0].textContent.trim().replace(/−/g, '-');
  // 必须完整匹配金额和 USDT 单位，不能将占位符、百分比或其他币种误读为金额。
  expect(/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?\s*USDT$/.test(text),
    '未实现盈亏不是有效的 USDT 金额');
  // big.js 不接受显式正号，盈利金额需要先去掉它。
  return num(text.replace(/^\+/, ''));
}
