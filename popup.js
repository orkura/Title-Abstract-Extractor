const DEFAULT_API_SETTINGS = {
  endpoint: "https://api.deepseek.com/chat/completions",
  model: "deepseek-v4-flash",
  apiKey: "",
  temperature: 0.2
};
const CHAT_COMPLETIONS_PATH = "/chat/completions";
const DEEPSEEK_LEGACY_MODEL_MAP = {
  "deepseek-reasoner": "deepseek-v4-flash",
  "deepseek-chat": "deepseek-v4-flash"
};
const DEFAULT_KNOWLEDGE_BASE = {
  enabled: false,
  directoryName: "",
  importedAt: "",
  files: []
};

const DEFAULT_PROMPT = `你是我的论文筛选助手。请根据论文标题和摘要判断它是否符合我的研究需要。

我的研究需要：
- 研究方向：
- 关注方法：
- 关注应用场景：
- 必须包含的关键词或特征：
- 需要排除的内容：

请用 Markdown 输出：
1. **结论**：推荐阅读 / 可略读 / 不推荐，并给出置信度。
2. **匹配理由**：说明与我的研究需要的对应关系。
3. **潜在价值**：如果值得读，指出可能有用的理论、方法、数据或实验。
4. **风险与缺口**：指出摘要中没有说明、可能不相关或需要进一步确认的地方。
5. **下一步建议**：给出我应该看全文的哪些部分。`;

const elements = {
  status: document.getElementById("status"),
  title: document.getElementById("title"),
  abstract: document.getElementById("abstract"),
  refresh: document.getElementById("refresh"),
  settingsButton: document.getElementById("settingsButton"),
  copyTitle: document.getElementById("copyTitle"),
  copyAbstract: document.getElementById("copyAbstract"),
  copyAll: document.getElementById("copyAll"),
  showPanel: document.getElementById("showPanel"),
  analyzePaper: document.getElementById("analyzePaper"),
  openResult: document.getElementById("openResult"),
  apiState: document.getElementById("apiState"),
  apiDialog: document.getElementById("apiDialog"),
  resultDialog: document.getElementById("resultDialog"),
  apiEndpoint: document.getElementById("apiEndpoint"),
  apiModel: document.getElementById("apiModel"),
  apiKey: document.getElementById("apiKey"),
  temperature: document.getElementById("temperature"),
  saveApiSettings: document.getElementById("saveApiSettings"),
  analysisPrompt: document.getElementById("analysisPrompt"),
  resetPrompt: document.getElementById("resetPrompt"),
  knowledgeEnabled: document.getElementById("knowledgeEnabled"),
  knowledgePath: document.getElementById("knowledgePath"),
  importKnowledgeBase: document.getElementById("importKnowledgeBase"),
  clearKnowledgeBase: document.getElementById("clearKnowledgeBase"),
  knowledgeFileInput: document.getElementById("knowledgeFileInput"),
  knowledgeSummary: document.getElementById("knowledgeSummary"),
  analysisMarkdown: document.getElementById("analysisMarkdown"),
  copyAnalysis: document.getElementById("copyAnalysis")
};

let currentData = null;
let apiSettings = { ...DEFAULT_API_SETTINGS };
let analysisPrompt = DEFAULT_PROMPT;
let analysisResult = null;
let floatingEnabled = false;
let knowledgeBase = { ...DEFAULT_KNOWLEDGE_BASE };
let manualEdited = false;
let activeTabUrl = "";

function storageGet(defaults) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(defaults, (items) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(items);
    });
  });
}

function storageSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else {
        activeTabUrl = tab?.url || activeTabUrl;
        resolve(tab);
      }
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

function executeContentScript(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ["content.js"]
      },
      () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      }
    );
  });
}

function setStatus(message, tone = "info") {
  elements.status.textContent = message;
  elements.status.className = "status";
  if (tone === "success" || tone === "error") {
    elements.status.classList.add(tone);
  }
}

function formatData(data) {
  return `Title: ${data.title || "未识别"}\n\nAbstract: ${data.abstract || "未识别"}\n\nURL: ${data.url || ""}`;
}

function readPaperDataFromFields() {
  const title = elements.title.value.trim();
  const abstract = elements.abstract.value.trim();

  return {
    ...(currentData || {}),
    title,
    abstract,
    url: currentData?.url || activeTabUrl || "",
    source: manualEdited ? "手动填写" : currentData?.source || "手动填写",
    extractedAt: currentData?.extractedAt || new Date().toISOString(),
    ok: Boolean(title || abstract)
  };
}

function syncPaperDataFromFields({ markManual = false } = {}) {
  if (markManual) {
    manualEdited = true;
  }

  currentData = readPaperDataFromFields();
  return currentData;
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error("无法读取当前标签页。");

  try {
    return await sendTabMessage(tab.id, message);
  } catch (_error) {
    await executeContentScript(tab.id);
    return sendTabMessage(tab.id, message);
  }
}

async function extract() {
  setStatus("正在读取当前页面...");

  try {
    const data = await sendToActiveTab({ type: "TAE_EXTRACT" });
    manualEdited = false;
    currentData = {
      ...(data || {}),
      title: data?.title || "",
      abstract: data?.abstract || "",
      url: data?.url || activeTabUrl || "",
      ok: Boolean(data?.title || data?.abstract)
    };
    elements.title.value = data?.title || "";
    elements.abstract.value = data?.abstract || "";
    setStatus(
      data?.ok ? `已识别：${data.source}` : "未识别到标题或摘要，可在下方手动填写后复制或分析。",
      data?.ok ? "success" : "info"
    );
    return currentData;
  } catch (error) {
    setStatus(`提取失败：${error.message}。可手动填写标题或摘要后继续分析。`, "error");
    throw error;
  }
}

async function copyText(text, doneMessage) {
  await navigator.clipboard.writeText(text || "");
  setStatus(doneMessage, "success");
}

function showDialog(dialog) {
  if (dialog.open) return;
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function updateApiState() {
  const isReady = Boolean(apiSettings.endpoint && apiSettings.model);
  elements.apiState.textContent = isReady ? `已配置：${apiSettings.model}` : "未配置 API";
  elements.apiState.classList.toggle("ready", isReady);
}

function updateFloatingButton() {
  elements.showPanel.textContent = floatingEnabled ? "关闭悬浮" : "悬浮模式";
  elements.showPanel.classList.toggle("primary", floatingEnabled);
}

function updateKnowledgeSummary() {
  const fileCount = knowledgeBase.files?.length || 0;
  const totalChars = (knowledgeBase.files || []).reduce((sum, file) => sum + file.content.length, 0);
  elements.knowledgeEnabled.checked = Boolean(knowledgeBase.enabled);
  elements.knowledgePath.value = knowledgeBase.directoryName || "";
  elements.knowledgeSummary.textContent = fileCount
    ? `已导入 ${fileCount} 个 Markdown 文件，约 ${totalChars.toLocaleString()} 字符。${knowledgeBase.enabled ? "分析时会启用。" : "当前未启用。"}`
    : "默认关闭。启用后会把已导入的 Markdown 文件作为分析知识库。";
}

function fillApiForm() {
  elements.apiEndpoint.value = apiSettings.endpoint || "";
  elements.apiModel.value = apiSettings.model || "";
  elements.apiKey.value = apiSettings.apiKey || "";
  elements.temperature.value = String(apiSettings.temperature ?? 0.2);
}

function clampTemperature(value) {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return 0.2;
  return Math.min(2, Math.max(0, number));
}

function normalizeChatCompletionsEndpoint(endpoint) {
  const value = endpoint.trim();
  if (!value) return "";

  try {
    const url = new URL(value);
    if (url.hostname === "api.deepseek.com") {
      url.pathname = CHAT_COMPLETIONS_PATH;
      return url.toString();
    }

    const pathname = url.pathname.replace(/\/+$/, "");
    if (pathname.endsWith(CHAT_COMPLETIONS_PATH)) {
      url.pathname = pathname;
      return url.toString();
    }

    const basePath = pathname === "" || pathname === "/" ? "" : pathname;
    url.pathname = `${basePath}${CHAT_COMPLETIONS_PATH}`;
    return url.toString();
  } catch (_error) {
    return value;
  }
}

function normalizeDeepSeekModel(endpoint, model) {
  try {
    const url = new URL(endpoint);
    if (url.hostname === "api.deepseek.com") {
      return DEEPSEEK_LEGACY_MODEL_MAP[model] || model;
    }
  } catch (_error) {
    return model;
  }

  return model;
}

async function saveSettings() {
  const endpoint = normalizeChatCompletionsEndpoint(elements.apiEndpoint.value);
  const originalModel = elements.apiModel.value.trim();
  const model = normalizeDeepSeekModel(endpoint, originalModel);
  analysisPrompt = elements.analysisPrompt.value.trim() || DEFAULT_PROMPT;
  elements.analysisPrompt.value = analysisPrompt;

  apiSettings = {
    endpoint,
    model,
    apiKey: elements.apiKey.value.trim(),
    temperature: clampTemperature(elements.temperature.value)
  };
  knowledgeBase = {
    ...DEFAULT_KNOWLEDGE_BASE,
    ...knowledgeBase,
    enabled: elements.knowledgeEnabled.checked
  };

  await storageSet({ apiSettings, analysisPrompt, knowledgeBase });
  fillApiForm();
  updateKnowledgeSummary();
  updateApiState();
  elements.apiDialog.close();
  setStatus(
    originalModel && originalModel !== model
      ? `API 设置已保存。DeepSeek 旧模型 ${originalModel} 已切换为 ${model}。`
      : "系统设置已保存。",
    "success"
  );
}

async function resetPrompt() {
  analysisPrompt = DEFAULT_PROMPT;
  elements.analysisPrompt.value = analysisPrompt;
  await storageSet({ analysisPrompt });
  setStatus("提示词已恢复默认。", "success");
}

function isMarkdownFile(file) {
  return /\.(md|markdown)$/i.test(file.name);
}

function getDirectoryName(file) {
  const relativePath = file.webkitRelativePath || file.name;
  return relativePath.includes("/") ? relativePath.split("/")[0] : "";
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error(`读取文件失败：${file.name}`));
    reader.readAsText(file, "utf-8");
  });
}

async function importKnowledgeBaseFromFiles(fileList) {
  const markdownFiles = Array.from(fileList || []).filter(isMarkdownFile);
  if (!markdownFiles.length) {
    setStatus("未找到 Markdown 文件。", "error");
    return;
  }

  setStatus("正在导入 Markdown 知识库...");

  const files = [];
  for (const file of markdownFiles) {
    const content = await readFileAsText(file);
    files.push({
      name: file.name,
      path: file.webkitRelativePath || file.name,
      content
    });
  }

  knowledgeBase = {
    enabled: elements.knowledgeEnabled.checked,
    directoryName: getDirectoryName(markdownFiles[0]) || "Markdown 知识库",
    importedAt: new Date().toISOString(),
    files
  };

  await storageSet({ knowledgeBase });
  updateKnowledgeSummary();
  setStatus(`知识库已导入：${files.length} 个 Markdown 文件。`, "success");
}

async function clearKnowledgeBase() {
  knowledgeBase = {
    ...DEFAULT_KNOWLEDGE_BASE,
    enabled: elements.knowledgeEnabled.checked
  };
  await storageSet({ knowledgeBase });
  updateKnowledgeSummary();
  setStatus("知识库已清空。", "success");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineMarkdown(value) {
  let text = escapeHtml(value);
  const codeTokens = [];

  text = text.replace(/`([^`]+)`/g, (_match, code) => {
    const index = codeTokens.push(`<code>${code}</code>`) - 1;
    return `@@TAE_CODE_${index}@@`;
  });

  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
  );
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  return text.replace(/@@TAE_CODE_(\d+)@@/g, (_match, index) => codeTokens[Number(index)] || "");
}

function isMarkdownTableRow(line) {
  return /^\s*\|.+\|\s*$/.test(line);
}

function isMarkdownTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitMarkdownTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderMarkdownTable(headers, rows) {
  const renderCells = (cells, tag) =>
    cells.map((cell) => `<${tag}>${renderInlineMarkdown(cell)}</${tag}>`).join("");

  return [
    "<table>",
    `<thead><tr>${renderCells(headers, "th")}</tr></thead>`,
    "<tbody>",
    ...rows.map((row) => `<tr>${renderCells(row, "td")}</tr>`),
    "</tbody>",
    "</table>"
  ].join("");
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let listType = "";
  let inCode = false;
  let codeLines = [];

  const closeParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = "";
  };

  const openList = (type) => {
    if (listType === type) return;
    closeParagraph();
    closeList();
    html.push(`<${type}>`);
    listType = type;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^```/.test(line.trim())) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        closeParagraph();
        closeList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      closeParagraph();
      closeList();
      continue;
    }

    if (isMarkdownTableRow(line) && isMarkdownTableSeparator(lines[index + 1] || "")) {
      closeParagraph();
      closeList();

      const headers = splitMarkdownTableRow(line);
      const rows = [];
      index += 2;

      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        rows.push(splitMarkdownTableRow(lines[index]));
        index += 1;
      }

      index -= 1;
      html.push(renderMarkdownTable(headers, rows));
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeParagraph();
      closeList();
      html.push("<hr>");
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    if (unordered) {
      openList("ul");
      html.push(`<li>${renderInlineMarkdown(unordered[1])}</li>`);
      continue;
    }

    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ordered) {
      openList("ol");
      html.push(`<li>${renderInlineMarkdown(ordered[1])}</li>`);
      continue;
    }

    const quote = line.match(/^\s*>\s?(.+)$/);
    if (quote) {
      closeParagraph();
      closeList();
      html.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  closeParagraph();
  closeList();

  return html.join("");
}

function renderAnalysisResult() {
  if (!analysisResult?.markdown) {
    elements.analysisMarkdown.classList.add("empty");
    elements.analysisMarkdown.textContent = "还没有分析结果。";
    elements.openResult.disabled = true;
    return;
  }

  elements.analysisMarkdown.classList.remove("empty");
  elements.analysisMarkdown.innerHTML = markdownToHtml(analysisResult.markdown);
  elements.openResult.disabled = false;
}

async function setAnalysisResult(result) {
  analysisResult = result;
  await storageSet({ analysisResult });
  renderAnalysisResult();
}

function setBusy(button, isBusy, busyText) {
  if (!button.dataset.originalText) {
    button.dataset.originalText = button.textContent;
  }
  button.disabled = isBusy;
  button.textContent = isBusy ? busyText : button.dataset.originalText;
}

async function ensurePaperData() {
  const fieldData = syncPaperDataFromFields();
  if (fieldData.ok) return fieldData;

  await extract();
  const extractedData = syncPaperDataFromFields();
  if (extractedData.ok) return extractedData;

  throw new Error("请先填写标题或摘要。");
}

async function analyzeCurrentPaper() {
  setBusy(elements.analyzePaper, true, "分析中...");
  setStatus("正在调用大语言模型分析论文...");

  try {
    const paper = await ensurePaperData();
    const result = await sendRuntimeMessage({
      type: "TAE_ANALYZE_PAPER",
      paper,
      settings: apiSettings,
      prompt: analysisPrompt
    });

    if (!result?.ok) {
      throw new Error(result?.error || "分析失败。");
    }

    await setAnalysisResult({
      markdown: result.markdown,
      analyzedAt: result.analyzedAt,
      endpoint: result.endpoint,
      model: result.model,
      notice: result.notice,
      paperTitle: paper.title || ""
    });
    setStatus(
      result.notice || `分析完成，结果已按 Markdown 渲染。请求地址：${result.endpoint || "已配置 API"}`,
      "success"
    );
    showDialog(elements.resultDialog);
  } catch (error) {
    setStatus(`分析失败：${error.message}`, "error");
  } finally {
    setBusy(elements.analyzePaper, false);
  }
}

async function init() {
  const stored = await storageGet({
    apiSettings: DEFAULT_API_SETTINGS,
    analysisPrompt: DEFAULT_PROMPT,
    analysisResult: null,
    floatingEnabled: false,
    knowledgeBase: DEFAULT_KNOWLEDGE_BASE
  });

  apiSettings = { ...DEFAULT_API_SETTINGS, ...(stored.apiSettings || {}) };
  analysisPrompt = stored.analysisPrompt || DEFAULT_PROMPT;
  analysisResult = stored.analysisResult;
  floatingEnabled = Boolean(stored.floatingEnabled);
  knowledgeBase = { ...DEFAULT_KNOWLEDGE_BASE, ...(stored.knowledgeBase || {}) };

  fillApiForm();
  elements.analysisPrompt.value = analysisPrompt;
  updateApiState();
  updateFloatingButton();
  updateKnowledgeSummary();
  renderAnalysisResult();

  extract().catch(() => {});
}

elements.title.addEventListener("input", () => syncPaperDataFromFields({ markManual: true }));
elements.abstract.addEventListener("input", () => syncPaperDataFromFields({ markManual: true }));
elements.refresh.addEventListener("click", () => extract().catch(() => {}));
elements.copyTitle.addEventListener("click", () => copyText(elements.title.value, "标题已复制。"));
elements.copyAbstract.addEventListener("click", () => copyText(elements.abstract.value, "摘要已复制。"));
elements.copyAll.addEventListener("click", () => {
  const data = syncPaperDataFromFields();
  if (!data.ok) {
    setStatus("请先填写标题或摘要。", "error");
    return;
  }

  copyText(formatData(data), "标题、摘要和 URL 已复制。");
});
elements.showPanel.addEventListener("click", async () => {
  floatingEnabled = !floatingEnabled;
  await storageSet({ floatingEnabled });
  updateFloatingButton();

  const paper = syncPaperDataFromFields();
  const message = {
    type: floatingEnabled ? "TAE_ENABLE_FLOATING" : "TAE_DISABLE_FLOATING"
  };
  if (floatingEnabled && paper.ok) {
    message.paper = paper;
  }

  const data = await sendToActiveTab(message);
  currentData = data || currentData;
  setStatus(
    floatingEnabled ? "悬浮模式已开启，新打开的页面也会自动显示悬浮球。" : "悬浮模式已关闭。",
    "success"
  );
});

elements.settingsButton.addEventListener("click", () => {
  fillApiForm();
  elements.analysisPrompt.value = analysisPrompt;
  showDialog(elements.apiDialog);
});
elements.saveApiSettings.addEventListener("click", () => saveSettings().catch((error) => setStatus(`保存失败：${error.message}`, "error")));
elements.resetPrompt.addEventListener("click", () => resetPrompt().catch((error) => setStatus(`保存失败：${error.message}`, "error")));
elements.knowledgeEnabled.addEventListener("change", () => {
  knowledgeBase.enabled = elements.knowledgeEnabled.checked;
  updateKnowledgeSummary();
});
elements.importKnowledgeBase.addEventListener("click", () => elements.knowledgeFileInput.click());
elements.knowledgeFileInput.addEventListener("change", () => {
  importKnowledgeBaseFromFiles(elements.knowledgeFileInput.files).catch((error) => setStatus(`导入失败：${error.message}`, "error"));
  elements.knowledgeFileInput.value = "";
});
elements.clearKnowledgeBase.addEventListener("click", () => clearKnowledgeBase().catch((error) => setStatus(`清空失败：${error.message}`, "error")));
elements.analyzePaper.addEventListener("click", analyzeCurrentPaper);
elements.openResult.addEventListener("click", () => showDialog(elements.resultDialog));
elements.copyAnalysis.addEventListener("click", () =>
  copyText(analysisResult?.markdown || "", "分析结果 Markdown 已复制。")
);

init().catch((error) => setStatus(`初始化失败：${error.message}`, "error"));
