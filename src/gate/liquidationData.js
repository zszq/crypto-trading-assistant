import { CONTRACT_API } from '../config.js';
import { readContractDetails } from './contract.js';
import { readPublicData } from './publicData.js';
import { readOrderRisk } from './riskFields.js';
import { normalizeTiers } from '../utils/liquidation.js';

export function readLiquidationData(ctx, form) {
  const module = form.dealbox.closest('.react-grid-item');
  const settings = readOrderRisk(module);
  const assetText = document.querySelector('.asset-container_new')?.innerText || '';
  settings.unsupported ||= /组合保证金|多币种保证金|跨币种保证金/.test(assetText);
  const details = readContractDetails(ctx.name);
  const tiers = readPublicData(CONTRACT_API.replace(/contracts\/$/, 'risk_limit_tiers?contract=') + encodeURIComponent(ctx.name));
  const unavailable = [details.status, tiers.status].includes('unavailable');
  if (details.status !== 'ready' || tiers.status !== 'ready') {
    return { settings, loading: !unavailable, notice: unavailable ? '行情接口暂不可用' : '读取风险参数中…' };
  }
  const contract = details.data;
  const normalized = normalizeTiers(tiers.data);
  const fee = Number.parseFloat(contract.taker_fee_rate);
  const mark = Number.parseFloat(contract.mark_price);
  if (contract.name !== ctx.name || contract.type !== 'direct' || !Number.isFinite(mark) || !(mark > 0) || !(fee >= 0 && fee < 0.1) || !normalized) {
    return { settings, notice: '合约风险参数不完整' };
  }
  return { settings, market: { fee, mark, tiers: normalized } };
}
