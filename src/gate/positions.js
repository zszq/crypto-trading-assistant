import { expect, PendingError } from '../core/guard.js';
import { isDecimal, isPositive, num } from '../utils/number.js';
import { isSupportedUnit, toCoin } from './contract.js';
import { isLiquidationLabel, isMarginLabel, parsePositionRisk } from './riskFields.js';
import { readPositionArea } from './positionArea.js';

const sideOf = (texts) => (texts.includes('多') ? 'long' : texts.includes('空') ? 'short' : null);

// 读取仓位。只读不写：结构不对应时抛 StructureError。
// 其他标签没有持仓 DOM，不能把这种情况当作已确认的空仓，也不能复用旧仓位计算。
// 仓位区有“列表”（table）和“详情”（卡片）两种视图，窄屏默认是卡片，两种都要支持
export function readPositions(ctx) {
  const { bottom, onPositionsTab, empty } = readPositionArea();
  const result = { long: null, short: null, status: 'ready' };
  if (!onPositionsTab) return { ...result, status: 'unavailable', notice: '请切回“仓位”标签读取当前持仓' };
  const content = bottom.lastElementChild;
  if (content.matches('[aria-busy="true"]') || content.querySelector('[aria-busy="true"], [role="progressbar"], .mantine-Loader-root')) {
    throw new PendingError('持仓数据加载中…');
  }
  let rows = 0;
  let emptyTable = false;
  const add = (where, name, side, sizeText, entryText, risk) => {
    const entry = num(entryText);
    const size = isDecimal(num(sizeText)) ? num(sizeText).abs() : NaN;
    // 每一行都校验，而不只是当前合约：任何一行读不出来都说明结构变了
    expect(name, `${where}中合约名未找到`);
    expect(side, `${where}中多/空方向未找到`);
    expect(isPositive(entry), `${where}中开仓均价无法解析：“${entryText}”`);
    expect(isPositive(size), `${where}中数量无法解析：“${sizeText}”`);
    rows++;
    if (name !== ctx.display) return;
    const unit = (sizeText.match(/[^\d.,\s-]+$/) || [''])[0];
    // 仓位单位跟随下单单位设置，USDT 模式下直接视为不可用
    expect(!result[side], `${where}中同方向有多个仓位，无法确认加仓归属`);
    result[side] = { entry, entryText, size: isSupportedUnit(unit, ctx) ? toCoin(size, unit, ctx) : NaN, ...risk };
  };

  const tables = content.matches('table.position-table') ? [content] : [...content.querySelectorAll('table.position-table')];
  tables.forEach((table) => {
    expect(table.querySelector('th.size') && table.querySelector('th.entry_price'), '仓位列表表头“数量/开仓均价”列未找到');
    const headers = [...table.querySelectorAll('thead th')];
    const liqIndex = headers.findIndex((th) => isLiquidationLabel(th.textContent));
    const marginIndex = headers.findIndex((th) => isMarginLabel(th.textContent));
    const bodyRows = [...table.querySelectorAll('tbody tr')];
    // 表头和 tbody 均已就绪的空表也是正常筛选结果，不能依赖可选的“(0)”或空状态文案。
    if (table.querySelector('tbody') && bodyRows.length === 0) emptyTable = true;
    bodyRows.forEach((tr) => {
      // 只有一个单元格的是“暂无数据”之类的占位行
      if (tr.cells.length <= 1) return;
      const badges = [...tr.querySelectorAll('.mantine-Badge-label')].map((b) => b.textContent.trim());
      add(
        '仓位列表',
        tr.querySelector('td span.text-b10')?.textContent.replace(/\s/g, ''),
        sideOf(badges),
        expect(tr.querySelector('td.size'), '仓位列表中数量单元格 td.size 未找到').textContent.trim(),
        expect(tr.querySelector('td.entry_price'), '仓位列表中开仓均价单元格 td.entry_price 未找到').textContent.trim(),
        parsePositionRisk(tr.innerText, tr.cells[marginIndex]?.innerText, tr.cells[liqIndex]?.innerText)
      );
    });
  });

  // 卡片视图没有语义化 class，只能按“标签文字 → 下一行是值”来解析
  content.querySelectorAll('span.underline-dashed').forEach((label) => {
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
    const field = (matches) => {
      const index = lines.findIndex(matches);
      return index >= 0 ? lines[index + 1] : '';
    };
    add(
      '仓位卡片', lines[0], sideOf(lines.slice(0, qtyIdx)), lines[qtyIdx + 1] || '',
      lines[lines.indexOf('开仓均价') + 1] || '',
      parsePositionRisk(lines.slice(0, qtyIdx).join(' '), field(isMarginLabel), field(isLiquidationLabel))
    );
  });
  // 空仓计数、空状态提示或完整空表可确认无仓位；缺少数据视图的中间帧继续等待。
  const emptyNotice = /暂无(?:数据|仓位|持仓)|没有(?:仓位|持仓)|无持仓/.test(content.textContent);
  if ((rows > 0 && empty) || (!rows && !empty && !emptyNotice && !emptyTable)) {
    throw new PendingError('持仓数据加载中…');
  }
  return result;
}
