const AUTH_TEXT = /^(?:登录|注册|立即登录|立即注册|登录\s*[\/／或|·]\s*注册|log\s*in|sign\s*in|sign\s*up|register)$/i;
const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

// 不读取 Cookie 或会话信息。只有下单区已显示真实交易按钮才认为登录完成，
// 避免把尚未加载账号的公共下单表单误判为已登录。
export function readAccountState() {
  const box = document.querySelector('.dealbox');
  const controls = box ? [...box.querySelectorAll('button, a, [role="button"]')].filter(visible) : [];
  if (controls.some((el) => AUTH_TEXT.test(el.textContent.replace(/\s+/g, ' ').trim()))) return 'loggedOut';

  const loginLinks = [...document.querySelectorAll('a[href*="/login"], a[href*="/signin"]')];
  if (loginLinks.some((el) => visible(el) && el.getBoundingClientRect().top < 160 && AUTH_TEXT.test(el.textContent.trim()))) {
    return 'loggedOut';
  }
  if (!box) return 'pending';
  const trading = controls.some((el) => /^(?:开多|开空|平多|平空|买入\s*[/／(（]?\s*(?:[开做]多|平空)|卖出\s*[/／(（]?\s*(?:[开做]空|平多))/.test(el.textContent.trim()));
  // 表单字段由结构校验负责；否则数量框改名会被当作账号未知，绕过改版提示。
  return trading ? 'loggedIn' : 'pending';
}
