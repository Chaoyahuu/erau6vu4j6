let db, allCards = [], mainDeckCards = [], extraDeckCards = [], selectedCard = null;
let currentDeckTab = "main";
const typeColors = {
  "通常罠": "#B766AD", "永続罠": "#B766AD", "カウンター罠": "#B766AD",
  "通常魔法": "#00BB00", "永続魔法": "#00BB00", "装備魔法": "#00BB00",
  "儀式魔法": "#00BB00", "フィールド": "#00BB00", "速攻魔法": "#00BB00",
  "効果モン": "#D26900", "通常モン": "#FFC78E", "融合": "#E800E8",
  "儀式": "#6A6AFF", "シンクロ": "#FCFCFC", "エクシーズ": "#9D9D9D", "リンク": "#2894FF",
  "超次元": "#EA0000"
};
const extraTypes = ["融合", "シンクロ", "エクシーズ", "リンク", "超次元"];
// Search history logic kept simple
let searchHistory = [];
let cardHistory = []; // Card view history
let searchTags = []; // New: Search Tags
const defaultSearchHistory = [["E.R.A"]];
let selectionTagPopup = null;
let pendingSelectionTagPayload = null;
let selectionTagPopupAnchorRect = null;

// Sort State
let currentSortKey = 'id';
let currentSortDir = 1;

const attrIcons = {
  "光属性": "光",
  "闇属性": "闇",
  "地属性": "地",
  "水属性": "水",
  "炎属性": "炎",
  "風属性": "風",
  "神属性": "神"
};

// 分頁狀態
let currentPage = 1;
let itemsPerPage = 60; // 預設值，之後會動態計算

let favorites = new Set();
let showFavoritesOnly = false;

try {
  const savedFavs = localStorage.getItem('ygo_favorites');
  if (savedFavs) {
    favorites = new Set(JSON.parse(savedFavs));
  }
} catch (e) { }

export async function init() {
  const SQL = await initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}` });
  const response = await fetch("cards.db");
  const buffer = await response.arrayBuffer();
  db = new SQL.Database(new Uint8Array(buffer));
  loadDbVersion();
  loadCards();
  // renderSearchHistory(); // If we implement history UI
}

function loadDbVersion() {
  try {
    const res = db.exec("SELECT value FROM metadata WHERE key = 'version'");
    if (res.length > 0 && res[0].values.length > 0) {
      const ver = res[0].values[0][0];
      const el = document.querySelector(".status-badge");
      if (el) el.textContent = `≡ DB: v${ver}`;
    }
  } catch (e) {
    console.log("Metadata version not found", e);
    const el = document.querySelector(".status-badge");
    if (el) el.textContent = "≡ DB: ONLINE";
  }
}

function loadCards() {
  const res = db.exec(`
    SELECT c.*, GROUP_CONCAT(cat.category) as categories
    FROM cards c
    LEFT JOIN card_categories cat ON c.id = cat.card_id
    GROUP BY c.id
  `);
  const stmt = res[0];
  if (stmt) {
    for (const row of stmt.values) {
      const obj = {};
      stmt.columns.forEach((col, i) => obj[col] = row[i]);
      obj.categories = obj.categories ? obj.categories.split(',') : [];
      allCards.push(obj);
    }
  }
  allCards.sort((a, b) => Number(a.id) - Number(b.id));
  ensureDefaultSearchHistory();

  // 初始化動態分頁數量
  updateItemsPerPage();
  window.addEventListener("resize", () => {
    updateItemsPerPage();
    renderCardList(false); // 調整大小時重新渲染並保留頁面
  });

  renderFilterPanel();
  renderCardList();
  renderDeck();

  // Select first card by default if available
  if (allCards.length > 0) {
    selectedCard = allCards[0];
    renderCardInfo();
  }
}

function findCardById(cardId) {
  return allCards.find(c => String(c.id) === String(cardId));
}

function getElementCenter(el) {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function getContainerCenter(selector) {
  const el = document.querySelector(selector);
  if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  return getElementCenter(el);
}

function toHalfWidth(text) {
  return String(text || "").normalize("NFKC");
}

function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripSelectionMultiplierSuffixes(text) {
  return String(text || "").replace(/(?<![A-Za-z0-9])[x×]\s*\d+(?!\d)/gi, "");
}

function stripQuotedSelectionText(text) {
  return String(text || "").replace(/「[^「」]*」/g, "");
}

function ensureSelectionTagPopup() {
  if (selectionTagPopup) return selectionTagPopup;
  const popup = document.createElement("div");
  popup.id = "selection-tag-popup";
  popup.className = "selection-tag-popup hidden";
  popup.addEventListener("mousedown", (e) => e.preventDefault());
  popup.addEventListener("click", (e) => {
    const target = e.target.closest("[data-kind]");
    if (!target || !pendingSelectionTagPayload) return;
    e.preventDefault();
    e.stopPropagation();
    toggleSelectionTagChip(target.dataset.kind, target.dataset.value);
  });
  document.body.appendChild(popup);
  selectionTagPopup = popup;
  return popup;
}

function hideSelectionTagPopup() {
  pendingSelectionTagPayload = null;
  selectionTagPopupAnchorRect = null;
  if (!selectionTagPopup) return;
  selectionTagPopup.classList.add("hidden");
}

function clearDescriptionSelection() {
  const selection = window.getSelection();
  if (selection) selection.removeAllRanges();
}

function getNumericFilterValue(id) {
  const input = document.getElementById(id);
  if (!input) return null;
  const value = toHalfWidth(input.value).trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function setNumericFilterValue(id, value) {
  const input = document.getElementById(id);
  if (input) {
    input.value = value === null || value === undefined ? "" : String(value);
  }
}

function clearNumericFilters() {
  ["filter-atk-min", "filter-atk-max", "filter-def-min", "filter-def-max"].forEach(id => {
    setNumericFilterValue(id, "");
  });
}

function getStatFilters() {
  return {
    atkMin: getNumericFilterValue("filter-atk-min"),
    atkMax: getNumericFilterValue("filter-atk-max"),
    defMin: getNumericFilterValue("filter-def-min"),
    defMax: getNumericFilterValue("filter-def-max")
  };
}

function cardMatchesStatRange(rawValue, min, max) {
  if (min === null && max === null) return true;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) return false;
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

function formatStatFilterLabel(label, min, max) {
  if (min !== null && max !== null) {
    return min === max ? `${label}: ${min}` : `${label}: ${min}-${max}`;
  }
  if (min !== null) return `${label}: >= ${min}`;
  if (max !== null) return `${label}: <= ${max}`;
  return label;
}

function isSelectionTagPopupVisible() {
  return !!selectionTagPopup && !selectionTagPopup.classList.contains("hidden");
}

function isStatFilterApplied(prefix, min, max) {
  const current = getStatFilters();
  return current[`${prefix}Min`] === min && current[`${prefix}Max`] === max;
}

function areLevelOptionsApplied(optionIds = []) {
  if (!optionIds.length) return false;
  return optionIds.every(id => {
    const option = pendingSelectionTagPayload?.filterOptions.find(item => item.id === id)
      || getSelectionFilterOptions().find(item => item.id === id);
    return !!option?.checkbox?.checked;
  });
}

function isSelectionPayloadFullyApplied(payload) {
  if (!payload) return false;
  const filtersApplied = payload.filterOptions.every(option => option.checkbox?.checked);
  const atkApplied = (payload.statFilters.atkMin === null && payload.statFilters.atkMax === null)
    || isStatFilterApplied("atk", payload.statFilters.atkMin, payload.statFilters.atkMax);
  const defApplied = (payload.statFilters.defMin === null && payload.statFilters.defMax === null)
    || isStatFilterApplied("def", payload.statFilters.defMin, payload.statFilters.defMax);
  const searchApplied = payload.quotedSearchTags.every(tag => searchTags.includes(tag));
  return filtersApplied && atkApplied && defApplied && searchApplied;
}

function renderSelectionTagPopupContent(payload) {
  const popup = ensureSelectionTagPopup();
  const levelRangeOptionIds = new Set((payload.levelRangeChips || []).flatMap(chip => chip.optionIds || []));
  const allApplied = isSelectionPayloadFullyApplied(payload);
  const chips = [
    ...((payload.levelRangeChips || []).map(chip => `
      <button type="button" class="selection-tag-chip${areLevelOptionsApplied(chip.optionIds) ? " active" : ""}" data-kind="level-range" data-value="${encodeURIComponent(JSON.stringify({ optionIds: chip.optionIds }))}">
        ${chip.label}
      </button>`)),
    ...payload.filterOptions
      .filter(option => !levelRangeOptionIds.has(option.id))
      .map(option => `
      <button type="button" class="selection-tag-chip${option.checkbox?.checked ? " active" : ""}" data-kind="filter" data-value="${encodeURIComponent(option.id)}">
        ${option.displayLabel}
      </button>`),
    ...(payload.statFilters.atkMin !== null || payload.statFilters.atkMax !== null
      ? [`
      <button type="button" class="selection-tag-chip${isStatFilterApplied("atk", payload.statFilters.atkMin, payload.statFilters.atkMax) ? " active" : ""}" data-kind="stat" data-value="${encodeURIComponent(JSON.stringify({ prefix: "atk", min: payload.statFilters.atkMin, max: payload.statFilters.atkMax }))}">
        ${formatStatFilterLabel("ATK", payload.statFilters.atkMin, payload.statFilters.atkMax)}
      </button>`]
      : []),
    ...(payload.statFilters.defMin !== null || payload.statFilters.defMax !== null
      ? [`
      <button type="button" class="selection-tag-chip${isStatFilterApplied("def", payload.statFilters.defMin, payload.statFilters.defMax) ? " active" : ""}" data-kind="stat" data-value="${encodeURIComponent(JSON.stringify({ prefix: "def", min: payload.statFilters.defMin, max: payload.statFilters.defMax }))}">
        ${formatStatFilterLabel("DEF", payload.statFilters.defMin, payload.statFilters.defMax)}
      </button>`]
      : []),
    ...payload.quotedSearchTags.map(tag => `
      <button type="button" class="selection-tag-chip quoted${searchTags.includes(tag) ? " active" : ""}" data-kind="search" data-value="${encodeURIComponent(tag)}">
        ${tag}
      </button>`)
  ].join("");

  popup.innerHTML = `
    <span class="selection-tag-popup-side">
      <span class="selection-tag-popup-label">候補</span>
    </span>
    <span class="selection-tag-popup-main">
      <span class="selection-tag-popup-actions">
        <button type="button" class="selection-tag-chip selection-tag-chip-batch${allApplied ? " active" : ""}" data-kind="apply-all">一括適用</button>
        <button type="button" class="selection-tag-chip selection-tag-chip-batch" data-kind="clear-all">一括解除</button>
      </span>
      <span class="selection-tag-popup-chips">${chips}</span>
    </span>
  `;
}

function getSelectionFilterOptions() {
  return [...document.querySelectorAll(".filter-panel input[type='checkbox'][class^='filter-']")]
    .map(cb => {
      const value = String(cb.value || "");
      if (!value) return null;

      const isTuner = cb.className.includes("filter-チューナー");
      const isLevel = cb.className.includes("filter-レベル");
      return {
        id: `${cb.className}::${value}`,
        value,
        normalizedValue: toHalfWidth(value),
        displayLabel: isTuner
          ? `チューナー: ${value === "1" ? "是" : "否"}`
          : isLevel
            ? `レベル: ${value}`
            : value,
        checkbox: cb,
        isTuner
      };
    })
    .filter(Boolean);
}

function extractSelectionTagPayload(selectedText) {
  const rawText = String(selectedText || "").trim();
  if (!rawText) return null;

  const normalizedText = toHalfWidth(rawText);
  const normalizedTextForFilterMatch = stripQuotedSelectionText(normalizedText);
  const normalizedTextForNumericMatch = stripSelectionMultiplierSuffixes(normalizedTextForFilterMatch);
  const filterOptions = getSelectionFilterOptions();
  const matchedFilterOptions = [];
  const levelOptions = filterOptions.filter(option => option.checkbox.className.includes("filter-レベル"));
  const levelRangeChips = [];
  const statFilters = {
    atkMin: null,
    atkMax: null,
    defMin: null,
    defMax: null
  };

  const pushFilterOption = (option) => {
    if (option && !matchedFilterOptions.some(item => item.id === option.id)) {
      matchedFilterOptions.push(option);
    }
  };

  const rangePatterns = [
    { regex: /レベル\s*(\d+)\s*以下/g, predicate: (target) => (level) => level <= target, label: (target) => `レベル: <= ${target}` },
    { regex: /レベル\s*(\d+)\s*以上/g, predicate: (target) => (level) => level >= target, label: (target) => `レベル: >= ${target}` },
    { regex: /レベル\s*(\d+)\s*未満/g, predicate: (target) => (level) => level < target, label: (target) => `レベル: < ${target}` },
    { regex: /レベル\s*(\d+)\s*超/g, predicate: (target) => (level) => level > target, label: (target) => `レベル: > ${target}` }
  ];

  rangePatterns.forEach(({ regex, predicate, label }) => {
    let rangeMatch;
    while ((rangeMatch = regex.exec(normalizedText)) !== null) {
      const target = Number(rangeMatch[1]);
      if (!Number.isNaN(target)) {
        const matchedLevelOptions = levelOptions.filter(option => {
          const level = Number(option.value);
          return !Number.isNaN(level) && predicate(target)(level);
        });
        if (matchedLevelOptions.length) {
          matchedLevelOptions.forEach(pushFilterOption);
          levelRangeChips.push({
            label: label(target),
            optionIds: matchedLevelOptions.map(option => option.id)
          });
        }
      }
    }
  });

  const assignStatRange = (prefix, min, max) => {
    if (min !== null) {
      const key = `${prefix}Min`;
      statFilters[key] = statFilters[key] === null ? min : Math.max(statFilters[key], min);
    }
    if (max !== null) {
      const key = `${prefix}Max`;
      statFilters[key] = statFilters[key] === null ? max : Math.min(statFilters[key], max);
    }
  };

  const statPatterns = [
    { regex: /攻撃力\s*(\d+)\s*の/g, apply: (value) => assignStatRange("atk", value, value) },
    { regex: /攻撃力\s*(\d+)\s*以下/g, apply: (value) => assignStatRange("atk", null, value) },
    { regex: /攻撃力\s*(\d+)\s*以上/g, apply: (value) => assignStatRange("atk", value, null) },
    { regex: /攻撃力\s*(\d+)\s*未満/g, apply: (value) => assignStatRange("atk", null, value - 1) },
    { regex: /攻撃力\s*(\d+)\s*超/g, apply: (value) => assignStatRange("atk", value + 1, null) },
    { regex: /守備力\s*(\d+)\s*の/g, apply: (value) => assignStatRange("def", value, value) },
    { regex: /守備力\s*(\d+)\s*以下/g, apply: (value) => assignStatRange("def", null, value) },
    { regex: /守備力\s*(\d+)\s*以上/g, apply: (value) => assignStatRange("def", value, null) },
    { regex: /守備力\s*(\d+)\s*未満/g, apply: (value) => assignStatRange("def", null, value - 1) },
    { regex: /守備力\s*(\d+)\s*超/g, apply: (value) => assignStatRange("def", value + 1, null) }
  ];

  statPatterns.forEach(({ regex, apply }) => {
    let statMatch;
    while ((statMatch = regex.exec(normalizedText)) !== null) {
      const value = Number(statMatch[1]);
      if (!Number.isNaN(value)) {
        apply(value);
      }
    }
  });

  filterOptions
    .slice()
    .sort((a, b) => b.normalizedValue.length - a.normalizedValue.length)
    .forEach(option => {
      const { normalizedValue, isTuner } = option;
      if (!normalizedValue) return;
      if (isTuner) return;
      const isNumeric = /^\d+$/.test(normalizedValue);
      const matched = isNumeric
        ? new RegExp(`(?<!\\d)${escapeRegExp(normalizedValue)}(?!\\d|体|枚)`).test(normalizedTextForNumericMatch)
        : normalizedTextForFilterMatch.includes(normalizedValue);
      if (matched) {
        pushFilterOption(option);
      }
    });

  const attributeChars = ["光", "闇", "地", "水", "炎", "風", "神"];
  attributeChars.forEach(char => {
    if (!normalizedTextForFilterMatch.includes(char)) return;
    if (char === "地" && normalizedTextForFilterMatch.includes("墓地")) return;
    filterOptions.forEach(option => {
      const { normalizedValue } = option;
      if (normalizedValue === char || normalizedValue === `${char}属性`) {
        pushFilterOption(option);
      }
    });
  });

  const hasTunerText = normalizedTextForFilterMatch.includes("チューナー");
  const hasNonTunerText = /チューナー以外|非チューナー/.test(normalizedTextForFilterMatch);
  if (hasNonTunerText) {
    filterOptions.forEach(option => {
      if (option.isTuner && option.value === "0") {
        pushFilterOption(option);
      }
    });
  } else if (hasTunerText) {
    filterOptions.forEach(option => {
      if (option.isTuner && option.value === "1") {
        pushFilterOption(option);
      }
    });
  }

  const quotedSearchTags = [];
  const quoteRegex = /「([^「」]+)」/g;
  let match;
  while ((match = quoteRegex.exec(rawText)) !== null) {
    const quoted = match[1].trim();
    if (quoted && !quotedSearchTags.includes(quoted)) {
      quotedSearchTags.push(quoted);
    }
  }

  const hasStatFilters = Object.values(statFilters).some(value => value !== null);
  if (matchedFilterOptions.length === 0 && quotedSearchTags.length === 0 && !hasStatFilters && levelRangeChips.length === 0) return null;
  return { filterOptions: matchedFilterOptions, quotedSearchTags, statFilters, levelRangeChips };
}

function renderSelectionTagPopup(payload, rect) {
  const popup = ensureSelectionTagPopup();
  pendingSelectionTagPayload = payload;
  selectionTagPopupAnchorRect = rect;
  renderSelectionTagPopupContent(payload);
  popup.classList.remove("hidden");

  const margin = 12;
  const popupRect = popup.getBoundingClientRect();
  let left = rect.left + (rect.width / 2) - (popupRect.width / 2);
  let top = rect.bottom + 10;

  if (left < margin) left = margin;
  if (left + popupRect.width > window.innerWidth - margin) {
    left = window.innerWidth - popupRect.width - margin;
  }

  if (top + popupRect.height > window.innerHeight - margin) {
    top = rect.top - popupRect.height - 10;
  }

  if (top < margin) top = margin;

  popup.style.left = `${Math.round(left)}px`;
  popup.style.top = `${Math.round(top)}px`;
}

function refreshSelectionTagPopup() {
  if (!pendingSelectionTagPayload || !isSelectionTagPopupVisible()) return;
  renderSelectionTagPopupContent(pendingSelectionTagPayload);
}

function toggleSelectionTagChip(kind, encodedValue) {
  if (!pendingSelectionTagPayload) return;

  if (kind === "apply-all") {
    applySelectionTagPayloadInternal(pendingSelectionTagPayload, { preservePopup: true, toggleOffIfApplied: true });
    refreshSelectionTagPopup();
    return;
  } else if (kind === "clear-all") {
    applySelectionTagPayloadInternal(pendingSelectionTagPayload, { preservePopup: true, clearOnly: true });
    refreshSelectionTagPopup();
    return;
  } else if (kind === "filter") {
    const targetId = decodeURIComponent(encodedValue || "");
    const option = pendingSelectionTagPayload.filterOptions.find(item => item.id === targetId);
    if (option?.checkbox) {
      option.checkbox.checked = !option.checkbox.checked;
    }
  } else if (kind === "level-range") {
    const payload = JSON.parse(decodeURIComponent(encodedValue || ""));
    const shouldApply = !areLevelOptionsApplied(payload.optionIds);
    payload.optionIds.forEach(optionId => {
      const option = pendingSelectionTagPayload.filterOptions.find(item => item.id === optionId);
      if (option?.checkbox) {
        option.checkbox.checked = shouldApply;
      }
    });
  } else if (kind === "stat") {
    const payload = JSON.parse(decodeURIComponent(encodedValue || ""));
    const isApplied = isStatFilterApplied(payload.prefix, payload.min, payload.max);
    setNumericFilterValue(`filter-${payload.prefix}-min`, isApplied ? "" : payload.min);
    setNumericFilterValue(`filter-${payload.prefix}-max`, isApplied ? "" : payload.max);
  } else if (kind === "search") {
    const tag = decodeURIComponent(encodedValue || "");
    if (searchTags.includes(tag)) {
      searchTags = searchTags.filter(item => item !== tag);
    } else {
      searchTags.push(tag);
    }
  }

  renderCardList();
  refreshSelectionTagPopup();
}

function applySelectionTagPayload(payload) {
  applySelectionTagPayloadInternal(payload, {});
}

function applySelectionTagPayloadInternal(payload, options = {}) {
  const { preservePopup = false, toggleOffIfApplied = false, clearOnly = false } = options;
  const shouldRemove = clearOnly || (toggleOffIfApplied && isSelectionPayloadFullyApplied(payload));

  if (shouldRemove) {
    payload.filterOptions.forEach(option => {
      if (option.checkbox) option.checkbox.checked = false;
    });
    if (payload.statFilters) {
      if (payload.statFilters.atkMin !== null || payload.statFilters.atkMax !== null) {
        setNumericFilterValue("filter-atk-min", "");
        setNumericFilterValue("filter-atk-max", "");
      }
      if (payload.statFilters.defMin !== null || payload.statFilters.defMax !== null) {
        setNumericFilterValue("filter-def-min", "");
        setNumericFilterValue("filter-def-max", "");
      }
    }
    searchTags = searchTags.filter(tag => !payload.quotedSearchTags.includes(tag));
    renderCardList();
    if (!preservePopup) {
      hideSelectionTagPopup();
      clearDescriptionSelection();
    }
    return;
  }

  document.querySelectorAll(".filter-panel input[type='checkbox'][class^='filter-']").forEach(cb => {
    cb.checked = false;
  });
  clearNumericFilters();
  const categoryInput = document.getElementById("filter-category");
  if (categoryInput) categoryInput.value = "";
  const searchInput = document.getElementById("search-text");
  if (searchInput) searchInput.value = "";
  const searchIcon = document.getElementById("search-icon-symbol");
  if (searchIcon) searchIcon.textContent = "🔍";
  searchTags = [];

  payload.filterOptions.forEach(option => {
    if (option.checkbox) {
      option.checkbox.checked = true;
    }
  });

  if (payload.statFilters) {
    setNumericFilterValue("filter-atk-min", payload.statFilters.atkMin);
    setNumericFilterValue("filter-atk-max", payload.statFilters.atkMax);
    setNumericFilterValue("filter-def-min", payload.statFilters.defMin);
    setNumericFilterValue("filter-def-max", payload.statFilters.defMax);
  }

  payload.quotedSearchTags.forEach(tag => {
    if (!searchTags.includes(tag)) {
      searchTags.push(tag);
    }
  });

  renderCardList();
  if (!preservePopup) {
    hideSelectionTagPopup();
    clearDescriptionSelection();
  }
}

function handleDescriptionSelection() {
  const descEl = document.getElementById("card-desc");
  if (!descEl) return hideSelectionTagPopup();

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    if (!isSelectionTagPopupVisible()) {
      hideSelectionTagPopup();
    }
    return;
  }

  const range = selection.getRangeAt(0);
  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;
  if (!anchorNode || !focusNode || !descEl.contains(anchorNode) || !descEl.contains(focusNode)) {
    hideSelectionTagPopup();
    return;
  }

  const selectedText = selection.toString().trim();
  const payload = extractSelectionTagPayload(selectedText);
  if (!payload) {
    hideSelectionTagPopup();
    return;
  }

  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    hideSelectionTagPopup();
    return;
  }

  renderSelectionTagPopup(payload, rect);
}

function setupDescriptionSelectionTagging() {
  ensureSelectionTagPopup();

  document.addEventListener("mouseup", () => {
    requestAnimationFrame(handleDescriptionSelection);
  });

  document.addEventListener("keyup", () => {
    requestAnimationFrame(handleDescriptionSelection);
  });

  document.addEventListener("scroll", hideSelectionTagPopup, true);
  window.addEventListener("resize", hideSelectionTagPopup);

  document.addEventListener("mousedown", (event) => {
    const descEl = document.getElementById("card-desc");
    if (event.button !== 0) return;
    if (selectionTagPopup?.contains(event.target)) return;
    if (descEl?.contains(event.target)) return;
    hideSelectionTagPopup();
    clearDescriptionSelection();
  });
}

function createFlyingCard(label, from, to) {
  if (!from || !to) return;
  const ghost = document.createElement("div");
  ghost.className = "flying-card";
  ghost.textContent = label || "";
  ghost.style.left = `${from.x}px`;
  ghost.style.top = `${from.y}px`;
  ghost.style.transform = "translate(-50%, -50%) translate(0px, 0px) scale(1)";
  ghost.style.opacity = "0.95";
  document.body.appendChild(ghost);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(fallbackTimer);
    ghost.remove();
  };

  const handleTransitionEnd = event => {
    if (event.target !== ghost) return;
    cleanup();
  };

  ghost.addEventListener("transitionend", handleTransitionEnd);

  const fallbackTimer = window.setTimeout(cleanup, 450);

  // Force the browser to commit the starting state before transitioning.
  void ghost.offsetWidth;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ghost.style.transform = `translate(-50%, -50%) translate(${to.x - from.x}px, ${to.y - from.y}px) scale(0.96)`;
      ghost.style.opacity = "0.08";
    });
  });
}

function findCardElementById(containerSelector, cardId) {
  const container = document.querySelector(containerSelector);
  if (!container) return null;
  return container.querySelector(`.card-item[data-card-id="${String(cardId)}"]`);
}

function findVisibleCardElementInRight(cardId) {
  const rightList = document.getElementById("card-list");
  if (!rightList) return null;
  const card = findCardById(cardId);
  if (!card) return null;
  return Array.from(rightList.querySelectorAll(".card-item")).find(el => (el.textContent || "").trim() === String(card.略称 || "")) || null;
}

function findVisibleCardElementInDeck(cardId) {
  const deckList = document.getElementById("deck-list");
  if (!deckList) return null;
  const card = findCardById(cardId);
  if (!card) return null;
  return Array.from(deckList.querySelectorAll(".card-item")).find(el => {
    const t = (el.textContent || "").trim();
    return t === String(card.名前 || "") || t.startsWith(String(card.名前 || ""));
  }) || null;
}


export function renderCardList(resetPage = true) {
  // 若從 Event (如 onchange) 呼叫，resetPage 會是 Event 物件 (truthy) -> 重置頁面。
  // 若要保留當前頁面，請明確傳入 false。
  if (resetPage === true || (typeof resetPage === 'object' && resetPage !== null)) {
    currentPage = 1;
  }

  const container = document.getElementById("card-list");
  container.innerHTML = "";
  let filtered = applyFiltersAndSearch();

  updateSearchHistory(); // Save history if tags present
  // Recalculate itemsPerPage to account for layout changes (e.g. active tags height)
  updateItemsPerPage();

  // 根據原有的邏輯過濾 Deck 類型
  if (currentDeckTab === 'main') {
    filtered = filtered.filter(c => !extraTypes.includes(c.種類));
  } else {
    filtered = filtered.filter(c => extraTypes.includes(c.種類));
  }

  // --- 分頁邏輯 ---
  const totalItems = filtered.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
  const pageCards = filtered.slice(startIndex, endIndex);
  const deckCounts = currentDeckList().reduce((counts, deckCard) => {
    counts.set(deckCard.id, (counts.get(deckCard.id) || 0) + 1);
    return counts;
  }, new Map());
  const activeSearchTerms = [
    document.getElementById("search-text")?.value.trim(),
    ...searchTags,
  ].filter(Boolean);

  renderPagination(totalPages);

  pageCards.forEach(card => {
    const el = document.createElement("div");
    el.className = "card-item";
    el.dataset.cardId = String(card.id);
    el.draggable = true;
    const isExactNameMatch = isExactOriginalNameMatch(card, activeSearchTerms);
    const aliasTreatmentNames = getAliasTreatmentNames(card);
    const hasAliasTreatment = isAliasTreatmentMatch(card, activeSearchTerms);
    if (isExactNameMatch) el.classList.add("exact-name-match");

    const badges = document.createElement("div");
    badges.className = "card-item-badges";
    if (isExactNameMatch) {
      const badge = document.createElement("span");
      badge.className = "card-item-badge card-item-badge-gold";
      badge.textContent = "\u2605";
      badge.title = card.名前 || "";
      badges.appendChild(badge);
    }
    if (hasAliasTreatment) {
      const badge = document.createElement("span");
      badge.className = "card-item-badge card-item-badge-silver";
      badge.textContent = "\u2605";
      badge.title = aliasTreatmentNames.join(" / ");
      badges.appendChild(badge);
    }
    el.appendChild(badges);

    const body = document.createElement("div");
    body.className = "card-item-body";

    const main = document.createElement("div");
    main.className = "card-item-main";
    main.textContent = card.略称 || "";
    body.appendChild(main);

    el.appendChild(body);
    const deckCount = deckCounts.get(card.id) || 0;
    if (deckCount > 0) {
      const countBadge = document.createElement("span");
      countBadge.className = "card-count-badge";
      countBadge.textContent = `x${deckCount}`;
      el.appendChild(countBadge);
    }
    // Color border or text based on type? Original: style.color. 
    // New design: card-item has border. Let's use border color or a small pip.
    el.style.borderLeft = `0.3rem solid ${typeColors[card.種類] || "#555"}`;

    if (selectedCard?.id === card.id) el.classList.add("selected");

    el.ondragstart = e => handleDragStart(e, card.id);
    el.onclick = () => {
      selectedCard = card;
      renderCardInfo();
      // Update selection visually to preserve DOM for dblclick
      document.querySelectorAll('#card-list .card-item').forEach(i => i.classList.remove('selected'));
      el.classList.add('selected');
      renderDeck();
    };
    el.ondblclick = () => addToCurrentDeck(card.id, { animate: true, sourceEl: el, sourceZone: "right" });
    el.oncontextmenu = e => {
      e.preventDefault();
      removeFromDeck(card.id, { animate: true });
    };
    container.appendChild(el);
  });

  container.scrollTop = 0; // 渲染時固定滾動到頂部

  const countEl = document.getElementById("result-count");
  if (countEl) {
    countEl.innerHTML = `<span class="count-badge-label">HITS</span><span class="count-badge-value">${totalItems}</span>`;
  }
}

function renderPagination(totalPages) {
  const info = document.getElementById("page-info");
  const btnPrev = document.getElementById("btn-prev");
  const btnNext = document.getElementById("btn-next");

  if (info) info.textContent = `PAGE ${currentPage} / ${totalPages}`;

  if (btnPrev) {
    btnPrev.disabled = currentPage <= 1;
    btnPrev.onclick = () => changePage(-1);
  }

  if (btnNext) {
    btnNext.disabled = currentPage >= totalPages;
    btnNext.onclick = () => changePage(1);
  }
}

function changePage(delta) {
  currentPage += delta;
  renderCardList(false); // 傳入 false 以保留新頁面
}

function updateItemsPerPage() {
  const container = document.getElementById("card-list");
  if (!container || container.clientHeight === 0) return;

  // 取得 CSS Grid 的列數 (假設 gap 為 4px)
  // 簡單判斷：容器寬度 / (大概卡片寬度 + gap) ?
  // 或者直接讀取 computedStyle 的 grid-template-columns
  const style = window.getComputedStyle(container);
  const gridCols = style.gridTemplateColumns.split(" ").length || 3;

  // 估算卡片高度 + gap
  // 如果列表是空的，我們可以暫時插入一個 dummy card 來測量
  let itemHeight = 40; // 預設估計值 (30px min-height + padding + border + gap)

  // 嘗試測量現有的卡片
  const firstCard = container.querySelector(".card-item");
  if (firstCard) {
    itemHeight = firstCard.offsetHeight + 4; // 加上 gap
  } else {
    // 創建一個臨時元素測量
    const temp = document.createElement("div");
    temp.className = "card-item";
    temp.style.visibility = "hidden";
    temp.textContent = "Test";
    container.appendChild(temp);
    itemHeight = temp.offsetHeight + 4;
    container.removeChild(temp);
  }

  // 計算可容納的行數
  // 預留一點空間避免 scrollbar 出現導致寬度變化
  const availableHeight = container.clientHeight - 12; // 減去 padding
  const rows = Math.floor(availableHeight / itemHeight);

  // 計算總數量，至少顯示一行
  const newItemsPerPage = Math.max(1, rows * gridCols);

  if (itemsPerPage !== newItemsPerPage) {
    itemsPerPage = newItemsPerPage;
    // console.log(`Updated itemsPerPage: ${itemsPerPage} (Rows: ${rows}, Cols: ${gridCols})`);
  }
}

function renderCardInfo() {
  const c = selectedCard;
  if (!c) return;
  updateCardHistory(c);
  const typeColor = typeColors[c.種類] || "";

  const btnFav = document.getElementById("btn-favorite");
  if (btnFav) {
    if (favorites.has(c.id)) {
      btnFav.classList.add('active');
    } else {
      btnFav.classList.remove('active');
    }
  }

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || "-";
  };

  set("card-id", `ID: ${c.id}`);
  set("card-name", c.名前 || "Unknown");
  set("card-shortname", c.略称 || "");
  let typeDisplay = c.種類 || "";
  if (c.チューナー == 1) {
    typeDisplay += " / チューナー";
  }
  set("card-type", typeDisplay);
  const nameEl = document.getElementById("card-name");
  if (nameEl) nameEl.style.color = typeColor || "#fff";
  const typeEl = document.getElementById("card-type");
  if (typeEl) typeEl.style.color = typeColor || "";
  set("card-attr", attrIcons[c.属性] || c.属性 || "-"); // Use icons
  set("card-race", c.種族 || ""); // Now separate
  set("card-level", c.レベル || "");
  set("card-atk", c.攻撃力 === -1 ? "?" : c.攻撃力 ?? "0");
  set("card-def", c.守備力 === -1 ? "?" : c.守備力 ?? "0");
  set("card-gender", c.性別 || "");
  set("card-tuner", c.チューナー == 1 ? "是" : "否");
  // Description
  const decorationMap = {
    "ROGUE": [{ l: "RED", r: "RED", t: "ROGUE CARD" }],
    "P_MAGIC": [
      { l: "chocolate", r: "lightseagreen", t: "PENDULUM  MAGIC" },
      { l: "chocolate", r: "lightseagreen", t: "このカードは永続魔法扱いで発動できる" }
    ],
    "P_MAGIC_2": [{ l: "chocolate", r: "lightseagreen", t: "このカードはフィールドから墓地へ送られる場合EXデッキへ行く" }],
    "BASM_P_MAGIC": [
      { l: "wheat", r: "lightseagreen", t: "PENDULUM  MAGIC" },
      { l: "wheat", r: "lightseagreen", t: "このカードは永続魔法扱いで発動できる" }
    ],
    "BASM_P_MAGIC_2": [
      { l: "wheat", r: "lightseagreen", t: "このカードはフィールドから墓地へ送られる場合EXデッキへ行く" },
      { l: "wheat", r: "lightseagreen", t: "モンスター効果" }
    ],
    "GISK_P_MAGIC": [
      { l: "DodgerBlue", r: "lightseagreen", t: "PENDULUM  MAGIC" },
      { l: "DodgerBlue", r: "lightseagreen", t: "このカードは永続魔法扱いで発動できる" }
    ],
    "GISK_P_MAGIC_2": [
      { l: "DodgerBlue", r: "lightseagreen", t: "このカードはフィールドから墓地へ送られる場合EXデッキへ行く" },
      { l: "DodgerBlue", r: "lightseagreen", t: "モンスター効果" }
    ],
    "FUSE_P_MAGIC": [
      { l: "PURPLE", r: "lightseagreen", t: "PENDULUM  MAGIC" },
      { l: "PURPLE", r: "lightseagreen", t: "このカードは永続魔法扱いで発動できる" }
    ],
    "FUSE_P_MAGIC_2": [
      { l: "PURPLE", r: "lightseagreen", t: "このカードはフィールドから墓地へ送られる場合EXデッキへ行く" },
      { l: "PURPLE", r: "lightseagreen", t: "モンスター効果" }
    ],
    "SYN_P_MAGIC": [
      { l: "WHITE", r: "lightseagreen", t: "PENDULUM  MAGIC" },
      { l: "WHITE", r: "lightseagreen", t: "このカードは永続魔法扱いで発動できる" }
    ],
    "SYN_P_MAGIC_2": [
      { l: "WHITE", r: "lightseagreen", t: "このカードはフィールドから墓地へ送られる場合EXデッキへ行く" },
      { l: "WHITE", r: "lightseagreen", t: "モンスター効果" }
    ],
    "XYZ_P_MAGIC": [
      { l: "BLACK", r: "lightseagreen", t: "PENDULUM  MAGIC" },
      { l: "BLACK", r: "lightseagreen", t: "このカードは永続魔法扱いで発動できる" }
    ],
    "XYZ_P_MAGIC_2": [
      { l: "BLACK", r: "lightseagreen", t: "このカードはフィールドから墓地へ送られる場合EXデッキへ行く" },
      { l: "BLACK", r: "lightseagreen", t: "モンスター効果" }
    ],
    "LINK_P_MAGIC": [
      { l: "DodgerBlue", r: "lightseagreen", t: "PENDULUM  MAGIC" },
      { l: "DodgerBlue", r: "lightseagreen", t: "このカードは永続魔法扱いで発動できる" }
    ],
    "LINK_P_MAGIC_2": [
      { l: "DodgerBlue", r: "lightseagreen", t: "このカードはフィールドから墓地へ送られる場合EXデッキへ行く" },
      { l: "DodgerBlue", r: "lightseagreen", t: "モンスター効果" }
    ],
    "PSY_P_MAGIC": [
      { l: "RED", r: "lightseagreen", t: "PENDULUM  MAGIC" },
      { l: "RED", r: "lightseagreen", t: "このカードは永続魔法扱いで發動できる" }
    ],
    "PSY_P_MAGIC_2": [
      { l: "RED", r: "lightseagreen", t: "このカードはフィールドから墓地へ送られる場合EXデッキへ行く" },
      { l: "RED", r: "lightseagreen", t: "モンスター效果" }
    ],
    "MAXIMUM": [
      { l: "GOLD", r: "GOLD", t: "【マキシマムモード】" },
      { l: "GOLD", r: "GOLD", t: "すべてのパーツがそろっているマキシマムモンスターは完全耐性を持つ" }
    ],
    "D_HEART_W": [{ l: "GREEN", r: "GREEN", t: "DRAG-HEART WEAPON" }],
    "D_HEART_F": [{ l: "RED", r: "RED", t: "DRAG-HEART FORT" }],
    "D_HEART_2": [{ l: "RED", r: "RED", t: "このカードはフィールドから墓地へ送られる場合EXデッキへ行く" }],
    "D_HEART_C": [{ l: "RED", r: "RED", t: "DRAG-HEART CREATURE" }],
    "FORTRESS": [{ l: "RED", r: "RED", t: "F O R T R E S S" }],
    "IMPACT!": [{ l: "GREEN", r: "GREEN", t: "FINISHER MOVE" }],
    "CUSTOM": [{ l: "YELLOW", r: "YELLOW", t: "カスタム カード" }],
    "INVASION": [{ l: "RED", r: "RED", t: "侵　略" }],
    "FREV_CHANGE": [{ l: "GOLD", r: "GOLD", t: "革　命 チ ェ ン ジ" }],
    "REV_CHANGE1": [{ l: "RED", r: "GREEN", t: "革　命 チ ェ ン ジ" }],
    "REV_CHANGE2": [{ l: "YELLOW", r: "AQUA", t: "革　命 チ ェ ン ジ" }],
    "REV_CHANGE3": [{ l: "YELLOW", r: "GREEN", t: "革　命 チ ェ ン ジ" }],
    "REV_CHANGE4": [{ l: "DodgerBlue", r: "PURPLE", t: "革　命 チ ェ ン ジ" }],
    "REV_CHANGE5": [{ l: "PURPLE", r: "RED", t: "革　命 チ ェ ン ジ" }],
    "REV_CHANGE6": [{ l: "RED", r: "YELLOW", t: "革　命 チ ェ ン ジ" }],
    "REV_CHANGE7": [{ l: "PURPLE", r: "GREEN", t: "革　命 チ ェ ン ジ" }],
    "REV_CHANGE8": [{ l: "GREEN", r: "DodgerBlue", t: "革　命 チ ェ ン ジ" }]
  };

  const descHTML = (c.説明 || "")
    // 使用 \n? 吞掉標籤前後可能存在的換行，避免產生多餘的 <br>
    .replace(/\n?\[DECORATION\](\w+)\n?/g, (match, key) => {
      const items = decorationMap[key];
      if (!items) return match;
      return items.map(item => `<div class="decoration-container"><div class="decoration-line" style="background: ${item.l};"></div><div class="decoration-text" style="background-image: linear-gradient(to right, ${item.l}, ${item.r});">${item.t}</div><div class="decoration-line" style="background: ${item.r};"></div></div>`).join("");
    })
    .replace(/「(.*?)」/g, (_, word) => {
      const encoded = encodeURIComponent(word);
      return `<a href="#" class="desc-link" data-word="${encoded}">「${word}」</a>`;
    })
    .replace(/\n/g, "<br>");
  const descEl = document.getElementById("card-desc");
  if (descEl) descEl.innerHTML = descHTML;
  hideSelectionTagPopup();

  // Categories
  const catContainer = document.getElementById("card-categories");
  if (catContainer) {
    catContainer.innerHTML = "";
    c.categories.forEach(cat => {
      const btn = document.createElement("button");
      btn.textContent = cat;
      btn.onclick = () => {
        searchTags = [cat];
        renderCardList();
      };
      catContainer.appendChild(btn);
    });
  }

  // Bind description links
  document.querySelectorAll(".desc-link").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      const word = decodeURIComponent(e.currentTarget.dataset.word);
      searchTags = [word];
      renderCardList();
    });
  });
}

function renderDeck() {
  const panel = document.getElementById("deck-list");
  panel.innerHTML = "";
  const deck = currentDeckList();
  deck.sort((a, b) => Number(a.id) - Number(b.id)); // Sort by ID

  // Update Header Info
  const title = document.getElementById("deck-title");
  if (title) title.textContent = currentDeckTab === "main" ? "主デッキ" : "EXデッキ";

  const countBadge = document.getElementById("deck-count-badge");
  const limit = currentDeckTab === "main" ? 60 : 15;
  if (countBadge) {
    countBadge.textContent = `(${deck.length} / ${limit})`;
    countBadge.classList.remove("over-limit", "under-limit");
    if (currentDeckTab === "main" && deck.length < 30) {
      countBadge.classList.add("under-limit");
    } else if (deck.length > limit) {
      countBadge.classList.add("over-limit");
    }
  }
  if (deck.length === 0) {
    // Show empty state (already in HTML default, but if we clear innerHTML we need to restore it or handle it)
    panel.innerHTML = `
        <div class="empty-placeholder">
            <div class="icon">🎴</div>
            <div class="text">デッキは空です</div>
            <div class="subtext">SELECT CARDS FROM THE DATABASE.</div>
        </div>
      `;
    return;
  }

  const grouped = [];
  deck.forEach(card => {
    const last = grouped[grouped.length - 1];
    if (last && last.card.id === card.id) {
      last.count++;
    } else {
      grouped.push({ card, count: 1 });
    }
  });

  grouped.forEach(({ card, count }) => {
    const el = document.createElement("div");
    el.className = "card-item";
    el.dataset.cardId = String(card.id);
    el.draggable = true;
    el.textContent = card.名前;
    el.style.borderLeft = `0.3rem solid ${typeColors[card.種類] || "#fff"}`;

    if (selectedCard?.id === card.id) el.classList.add("selected");

    el.ondragstart = e => handleDeckDragStart(e, card.id);
    el.onclick = () => {
      selectedCard = card;
      renderCardInfo();
      renderCardList();
      // Update selection visually to preserve DOM for dblclick
      document.querySelectorAll('#deck-list .card-item').forEach(i => i.classList.remove('selected'));
      el.classList.add('selected');
    };
    el.ondblclick = () => addToCurrentDeck(card.id, { animate: true, sourceEl: el, sourceZone: "middle" });
    el.oncontextmenu = e => {
      e.preventDefault();
      removeFromDeck(card.id, { animate: true, sourceEl: el });
    };

    if (count > 1) {
      const badge = document.createElement("span");
      badge.className = "card-count-badge";
      badge.textContent = `x${count}`;
      el.appendChild(badge);
    }
    panel.appendChild(el);
  });
}

function applyFiltersAndSearch() {
  const categoryText = document.getElementById("filter-category")?.value.trim();
  const statFilters = getStatFilters();

  // Collect checked filters
  const filters = {
    種類: getChecked("filter-種類"),
    属性: getChecked("filter-属性"),
    種族: getChecked("filter-種族"),
    レベル: getChecked("filter-レベル"),
    性別: getChecked("filter-性別"),
    チューナー: getChecked("filter-チューナー")
  };

  const search = document.getElementById("search-text")?.value.trim();

  let result = allCards.filter(card => {
    for (let key in filters) {
      if (filters[key].length && !filters[key].includes(String(card[key]))) return false;
    }

    if (!cardMatchesStatRange(card.攻撃力, statFilters.atkMin, statFilters.atkMax)) return false;
    if (!cardMatchesStatRange(card.守備力, statFilters.defMin, statFilters.defMax)) return false;

    if (categoryText && !card.categories.some(c => c.includes(categoryText))) return false;

    // Check Input Text
    if (search && !isSearchMatch(card, search)) return false;

    // Check Search Tags
    if (searchTags.length > 0) {
      for (const tag of searchTags) {
        if (!isSearchMatch(card, tag)) return false;
      }
    }

    if (showFavoritesOnly && !favorites.has(card.id)) return false;

    return true;
  });

  // Sorting Logic
  // sortDir: 1 (Asc), -1 (Desc)
  // But wait, traditionally:
  // ID: Asc (1->10)
  // ATK: Desc (3000 -> 0)

  result.sort((a, b) => {
    let valA, valB;

    switch (currentSortKey) {
      case 'atk':
        valA = parseInt(a.攻撃力) || 0;
        valB = parseInt(b.攻撃力) || 0;
        break;
      case 'def':
        valA = parseInt(a.守備力) || 0;
        valB = parseInt(b.守備力) || 0;
        break;
      case 'release':
        valA = parseInt(a.追加日) || 0;
        valB = parseInt(b.追加日) || 0;
        break;
      case 'id':
      default:
        valA = Number(a.id);
        valB = Number(b.id);
        break;
    }

    if (valA < valB) return -1 * currentSortDir;
    if (valA > valB) return 1 * currentSortDir;
    return 0;
  });

  // Render Tags
  renderActiveFilters();

  // Update Sort UI (ensure buttons reflect state)
  updateSortUI();

  return result;
}

export function handleSort(key) {
  if (currentSortKey === key) {
    // Toggle direction
    currentSortDir *= -1;
  } else {
    // New key
    currentSortKey = key;
    // Set default direction based on key type?
    // User: "Default is ID.. Click once is DESC, click again is ASC" -> Implies Toggle.
    // Usually stats default to DESC (High to Low). ID defaults to ASC.
    if (key === 'id') currentSortDir = 1; // Asc
    else currentSortDir = -1; // Desc (ATK, DEF, DATE)
  }
  renderCardList();
}

function updateSortUI() {
  // Buttons: sort-id, sort-atk, sort-def, sort-release
  ['id', 'atk', 'def', 'release'].forEach(k => {
    const btn = document.getElementById(`sort-${k}`);
    if (btn) {
      btn.classList.remove('active');
      btn.textContent = k.toUpperCase(); // Reset text

      if (currentSortKey === k) {
        btn.classList.add('active');
        // Append arrow
        const arrow = currentSortDir === 1 ? " ▲" : " ▼";
        // Optionally add Asc/Desc text if space permits, or just arrow
        btn.textContent += arrow;
      }
    }
  });
}


function renderActiveFilters() {
  const container = document.getElementById("active-filters");
  if (!container) return;
  container.innerHTML = "";

  // Check sorted checkboxes
  document.querySelectorAll(".filter-panel input[type='checkbox'][class^='filter-']:checked").forEach(cb => {
    const val = cb.value;
    const tag = document.createElement("div");
    tag.className = "filter-tag";
    if (cb.className.includes('filter-チューナー')) {
      tag.textContent = `チューナー: ${val === '1' ? '是' : '否'}`;
    } else if (cb.className.includes('filter-レベル')) {
      tag.textContent = `レベル: ${val}`;
    } else {
      tag.textContent = val;
    }
    tag.onclick = () => {
      cb.checked = false;
      renderCardList();
    };
    container.appendChild(tag);
  });

  // Check category text
  const catInput = document.getElementById("filter-category");
  if (catInput && catInput.value.trim()) {
    const tag = document.createElement("div");
    tag.className = "filter-tag";
    tag.textContent = `Cat: ${catInput.value}`;
    tag.onclick = () => {
      catInput.value = "";
      renderCardList();
    };
    container.appendChild(tag);
  }

  const statFilters = getStatFilters();
  if (statFilters.atkMin !== null || statFilters.atkMax !== null) {
    const tag = document.createElement("div");
    tag.className = "filter-tag";
    tag.textContent = formatStatFilterLabel("ATK", statFilters.atkMin, statFilters.atkMax);
    tag.onclick = () => {
      setNumericFilterValue("filter-atk-min", "");
      setNumericFilterValue("filter-atk-max", "");
      renderCardList();
    };
    container.appendChild(tag);
  }

  if (statFilters.defMin !== null || statFilters.defMax !== null) {
    const tag = document.createElement("div");
    tag.className = "filter-tag";
    tag.textContent = formatStatFilterLabel("DEF", statFilters.defMin, statFilters.defMax);
    tag.onclick = () => {
      setNumericFilterValue("filter-def-min", "");
      setNumericFilterValue("filter-def-max", "");
      renderCardList();
    };
    container.appendChild(tag);
  }

  // Render Search Tags
  searchTags.forEach((term, index) => {
    const tag = document.createElement("div");
    tag.className = "filter-tag search-tag"; // Different class for styling
    tag.textContent = `${term}`;
    tag.onclick = () => {
      searchTags.splice(index, 1);
      renderCardList();
    };
    container.appendChild(tag);
  });
}

export function toggleHistory() {
  const p = document.getElementById("history-panel");
  if (p) {
    const wasCollapsed = p.classList.contains("collapsed");
    // Close others
    document.getElementById("filter-panel")?.classList.add("collapsed");
    document.getElementById("sort-panel")?.classList.add("collapsed");

    if (wasCollapsed) {
      renderHistoryPanel();
      p.classList.remove("collapsed");
    } else {
      p.classList.add("collapsed");
    }
    syncRightPanelFocusState();
  }
}

function updateSearchHistory() {
  if (searchTags.length === 0) return;

  // Find if the exact same tag combination already exists.
  const existingIndex = searchHistory.findIndex(historyTags => arraysEqual(historyTags, searchTags));

  // If it exists, remove it from its old position.
  if (existingIndex > -1) {
    searchHistory.splice(existingIndex, 1);
  }

  // Add the new (or now-moved) search to the front.
  searchHistory.unshift([...searchTags]);

  // Limit the history to 5 entries.
  if (searchHistory.length > 5) {
    searchHistory.length = 5; // Truncate array
  }

  // If panel is open, refresh it
  if (!document.getElementById("history-panel")?.classList.contains("collapsed")) {
    renderHistoryPanel();
  }
}

function ensureDefaultSearchHistory() {
  defaultSearchHistory.forEach(tags => {
    const exists = searchHistory.some(historyTags => arraysEqual(historyTags, tags));
    if (!exists) {
      searchHistory.push([...tags]);
    }
  });
}

function updateCardHistory(card) {
  if (!card) return;

  // Find if the card already exists.
  const existingIndex = cardHistory.findIndex(historyCard => historyCard.id === card.id);

  // If it exists, remove it.
  if (existingIndex > -1) {
    cardHistory.splice(existingIndex, 1);
  }

  cardHistory.unshift(card);
  if (cardHistory.length > 5) {
    cardHistory.length = 5;
  }

  if (!document.getElementById("history-panel")?.classList.contains("collapsed")) {
    renderHistoryPanel();
  }
}

function renderHistoryPanel() {
  // Render Searches
  const searchContainer = document.getElementById("history-searches");
  if (searchContainer) {
    searchContainer.innerHTML = "";
    searchHistory.forEach(tags => {
      const historyItemDiv = document.createElement("div");
      historyItemDiv.className = "history-item";
      // Make it a flex container for tags
      historyItemDiv.style.display = 'flex';
      historyItemDiv.style.flexWrap = 'wrap';
      historyItemDiv.style.gap = '4px';

      historyItemDiv.onclick = () => {
        searchTags = [...tags];
        renderCardList();
        // Close panel after applying for better UX
        document.getElementById("history-panel")?.classList.add("collapsed");
        syncRightPanelFocusState();
      };

      tags.forEach(tagText => {
        const tagEl = document.createElement("div");
        tagEl.className = "filter-tag search-tag";
        tagEl.textContent = tagText;
        historyItemDiv.appendChild(tagEl);
      });

      searchContainer.appendChild(historyItemDiv);
    });
  }

  // Render Cards
  const cardContainer = document.getElementById("history-cards");
  if (cardContainer) {
    cardContainer.innerHTML = "";
    cardHistory.forEach(card => {
      const div = document.createElement("div");
      div.className = "history-item";
      div.textContent = `[${card.id}] ${card.名前}`;
      div.onclick = () => {
        selectedCard = card;
        renderCardInfo();
        // Note: Do not close panel here, user may want to browse recent cards
      };
      cardContainer.appendChild(div);
    });
  }
}

function arraysEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function normalizeSearchTerm(term) {
  return String(term || "").normalize("NFKC").trim().toLowerCase();
}

function isExactOriginalNameMatch(card, terms = []) {
  const originalName = normalizeSearchTerm(card?.名前);
  const shortName = normalizeSearchTerm(card?.略称);
  if (!originalName && !shortName) return false;
  return terms.some(term => {
    const normalizedTerm = normalizeSearchTerm(term);
    return normalizedTerm === originalName || normalizedTerm === shortName;
  });
}

function getAliasTreatmentNames(card) {
  const description = String(card?.説明 || "");
  const matches = [...description.matchAll(/「([^」]+)」としても扱う/g)];
  return matches.map(match => normalizeSearchTerm(match[1])).filter(Boolean);
}

function isAliasTreatmentMatch(card, terms = []) {
  const aliasNames = getAliasTreatmentNames(card);
  if (!aliasNames.length) return false;
  return terms.some(term => aliasNames.includes(normalizeSearchTerm(term)));
}

// Helper for search matching
function isSearchMatch(card, term) {
  const target = [
    card.id,
    card.名前,
    card.略称,
    card.説明,
    ...(card.categories || [])
  ].join(" ");
  return target.includes(term);
}

export function handleSearch() {
  const input = document.getElementById("search-text");
  const icon = document.getElementById("search-icon-symbol");
  if (input && icon) {
    icon.textContent = input.value.trim() ? "▶" : "🔍";
  }
  renderCardList();
}

function renderFilterPanel() {
  const filterDiv = document.getElementById("filters");
  if (!filterDiv) return;
  filterDiv.innerHTML = "";

  // Define what to filter
  const filterKeys = ["種類", "属性", "種族", "レベル", "性別"];
  const filters = {};
  filterKeys.forEach(k => {
    filters[k] = [...new Set(allCards.map(c => c[k]))];
  });

  for (let key in filters) {
    const group = document.createElement("div");
    group.className = "filter-group";

    const title = document.createElement("div");
    title.className = "filter-group-title";
    title.textContent = key;
    const content = document.createElement("div");
    content.className = "filter-group-content";

    group.appendChild(title);
    group.appendChild(content);

    if (key === "種類") {
      const trapTypes = ["通常罠", "永続罠", "カウンター罠"];
      const spellTypes = ["通常魔法", "永続魔法", "装備魔法", "儀式魔法", "フィールド", "速攻魔法"];
      const otherTypes = filters[key].filter(type =>
        type && !trapTypes.includes(type) && !spellTypes.includes(type)
      );

      const typeGroups = [trapTypes, spellTypes, otherTypes];

      typeGroups.forEach((groupTypes, groupIndex) => {
        if (!groupTypes.length) return;

        const groupContainer = document.createElement("div");
        groupContainer.className = "filter-subgroup";

        let selectAllLabelText = "";
        if (groupIndex === 0) selectAllLabelText = "罠全般";
        else if (groupIndex === 1) selectAllLabelText = "魔法全般";

        if (selectAllLabelText) {
          const allNoneLabel = document.createElement("label");
          allNoneLabel.className = "filter-card filter-card-select-all";

          const allNoneCheckbox = document.createElement("input");
          allNoneCheckbox.type = "checkbox";
          allNoneCheckbox.onchange = () => {
            groupTypes.forEach(type => {
              const checkbox = document.querySelector(`.filter-${key}[value="${type}"]`);
              if (checkbox) checkbox.checked = allNoneCheckbox.checked;
            });
            renderCardList();
          };

          const text = document.createElement("span");
          text.textContent = selectAllLabelText;

          allNoneLabel.appendChild(allNoneCheckbox);
          allNoneLabel.appendChild(text);
          groupContainer.appendChild(allNoneLabel);
        }

        const checkboxContainer = document.createElement("div");
        checkboxContainer.className = "filter-card-grid";

        groupTypes.forEach(val => {
          const label = createFilterCheckbox(key, val);
          checkboxContainer.appendChild(label);
        });

        groupContainer.appendChild(checkboxContainer);
        content.appendChild(groupContainer);
      });
    } else {
      const container = document.createElement("div");
      container.className = "filter-card-grid";

      filters[key]
        .filter(x => x !== null && x !== undefined)
        .sort((a, b) => (typeof a === 'number' && typeof b === 'number') ? a - b : String(a).localeCompare(String(b), 'ja'))
        .forEach(val => { if (val) { const label = createFilterCheckbox(key, val); container.appendChild(label); } });

      content.appendChild(container);
    }
    filterDiv.appendChild(group);
  }

  // Manually add Tuner filter group
  const tunerGroup = document.createElement("div");
  tunerGroup.className = "filter-group";

  const tunerTitle = document.createElement("div");
  tunerTitle.className = "filter-group-title";
  tunerTitle.textContent = "チューナー";
  tunerGroup.appendChild(tunerTitle);

  const tunerContent = document.createElement("div");
  tunerContent.className = "filter-group-content";

  const tunerContainer = document.createElement("div");
  tunerContainer.className = "filter-card-grid";

  [{ label: '是', value: '1' }, { label: '否', value: '0' }].forEach(opt => {
    const label = createFilterCheckbox("チューナー", opt.value, opt.label);
    tunerContainer.appendChild(label);
  });
  tunerContent.appendChild(tunerContainer);
  tunerGroup.appendChild(tunerContent);
  filterDiv.appendChild(tunerGroup);

  const categoryGroup = document.createElement("div");
  categoryGroup.className = "filter-group filter-group-field";

  const categoryTitle = document.createElement("div");
  categoryTitle.className = "filter-group-title";
  categoryTitle.textContent = "Category";

  const categoryContent = document.createElement("div");
  categoryContent.className = "filter-group-content";

  const categoryRow = document.createElement("div");
  categoryRow.className = "filter-field-row";

  const categoryInput = document.createElement("input");
  categoryInput.type = "text";
  categoryInput.id = "filter-category";
  categoryInput.placeholder = "Category...";
  categoryInput.className = "filter-text-input";
  categoryInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      renderCardList();
    }
  });
  categoryInput.addEventListener("input", renderCardList);

  categoryRow.appendChild(categoryInput);
  categoryContent.appendChild(categoryRow);
  categoryGroup.appendChild(categoryTitle);
  categoryGroup.appendChild(categoryContent);
  filterDiv.appendChild(categoryGroup);

  const statConfigs = [
    { key: "atk", label: "攻撃力" },
    { key: "def", label: "守備力" }
  ];

  statConfigs.forEach(({ key, label }) => {
    const group = document.createElement("div");
    group.className = "filter-group filter-group-field";

    const title = document.createElement("div");
    title.className = "filter-group-title";
    title.textContent = label;

    const content = document.createElement("div");
    content.className = "filter-group-content";

    const row = document.createElement("div");
    row.className = "filter-range-row";

    const minInput = document.createElement("input");
    minInput.type = "number";
    minInput.id = `filter-${key}-min`;
    minInput.placeholder = "Min";
    minInput.className = "filter-range-input";
    minInput.addEventListener("input", renderCardList);

    const sep = document.createElement("span");
    sep.className = "filter-range-separator";
    sep.textContent = "~";

    const maxInput = document.createElement("input");
    maxInput.type = "number";
    maxInput.id = `filter-${key}-max`;
    maxInput.placeholder = "Max";
    maxInput.className = "filter-range-input";
    maxInput.addEventListener("input", renderCardList);

    row.appendChild(minInput);
    row.appendChild(sep);
    row.appendChild(maxInput);
    content.appendChild(row);
    group.appendChild(title);
    group.appendChild(content);
    filterDiv.appendChild(group);
  });
}

function createFilterCheckbox(key, val, labelText = val) {
  const label = document.createElement("label");
  label.className = "filter-card";

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.value = val;
  cb.className = `filter-${key}`;
  cb.onchange = renderCardList;

  const text = document.createElement("span");
  text.textContent = labelText;

  label.appendChild(cb);
  label.appendChild(text);
  return label;
}






function getChecked(cls) {
  return [...document.querySelectorAll(`.${cls}:checked`)].map(cb => cb.value);
}

function isRightOverlayOpen() {
  return ["filter-panel", "sort-panel", "history-panel"].some(id => {
    const panel = document.getElementById(id);
    return panel && !panel.classList.contains("collapsed");
  });
}

function syncRightPanelFocusState() {
  const rightPanel = document.querySelector(".panel.right");
  if (!rightPanel) return;
  rightPanel.classList.toggle("overlay-active", isRightOverlayOpen());
}

export function openHelpModal() {
  const modal = document.getElementById("help-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

export function closeHelpModal() {
  const modal = document.getElementById("help-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

export function toggleFilter() {
  const p = document.getElementById("filter-panel");
  if (p) {
    p.classList.toggle("collapsed");
    // Close sort if open
    document.getElementById("sort-panel")?.classList.add("collapsed");
    document.getElementById("history-panel")?.classList.add("collapsed");
    syncRightPanelFocusState();
  }
}

export function toggleSort() {
  const p = document.getElementById("sort-panel");
  if (p) {
    p.classList.toggle("collapsed");
    // Close filter if open
    document.getElementById("filter-panel")?.classList.add("collapsed");
    document.getElementById("history-panel")?.classList.add("collapsed");
    syncRightPanelFocusState();
  }
}

export function resetFilters() {
  document.querySelectorAll(".filter-panel input[type='checkbox']").forEach(cb => cb.checked = false);
  const cat = document.getElementById("filter-category");
  if (cat) cat.value = "";
  clearNumericFilters();
  renderCardList();
}

export function resetSearch() {
  const s = document.getElementById("search-text");
  if (s) s.value = "";
  const icon = document.getElementById("search-icon-symbol");
  if (icon) icon.textContent = "🔍";
  searchTags = [];
  renderCardList();
}

export function switchDeckTab(tab) {
  currentDeckTab = tab;

  // Toggle active class
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`tab-${tab}`);
  if (btn) btn.classList.add('active');

  renderDeck();
  renderCardList(); // Refresh list filtering
}

function currentDeckList() {
  return currentDeckTab === "main" ? mainDeckCards : extraDeckCards;
}

function canAddToCurrentDeck(card) {
  const deck = currentDeckList();
  const limit = currentDeckTab === "main" ? 60 : 15;
  // if (deck.length >= limit) return false; // 允許超過上限
  if (currentDeckTab === "main" && extraTypes.includes(card.種類)) return false;
  if (currentDeckTab === "extra" && !extraTypes.includes(card.種類)) return false;

  const sameCardCount = deck.filter(c => c.id === card.id).length;
  if (sameCardCount >= 3) return false;

  if (card.id >= 100000) return false;
  return true;
}

export function addToCurrentDeck(cardId, options = {}) {
  if (!cardId) return;
  const card = findCardById(cardId);
  if (card && canAddToCurrentDeck(card)) {
    if (options.animate) {
      const target = getContainerCenter("#deck-list");
      const visibleRightCard = findCardElementById("#card-list", cardId) || findVisibleCardElementInRight(cardId);
      let from = null;
      if (visibleRightCard) {
        from = getElementCenter(visibleRightCard);
      } else if (options.sourceZone === "right" && options.sourceEl) {
        from = getElementCenter(options.sourceEl);
      } else {
        from = getContainerCenter("#card-list");
      }
      createFlyingCard(card.略称 || card.名前, from, target);
    }
    currentDeckList().push(card);
    renderDeck();
    renderCardList(false);
  } else {
    // Optional: Visual feedback for failure
    console.log('Cannot add card');
  }
}

export function removeFromDeck(cardId, options = {}) {
  if (!cardId) return;
  const list = currentDeckList();
  const idx = list.findIndex(c => c.id === cardId);
  if (idx !== -1) {
    const card = list[idx];
    if (options.animate) {
      const deckCardEl = options.sourceEl || findCardElementById("#deck-list", cardId) || findVisibleCardElementInDeck(cardId);
      const from = deckCardEl ? getElementCenter(deckCardEl) : getContainerCenter("#deck-list");
      const to = options.targetEl
        ? getElementCenter(options.targetEl)
        : getContainerCenter(options.targetSelector || "#card-list");
      createFlyingCard(card.略称 || card.名前, from, to);
    }
    list.splice(idx, 1);
    renderDeck();
    renderCardList(false);
  }
}

export function clearCurrentDeck() {
  if (confirm("Are you sure you want to clear the current deck?")) {
    const list = currentDeckList();
    list.length = 0;
    renderDeck();
    renderCardList(false);
  }
}

export function autoGenerateStub() {
  alert("This feature is under development.");
}

// Drag & Drop
function handleDragStart(event, cardId) {
  event.dataTransfer.setData("text/plain", JSON.stringify({
    id: cardId,
    source: "right"
  }));
}
function handleDeckDragStart(event, cardId) {
  event.dataTransfer.setData("text/plain", JSON.stringify({
    id: cardId,
    source: "mid"
  }));
}
export function allowDrop(event) {
  event.preventDefault();
}
export function handleDrop(event) {
  event.preventDefault();
  // Find drop target
  // Simplified: if drop on .panel.middle or .deck-content-area -> Add
  // If drop on .panel.left or .panel.right -> properties check? No.
  // Logic: Drag from right to middle = Add. Drag from middle to right/outside = Remove.

  const path = event.composedPath();
  const dropZone = path.find(el => el.classList && el.classList.contains("panel"));

  if (!dropZone) return;

  let zoneType = "";
  if (dropZone.classList.contains("middle")) zoneType = "middle";
  else if (dropZone.classList.contains("right")) zoneType = "right";
  else if (dropZone.classList.contains("left")) zoneType = "left"; // maybe just clicking

  try {
    const data = JSON.parse(event.dataTransfer.getData("text/plain"));
    const cardId = data.id;
    const source = data.source;

    if (source === "right" && zoneType === "middle") {
      addToCurrentDeck(cardId);
    } else if (source === "mid" && zoneType !== "middle") {
      removeFromDeck(cardId);
    }
  } catch (e) { console.error(e); }
}

// Import/Export
export function exportDeck() {
  const lines = [];
  const mainDeckLimit = 60;
  const extraDeckLimit = 15;
  let errors = [];

  if (mainDeckCards.length > mainDeckLimit) {
    errors.push(`主牌組超過 ${mainDeckLimit} 張 (目前 ${mainDeckCards.length} 張)`);
  }
  if (mainDeckCards.length < 30) {
    errors.push(`主牌組少於 30 張 (目前 ${mainDeckCards.length} 張)`);
  }
  if (extraDeckCards.length > extraDeckLimit) {
    errors.push(`額外牌組超過 ${extraDeckLimit} 張 (目前 ${extraDeckCards.length} 張)`);
  }

  if (errors.length > 0) {
    alert("存檔錯誤：\n" + errors.join("\n"));
    return;
  }
  const main = mainDeckCards.map(c => c.id);
  const extra = extraDeckCards.map(c => c.id);
  for (let i = 0; i < 60; i++) lines.push(main[i] || -1);
  for (let i = 0; i < 5; i++) lines.push("");
  for (let i = 0; i < 15; i++) lines.push(extra[i] || -1);

  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "deck.txt";
  a.click();
  URL.revokeObjectURL(url);
}

export function importDeck() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".txt";
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const lines = reader.result.split(/\r?\n/);
      // Basic parsing as per original
      const mainIds = lines.slice(0, 60).filter(id => id && id != "-1");
      // Extra starts at line 45 (index 45)
      const extraIds = lines.slice(65, 80).filter(id => id && id != "-1");

      mainDeckCards = mainIds.map(id => allCards.find(c => String(c.id) == String(id))).filter(Boolean);
      extraDeckCards = extraIds.map(id => allCards.find(c => String(c.id) == String(id))).filter(Boolean);

      renderDeck();
      renderCardList();
    };
    reader.readAsText(file);
  };
  input.click();
}

// Global Click Handlers for Collapse logic
document.addEventListener("mousedown", (event) => {
  const filterPanel = document.getElementById("filter-panel");
  const sortPanel = document.getElementById("sort-panel");
  const historyPanel = document.getElementById("history-panel");
  const filterBtn = document.getElementById("filter-toggle");
  const sortBtn = document.getElementById("sort-toggle");
  const historyBtn = document.getElementById("history-toggle");

  // Close Filter
  if (filterPanel && !filterPanel.classList.contains("collapsed")) {
    if (!filterPanel.contains(event.target) && event.target !== filterBtn) {
      filterPanel.classList.add("collapsed");
    }
  }
  // Close Sort
  if (sortPanel && !sortPanel.classList.contains("collapsed")) {
    if (!sortPanel.contains(event.target) && event.target !== sortBtn) {
      sortPanel.classList.add("collapsed");
    }
  }
  // Close History
  if (historyPanel && !historyPanel.classList.contains("collapsed")) {
    if (!historyPanel.contains(event.target) && event.target !== historyBtn) {
      historyPanel.classList.add("collapsed");
    }
  }

  syncRightPanelFocusState();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeHelpModal();
  }
});

// Bind Sort Radio Changes to Render
// Removed radio listener

// Add Enter listener for search
document.addEventListener("DOMContentLoaded", () => {
  const isEditableTarget = (el) => {
    if (!el) return false;
    const tag = (el.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
  };

  const blockContextMenuAndDoubleSelect = (selector) => {
    const panel = document.querySelector(selector);
    if (!panel) return;

    const allowSelection = (target) => target?.closest?.("#card-desc");

    panel.addEventListener("contextmenu", (e) => {
      if (allowSelection(e.target)) return;
      e.preventDefault();
    });

    panel.addEventListener("dblclick", (e) => {
      if (allowSelection(e.target)) return;
      if (!isEditableTarget(e.target)) e.preventDefault();
    });

    panel.addEventListener("selectstart", (e) => {
      if (allowSelection(e.target)) return;
      if (!isEditableTarget(e.target)) e.preventDefault();
    });
  };

  blockContextMenuAndDoubleSelect(".panel.middle");
  blockContextMenuAndDoubleSelect(".panel.right");
  setupDescriptionSelectionTagging();

  const searchInput = document.getElementById("search-text");
  if (searchInput) {
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = searchInput.value.trim();
        if (val) {
          searchTags.push(val); // Add to tags
          searchInput.value = ""; // Clear input
          const icon = document.getElementById("search-icon-symbol");
          if (icon) icon.textContent = "🔍";
          renderCardList(); // Update
        }
      }
    });
  }


  const cardList = document.getElementById("card-list");
  if (cardList) {
    cardList.addEventListener("wheel", (e) => {
      // 根據需求：滾動滑鼠滾輪時切換頁面
      // 檢查邊界
      if (e.deltaY > 0) {
        // 向下滾動 -> 下一頁
        if (cardList.scrollTop + cardList.clientHeight >= cardList.scrollHeight - 5) {
          // 僅當有下一頁時
          const btnNext = document.getElementById("btn-next");
          if (btnNext && !btnNext.disabled) {
            e.preventDefault();
            btnNext.click();
          }
        }
      } else {
        // 向上滾動 -> 上一頁
        if (cardList.scrollTop <= 0) {
          const btnPrev = document.getElementById("btn-prev");
          if (btnPrev && !btnPrev.disabled) {
            e.preventDefault();
            btnPrev.click();
          }
        }
      }
    }, { passive: false });
  }
});

export function toggleFavorite(id) {
  if (favorites.has(id)) {
    favorites.delete(id);
  } else {
    favorites.add(id);
  }

  localStorage.setItem('ygo_favorites', JSON.stringify([...favorites]));

  // Re-render card info to update heart icon immediately
  renderCardInfo();

  renderCardList(false);
}

export function toggleFavoriteFilter() {
  showFavoritesOnly = !showFavoritesOnly;

  const btn = document.getElementById("favorite-filter-toggle");
  if (btn) {
    if (showFavoritesOnly) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  }

  renderCardList();
}

export function getSelectedCard() {
  return selectedCard;
}

