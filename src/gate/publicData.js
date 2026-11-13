import { GM_xmlhttpRequest } from '$';
import { isDisabled, onCleanup } from '../core/guard.js';

const cache = new Map();
const requests = new Set();
const RETRY_MS = 30000;

onCleanup(() => {
  requests.forEach((request) => request.abort?.());
  requests.clear();
  cache.clear();
});

// 过期数据不继续参与风险预估；请求失败退避，且公共接口不携带账号凭据。
export function readPublicData(url, ttl = 30000) {
  if (isDisabled()) return { status: 'unavailable' };
  const now = Date.now();
  const old = cache.get(url);
  if (old?.data && now - old.at < ttl) return { status: 'ready', data: old.data };
  if (old?.loading) return { status: 'loading' };
  if (old?.failedAt && now - old.failedAt < RETRY_MS) return { status: 'unavailable' };
  const entry = { loading: true };
  cache.set(url, entry);
  let request;
  const finish = (data) => {
    requests.delete(request);
    if (isDisabled() || cache.get(url) !== entry) return;
    cache.set(url, data ? { data, at: Date.now() } : { failedAt: Date.now() });
  };
  request = GM_xmlhttpRequest({
    method: 'GET', url, anonymous: true, timeout: 10000,
    onload: (response) => {
      try {
        finish(response.status >= 200 && response.status < 300 ? JSON.parse(response.responseText) : null);
      } catch (_) {
        finish(null);
      }
    },
    onerror: () => finish(null),
    ontimeout: () => finish(null),
    onabort: () => finish(null),
  });
  if (entry === cache.get(url)) requests.add(request);
  return { status: 'loading' };
}
