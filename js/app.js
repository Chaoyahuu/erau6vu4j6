import {
  addToCurrentDeck,
  allowDrop,
  autoGenerateStub,
  clearCurrentDeck,
  closeHelpModal,
  exportDeck,
  getSelectedCard,
  handleDrop,
  handleSearch,
  handleSort,
  importDeck,
  init,
  openHelpModal,
  removeFromDeck,
  renderCardList,
  resetFilters,
  resetSearch,
  switchDeckTab,
  toggleFavorite,
  toggleFavoriteFilter,
  toggleFilter,
  toggleHistory,
  toggleSort,
} from "../main.js";

function withSelectedCard(action) {
  const card = getSelectedCard();
  if (!card) return;
  action(card);
}

function bindClick(id, handler) {
  const element = document.getElementById(id);
  if (element) {
    element.addEventListener("click", handler);
  }
}

function bindUiEvents() {
  document.body.addEventListener("dragover", allowDrop);
  document.body.addEventListener("drop", handleDrop);
  const leftDetails = document.querySelector(".panel.left .card-details-container");

  bindClick("help-trigger", openHelpModal);
  bindClick("btn-favorite", () => withSelectedCard(card => toggleFavorite(card.id)));
  bindClick("btn-add", () => withSelectedCard(card => addToCurrentDeck(card.id, {
    animate: true,
    sourceEl: leftDetails,
  })));
  bindClick("btn-remove", () => withSelectedCard(card => removeFromDeck(card.id, {
    animate: true,
    targetSelector: "#card-list",
  })));
  bindClick("btn-clear", clearCurrentDeck);
  bindClick("btn-save", exportDeck);
  bindClick("btn-load", importDeck);
  bindClick("btn-auto-generate", autoGenerateStub);

  bindClick("filter-toggle", toggleFilter);
  bindClick("sort-toggle", toggleSort);
  bindClick("history-toggle", toggleHistory);
  bindClick("favorite-filter-toggle", toggleFavoriteFilter);
  bindClick("reset-controls", () => {
    resetFilters();
    resetSearch();
  });
  bindClick("btn-filter-reset", resetFilters);

  document.querySelectorAll("[data-sort-key]").forEach(button => {
    button.addEventListener("click", () => handleSort(button.dataset.sortKey));
  });

  document.querySelectorAll("[data-deck-tab]").forEach(button => {
    button.addEventListener("click", () => switchDeckTab(button.dataset.deckTab));
  });

  const searchInput = document.getElementById("search-text");
  if (searchInput) {
    searchInput.addEventListener("input", handleSearch);
  }

  document.querySelectorAll(".help-backdrop, .help-close").forEach(element => {
    element.addEventListener("click", closeHelpModal);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  bindUiEvents();
  await init();
});
