import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.js',
      // version 不写，由插件读取 package.json，保证只有一处版本号
      userscript: {
        name: 'Gate 合约助手',
        namespace: 'http://tampermonkey.net/',
        description: 'Gate USDT 永续合约：登录后预估加仓均价与强平价，支持亏损提醒和模块隐私模糊',
        author: 'zl',
        match: ['https://www.gate.com/*futures/USDT/*', 'https://www.gate.io/*futures/USDT/*'],
        // 数量单位为“张”时需要合约乘数，走公开行情接口
        connect: ['api.gateio.ws'],
      },
      build: {
        fileName: 'gate-futures-helper.user.js',
      },
    }),
  ],
});
