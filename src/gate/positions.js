import { num } from '../utils/number.js';
import { toCoin } from './contract.js';

const sideOf = (texts) => (texts.includes('多') ? 'long' : texts.includes('空') ? 'short' : null);

// 仓位区有“列表”（table）和“详情”（卡片）两种视图，窄屏默认是卡片，两种都要支持
export function readPositions(ctx) {
  const result = { long: null, short: null };
  const add = (name, side, sizeText, entryText) => {
    if (name !== ctx.display || !side) return;
    const entry = num(entryText);
    const size = Math.abs(num(sizeText));
    const unit = (sizeText.match(/[^\d.,\s-]+$/) || [''])[0];
    if (!(entry > 0) || !(size > 0)) return;
    result[side] = { entry, entryText, size: toCoin(size, unit, entry, ctx) };
  };

  document.querySelectorAll('table.position-table tbody tr').forEach((tr) => {
    const badges = [...tr.querySelectorAll('.mantine-Badge-label')].map((b) => b.textContent.trim());
    add(
      tr.querySelector('td span.text-b10')?.textContent.replace(/\s/g, ''),
      sideOf(badges),
      tr.querySelector('td.size')?.textContent.trim() || '',
      tr.querySelector('td.entry_price')?.textContent.trim() || ''
    );
  });

  // 卡片视图没有语义化 class，只能按“标签文字 → 下一行是值”来解析
  document.querySelectorAll('span.underline-dashed').forEach((label) => {
    if (label.textContent.trim() !== '开仓均价' || label.closest('table')) return;
    let card = label.parentElement;
    while (card && !/^[A-Z0-9]+USDT\n/.test(card.innerText)) card = card.parentElement;
    if (!card) return;
    const lines = card.innerText.split('\n').map((s) => s.trim());
    const after = (key) => lines[lines.indexOf(key) + 1] || '';
    add(lines[0], sideOf(lines.slice(0, lines.indexOf('数量'))), after('数量'), after('开仓均价'));
  });
  return result;
}
