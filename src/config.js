export const PANEL_ID = 'tm-avg-preview';

// 页面是 React 渲染，输入框值由滑块/快捷按钮程序化修改时不会触发 input 事件，
// DOM 观察和交互事件负责及时刷新，轻量轮询 + 结果缓存兜住未产生事件的改值及接口完成
export const TICK_MS = 300;

export const LOSS_ALERT_THRESHOLD = 100;

export const CONTRACT_API = 'https://api.gateio.ws/api/v4/futures/usdt/contracts/';
