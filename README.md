# Title Abstract Extractor

用于在论文详情页自动提取标题和摘要的浏览器插件，支持 IEEE Xplore、ScienceDirect，并包含 SpringerLink、ACM Digital Library 和通用网页元数据兜底规则。

## 安装

1. 打开 Chrome 或 Edge 的扩展程序页面。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择本项目目录：`F:\Project\浏览器插件开发\Title-Abstract-Extractor`。

## 使用

- 打开 IEEE、ScienceDirect 等论文详情页。
- 点击浏览器工具栏中的插件图标，弹窗会自动显示标题和摘要。
- 可复制标题、复制摘要、复制全部，或开启悬浮模式。
- 开启悬浮模式后，新打开的匹配页面会自动在右下角显示悬浮球，点击悬浮球可展开完整功能面板。
- 在“LLM 论文筛选”区域配置 API、编辑提示词，然后点击“分析论文”。
- 模型输出会在“分析结果”窗口中按 Markdown 渲染，也可以复制原始 Markdown。
- 系统设置中可导入由 `.md` / `.markdown` 文件组成的知识库目录。知识库默认关闭，启用后会在分析时作为补充背景传给模型。

## LLM API

插件使用 OpenAI-compatible Chat Completions 格式调用模型。默认 API 地址为：

```text
https://api.openai.com/v1/chat/completions
```

如果使用兼容服务或本地模型网关，可以在 API 设置中修改 API 地址、模型名称、API Key 和 Temperature。API Key 保存在浏览器本地存储中。

DeepSeek 可以填写：

```text
https://api.deepseek.com
```

插件会自动补全为：

```text
https://api.deepseek.com/chat/completions
```

当前 DeepSeek Chat Completions 文档中的模型名为 `deepseek-v4-flash` 和 `deepseek-v4-pro`。如果仍填写旧模型名 `deepseek-reasoner` 或 `deepseek-chat`，插件会自动兼容为 `deepseek-v4-flash`，并为 DeepSeek 请求开启 thinking。

## 知识库

浏览器扩展不能仅凭本地路径字符串自动读取磁盘目录，因此知识库通过“选择目录”导入。插件会读取所选目录下所有 Markdown 文件，并保存在浏览器本地存储中。启用知识库后，分析论文时会自动把这些 Markdown 内容作为补充资料加入模型上下文；默认关闭。

## 识别逻辑

插件优先使用站点专用选择器，例如 IEEE Xplore 的论文标题和摘要区域、ScienceDirect 的 `title-text` 和 `abstract` 区域。若未命中，则使用 `citation_title`、`citation_abstract`、`description`、`og:title` 等通用元数据，并尝试查找页面中标记为 Abstract 的内容块。
