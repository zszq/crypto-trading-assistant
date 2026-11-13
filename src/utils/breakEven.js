import { divide, isPositive, num, weightedEntry } from './number.js';

// 按当前持仓的合计未实现盈亏为零求解，不计手续费和资金费。
export function calculateBreakEven({ long, short }) {
  if (!long && !short) return { notice: '暂无持仓' };
  if (!long || !short) return { price: num((long || short).entry) };
  if (![long.size, short.size].every(isPositive)) return { notice: '换算中…' };

  const netSize = num(long.size).minus(short.size);
  const netCost = num(long.cost ?? num(long.size).times(long.entry)).minus(short.cost ?? num(short.size).times(short.entry));
  // 十进制换算后可以精确判断等量对冲，不再用浮点容差吞掉真实的小额净仓位。
  if (netSize.eq(0)) {
    if (netCost.eq(0)) return { notice: '任意价格均平衡' };
    return { notice: netCost.lt(0) ? '无平衡价（锁盈）' : '无平衡价（锁亏）' };
  }
  const price = divide(netCost, netSize);
  return price.gt(0) ? { price } : { notice: '无正数平衡价' };
}

export function estimateBreakEven({ positions, side, price, qty }) {
  const pos = positions[side];
  if (!pos || !isPositive(price) || !isPositive(pos.entry)) return { notice: '等待完整价格和数量' };
  if (![pos.size, qty].every(isPositive)) return { notice: '换算中…' };
  // 多空按钮是两个独立委托方案，只替换本次加仓方向，保留另一方向的持仓。
  const size = num(pos.size).plus(qty);
  const entry = weightedEntry(pos, price, qty);
  // 保留精确成本，避免循环小数均价再乘数量后影响等量对冲判断。
  const cost = num(pos.size).times(pos.entry).plus(num(qty).times(price));
  return calculateBreakEven({ ...positions, [side]: { size, entry, cost } });
}
