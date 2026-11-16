import { expect } from '../core/guard.js';

export function readPositionArea() {
  const boxes = document.querySelectorAll('.scroll-table-bottom-box');
  expect(boxes.length === 1, `仓位区 .scroll-table-bottom-box 应有 1 个，实际 ${boxes.length} 个`);
  const bottom = boxes[0];
  expect(bottom.closest('.react-grid-item'), '仓位区所在模块 .react-grid-item 未找到');
  expect(bottom.children.length >= 2, '仓位区缺少数据区');
  const tabs = [...(bottom.firstElementChild.firstElementChild?.children || [])];
  const active = tabs.filter((tab) => tab.classList.contains('text-c-text-1'));
  expect(active.length === 1, `仓位区选中的标签应有 1 个，实际 ${active.length} 个`);
  const title = active[0].textContent.trim();
  return { bottom, onPositionsTab: /^仓位(\(\d+\))?$/.test(title), empty: /^仓位\(0\)$/.test(title) };
}
