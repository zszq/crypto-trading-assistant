# Repository Guidelines

## 项目结构与模块组织

本项目是 Gate USDT 永续合约页面的 Tampermonkey 脚本，使用 Vite 和 `vite-plugin-monkey` 构建。

- `src/main.js`：入口；`src/config.js`：共享常量。
- `src/core/`：启动校验、异常停用及生命周期清理。
- `src/features/`：均价预估与隐私隐藏功能。
- `src/gate/`：页面数据读取、合约解析和单位换算。
- `src/ui/`、`src/utils/`：界面渲染与通用数字处理。
- `vite.config.js`：构建及用户脚本元数据配置。

目前没有独立测试或静态资源目录。`dist/` 是被忽略的构建目录；根目录的 `gate-futures-helper.user.js` 是已纳入版本控制的安装产物，不应直接编辑。

## 构建与本地开发

- `npm ci`：按 `package-lock.json` 安装依赖。
- `npm run dev`：启动开发服务，通过插件安装开发脚本并热更新。
- `npm run build`：生成 `dist/gate-futures-helper.user.js`，并复制到根目录，执行后检查产物差异。
- `npm run preview`：启动 Vite 构建预览服务；脚本功能仍需在匹配的 Gate 页面验证。

版本号统一维护在 `package.json`，构建时自动写入脚本头。

## 编码风格与命名

使用 JavaScript ES Modules、两空格缩进、单引号和分号；相对导入保留 `.js` 后缀。函数、变量及模块文件采用 `camelCase`，常量采用 `UPPER_SNAKE_CASE`，错误类采用 `PascalCase`。沿用现有模块职责，注释解释设计原因和页面兼容性约束。目前没有配置 ESLint 或 Prettier，避免无关格式调整。

## 测试与验证

目前没有自动化测试框架、`npm test` 命令或覆盖率门槛。修改代码后运行 `npm run build`，并按影响范围手动验证：限价与市价、开仓与平仓、无仓位、多空仓位、列表与卡片视图、百分比数量、币与张单位，以及中文合约名。USDT 数量应继续提示不支持预估。

涉及页面结构或隐藏功能时，检查标签切换、悬停与聚焦显示、开关持久化，以及结构异常后的停用和完整清理。验证不得提交真实订单；在 PR 中记录验证场景和结果。

## 提交与 Pull Request

历史提交采用 `feat: 简短中文说明`、`fix: 简短中文说明`，初始化使用 `init:`。保持提交聚焦；PR 应说明问题、行为变化和验证结果，关联适用的 issue，界面变化附截图并遮盖账户数据。涉及源码发布时，检查构建产物是否同步更新。

## 安全约束与代理规则

先完整读取并校验页面结构，再渲染脚本自身界面。通过 `src/core/guard.js` 登记定时器、监听及清理任务，保留结构不符时整体停用的机制。不得触发交易操作或改写 Gate 原有控件，不得提交密钥、会话信息或账户数据。

代理始终使用简体中文交流，未经用户允许不得执行 `git commit`。用户要求“review，没有问题就提交”时，仅在未发现问题且未做任何修改的情况下提交；否则先汇报并等待确认。
