// Gate 的维持保证金已改为梯度计算；只用第一档 maintenance_rate 会低估大仓位风险。
// 规则与推导见 docs/liquidation-research.md，计算模块保持纯函数以便用官方示例回归。
export function normalizeTiers(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const tiers = raw.map((tier) => ({
    limit: Number.parseFloat(tier.risk_limit),
    rate: Number.parseFloat(tier.maintenance_rate),
    deduction: Number.parseFloat(tier.deduction),
    leverageMax: Number.parseFloat(tier.leverage_max),
  })).sort((a, b) => a.limit - b.limit);
  let previous = { limit: 0, rate: 0, deduction: 0 };
  for (const tier of tiers) {
    if (!Object.values(tier).every(Number.isFinite) || !(tier.limit > previous.limit && tier.rate >= previous.rate && tier.rate < 1 &&
      tier.deduction >= 0 && tier.leverageMax >= 1)) return null;
    const deduction = previous.deduction + previous.limit * (tier.rate - previous.rate);
    if (Math.abs(tier.deduction - deduction) > Math.max(0.01, deduction * 1e-8)) return null;
    previous = tier;
  }
  return tiers;
}

export function maintenanceMargin(value, tiers, fee) {
  const tier = tiers.find((item) => value <= item.limit * (1 + 1e-12));
  if (!tier || !(value >= 0)) return NaN;
  return Math.max(0, value * tier.rate - tier.deduction) + value * fee;
}

export function positionPnl(positions, price) {
  return (positions.long ? positions.long.size * (price - positions.long.entry) : 0) +
    (positions.short ? positions.short.size * (positions.short.entry - price) : 0);
}

export function hedgeMaintenance(positions, price, tiers, fee) {
  const long = positions.long?.size || 0;
  const short = positions.short?.size || 0;
  return Math.max(maintenanceMargin(long * price, tiers, fee), maintenanceMargin(short * price, tiers, fee)) +
    Math.min(long, short) * price * fee;
}

// 梯度维持保证金是连续凸函数，权益是线性函数，安全区间因此连续。
// 分别向下、向上求边界，兼容接近对冲时可能同时存在的两个强平边界。
function findBoundaries(positions, margin, market) {
  const { tiers, fee, mark } = market;
  const maxPrice = tiers[tiers.length - 1].limit / Math.max(positions.long?.size || 0, positions.short?.size || 0);
  const balance = (price) => margin + positionPnl(positions, price) - hedgeMaintenance(positions, price, tiers, fee);
  if (!(maxPrice >= mark)) return { notice: '仓位超出风险档位范围' };
  if (!(balance(mark) > 0)) return { notice: '当前标记价已触及强平条件' };
  const bisect = (a, b) => {
    const positiveAtA = balance(a) > 0;
    for (let i = 0; i < 64; i++) {
      const mid = (a + b) / 2;
      if ((balance(mid) > 0) === positiveAtA) a = mid;
      else b = mid;
    }
    return (a + b) / 2;
  };
  const lower = balance(0) < 0 ? bisect(0, mark) : null;
  const upper = balance(maxPrice) <= 0 ? bisect(mark, maxPrice) : null;
  return lower || upper ? { lower, upper } : { notice: '风险档位内无强平价' };
}

const validPosition = (pos) => pos && Number.isFinite(pos.entry) && pos.entry > 0 && Number.isFinite(pos.size) && pos.size > 0;
const notice = (text) => ({ notice: text });

export function estimateLiquidation({ positions, side, price, qty, settings, market }) {
  const pos = positions[side];
  if (!market || !validPosition(pos) || !Number.isFinite(qty) || !(qty > 0) || !Number.isFinite(price) || !(price > 0)) {
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
    if (!(a > 0 && b > 0) || Math.abs(a - b) > Math.max(a, b) * 1e-5) {
      return notice('双向全仓强平数据不一致');
    }
  }
  let margin;
  if (pos.liquidation > 0 && Number.isFinite(pos.liquidation)) {
    margin = hedgeMaintenance(current, pos.liquidation, market.tiers, market.fee) - positionPnl(current, pos.liquidation);
  } else if (isolated && Number.isFinite(pos.margin) && pos.margin >= 0) {
    margin = pos.margin;
  } else {
    return notice('缺少当前强平价或逐仓保证金');
  }
  if (!Number.isFinite(margin)) return notice('当前强平价超出风险档位范围');

  const notional = qty * price;
  let explanation;
  if (isolated) {
    const leverage = side === 'long' ? settings.leverageLong : settings.leverageShort;
    if (!(Number.isFinite(leverage) && leverage >= 1)) return notice('未读取到当前杠杆');
    const tier = market.tiers.find((item) => (pos.size + qty) * Math.max(price, market.mark) <= item.limit);
    if (!tier || leverage > tier.leverageMax * (1 + 1e-8)) return notice('加仓规模超过当前杠杆档位');
    // 开仓费由可用资金另付；逐仓追加的是初始保证金（含预留平仓费），不能再扣一次开仓费。
    const closeReserve = notional * market.fee * (side === 'short' ? 1 + 1 / leverage : 1);
    margin += notional / leverage + closeReserve;
    explanation = '逐仓：保留原仓保证金，按当前杠杆追加初始保证金及预留平仓费。';
  } else {
    // 全仓占用初始保证金只是账户内部划分，不增加总权益；只有成交手续费减少有效保证金。
    margin -= notional * market.fee;
    explanation = '全仓：由当前强平价反推有效保证金，保持其他仓位当前盈亏和维持保证金不变，扣除新开仓费。';
  }
  const next = { ...current, [side]: {
    size: pos.size + qty,
    entry: (pos.size * pos.entry + notional) / (pos.size + qty),
  } };
  const result = findBoundaries(next, margin, market);
  return {
    ...result,
    explanation: `${explanation}假设本次按委托价全部成交，仅模拟当前方向的一笔加仓。按公开 Taker 费率 ${(market.fee * 100).toFixed(4)}% 近似，实际费率、成交、资金费及页面价格舍入可能造成差异。`,
  };
}
