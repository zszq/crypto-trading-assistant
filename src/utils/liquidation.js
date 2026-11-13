import { divide, isDecimal, isPositive, max, min, num, weightedEntry } from './number.js';

// Gate 的维持保证金已改为梯度计算；只用第一档 maintenance_rate 会低估大仓位风险。
// 规则与推导见 docs/liquidation-research.md，计算模块保持纯函数以便用官方示例回归。
export function normalizeTiers(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const tiers = raw.map((tier) => ({
    limit: num(tier.risk_limit),
    rate: num(tier.maintenance_rate),
    deduction: num(tier.deduction),
    leverageMax: num(tier.leverage_max),
  })).sort((a, b) => isDecimal(a.limit) && isDecimal(b.limit) ? a.limit.cmp(b.limit) : 0);
  let previous = { limit: num(0), rate: num(0), deduction: num(0) };
  for (const tier of tiers) {
    if (!Object.values(tier).every(isDecimal) || !(tier.limit.gt(previous.limit) && tier.rate.gte(previous.rate) && tier.rate.lt(1) &&
      tier.deduction.gte(0) && tier.leverageMax.gte(1))) return null;
    const deduction = previous.deduction.plus(previous.limit.times(tier.rate.minus(previous.rate)));
    if (tier.deduction.minus(deduction).abs().gt(max('0.01', deduction.times('1e-8')))) return null;
    previous = tier;
  }
  return tiers;
}

export function maintenanceMargin(value, tiers, fee) {
  value = num(value);
  if (!isDecimal(value) || value.lt(0)) return NaN;
  const tier = tiers.find((item) => value.lte(item.limit));
  if (!tier) return NaN;
  return max(0, value.times(tier.rate).minus(tier.deduction)).plus(value.times(fee));
}

const positionCost = (pos) => num(pos.cost ?? num(pos.size).times(pos.entry));

export function positionPnl(positions, price) {
  price = num(price);
  return (positions.long ? num(positions.long.size).times(price).minus(positionCost(positions.long)) : num(0)).plus(
    positions.short ? positionCost(positions.short).minus(num(positions.short.size).times(price)) : 0);
}

export function hedgeMaintenance(positions, price, tiers, fee) {
  const long = num(positions.long?.size ?? 0);
  const short = num(positions.short?.size ?? 0);
  const longMargin = maintenanceMargin(long.times(price), tiers, fee);
  const shortMargin = maintenanceMargin(short.times(price), tiers, fee);
  if (![longMargin, shortMargin].every(isDecimal)) return NaN;
  return max(longMargin, shortMargin).plus(min(long, short).times(price).times(fee));
}

// 同一合约两侧使用相同的递增维持保证金函数，较大仓位决定风险档位。
// 每档内权益和维持保证金均为线性函数，直接解方程，避免二分尾差被展示规则放大。
function findBoundaries(positions, marginNumerator, marginDivisor, market) {
  const { tiers, fee, mark } = market;
  const long = num(positions.long?.size ?? 0);
  const short = num(positions.short?.size ?? 0);
  const largest = max(long, short);
  if (largest.times(mark).gt(tiers[tiers.length - 1].limit)) return { notice: '仓位超出风险档位范围' };
  const netSize = long.minus(short);
  const equityBase = marginNumerator.minus(positions.long ? positionCost(positions.long).times(marginDivisor) : 0)
    .plus(positions.short ? positionCost(positions.short).times(marginDivisor) : 0);
  if (!equityBase.plus(netSize.times(mark).times(marginDivisor))
    .minus(hedgeMaintenance(positions, mark, tiers, fee).times(marginDivisor)).gt(0)) {
    return { notice: '当前标记价已触及强平条件' };
  }

  const feeSlope = long.plus(short).times(fee);
  let lower = null;
  let upper = null;
  let previousLimit = num(0);
  for (const tier of tiers) {
    // 保留 max(0, 基础维持保证金) 的两个分支，兼容扣除数附近的零保证金区间。
    for (const active of [false, true]) {
      const maintenanceSlope = active ? largest.times(tier.rate) : num(0);
      const deduction = active ? tier.deduction.times(marginDivisor) : num(0);
      const denominator = maintenanceSlope.plus(feeSlope).minus(netSize).times(marginDivisor);
      if (denominator.eq(0)) continue;
      const price = divide(equityBase.plus(deduction), denominator);
      if (!price.gt(0)) continue;
      const value = largest.times(price);
      if (value.lt(previousLimit) || value.gt(tier.limit)) continue;
      const baseMargin = value.times(tier.rate).minus(tier.deduction);
      if (active ? baseMargin.lt(0) : baseMargin.gt(0)) continue;
      // 当前标记价处于安全区间，负斜率的零点是上界，正斜率的零点是下界。
      if (denominator.lt(0) && price.lt(mark)) lower = lower ? max(lower, price) : price;
      if (denominator.gt(0) && price.gt(mark)) upper = upper ? min(upper, price) : price;
    }
    previousLimit = tier.limit;
  }
  return lower || upper ? { lower, upper } : { notice: '风险档位内无强平价' };
}

const validPosition = (pos) => pos && isPositive(pos.entry) && isPositive(pos.size);
const notice = (text) => ({ notice: text });

export function estimateLiquidation({ positions, side, price, qty, settings, market }) {
  const pos = positions[side];
  if (!market || !validPosition(pos) || !isPositive(qty) || !isPositive(price)) {
    return notice('等待完整价格和数量');
  }
  if (settings.unsupported) return notice('暂不支持组合或多币种保证金');
  if (!pos.marginMode || !settings.marginMode) return notice('未读取到保证金模式');
  if (pos.marginMode !== settings.marginMode) return notice('下单与持仓保证金模式不一致');
  const isolated = pos.marginMode === 'isolated';
  const current = { long: null, short: null };
  for (const direction of isolated ? [side] : ['long', 'short']) {
    const item = positions[direction];
    if (!item) continue;
    if (!item.marginMode) return notice('另一方向的保证金模式不明');
    if (item.marginMode !== pos.marginMode) continue;
    if (!validPosition(item)) return notice('持仓数量换算中…');
    current[direction] = item;
  }
  if (current.long && current.short) {
    const a = current.long.liquidation;
    const b = current.short.liquidation;
    // 经典双向全仓共享强平边界；不同边界可能来自分仓/组合模式，不能混用公式。
    if (![a, b].every(isPositive) || num(a).minus(b).abs().gt(max(a, b).times('1e-5'))) {
      return notice('双向全仓强平数据不一致');
    }
  }
  let margin;
  if (isPositive(pos.liquidation)) {
    margin = hedgeMaintenance(current, pos.liquidation, market.tiers, market.fee);
    if (isDecimal(margin)) margin = margin.minus(positionPnl(current, pos.liquidation));
  } else if (isolated && isDecimal(pos.margin) && num(pos.margin).gte(0)) {
    margin = num(pos.margin);
  } else {
    return notice('缺少当前强平价或逐仓保证金');
  }
  if (!isDecimal(margin)) return notice('当前强平价超出风险档位范围');

  const notional = num(qty).times(price);
  let marginNumerator = margin;
  let marginDivisor = num(1);
  let explanation;
  if (isolated) {
    const leverage = side === 'long' ? settings.leverageLong : settings.leverageShort;
    if (!(isDecimal(leverage) && num(leverage).gte(1))) return notice('未读取到当前杠杆');
    const tier = market.tiers.find((item) => num(pos.size).plus(qty).times(max(price, market.mark)).lte(item.limit));
    if (!tier || num(leverage).gt(tier.leverageMax)) return notice('加仓规模超过当前杠杆档位');
    // 开仓费由可用资金另付；逐仓追加的是初始保证金（含预留平仓费），不能再扣一次开仓费。
    // 保留共同分母直到解方程，避免 1/杠杆及分项除法的循环小数尾差污染最终截断值。
    marginDivisor = num(leverage);
    const reserveNumerator = notional.times(market.fee).times(side === 'short' ? marginDivisor.plus(1) : marginDivisor);
    marginNumerator = margin.times(marginDivisor).plus(notional).plus(reserveNumerator);
    explanation = '逐仓：保留原仓保证金，按当前杠杆追加初始保证金及预留平仓费。';
  } else {
    // 全仓占用初始保证金只是账户内部划分，不增加总权益；只有成交手续费减少有效保证金。
    marginNumerator = margin.minus(notional.times(market.fee));
    explanation = '全仓：由当前强平价反推有效保证金，保持其他仓位当前盈亏和维持保证金不变，扣除新开仓费。';
  }
  const next = { ...current, [side]: {
    size: num(pos.size).plus(qty),
    entry: weightedEntry(pos, price, qty),
    cost: positionCost(pos).plus(notional),
  } };
  const result = findBoundaries(next, marginNumerator, marginDivisor, market);
  return {
    ...result,
    explanation: `${explanation}假设本次按委托价全部成交，仅模拟当前方向的一笔加仓。按公开 Taker 费率 ${num(market.fee).times(100).toFixed(4)}% 近似，实际费率、成交、资金费及页面价格舍入可能造成差异。`,
  };
}
