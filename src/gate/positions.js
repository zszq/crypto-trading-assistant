import { expect } from '../core/guard.js';
import { num } from '../utils/number.js';
import { isSupportedUnit, toCoin } from './contract.js';

const sideOf = (texts) => (texts.includes('多') ? 'long' : texts.includes('空') ? 'short' : null);

// 读取仓位。只读不写：结构不对应时抛 StructureError。
// 没有仓位、不在仓位标签页时列表/卡片都不存在，属正常情况，返回空结果。
// 仓位区有“列表”（table）和“详情”（卡片）两种视图，窄屏默认是卡片，两种都要支持
export function readPositions(ctx) {
  const result = { long: null, short: null };
  const add = (where, name, side, sizeText, entryText) => {
    const entry = num(entryText);
    const size = Math.abs(num(sizeText));
    // 每一行都校验，而不只是当前合约：任何一行读不出来都说明结构变了
    expect(name, `${where}中合约名未找到`);
    expect(side, `${where}中多/空方向未找到`);
    expect(entry > 0, `${where}中开仓均价无法解析：“${entryText}”`);
    expect(size > 0, `${where}中数量无法解析：“${sizeText}”`);
    if (name !== ctx.display) return;
    const unit = (sizeText.match(/[^\d.,\s-]+$/) || [''])[0];
    // 仓位单位跟随下单单位设置，USDT 模式下直接视为不可用
    result[side] = { entry, entryText, size: isSupportedUnit(unit, ctx) ? toCoin(size, unit, ctx) : NaN };
  };

  document.querySelectorAll('table.position-table').forEach((table) => {
    expect(table.querySelector('th.size') && table.querySelector('th.entry_price'), '仓位列表表头“数量/开仓均价”列未找到');
    table.querySelectorAll('tbody tr').forEach((tr) => {
      // 只有一个单元格的是“暂无数据”之类的占位行
      if (tr.cells.length <= 1) return;
      const badges = [...tr.querySelectorAll('.mantine-Badge-label')].map((b) => b.textContent.trim());
      add(
        '仓位列表',
        tr.querySelector('td span.text-b10')?.textContent.replace(/\s/g, ''),
        sideOf(badges),
        expect(tr.querySelector('td.size'), '仓位列表中数量单元格 td.size 未找到').textContent.trim(),
        expect(tr.querySelector('td.entry_price'), '仓位列表中开仓均价单元格 td.entry_price 未找到').textContent.trim()
      );
    });
  });

  // 卡片视图没有语义化 class，只能按“标签文字 → 下一行是值”来解析
  document.querySelectorAll('span.underline-dashed').forEach((label) => {
    if (label.textContent.trim() !== '开仓均价' || label.closest('table')) return;
    // 资产等其他模块若也出现“开仓均价”标签，不属于仓位卡片
    if (!label.closest('.scroll-table-bottom-box')) return;
    let card = label.parentElement;
    // 合约名可能是中文，不能限定为 [A-Z0-9]
    while (card && !/^\S+USDT\n/.test(card.innerText)) card = card.parentElement;
    expect(card, '仓位卡片未找到（以合约名开头的容器）');
    const lines = card.innerText.split('\n').map((s) => s.trim());
    const qtyIdx = lines.indexOf('数量');
    expect(qtyIdx > 0, '仓位卡片中“数量”标签未找到');
    add('仓位卡片', lines[0], sideOf(lines.slice(0, qtyIdx)), lines[qtyIdx + 1] || '', lines[lines.indexOf('开仓均价') + 1] || '');
  });
  return result;
}
