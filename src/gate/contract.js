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

// 失败后隔一段时间再试：轮询是 300ms 一次，立即重试会在接口不通时持续刷请求
const RETRY_MS = 30000;
const multiplierCache = {};

// 同步返回：首次调用发起请求并返回 NaN，下一轮轮询时缓存已就绪
function getMultiplier(contract) {
  const c = multiplierCache[contract];
  if (typeof c === 'number') return c;
  if (c && (c.loading || Date.now() - c.failedAt < RETRY_MS)) return NaN;
  multiplierCache[contract] = { loading: true };
  const fail = () => (multiplierCache[contract] = { failedAt: Date.now() });
  GM_xmlhttpRequest({
    method: 'GET',
    url: CONTRACT_API + contract,
    timeout: 10000,
    onload: (r) => {
      const v = (() => {
        try {
          return num(JSON.parse(r.responseText).quanto_multiplier);
        } catch (e) {
          return NaN;
        }
      })();
      if (v > 0) multiplierCache[contract] = v;
      else fail();
    },
    onerror: fail,
    ontimeout: fail,
  });
  return NaN;
}

// 统一换算成“币”的数量，否则仓位单位和下单单位不同时无法相加。
// USDT 单位的含义（名义价值还是保证金）未经验证，算错会误导下单，所以不支持
export const isSupportedUnit = (unit, ctx) => !unit || unit === ctx.base || unit === '张';

export function toCoin(qty, unit, ctx) {
  if (!unit || unit === ctx.base) return qty;
  if (unit === '张') return qty * getMultiplier(ctx.name);
  return NaN;
}
