# 六 AI 圆桌辩论（Multi-AI Debate Arena）

让 **ChatGPT、Claude、Codex、DeepSeek、Gemini、豆包** 六个 AI 进入同一个群聊，围绕你给出的议题自动轮次发言、互相反驳，最后各自给出立场与理由，并汇总出多数结论与分歧点。

- 中文界面，手机 / 电脑浏览器均可访问（响应式布局）
- 后端零第三方依赖（Node.js 内置模块），前端原生 HTML/CSS/JS
- 不购买任何付费服务；仅消耗你自己在各家开放平台的 API 额度
- 密钥只保存在本机浏览器 localStorage 或服务端 `.env`，不写入 Git、不上传仓库

## 一、快速开始

### 1. 环境要求
- Node.js ≥ 18（推荐 20+），无需 `npm install`。

### 2. 启动
```bash
# 克隆后进入目录
cd multi-ai-debate-arena

# 可选：复制环境变量模板（不复制也能在网页上填密钥）
cp .env.example .env

# 启动
node server.js
```

启动后终端会输出：
- 本机访问：`http://localhost:3210`
- 手机访问：电脑与手机连同一 Wi-Fi，浏览器打开 `http://<电脑局域网 IP>:3210`

### 3. 使用
1. 点击右上角「接入配置」，填入你已有密钥的 AI 的 API Key（模型名、Base URL 可保持默认），关闭抽屉。
2. 勾选参与讨论的 AI，输入议题，选择辩论轮数（1~5）。
3. 点击「开始讨论」：每位 AI 依次发言，后续轮次会主动反驳不同观点；结束后自动汇总立场与共识。
4. 讨论过程中可随时点「停止」中断。

## 二、六家接入配置清单

| AI | 接入类型 | 默认 Base URL | 默认模型 | 环境变量 | 密钥获取 |
| --- | --- | --- | --- | --- | --- |
| ChatGPT | OpenAI 兼容 | `https://api.openai.com/v1` | `gpt-4o-mini` | `OPENAI_API_KEY` | platform.openai.com/api-keys |
| Claude | Anthropic 原生 | `https://api.anthropic.com` | `claude-haiku-4-5` | `ANTHROPIC_API_KEY` | console.anthropic.com/keys |
| Codex | OpenAI 兼容端点 | `https://api.openai.com/v1` | `gpt-5-codex` | `CODEX_API_KEY`（未填时复用 `OPENAI_API_KEY`） | 同 OpenAI |
| DeepSeek | OpenAI 兼容 | `https://api.deepseek.com` | `deepseek-chat` | `DEEPSEEK_API_KEY` | platform.deepseek.com/api_keys |
| Gemini | Google 原生 | `https://generativelanguage.googleapis.com` | `gemini-2.0-flash` | `GEMINI_API_KEY` | aistudio.google.com/apikey |
| 豆包 | 火山方舟 OpenAI 兼容 | `https://ark.cn-beijing.volces.com/api/v3` | 填你的接入点 ID（如 `doubao-pro-32k`） | `DOUBAO_API_KEY` | console.volcengine.com/ark |

填写位置二选一：
- **网页端**：右上角「接入配置」，填写后存于浏览器 localStorage；
- **服务端**：在 `.env` 文件中按 `.env.example` 模板填写。

### 模型名说明
- 各厂商模型迭代很快，若默认模型名不可用，在配置里改成你账号实际可用的模型名即可。
- 豆包方舟控制台创建「推理接入点」后，把接入点 ID（`ep-xxxxxx`）填入模型名栏。
- Codex 没有独立公开聊天接口，本项目通过 OpenAI 兼容端点调用 codex 系列模型；如你有自建 Codex 兼容服务，可在高级选项里改 Base URL。

## 三、项目结构

```
multi-ai-debate-arena/
├── server.js              # 零依赖 HTTP 服务：静态托管 + 辩论接口（NDJSON 流式）
├── package.json
├── .env.example           # 服务端密钥模板
├── .gitignore
├── src/
│   ├── providers.js       # 六家适配层：OpenAI 兼容 / Anthropic / Gemini 统一封装
│   └── engine.js          # 辩论编排：轮次发言、互相反驳、结论立场汇总
└── public/
    ├── index.html         # 页面骨架（中文）
    ├── style.css          # 响应式样式（手机 / 电脑）
    └── app.js             # 前端交互：配置持久化、流式消息渲染、结论展示
```

## 四、工作流程

1. **开场**：每位 AI 先给出初步立场与核心理由。
2. **反驳轮**：后续轮次中，每位 AI 先回应并反驳上一轮不同观点，再说明立场是否调整。
3. **结论阶段**：每位 AI 基于全场记录输出 `【立场】支持/反对/有条件支持/中立` 与一句话理由；系统统计多数意见并列出分歧方。

## 五、免费与部署说明

- **本项目本身不收费、无付费 SDK、无托管费用**；产生的费用仅来自你调用各家官方 API 的按量计费（多数厂商提供免费额度或低价模型）。
- 仓库可直接克隆到本机运行；若需公网访问，可自行将后端部署到任意支持 Node.js 的免费平台，前端静态页可单独托管到 GitHub Pages（注意：OpenAI / Anthropic 等接口存在浏览器跨域限制，生产环境仍需经本项目后端转发）。
- 密钥绝不能提交到仓库：`.env` 已在 `.gitignore` 中排除；网页端填写的密钥仅存在你自己的浏览器。

## 六、常见问题

- **某个 AI 发言失败**：界面会显示该家「调用失败」原因，其他 AI 与整场讨论不受影响；常见原因为密钥缺失/失效、模型名不可用、网络或地区访问受限。
- **手机打不开**：确认手机与电脑在同一局域网，使用电脑的局域网 IP（不是 localhost）；检查防火墙是否放行 3210 端口。
- **想增减参与 AI**：主界面直接勾选/取消即可，无需改代码。

## License

MIT
