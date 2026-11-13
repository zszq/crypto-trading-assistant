import { CONTRACT_API } from '../config.js';
import { isPositive, num } from '../utils/number.js';
import { readPublicData } from './publicData.js';

// 从 URL 取合约名，SPA 内切换币种时 URL 会变，所以每次都现取
export function getContract() {
  // 存在中文等非 ASCII 合约名（如 龙虾_USDT），地址栏里是百分号编码，需先解码再匹配
  let path;
  try {
    path = decodeURIComponent(location.pathname);
  } catch (e) {
    return null;
  }
  const m = path.match(/futures\/USDT\/([^/_\s]+_USDT)/i);
  if (!m) return null;
  const name = m[1].toUpperCase();
  return { name, base: name.split('_')[0], display: name.replace('_', '') };
}

export const readContractDetails = (contract) => readPublicData(CONTRACT_API + encodeURIComponent(contract));

// 统一换算成“币”的数量，否则仓位单位和下单单位不同时无法相加。
// USDT 单位的含义（名义价值还是保证金）未经验证，算错会误导下单，所以不支持
export const isSupportedUnit = (unit, ctx) => !unit || unit === ctx.base || unit === '张';

export function toCoin(qty, unit, ctx) {
  if (!unit || unit === ctx.base) return qty;
  if (unit === '张') {
    const details = readContractDetails(ctx.name).data;
    const multiplier = num(details?.quanto_multiplier);
    return details?.name === ctx.name && isPositive(multiplier) && isPositive(qty) ? num(qty).times(multiplier) : NaN;
  }
  return NaN;
}
