# Gate 合约助手

Gate USDT 永续合约页面的 Tampermonkey 脚本，基于 Vite + vite-plugin-monkey，源码在 `src/`。

## 功能

- **开仓后均价预估**：在限价单里填好价格和数量后，数量滑块下方显示“开多/开空后均价”及相对原均价的变化。只显示已有仓位的方向，没有仓位时不显示。
- **市价平仓弹窗**：点击仓位里的“市价”后，取消弹窗的垂直居中。

### 均价计算

```
新均价 = (仓位数量 × 开仓均价 + 下单数量 × 委托价) / (仓位数量 + 下单数量)
```

仓位数量和下单数量都会先换算成币的数量：

| 单位 | 换算方式 |
|---|---|
| 币（如 WIF） | 直接使用 |
| 张 | × 合约乘数（`quanto_multiplier`，来自公开接口 `api.gateio.ws`） |
| USDT | ÷ 委托价，按名义价值处理 |

### 页面读取方式

- 委托价：`.dealbox` 里数量框之前、离它最近的可见输入框。
- 数量：`input[name="f_order"]`，单位取自同一个 label 里的 `span.truncate`。
- 百分比数量：用滑块下单时数量框显示 `25%`，真实数量取自数量框下方的提示 `≈ 190,638 / 184,885 WIF`，绿色（`.font-add-color`）是开多数量，红色（`.font-dec-color`）是开空数量，两边分别计算。普通模式下这一行显示的是 USDT 成本，不读取。
- 仓位：同时支持“列表”视图（`table.position-table`）和“详情”卡片视图（按“数量”“开仓均价”标签取下一行的值）。

页面是 React 渲染，滑块等程序化修改不会触发 input 事件，所以每 300ms 轮询一次（结果不变时不重绘），手动输入时额外立即刷新。

## 常用命令

```bash
npm install
npm run dev     # 开发模式，由插件处理脚本安装与热更新
npm run build   # 构建 dist/gate-futures-helper.user.js，并复制到根目录
```

根目录的 `gate-futures-helper.user.js` 就是可以直接安装的脚本。版本号只写在 `package.json` 里，构建时会自动写进脚本头。

## 排查问题

Gate 改版后如果读取失败：打开控制台，把日志级别设成“详细”（Verbose），过滤 `[均价预估]`，就能看到脚本实际读到的价格、数量、单位和仓位。

## 目录结构

```text
src/
├── main.js               # 入口，初始化各功能
├── config.js             # 常量（面板 id、轮询间隔、接口地址）
├── features/
│   ├── avgPreview.js     # 均价预估：轮询、计算、决定显示/隐藏
│   └── modalFix.js       # 市价平仓弹窗处理
├── gate/
│   ├── contract.js       # 合约名解析、合约乘数、单位换算
│   ├── orderForm.js      # 读取下单区的价格/数量/单位
│   └── positions.js      # 读取仓位（列表 + 卡片视图）
├── ui/
│   └── avgPanel.js       # 面板挂载与渲染
└── utils/
    └── number.js         # 数字解析
```
