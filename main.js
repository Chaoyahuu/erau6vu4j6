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
} catch(e) {}

init();

async function init() {
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


function renderCardList(resetPage = true) {
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

  renderPagination(totalPages);

  pageCards.forEach(card => {
    const el = document.createElement("div");
    el.className = "card-item";
    el.draggable = true;
    el.textContent = card.略称; // Short name
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
    el.ondblclick = () => {
      addToCurrentDeck(card.id);
    };
    container.appendChild(el);
  });

  container.scrollTop = 0; // 渲染時固定滾動到頂部

  const countEl = document.getElementById("result-count");
  if (countEl) countEl.textContent = `(${totalItems})`;
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

  const btnFav = document.getElementById("btn-favorite");
  if (btnFav) {
    if (favorites.has(c.id)) {
      btnFav.textContent = "❤️";
      btnFav.classList.add('active');
    } else {
      btnFav.textContent = "🤍";
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
  set("card-attr", attrIcons[c.属性] || c.属性 || "-"); // Use icons
  set("card-race", c.種族 || ""); // Now separate
  set("card-level", c.レベル || "");
  set("card-atk", c.攻撃力 === -1 ? "?" : c.攻撃力 ?? "0");
  set("card-def", c.守備力 === -1 ? "?" : c.守備力 ?? "0");
  set("card-gender", c.性別 || "");
  set("card-tuner", c.チューナー == 1 ? "是" : "否");
  // Description
  const descHTML = (c.説明 || "")
    .replace(/「(.*?)」/g, (_, word) => {
      const encoded = encodeURIComponent(word);
      return `<a href="#" class="desc-link" data-word="${encoded}">「${word}」</a>`;
    })
    .replace(/\n/g, "<br>");
  const descEl = document.getElementById("card-desc");
  if (descEl) descEl.innerHTML = descHTML;

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
      searchTags.push(word);
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
            <div class="icon">💾</div>
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
    el.ondblclick = () => {
      removeFromDeck(card.id);
    };

    if (count > 1) {
      const badge = document.createElement("span");
      badge.textContent = `x${count}`;
      el.appendChild(badge);
    }
    panel.appendChild(el);
  });
}

function applyFiltersAndSearch() {
  const categoryText = document.getElementById("filter-category")?.value.trim();

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

function handleSort(key) {
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
  document.querySelectorAll(".filter-panel input[type='checkbox']:checked").forEach(cb => {
    const val = cb.value;
    const tag = document.createElement("div");
    tag.className = "filter-tag";
    if (cb.className.includes('filter-チューナー')) {
      tag.textContent = `チューナー: ${val === '1' ? '是' : '否'}`;
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

function toggleHistory() {
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

function handleSearch() {
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
    group.style.marginBottom = "0.5rem";

    const title = document.createElement("div");
    title.textContent = key;
    title.style.color = "#888";
    title.style.fontSize = "0.9rem";
    title.style.fontWeight = "bold";
    title.style.marginBottom = "0.25rm";
    group.appendChild(title);

    // Grid of checkboxes? Or just list.
    if (key === "種類") {
      const trapTypes = ["通常罠", "永続罠", "カウンター罠"];
      const spellTypes = ["通常魔法", "永続魔法", "装備魔法", "儀式魔法", "フィールド", "速攻魔法"];
      const otherTypes = filters[key].filter(type =>
        type && !trapTypes.includes(type) && !spellTypes.includes(type)
      );

      const typeGroups = [trapTypes, spellTypes, otherTypes];

      typeGroups.forEach((groupTypes, groupIndex) => {
        const groupContainer = document.createElement("div");
        groupContainer.style.display = "flex";
        groupContainer.style.alignItems = "start";
        groupContainer.style.marginBottom = "4px";

        // Add "All/None" checkbox
        const allNoneLabel = document.createElement("label");
        allNoneLabel.style.display = "flex";
        allNoneLabel.style.marginRight = '8px';
        allNoneLabel.style.alignItems = "center";
        allNoneLabel.style.fontSize = "0.9rem";
        allNoneLabel.style.cursor = "pointer";
        allNoneLabel.style.whiteSpace = "nowrap";

        const allNoneCheckbox = document.createElement("input");
        allNoneCheckbox.type = "checkbox";
        allNoneCheckbox.onchange = () => {
          groupTypes.forEach(type => {
            const checkbox = document.querySelector(`.filter-${key}[value="${type}"]`);
            if (checkbox) checkbox.checked = allNoneCheckbox.checked;
          });
          renderCardList();
        };
        allNoneLabel.appendChild(allNoneCheckbox);

        if (groupIndex === 0) allNoneLabel.append(" 罠全般");
        else if (groupIndex === 1) allNoneLabel.append(" 魔法全般");
        else allNoneLabel.style.display = 'none';

        groupContainer.appendChild(allNoneLabel);

        const checkboxContainer = document.createElement("div");
        checkboxContainer.style.display = "flex";
        checkboxContainer.style.flexWrap = "wrap";
        checkboxContainer.style.gap = "0.2rem";

        groupTypes.forEach(val => {
          const label = createFilterCheckbox(key, val);
          checkboxContainer.appendChild(label);
        });

        groupContainer.appendChild(checkboxContainer);
        group.appendChild(groupContainer);
      });
    } else {
      const container = document.createElement("div");
      container.style.display = "flex";
      container.style.flexWrap = "wrap";
      container.style.gap = "0.5rem";

      filters[key]
        .filter(x => x !== null && x !== undefined)
        .sort((a, b) => (typeof a === 'number' && typeof b === 'number') ? a - b : String(a).localeCompare(String(b), 'ja'))
        .forEach(val => { if (val) { const label = createFilterCheckbox(key, val); container.appendChild(label); } });

      group.appendChild(container);
    }
    filterDiv.appendChild(group);
  }

  // Manually add Tuner filter group
  const tunerGroup = document.createElement("div");
  tunerGroup.style.marginBottom = "0.5rem";

  const tunerTitle = document.createElement("div");
  tunerTitle.textContent = "チューナー";
  tunerTitle.style.color = "#888";
  tunerTitle.style.fontSize = "0.9rem";
  tunerTitle.style.fontWeight = "bold";
  tunerTitle.style.marginBottom = "0.25rem";
  tunerGroup.appendChild(tunerTitle);

  const tunerContainer = document.createElement("div");
  tunerContainer.style.display = "flex";
  tunerContainer.style.flexWrap = "wrap";
  tunerContainer.style.gap = "0.5rem";

  [{ label: '是', value: '1' }, { label: '否', value: '0' }].forEach(opt => {
    const label = document.createElement("label");
    label.style.display = "flex";
    label.style.alignItems = "center";
    label.style.fontSize = "0.9rem";
    label.style.cursor = "pointer";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = opt.value;
    cb.className = `filter-チューナー`;
    cb.onchange = renderCardList;

    label.appendChild(cb);
    label.append(` ${opt.label}`);
    tunerContainer.appendChild(label);
  });
  tunerGroup.appendChild(tunerContainer);
  filterDiv.appendChild(tunerGroup);
}

function createFilterCheckbox(key, val) {
  const label = document.createElement("label");
  label.style.display = "flex";
  label.style.alignItems = "center";
  label.style.fontSize = "0.9rem";
  label.style.cursor = "pointer";

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.value = val;
  cb.className = `filter-${key}`;
  cb.onchange = renderCardList;

  label.appendChild(cb);
  label.append(` ${val}`);
  return label;
}






function getChecked(cls) {
  return [...document.querySelectorAll(`.${cls}:checked`)].map(cb => cb.value);
}

function toggleFilter() {
  const p = document.getElementById("filter-panel");
  if (p) {
    p.classList.toggle("collapsed");
    // Close sort if open
    document.getElementById("sort-panel")?.classList.add("collapsed");
    document.getElementById("history-panel")?.classList.add("collapsed");
  }
}

function toggleSort() {
  const p = document.getElementById("sort-panel");
  if (p) {
    p.classList.toggle("collapsed");
    // Close filter if open
    document.getElementById("filter-panel")?.classList.add("collapsed");
    document.getElementById("history-panel")?.classList.add("collapsed");
  }
}

function resetFilters() {
  document.querySelectorAll(".filter-panel input[type='checkbox']").forEach(cb => cb.checked = false);
  const cat = document.getElementById("filter-category");
  if (cat) cat.value = "";
  renderCardList();
}

function resetSearch() {
  const s = document.getElementById("search-text");
  if (s) s.value = "";
  const icon = document.getElementById("search-icon-symbol");
  if (icon) icon.textContent = "🔍";
  searchTags = [];
  renderCardList();
}

function switchDeckTab(tab) {
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

function addToCurrentDeck(cardId) {
  if (!cardId) return;
  const card = allCards.find(c => c.id === cardId);
  if (card && canAddToCurrentDeck(card)) {
    currentDeckList().push(card);
    renderDeck();
  } else {
    // Optional: Visual feedback for failure
    console.log('Cannot add card');
  }
}

function removeFromDeck(cardId) {
  if (!cardId) return;
  const list = currentDeckList();
  const idx = list.findIndex(c => c.id === cardId);
  if (idx !== -1) {
    list.splice(idx, 1);
    renderDeck();
  }
}

function clearCurrentDeck() {
  if (confirm("Are you sure you want to clear the current deck?")) {
    const list = currentDeckList();
    list.length = 0;
    renderDeck();
  }
}

function autoGenerateStub() {
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
function allowDrop(event) {
  event.preventDefault();
}
function handleDrop(event) {
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
function exportDeck() {
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

function importDeck() {
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
});

// Bind Sort Radio Changes to Render
// Removed radio listener

// Add Enter listener for search
document.addEventListener("DOMContentLoaded", () => {
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

  const filterCat = document.getElementById("filter-category");
  if (filterCat) {
    filterCat.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        renderCardList();
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

function toggleFavorite(id) {
  if (favorites.has(id)) {
    favorites.delete(id);
  } else {
    favorites.add(id);
  }
  
  localStorage.setItem('ygo_favorites', JSON.stringify([...favorites]));
  
  // Re-render card info to update heart icon immediately
  renderCardInfo();
  
  // If the filter is currently active, re-render the list
  if (showFavoritesOnly) {
    renderCardList();
  }
}

function toggleFavoriteFilter() {
  showFavoritesOnly = !showFavoritesOnly;
  
  const btn = document.getElementById("favorite-filter-toggle");
  if (btn) {
    if (showFavoritesOnly) {
      btn.textContent = "❤️";
      btn.classList.add("active");
    } else {
      btn.textContent = "🤍";
      btn.classList.remove("active");
    }
  }
  
  renderCardList();
}