const ANALYSIS_TIMEOUT_MS = 90000;
const CHAT_COMPLETIONS_PATH = "/chat/completions";
const DEEPSEEK_LEGACY_MODEL_MAP = {
  "deepseek-reasoner": "deepseek-v4-flash",
  "deepseek-chat": "deepseek-v4-flash"
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "tae-show-panel",
    title: "提取论文题目和摘要",
    contexts: ["page"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "tae-show-panel" || !tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TAE_SHOW_PANEL" });
  } catch (_error) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
    await chrome.tabs.sendMessage(tab.id, { type: "TAE_SHOW_PANEL" });
  }
});

function buildAnalysisMessages(paper, prompt) {
  const title = paper?.title || "未识别";
  const abstract = paper?.abstract || "未识别";
  const url = paper?.url || "";

  return [
    {
      role: "system",
      content:
        prompt ||
        "你是一位严谨的论文筛选助手。请根据用户的研究需要判断论文是否值得阅读，并用 Markdown 输出结论、理由、风险和建议。"
    },
    {
      role: "user",
      content: [
        "请分析下面这篇论文是否符合我的需要。",
        "",
        `Title: ${title}`,
        "",
        `Abstract: ${abstract}`,
        "",
        `URL: ${url}`,
        "",
        "请使用 Markdown 格式输出，优先给出明确结论。"
      ].join("\n")
    }
  ];
}

function readModelOutput(data) {
  return (
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.text ||
    data?.output_text ||
    data?.content ||
    ""
  ).trim();
}

function normalizeChatCompletionsEndpoint(endpoint) {
  const value = endpoint?.trim();
  if (!value) return "";

  const url = new URL(value);
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.endsWith(CHAT_COMPLETIONS_PATH)) {
    url.pathname = pathname;
    return url.toString();
  }

  const basePath = pathname === "" || pathname === "/" ? "" : pathname;
  url.pathname = `${basePath}${CHAT_COMPLETIONS_PATH}`;
  return url.toString();
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function getDeepSeekEndpointCandidates(endpoint) {
  const url = new URL(endpoint);
  if (url.hostname !== "api.deepseek.com") {
    return [endpoint];
  }

  const official = new URL(url.toString());
  official.pathname = CHAT_COMPLETIONS_PATH;

  const compatible = new URL(url.toString());
  compatible.pathname = `/v1${CHAT_COMPLETIONS_PATH}`;

  return uniqueValues([endpoint, official.toString(), compatible.toString()]);
}

function isDeepSeekEndpoint(endpoint) {
  try {
    return new URL(endpoint).hostname === "api.deepseek.com";
  } catch (_error) {
    return false;
  }
}

function normalizeModelForEndpoint(endpoint, model) {
  if (!isDeepSeekEndpoint(endpoint)) {
    return {
      model,
      notice: ""
    };
  }

  const mappedModel = DEEPSEEK_LEGACY_MODEL_MAP[model] || model;
  return {
    model: mappedModel,
    notice: mappedModel === model ? "" : `DeepSeek 模型名已从 ${model} 自动兼容为 ${mappedModel}。`
  };
}

async function postChatCompletion(endpoint, headers, body, signal) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal
  });
  const responseText = await response.text();
  let data = {};

  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch (_error) {
    data = { content: responseText };
  }

  return { response, responseText, data };
}

function readErrorMessage(data, responseText, response) {
  return data?.error?.message || data?.message || responseText || response.statusText || "无响应正文";
}

async function analyzePaper({ paper, settings, prompt }) {
  const endpoint = normalizeChatCompletionsEndpoint(settings?.endpoint);
  const model = settings?.model?.trim();

  if (!endpoint) {
    throw new Error("请先设置 API 地址。");
  }

  if (!model) {
    throw new Error("请先设置模型名称。");
  }

  if (!paper?.title && !paper?.abstract) {
    throw new Error("当前页面没有可分析的题目或摘要。");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);

  try {
    const headers = { "Content-Type": "application/json" };
    if (settings?.apiKey) {
      headers.Authorization = `Bearer ${settings.apiKey}`;
    }

    const normalizedModel = normalizeModelForEndpoint(endpoint, model);
    const requestBody = {
      model: normalizedModel.model,
      messages: buildAnalysisMessages(paper, prompt),
      temperature: Number.isFinite(settings?.temperature) ? settings.temperature : 0.2,
      stream: false
    };
    if (isDeepSeekEndpoint(endpoint)) {
      requestBody.thinking = { type: "enabled" };
    }
    const endpoints = getDeepSeekEndpointCandidates(endpoint);
    const failures = [];

    for (const requestEndpoint of endpoints) {
      const { response, responseText, data } = await postChatCompletion(requestEndpoint, headers, requestBody, controller.signal);

      if (!response.ok) {
        const message = readErrorMessage(data, responseText, response);
        failures.push(`${response.status} ${requestEndpoint}：${message}`);
        if ((response.status === 400 || response.status === 404) && requestEndpoint !== endpoints[endpoints.length - 1]) {
          continue;
        }
        throw new Error(`API 请求失败：${failures.join("；")}`);
      }

      const output = readModelOutput(data);
      if (!output) {
        throw new Error(`API 返回成功，但没有找到模型输出内容。请求地址：${requestEndpoint}`);
      }

      return {
        ok: true,
        markdown: output,
        endpoint: requestEndpoint,
        model: normalizedModel.model,
        notice: normalizedModel.notice,
        analyzedAt: new Date().toISOString()
      };
    }

    throw new Error(`API 请求失败：${failures.join("；")}`);
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("API 请求超时，请检查网络、地址或模型响应速度。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "TAE_ANALYZE_PAPER") return false;

  analyzePaper(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
