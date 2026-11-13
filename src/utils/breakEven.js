// 按当前持仓的合计未实现盈亏为零求解，不计手续费和资金费。
export function calculateBreakEven({ long, short }) {
  if (!long && !short) return { notice: '暂无持仓' };
  if (!long || !short) return { price: (long || short).entry };
  if (![long.size, short.size].every((size) => Number.isFinite(size) && size > 0)) {
    return { notice: '换算中…' };
  }

  const netSize = long.size - short.size;
  const netCost = long.size * long.entry - short.size * short.entry;
  // 合约乘数换算可能带来浮点误差，等量对冲不能除以接近零的净仓位。
  if (Math.abs(netSize) <= Math.max(long.size, short.size) * Number.EPSILON * 4) {
    // 加权均价也有舍入误差；容差随价格缩放，避免把低价币的真实价差当成零。
    const entryTolerance = Math.max(long.entry, short.entry) * Number.EPSILON * 4;
    if (Math.abs(long.entry - short.entry) <= entryTolerance) return { notice: '任意价格均平衡' };
    return { notice: short.entry > long.entry ? '无平衡价（锁盈）' : '无平衡价（锁亏）' };
  }
  const price = netCost / netSize;
  return Number.isFinite(price) && price > 0 ? { price } : { notice: '无正数平衡价' };
}

export function estimateBreakEven({ positions, side, price, qty }) {
  const pos = positions[side];
  if (!pos || !Number.isFinite(price) || !(price > 0) || !Number.isFinite(pos.entry) || !(pos.entry > 0)) {
    return { notice: '等待完整价格和数量' };
  }
  if (![pos.size, qty].every((size) => Number.isFinite(size) && size > 0)) {
    return { notice: '换算中…' };
  }
  // 多空按钮是两个独立委托方案，只替换本次加仓方向，保留另一方向的持仓。
  const size = pos.size + qty;
  const entry = (pos.size * pos.entry + qty * price) / size;
  if (!Number.isFinite(size) || !Number.isFinite(entry)) return { notice: '暂无法预估' };
  return calculateBreakEven({ ...positions, [side]: { size, entry } });
}
