import { GM_xmlhttpRequest } from '$';
import { CONTRACT_API } from '../config.js';
import { num } from '../utils/number.js';

// 从 URL 取合约名，SPA 内切换币种时 URL 会变，所以每次都现取
export function getContract() {
  const m = location.pathname.match(/futures\/USDT\/([A-Z0-9]+_USDT)/i);
  if (!m) return null;
  const name = m[1].toUpperCase();
  return { name, base: name.split('_')[0], display: name.replace('_', '') };
}

const multiplierCache = {};

// 同步返回：首次调用发起请求并返回 NaN，下一轮轮询时缓存已就绪
function getMultiplier(contract) {
  const c = multiplierCache[contract];
  if (c !== undefined) return c === 'loading' ? NaN : c;
  multiplierCache[contract] = 'loading';
  GM_xmlhttpRequest({
    method: 'GET',
    url: CONTRACT_API + contract,
    onload: (r) => {
      try {
        multiplierCache[contract] = num(JSON.parse(r.responseText).quanto_multiplier);
      } catch (e) {
        delete multiplierCache[contract]; // 失败下次重试
      }
    },
    onerror: () => delete multiplierCache[contract],
  });
  return NaN;
}

// 统一换算成“币”的数量，否则仓位单位和下单单位不同时无法相加
export function toCoin(qty, unit, price, ctx) {
  if (!unit || unit === ctx.base) return qty;
  if (unit === '张') return qty * getMultiplier(ctx.name);
  if (unit === 'USDT') return price > 0 ? qty / price : NaN; // 按名义价值换算
  return NaN;
}
