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

  function copyToClipboard(text) {
    return navigator.clipboard.writeText(text);
  }

  function formatForCopy(data) {
    return `Title: ${data.title || "未识别"}\n\nAbstract: ${data.abstract || "未识别"}\n\nURL: ${data.url}`;
  }

  function createPanel(data) {
    document.getElementById(PANEL_ID)?.remove();

    const root = document.createElement("aside");
    root.id = PANEL_ID;
    root.innerHTML = `
      <style>
        #${PANEL_ID} {
          position: fixed;
          right: 24px;
          bottom: 24px;
          z-index: 2147483647;
          width: min(420px, calc(100vw - 32px));
          max-height: min(680px, calc(100vh - 32px));
          overflow: auto;
          color: #17212b;
          background: #ffffff;
          border: 1px solid #d9e2ec;
          border-top: 4px solid #0b75bb;
          box-shadow: 0 18px 48px rgba(15, 32, 46, 0.22);
          font: 14px/1.5 Arial, "Helvetica Neue", sans-serif;
        }
        #${PANEL_ID} * { box-sizing: border-box; }
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
          margin: 0 0 5px;
          color: #52616f;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
        }
        #${PANEL_ID} .tae-title {
          margin: 0 0 14px;
          font-size: 16px;
          font-weight: 700;
        }
        #${PANEL_ID} .tae-abstract {
          margin: 0 0 14px;
          max-height: 280px;
          overflow: auto;
          white-space: pre-wrap;
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
        #${PANEL_ID} .tae-actions button.secondary {
          background: #ffffff;
          color: #0b75bb;
        }
        #${PANEL_ID} .tae-source {
          margin-top: 12px;
          color: #637381;
          font-size: 12px;
        }
      </style>
      <div class="tae-head">
        <strong>题目与摘要提取</strong>
        <button class="tae-close" type="button" aria-label="关闭">×</button>
      </div>
      <div class="tae-body">
        <p class="tae-label">Title</p>
        <p class="tae-title"></p>
        <p class="tae-label">Abstract</p>
        <p class="tae-abstract"></p>
        <div class="tae-actions">
          <button type="button" data-action="copy">复制全部</button>
          <button type="button" class="secondary" data-action="copy-title">复制题目</button>
          <button type="button" class="secondary" data-action="copy-abstract">复制摘要</button>
        </div>
        <div class="tae-source"></div>
      </div>
    `;

    root.querySelector(".tae-title").textContent = data.title || "未识别到题目";
    root.querySelector(".tae-abstract").textContent = data.abstract || "未识别到摘要";
    root.querySelector(".tae-source").textContent = `来源规则：${data.source}`;
    root.querySelector(".tae-close").addEventListener("click", () => root.remove());
    root.querySelector("[data-action='copy']").addEventListener("click", () => copyToClipboard(formatForCopy(data)));
    root.querySelector("[data-action='copy-title']").addEventListener("click", () => copyToClipboard(data.title || ""));
    root.querySelector("[data-action='copy-abstract']").addEventListener("click", () => copyToClipboard(data.abstract || ""));

    document.documentElement.append(root);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "TAE_EXTRACT") {
      sendResponse(extractPaperInfo());
      return true;
    }

    if (message?.type === "TAE_SHOW_PANEL") {
      const data = extractPaperInfo();
      createPanel(data);
      sendResponse(data);
      return true;
    }

    return false;
  });
})();
