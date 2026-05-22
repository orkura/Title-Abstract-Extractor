(() => {
  const PANEL_ID = "tae-extractor-panel";

  const SITE_RULES = [
    {
      id: "ieee",
      label: "IEEE Xplore",
      host: /(^|\.)ieeexplore\.ieee\.org$/i,
      title: [
        "h1.document-title",
        ".document-title",
        "xpl-document-details h1",
        "meta[name='citation_title']"
      ],
      abstract: [
        ".abstract-text .u-mb-1",
        ".abstract-text",
        "section.abstract div",
        "div[ng-bind-html*='abstract']",
        "meta[name='description']"
      ]
    },
    {
      id: "science-direct",
      label: "ScienceDirect",
      host: /(^|\.)sciencedirect\.com$/i,
      title: [
        "h1.title-text",
        "span.title-text",
        "meta[name='citation_title']"
      ],
      abstract: [
        "#abstracts .abstract.author",
        "div.Abstracts div.abstract.author",
        "section[id*='abstract'] div[class*='abstract']",
        "meta[name='description']"
      ]
    },
    {
      id: "springer",
      label: "SpringerLink",
      host: /(^|\.)springer\.com$/i,
      title: ["h1.c-article-title", "meta[name='citation_title']"],
      abstract: ["#Abs1-content", "section[data-title='Abstract']", "meta[name='description']"]
    },
    {
      id: "acm",
      label: "ACM Digital Library",
      host: /(^|\.)dl\.acm\.org$/i,
      title: ["h1.citation__title", "meta[name='citation_title']"],
      abstract: [".abstractSection", "#abstract", "meta[name='description']"]
    }
  ];

  const GENERIC_TITLE_SELECTORS = [
    "meta[name='citation_title']",
    "meta[property='og:title']",
    "meta[name='dc.Title']",
    "meta[name='DC.Title']",
    "meta[name='twitter:title']",
    "article h1",
    "main h1",
    "h1"
  ];

  const GENERIC_ABSTRACT_SELECTORS = [
    "meta[name='citation_abstract']",
    "meta[name='dc.Description']",
    "meta[name='DC.Description']",
    "meta[name='description']",
    "meta[property='og:description']",
    "section[id*='abstract' i]",
    "div[class*='abstract' i]",
    "section[class*='abstract' i]",
    "article [class*='abstract' i]"
  ];

  function getMetaContent(element) {
    return element?.getAttribute("content") || element?.textContent || "";
  }

  function normalizeText(value) {
    return (value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^\s*(Abstract|Summary)\s*[:.-]?\s*/i, "")
      .trim();
  }

  function readSelector(selector) {
    const element = document.querySelector(selector);
    if (!element) return "";
    return normalizeText(element.matches("meta") ? getMetaContent(element) : element.textContent);
  }

  function readFirst(selectors) {
    for (const selector of selectors) {
      const text = readSelector(selector);
      if (text) return text;
    }
    return "";
  }

  function findLabelledAbstract() {
    const headings = Array.from(document.querySelectorAll("h2, h3, h4, strong, b, .section-title"));
    const abstractHeading = headings.find((element) => /^abstract\s*:?$/i.test(normalizeText(element.textContent)));
    if (!abstractHeading) return "";

    const container = abstractHeading.closest("section, article, div") || abstractHeading.parentElement;
    if (!container) return "";

    const paragraphs = Array.from(container.querySelectorAll("p"))
      .map((paragraph) => normalizeText(paragraph.textContent))
      .filter(Boolean);
    return paragraphs.join(" ");
  }

  function inferSiteRule() {
    return SITE_RULES.find((rule) => rule.host.test(location.hostname));
  }

  function extractPaperInfo() {
    const rule = inferSiteRule();
    const title = readFirst(rule?.title || []) || readFirst(GENERIC_TITLE_SELECTORS) || normalizeText(document.title);
    const abstract =
      readFirst(rule?.abstract || []) ||
      readFirst(GENERIC_ABSTRACT_SELECTORS) ||
      findLabelledAbstract();

    return {
      title,
      abstract,
      url: location.href,
      source: rule?.label || "通用网页规则",
      extractedAt: new Date().toISOString(),
      ok: Boolean(title || abstract)
    };
  }

  function readMessagePaper(message) {
    const paper = message?.paper;
    if (!paper?.title && !paper?.abstract) return null;

    const title = normalizeText(paper.title);
    const abstract = normalizeText(paper.abstract);
    return {
      title,
      abstract,
      url: paper.url || location.href,
      source: paper.source || "手动填写",
      extractedAt: paper.extractedAt || new Date().toISOString(),
      ok: Boolean(title || abstract)
    };
  }

  function copyToClipboard(text) {
    return navigator.clipboard.writeText(text);
  }

  function formatForCopy(data) {
    return `Title: ${data.title || "未识别"}\n\nAbstract: ${data.abstract || "未识别"}\n\nURL: ${data.url}`;
  }

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

  function createPanel(data) {
    document.getElementById(PANEL_ID)?.remove();

    const root = document.createElement("aside");
    root.id = PANEL_ID;
    root.className = "is-collapsed";
    root.innerHTML = `
      <style>
        #${PANEL_ID} {
          position: fixed;
          right: 24px;
          bottom: 24px;
          z-index: 2147483647;
          width: min(420px, calc(100vw - 32px));
          max-height: min(680px, calc(100vh - 32px));
          color: #17212b;
          font: 14px/1.5 Arial, "Helvetica Neue", sans-serif;
        }
        #${PANEL_ID} * { box-sizing: border-box; }
        #${PANEL_ID}.is-collapsed {
          width: 56px;
          height: 56px;
        }
        #${PANEL_ID} .tae-launcher {
          display: none;
          width: 56px;
          height: 56px;
          padding: 0;
          border: 0;
          border-radius: 50%;
          background: #0b75bb;
          color: #ffffff;
          box-shadow: 0 12px 32px rgba(15, 32, 46, 0.24);
          cursor: pointer;
          font-weight: 700;
          font-size: 22px;
        }
        #${PANEL_ID}.is-collapsed .tae-launcher {
          display: inline-flex;
          justify-content: center;
          align-items: center;
        }
        #${PANEL_ID} .tae-panel {
          max-height: min(680px, calc(100vh - 32px));
          overflow: auto;
          background: #ffffff;
          border: 1px solid #d9e2ec;
          border-top: 4px solid #0b75bb;
          box-shadow: 0 18px 48px rgba(15, 32, 46, 0.22);
        }
        #${PANEL_ID}.is-collapsed .tae-panel {
          display: none;
        }
        #${PANEL_ID} .tae-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px;
          border-bottom: 1px solid #e8edf2;
        }
        #${PANEL_ID} .tae-head strong {
          font-size: 15px;
        }
        #${PANEL_ID} .tae-window-actions {
          display: flex;
          gap: 4px;
        }
        #${PANEL_ID} .tae-close {
          width: 30px;
          height: 30px;
          border: 0;
          background: transparent;
          color: #637381;
          cursor: pointer;
          font-size: 24px;
          line-height: 24px;
        }
        #${PANEL_ID} .tae-body {
          padding: 14px;
        }
        #${PANEL_ID} .tae-label {
          display: block;
          margin: 0 0 5px;
          color: #52616f;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
        }
        #${PANEL_ID} .tae-title,
        #${PANEL_ID} .tae-abstract {
          width: 100%;
          border: 1px solid #d9e2ec;
          border-radius: 4px;
          padding: 9px 10px;
          color: #17212b;
          background: #ffffff;
          font: 13px/1.55 Arial, "Helvetica Neue", sans-serif;
          resize: vertical;
        }
        #${PANEL_ID} .tae-title:focus,
        #${PANEL_ID} .tae-abstract:focus {
          outline: 2px solid rgba(11, 117, 187, 0.2);
          border-color: #0b75bb;
        }
        #${PANEL_ID} .tae-title {
          margin: 0 0 14px;
          font-size: 16px;
          font-weight: 700;
        }
        #${PANEL_ID} .tae-abstract {
          margin: 0 0 14px;
          min-height: 140px;
          max-height: 280px;
        }
        #${PANEL_ID} .tae-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding-top: 8px;
        }
        #${PANEL_ID} .tae-actions button {
          min-height: 34px;
          padding: 0 12px;
          border: 1px solid #0b75bb;
          border-radius: 4px;
          background: #0b75bb;
          color: #ffffff;
          cursor: pointer;
          font-weight: 700;
        }
        #${PANEL_ID} .tae-actions button:disabled {
          cursor: not-allowed;
          opacity: 0.62;
        }
        #${PANEL_ID} .tae-actions button.secondary {
          background: #ffffff;
          color: #0b75bb;
        }
        #${PANEL_ID} .tae-status {
          margin: 0 0 12px;
          padding: 8px 10px;
          color: #52616f;
          background: #eef5fa;
          border-left: 3px solid #0b75bb;
        }
        #${PANEL_ID} .tae-status.success {
          color: #0f7b5f;
          background: #edfdf7;
          border-left-color: #0f7b5f;
        }
        #${PANEL_ID} .tae-status.error {
          color: #b42318;
          background: #fff1f0;
          border-left-color: #b42318;
        }
        #${PANEL_ID} .tae-result {
          display: none;
          margin-top: 12px;
          padding: 10px;
          border: 1px solid #d9e2ec;
          border-radius: 6px;
          background: #fbfdff;
        }
        #${PANEL_ID} .tae-result.is-visible {
          display: block;
        }
        #${PANEL_ID} .tae-result h2,
        #${PANEL_ID} .tae-result h3,
        #${PANEL_ID} .tae-result h4 {
          margin: 8px 0 6px;
          font-size: 15px;
        }
        #${PANEL_ID} .tae-result p {
          margin: 8px 0;
        }
        #${PANEL_ID} .tae-result ul,
        #${PANEL_ID} .tae-result ol {
          margin: 8px 0;
          padding-left: 22px;
        }
        #${PANEL_ID} .tae-result blockquote {
          margin: 8px 0;
          padding: 1px 10px;
          color: #637381;
          border-left: 3px solid #d9e2ec;
        }
        #${PANEL_ID} .tae-result table {
          width: 100%;
          margin: 10px 0;
          border-collapse: collapse;
        }
        #${PANEL_ID} .tae-result th,
        #${PANEL_ID} .tae-result td {
          border: 1px solid #d9e2ec;
          padding: 6px 8px;
          text-align: left;
          vertical-align: top;
        }
        #${PANEL_ID} .tae-result th {
          background: #eef5fa;
          font-weight: 700;
        }
        #${PANEL_ID} .tae-result hr {
          border: 0;
          border-top: 1px solid #d9e2ec;
          margin: 12px 0;
        }
        #${PANEL_ID} .tae-result pre {
          overflow: auto;
          margin: 8px 0;
          padding: 10px;
          border-radius: 4px;
          background: #17212b;
          color: #f4f7fb;
        }
        #${PANEL_ID} .tae-result code {
          padding: 1px 4px;
          border-radius: 3px;
          background: #eef5fa;
        }
        #${PANEL_ID} .tae-result pre code {
          padding: 0;
          background: transparent;
          color: inherit;
        }
        #${PANEL_ID} .tae-result a {
          color: #0b75bb;
        }
        #${PANEL_ID} .tae-source {
          margin-top: 12px;
          color: #637381;
          font-size: 12px;
        }
      </style>
      <button class="tae-launcher" type="button" aria-label="展开论文摘要">
        <span>文</span>
      </button>
      <div class="tae-panel">
        <div class="tae-head">
          <strong>标题和摘要</strong>
          <div class="tae-window-actions">
            <button class="tae-close" type="button" aria-label="收回悬浮球">×</button>
          </div>
        </div>
        <div class="tae-body">
          <p class="tae-status success">已识别：${escapeHtml(data.source)}</p>
          <label class="tae-label" for="tae-floating-title">标题</label>
          <textarea id="tae-floating-title" class="tae-title" rows="2" placeholder="未识别到标题时可在这里手动填写"></textarea>
          <label class="tae-label" for="tae-floating-abstract">摘要</label>
          <textarea id="tae-floating-abstract" class="tae-abstract" rows="6" placeholder="未识别到摘要时可在这里手动填写"></textarea>
          <div class="tae-actions">
            <button type="button" data-action="analyze">分析论文</button>
            <button type="button" class="secondary" data-action="result">展开分析</button>
            <button type="button" class="secondary" data-action="copy-analysis">复制分析</button>
          </div>
          <article class="tae-result"></article>
          <div class="tae-source"></div>
        </div>
      </div>
    `;

    const titleInput = root.querySelector(".tae-title");
    const abstractInput = root.querySelector(".tae-abstract");
    const readPanelData = () => {
      const title = normalizeText(titleInput.value);
      const abstract = normalizeText(abstractInput.value);
      return {
        ...data,
        title,
        abstract,
        url: data.url || location.href,
        source: title !== data.title || abstract !== data.abstract ? "手动填写" : data.source,
        ok: Boolean(title || abstract)
      };
    };

    titleInput.value = data.title || "";
    abstractInput.value = data.abstract || "";
    root.querySelector(".tae-source").textContent = `来源规则：${data.source}`;
    root.querySelector(".tae-launcher").addEventListener("click", () => root.classList.remove("is-collapsed"));
    root.querySelector(".tae-close").addEventListener("click", () => root.classList.add("is-collapsed"));
    root.querySelector("[data-action='result']").addEventListener("click", async () => {
      const resultButton = root.querySelector("[data-action='result']");
      const stored = await storageGet({ analysisResult: null });
      const result = root.querySelector(".tae-result");
      if (result.classList.contains("is-visible")) {
        result.classList.remove("is-visible");
        resultButton.textContent = "展开分析";
        return;
      }

      result.classList.add("is-visible");
      resultButton.textContent = "收起分析";
      result.innerHTML = stored.analysisResult?.markdown
        ? markdownToHtml(stored.analysisResult.markdown)
        : "还没有分析结果。";
    });
    root.querySelector("[data-action='copy-analysis']").addEventListener("click", async () => {
      const status = root.querySelector(".tae-status");
      const stored = await storageGet({ analysisResult: null });
      const markdown = stored.analysisResult?.markdown || "";

      if (!markdown) {
        status.className = "tae-status error";
        status.textContent = "还没有可复制的分析结果。";
        return;
      }

      await copyToClipboard(markdown);
      status.className = "tae-status success";
      status.textContent = "分析结果 Markdown 已复制。";
    });
    root.querySelector("[data-action='analyze']").addEventListener("click", async () => {
      const status = root.querySelector(".tae-status");
      const result = root.querySelector(".tae-result");
      const analyzeButton = root.querySelector("[data-action='analyze']");
      analyzeButton.disabled = true;
      analyzeButton.textContent = "分析中...";
      status.className = "tae-status";
      status.textContent = "正在调用大语言模型分析论文...";

      try {
        const paper = readPanelData();
        if (!paper.ok) {
          throw new Error("请先填写标题或摘要。");
        }

        const stored = await storageGet({ apiSettings: null, analysisPrompt: "" });
        const response = await sendRuntimeMessage({
          type: "TAE_ANALYZE_PAPER",
          paper,
          settings: stored.apiSettings || {},
          prompt: stored.analysisPrompt || ""
        });

        if (!response?.ok) {
          throw new Error(response?.error || "分析失败。");
        }

        await storageSet({
          analysisResult: {
            markdown: response.markdown,
            analyzedAt: response.analyzedAt,
            endpoint: response.endpoint,
            model: response.model,
            notice: response.notice,
            paperTitle: paper.title || ""
          }
        });

        status.className = "tae-status success";
        status.textContent = "分析完成。";
        result.classList.add("is-visible");
        root.querySelector("[data-action='result']").textContent = "收起分析";
        result.innerHTML = markdownToHtml(response.markdown);
      } catch (error) {
        status.className = "tae-status error";
        status.textContent = `分析失败：${error.message}`;
      } finally {
        analyzeButton.disabled = false;
        analyzeButton.textContent = "分析论文";
      }
    });

    document.documentElement.append(root);
  }

  async function initFloatingMode() {
    try {
      const stored = await storageGet({ floatingEnabled: false });
      if (stored.floatingEnabled) {
        createPanel(extractPaperInfo());
      }
    } catch (_error) {
      // Ignore storage errors on pages where extension APIs are unavailable.
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "TAE_EXTRACT") {
      sendResponse(extractPaperInfo());
      return true;
    }

    if (message?.type === "TAE_SHOW_PANEL") {
      const data = readMessagePaper(message) || extractPaperInfo();
      createPanel(data);
      sendResponse(data);
      return true;
    }

    if (message?.type === "TAE_ENABLE_FLOATING") {
      const data = readMessagePaper(message) || extractPaperInfo();
      createPanel(data);
      sendResponse(data);
      return true;
    }

    if (message?.type === "TAE_DISABLE_FLOATING") {
      document.getElementById(PANEL_ID)?.remove();
      sendResponse(extractPaperInfo());
      return true;
    }

    return false;
  });

  initFloatingMode();
})();
