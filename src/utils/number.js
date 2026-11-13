import BigBase from 'big.js';

// 独立构造器避免其他代码改动计算配置；加减乘保持精确，除法统一经 divide。
export const Big = BigBase();
Big.RM = Big.roundDown;
const DIVISION_DIGITS = 100;

// 页面带千分位和单位，直接从字符串构造，不能先经过 Number。
export function num(value) {
  if (value instanceof Big) return value;
  const match = String(value ?? '').trim().replace(/,/g, '').match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
  return match ? new Big(match[0]) : NaN;
}

export const isDecimal = (value) => {
  const parsed = num(value);
  return parsed instanceof Big;
};
export const isPositive = (value) => isDecimal(value) && num(value).gt(0);
export const max = (a, b) => num(a).gte(num(b)) ? num(a) : num(b);
export const min = (a, b) => num(a).lte(num(b)) ? num(a) : num(b);

// big.js 的除法精度按小数位计数，需随数量级扩展，否则极小价格会被算成零。
export function divide(a, b) {
  const dividend = num(a);
  const divisor = num(b);
  const Division = Big();
  Division.DP = Math.max(DIVISION_DIGITS, DIVISION_DIGITS + divisor.e - dividend.e);
  Division.RM = Big.roundDown;
  return new Big(new Division(dividend).div(divisor));
}

export function weightedEntry(pos, price, qty) {
  return divide(num(pos.entry).times(pos.size).plus(num(price).times(qty)), num(pos.size).plus(qty));
}

export const PRICE_FORMAT = Object.freeze({
  normalDigits: 6,
  tinyDigits: 4,
  tinyZeroThreshold: 5,
  compactZeroThreshold: 6,
});

// 有效小数从首个非零小数开始计数；只截断展示值，不改变后续计算使用的原值。
export function formatPrice(value) {
  if (!isDecimal(value)) return '—';
  const price = num(value);
  const fraction = price.abs().toFixed().split('.')[1] || '';
  const zeros = fraction.match(/^0*/)[0].length;
  const digits = zeros > PRICE_FORMAT.tinyZeroThreshold ? PRICE_FORMAT.tinyDigits : PRICE_FORMAT.normalDigits;
  const text = price.round(zeros + digits, Big.roundDown).toFixed();
  return text.replace(/\.(0+)([1-9]\d*)$/, (match, leading, rest) =>
    leading.length > PRICE_FORMAT.compactZeroThreshold ? `.0{${leading.length}}${rest}` : match);
}
