// 页面数字带千分位逗号，且可能夹带单位
export const num = (s) => {
  const v = parseFloat(String(s ?? '').replace(/,/g, ''));
  return Number.isFinite(v) ? v : NaN;
};

export const decimalsOf = (s) => (String(s).split('.')[1] || '').replace(/\D.*$/, '').length;
