export const PANEL_ID = 'tm-avg-preview';

// 页面是 React 渲染，输入框值由滑块/快捷按钮程序化修改时不会触发 input 事件，
// 仓位数据也随推送刷新，所以用轻量轮询 + 结果缓存兜底
export const TICK_MS = 300;

export const CONTRACT_API = 'https://api.gateio.ws/api/v4/futures/usdt/contracts/';
