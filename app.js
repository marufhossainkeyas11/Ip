/* =========================================================
   কোথায়দেখব — App logic
   No backend, no login. TMDB public key used directly from
   the client (standard practice for TMDB — see README).
   State is kept in the URL hash for shareable/back-button-safe
   navigation, and watchlist data lives in localStorage only.
   ========================================================= */

(() => {
  "use strict";

  /* ---------- CONFIG ---------- */
  // TMDB v3 API key — read-only, public-safe by TMDB's own terms.
  // Replace with your own free key from https://www.themoviedb.org/settings/api
  const TMDB_KEY = "773d76e9c544b33992c3eae2e5a761d6";
  const TMDB_BASE = "https://api.themoviedb.org/3";
  const IMG_BASE = "https://image.tmdb.org/t/p/";
  const POSTER_SIZE = "w342";
  const BACKDROP_SIZE = "w1280";
  const PROFILE_SIZE = "w185";
  const LOGO_SIZE = "w92";

  const LS_WATCHLIST = "k2d_watchlist_v1";
  const LS_REGION = "k2d_region_v1";
  const LS_THEME = "k2d_theme_v1";

  const REGIONS = [
    ["", "🌐 গ্লোবাল ভিউ"],
    ["BD", "🇧🇩 বাংলাদেশ"],
    ["US", "🇺🇸 United States"],
    ["IN", "🇮🇳 India"],
    ["GB", "🇬🇧 United Kingdom"],
    ["CA", "🇨🇦 Canada"],
    ["AU", "🇦🇺 Australia"],
    ["JP", "🇯🇵 Japan"],
    ["KR", "🇰🇷 South Korea"],
    ["DE", "🇩🇪 Germany"],
    ["FR", "🇫🇷 France"],
    ["AE", "🇦🇪 UAE"],
    ["SA", "🇸🇦 Saudi Arabia"],
    ["SG", "🇸🇬 Singapore"],
    ["PK", "🇵🇰 Pakistan"],
  ];

  /* ---------- STATE ---------- */
  const state = {
    region: localStorage.getItem(LS_REGION) || "",
    query: "",
    filterType: "all",     // all | movie | tv
    filterLang: "",
    filterYear: "",
    page: 1,
    totalPages: 1,
    results: [],
    watchlist: loadWatchlist(),
  };

  /* ---------- DOM ---------- */
  const $ = (sel) => document.querySelector(sel);
  const views = {
    home: $("#homeView"),
    results: $("#resultsView"),
    detail: $("#detailView"),
    watchlist: $("#watchlistView"),
  };

  /* ---------- WATCHLIST (localStorage) ---------- */
  function loadWatchlist() {
    try {
      const raw = localStorage.getItem(LS_WATCHLIST);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  function saveWatchlist() {
    localStorage.setItem(LS_WATCHLIST, JSON.stringify(state.watchlist));
    updateWatchlistCount();
  }
  function watchKey(mediaType, id) {
    return `${mediaType}:${id}`;
  }
  function isInWatchlist(mediaType, id) {
    return !!state.watchlist[watchKey(mediaType, id)];
  }
  function addToWatchlist(item) {
    const key = watchKey(item.media_type, item.id);
    state.watchlist[key] = {
      id: item.id,
      media_type: item.media_type,
      title: item.title || item.name,
      poster_path: item.poster_path || null,
      release_date: item.release_date || item.first_air_date || "",
      status: state.watchlist[key]?.status || "towatch",
      added_at: Date.now(),
    };
    saveWatchlist();
  }
  function removeFromWatchlist(mediaType, id) {
    delete state.watchlist[watchKey(mediaType, id)];
    saveWatchlist();
  }
  function toggleWatchlistStatus(mediaType, id) {
    const key = watchKey(mediaType, id);
    const entry = state.watchlist[key];
    if (!entry) return;
    entry.status = entry.status === "watched" ? "towatch" : "watched";
    saveWatchlist();
  }
  function updateWatchlistCount() {
    const count = Object.keys(state.watchlist).length;
    const badge = $("#watchlistCount");
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = count === 0;
  }

  /* ---------- THEME ---------- */
  function initTheme() {
    const saved = localStorage.getItem(LS_THEME);
    const preferred = saved || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    applyTheme(preferred);
  }
  function applyTheme(theme) {
    document.body.setAttribute("data-theme", theme);
    $(".icon-moon").hidden = theme === "light";
    $(".icon-sun").hidden = theme !== "light";
    localStorage.setItem(LS_THEME, theme);
  }
  $("#themeToggle").addEventListener("click", () => {
    const current = document.body.getAttribute("data-theme");
    applyTheme(current === "dark" ? "light" : "dark");
  });

  /* ---------- REGION SELECT ---------- */
  function initRegionSelect() {
    const sel = $("#regionSelect");
    sel.innerHTML = REGIONS.map(([code, label]) =>
      `<option value="${code}">${label}</option>`
    ).join("");
    sel.value = state.region;
    sel.addEventListener("change", () => {
      state.region = sel.value;
      localStorage.setItem(LS_REGION, state.region);
      showToast(state.region ? `রিজিওন বদলে গেছে` : "গ্লোবাল ভিউতে সব প্রোভাইডার দেখাবে");
      if (currentDetailItem) renderDetail(currentDetailItem, true);
    });
  }

  /* ---------- TOAST ---------- */
  let toastTimer;
  function showToast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2200);
  }

  /* ---------- API HELPERS ---------- */
  async function tmdbFetch(path, params = {}) {
    const url = new URL(TMDB_BASE + path);
    url.searchParams.set("api_key", TMDB_KEY);
    url.searchParams.set("language", "bn-BD");
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    });
    const res = await fetch(url.toString());
    if (!res.ok) {
      // Bengali metadata sometimes missing on TMDB; fall back to English on failure.
      if (url.searchParams.get("language") === "bn-BD") {
        url.searchParams.set("language", "en-US");
        const res2 = await fetch(url.toString());
        if (res2.ok) return res2.json();
      }
      throw new Error(`TMDB error ${res.status}`);
    }
    const data = await res.json();
    // If overview is empty in Bengali, caller can refetch English; kept simple here.
    return data;
  }

  function posterUrl(path, size = POSTER_SIZE) {
    return path ? `${IMG_BASE}${size}${path}` : null;
  }
  function backdropUrl(path) {
    return path ? `${IMG_BASE}${BACKDROP_SIZE}${path}` : null;
  }
  function logoUrl(path) {
    return path ? `${IMG_BASE}${LOGO_SIZE}${path}` : null;
  }

  /* ---------- SEARCH ---------- */
  let searchDebounce;

  /* ---------- LIVE SUGGESTIONS (typeahead) ---------- */
  const SUGGEST_LIMIT = 6;
  let suggestDebounce;
  let suggestAbortToken = 0;
  const suggestCache = new Map(); // query -> results[]

  function setupSuggest(inputEl, dropdownEl) {
    let focusedIndex = -1;
    let currentQuery = "";
    let currentItems = [];

    function close() {
      dropdownEl.hidden = true;
      dropdownEl.innerHTML = "";
      inputEl.setAttribute("aria-expanded", "false");
      focusedIndex = -1;
    }

    function open() {
      dropdownEl.hidden = false;
      inputEl.setAttribute("aria-expanded", "true");
    }

    function renderLoading() {
      open();
      dropdownEl.innerHTML = `<div class="suggest-loading">খোঁজা হচ্ছে...</div>`;
    }

    function renderItems(items, query) {
      currentItems = items;
      focusedIndex = -1;
      if (items.length === 0) {
        open();
        dropdownEl.innerHTML = `<div class="suggest-empty">"${escapeHtml(query)}" এর জন্য কিছু পাওয়া যায়নি</div>`;
        return;
      }
      open();
      dropdownEl.innerHTML =
        items
          .map((item, i) => {
            const title = item.title || item.name || "নাম নেই";
            const date = item.release_date || item.first_air_date || "";
            const year = date ? date.slice(0, 4) : "";
            const typeLabel = item.media_type === "tv" ? "সিরিজ" : "মুভি";
            const thumb = posterUrl(item.poster_path, "w92");
            return `
            <button type="button" class="suggest-item" role="option" data-suggest-index="${i}">
              ${
                thumb
                  ? `<img class="suggest-thumb" src="${thumb}" alt="" loading="lazy">`
                  : `<div class="suggest-thumb-fallback">🎬</div>`
              }
              <span class="suggest-info">
                <span class="suggest-title">${escapeHtml(title)}</span>
                <span class="suggest-meta">${typeLabel}${year ? " · " + year : ""}</span>
              </span>
            </button>`;
          })
          .join("") +
        `<button type="button" class="suggest-footer" data-suggest-viewall>"${escapeHtml(query)}" এর সব ফলাফল দেখুন</button>`;
    }

    async function fetchSuggestions(query) {
      const token = ++suggestAbortToken;
      if (suggestCache.has(query)) {
        renderItems(suggestCache.get(query), query);
        return;
      }
      renderLoading();
      try {
        const data = await tmdbFetch("/search/multi", { query, page: 1, include_adult: false });
        if (token !== suggestAbortToken || inputEl.value.trim() !== query) return; // stale response
        const items = (data.results || [])
          .filter((r) => r.media_type === "movie" || r.media_type === "tv")
          .slice(0, SUGGEST_LIMIT);
        suggestCache.set(query, items);
        renderItems(items, query);
      } catch (err) {
        if (token !== suggestAbortToken) return;
        close();
        console.error(err);
      }
    }

    function selectItem(item) {
      close();
      inputEl.value = item.title || item.name || "";
      openDetail(item.media_type, item.id);
    }

    function updateFocusVisual() {
      dropdownEl.querySelectorAll(".suggest-item").forEach((el, i) => {
        el.classList.toggle("is-focused", i === focusedIndex);
      });
      const focusedEl = dropdownEl.querySelector(".suggest-item.is-focused");
      if (focusedEl) focusedEl.scrollIntoView({ block: "nearest" });
    }

    inputEl.addEventListener("input", () => {
      const q = inputEl.value.trim();
      currentQuery = q;
      clearTimeout(suggestDebounce);
      if (!q) {
        close();
        return;
      }
      suggestDebounce = setTimeout(() => {
        if (inputEl.value.trim() === q) fetchSuggestions(q);
      }, 220);
    });

    inputEl.addEventListener("keydown", (e) => {
      if (dropdownEl.hidden) return;
      const itemCount = currentItems.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (itemCount === 0) return;
        focusedIndex = (focusedIndex + 1) % itemCount;
        updateFocusVisual();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (itemCount === 0) return;
        focusedIndex = (focusedIndex - 1 + itemCount) % itemCount;
        updateFocusVisual();
      } else if (e.key === "Enter") {
        if (focusedIndex >= 0 && currentItems[focusedIndex]) {
          e.preventDefault();
          selectItem(currentItems[focusedIndex]);
        } else {
          close();
        }
      } else if (e.key === "Escape") {
        close();
      }
    });

    dropdownEl.addEventListener("click", (e) => {
      const viewAllBtn = e.target.closest("[data-suggest-viewall]");
      if (viewAllBtn) {
        close();
        clearTimeout(searchDebounce);
        runSearch(currentQuery);
        return;
      }
      const itemBtn = e.target.closest("[data-suggest-index]");
      if (itemBtn) {
        const idx = Number(itemBtn.dataset.suggestIndex);
        if (currentItems[idx]) selectItem(currentItems[idx]);
      }
    });

    inputEl.addEventListener("focus", () => {
      if (currentItems.length && inputEl.value.trim() === currentQuery && currentQuery) open();
    });

    document.addEventListener("click", (e) => {
      if (!dropdownEl.hidden && !e.target.closest(".search-form-wrap")) close();
    });

    return { close };
  }

  async function runSearch(query, page = 1, opts = {}) {
    const { keepFilters = false } = opts;
    state.query = query;
    state.page = page;
    // A fresh search should never be silently hidden by a filter left on
    // from a previous chip/pill tap — reset filters unless this is just
    // paging through the same query's results, or the caller explicitly
    // wants the current filter carried in (e.g. a chip tap).
    if (page === 1 && !keepFilters) {
      state.filterType = "all";
      state.filterLang = "";
      state.filterYear = "";
      $$(".chip").forEach((c) => c.classList.remove("is-active"));
      const langFilterEl = document.getElementById("langFilter");
      if (langFilterEl) langFilterEl.value = "";
      const yearFilterEl = document.getElementById("yearFilter");
      if (yearFilterEl) yearFilterEl.value = "";
      $$(".filter-pill[data-filter-type]").forEach((p) => p.classList.remove("is-active"));
      const allPill = document.querySelector('.filter-pill[data-filter-type="all"]');
      if (allPill) allPill.classList.add("is-active");
    }
    navigateTo("results");
    $("#resultsSearchInput").value = query;
    $("#heroSearchInput").value = query;
    $("#resultsMeta").textContent = "খোঁজা হচ্ছে...";
    $("#emptyState").hidden = true;
    $("#loadMoreBtn").hidden = true;
    if (page === 1) $("#resultsGrid").innerHTML = skeletonGrid();

    try {
      const data = await tmdbFetch("/search/multi", {
        query,
        page,
        include_adult: false,
      });
      let results = (data.results || []).filter(
        (r) => r.media_type === "movie" || r.media_type === "tv"
      );
      state.totalPages = data.total_pages || 1;
      if (page === 1) {
        state.results = results;
      } else {
        state.results = state.results.concat(results);
      }
      renderResults();
    } catch (err) {
      $("#resultsGrid").innerHTML = "";
      $("#resultsMeta").textContent = "";
      $("#emptyState").hidden = false;
      $("#emptyState").querySelector("h3").textContent = "সমস্যা হয়েছে";
      $("#emptyState").querySelector("p").textContent =
        "ইন্টারনেট সংযোগ চেক করুন, অথবা API কী ঠিক আছে কিনা দেখুন।";
      console.error(err);
    }
  }

  function skeletonGrid() {
    return Array.from({ length: 10 })
      .map(() => `<div class="skel-card" style="width:100%;height:0;padding-bottom:150%;"></div>`)
      .join("");
  }

  function applyFilters(list) {
    return list.filter((item) => {
      if (state.filterType !== "all" && item.media_type !== state.filterType) return false;
      if (state.filterLang && item.original_language !== state.filterLang) return false;
      if (state.filterYear) {
        const date = item.release_date || item.first_air_date || "";
        if (!date.startsWith(state.filterYear)) return false;
      }
      return true;
    });
  }

  function renderResults() {
    const filtered = applyFilters(state.results);
    const grid = $("#resultsGrid");

    if (filtered.length === 0) {
      grid.innerHTML = "";
      $("#emptyState").hidden = false;
      $("#emptyState").querySelector("h3").textContent = "কিছু পাওয়া যায়নি";
      $("#emptyState").querySelector("p").textContent = "বানান চেক করুন, অথবা ফিল্টার মুছে দেখুন।";
      $("#resultsMeta").textContent = "";
    } else {
      $("#emptyState").hidden = true;
      grid.innerHTML = filtered.map(posterCardHTML).join("");
      $("#resultsMeta").textContent = `"${state.query}" এর জন্য ${filtered.length}টি ফলাফল${state.page < state.totalPages ? "+" : ""}`;
    }

    populateLangFilterOptions();
    syncFilterPillUI();
    $("#loadMoreBtn").hidden = state.page >= state.totalPages;
    bindPosterCardEvents(grid);
  }

  function syncFilterPillUI() {
    $$(".filter-pill[data-filter-type]").forEach((p) => {
      p.classList.toggle("is-active", p.dataset.filterType === state.filterType);
    });
    const yearFilterEl = document.getElementById("yearFilter");
    if (yearFilterEl) yearFilterEl.value = state.filterYear || "";
    syncClearFiltersVisibility();
  }

  function populateLangFilterOptions() {
    const sel = $("#langFilter");
    const current = state.filterLang;
    const langs = [...new Set(state.results.map((r) => r.original_language).filter(Boolean))].sort();
    const langNames = new Intl.DisplayNames(["bn"], { type: "language" });
    sel.innerHTML =
      `<option value="">যেকোনো ভাষা</option>` +
      langs
        .map((code) => {
          let label = code.toUpperCase();
          try {
            const name = langNames.of(code);
            if (name) label = name;
          } catch {}
          return `<option value="${code}">${label}</option>`;
        })
        .join("");
    sel.value = current;
  }

  /* ---------- POSTER CARD ---------- */
  function posterCardHTML(item) {
    const title = item.title || item.name || "নাম নেই";
    const date = item.release_date || item.first_air_date || "";
    const year = date ? date.slice(0, 4) : "";
    const poster = posterUrl(item.poster_path);
    const typeLabel = item.media_type === "tv" ? "সিরিজ" : "মুভি";
    const inList = isInWatchlist(item.media_type, item.id);

    return `
      <div class="poster-card" data-id="${item.id}" data-type="${item.media_type}">
        <div class="poster-frame">
          ${
            poster
              ? `<img src="${poster}" alt="${escapeHtml(title)} পোস্টার" loading="lazy">`
              : `<div class="poster-fallback">${escapeHtml(title)}</div>`
          }
          <span class="poster-badge poster-badge--rent">${typeLabel}</span>
          <button class="poster-quickadd ${inList ? "is-added" : ""}" data-quickadd aria-label="${inList ? "তালিকা থেকে সরান" : "তালিকায় যোগ করুন"}" title="${inList ? "তালিকা থেকে সরান" : "তালিকায় যোগ করুন"}"><span>+</span></button>
        </div>
        <p class="poster-title">${escapeHtml(title)}</p>
        <p class="poster-year">${year || "—"}</p>
      </div>`;
  }

  function bindPosterCardEvents(container) {
    container.querySelectorAll(".poster-card").forEach((card) => {
      const id = Number(card.dataset.id);
      const type = card.dataset.type;

      card.addEventListener("click", (e) => {
        if (e.target.closest("[data-quickadd]")) return;
        openDetail(type, id);
      });

      const quickAdd = card.querySelector("[data-quickadd]");
      quickAdd.addEventListener("click", (e) => {
        e.stopPropagation();
        const item = state.results.find((r) => r.id === id && r.media_type === type) ||
          Object.values(state.watchlist).find((w) => w.id === id && w.media_type === type);
        if (isInWatchlist(type, id)) {
          removeFromWatchlist(type, id);
          quickAdd.classList.remove("is-added");
          quickAdd.setAttribute("aria-label", "তালিকায় যোগ করুন");
          quickAdd.setAttribute("title", "তালিকায় যোগ করুন");
          showToast("তালিকা থেকে সরানো হয়েছে");
        } else if (item) {
          addToWatchlist(item);
          quickAdd.classList.add("is-added");
          quickAdd.setAttribute("aria-label", "তালিকা থেকে সরান");
          quickAdd.setAttribute("title", "তালিকা থেকে সরান");
          showToast("তালিকায় যোগ হয়েছে");
        }
        renderHomeWatchlistRail();
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  /* ---------- DETAIL VIEW ---------- */
  let currentDetailItem = null;

  async function openDetail(mediaType, id) {
    navigateTo("detail", { type: mediaType, id });
    $("#detailContent").innerHTML = `<div style="padding:100px 20px;text-align:center;color:var(--ink-faint)">লোড হচ্ছে...</div>`;
    window.scrollTo(0, 0);

    try {
      const [details, providers, credits] = await Promise.all([
        tmdbFetch(`/${mediaType}/${id}`, { append_to_response: "release_dates" }),
        tmdbFetch(`/${mediaType}/${id}/watch/providers`),
        tmdbFetch(`/${mediaType}/${id}/credits`),
      ]);
      currentDetailItem = { mediaType, id, details, providers, credits };
      renderDetail(currentDetailItem);
    } catch (err) {
      $("#detailContent").innerHTML = `<div style="padding:100px 20px;text-align:center;color:var(--ink-faint)">তথ্য লোড করা যায়নি। আবার চেষ্টা করুন।</div>`;
      console.error(err);
    }
  }

  function renderDetail({ mediaType, id, details, providers, credits }) {
    const title = details.title || details.name || "";
    const tagline = details.tagline || "";
    const overview = details.overview || "কোনো বর্ণনা পাওয়া যায়নি।";
    const date = details.release_date || details.first_air_date || "";
    const year = date ? date.slice(0, 4) : "—";
    const runtime = details.runtime
      ? `${details.runtime} মিনিট`
      : details.episode_run_time?.[0]
      ? `প্রতি পর্ব ~${details.episode_run_time[0]} মিনিট`
      : "";
    const rating = details.vote_average ? details.vote_average.toFixed(1) : null;
    const genres = (details.genres || []).map((g) => g.name).join(" · ");
    const backdrop = backdropUrl(details.backdrop_path);
    const poster = posterUrl(details.poster_path);
    const inList = isInWatchlist(mediaType, id);
    const watchedStatus = state.watchlist[watchKey(mediaType, id)]?.status;

    const watchSection = renderWatchProviders(providers, mediaType, id);
    const castSection = renderCast(credits);

    $("#detailContent").innerHTML = `
      <div class="detail-hero">
        ${backdrop ? `<div class="detail-hero-bg" style="background-image:url('${backdrop}')"></div>` : ""}
        <div class="detail-hero-scrim"></div>
        <div class="detail-hero-inner">
          <div class="detail-poster">
            ${poster ? `<img src="${poster}" alt="${escapeHtml(title)} পোস্টার">` : ""}
          </div>
          <div class="detail-heading">
            <h1 class="detail-title">${escapeHtml(title)}</h1>
            ${tagline ? `<p class="detail-tagline">"${escapeHtml(tagline)}"</p>` : ""}
            <div class="detail-meta-row">
              <span>${year}</span>
              ${runtime ? `<span class="sep">•</span><span>${runtime}</span>` : ""}
              ${genres ? `<span class="sep">•</span><span>${escapeHtml(genres)}</span>` : ""}
              ${rating ? `<span class="sep">•</span><span class="detail-rating">★ ${rating}</span>` : ""}
            </div>
          </div>
        </div>
      </div>

      <div class="detail-body">
        <div class="detail-actions">
          <button class="action-btn ${inList ? "is-added" : ""}" id="detailAddBtn">
            ${inList ? "তালিকায় আছে" : "+ তালিকায় যোগ করুন"}
          </button>
          ${
            inList
              ? `<button class="action-btn action-btn--outline" id="detailWatchedBtn">${watchedStatus === "watched" ? "↺ আবার 'দেখব' এ রাখুন" : "দেখা হয়ে গেছে বলুন"}</button>`
              : ""
          }
        </div>

        <p class="detail-overview">${escapeHtml(overview)}</p>

        <div class="ticket-divider"></div>

        ${watchSection}

        ${castSection}
      </div>
    `;

    $("#detailAddBtn").addEventListener("click", () => {
      if (isInWatchlist(mediaType, id)) {
        removeFromWatchlist(mediaType, id);
        showToast("তালিকা থেকে সরানো হয়েছে");
      } else {
        addToWatchlist({
          id,
          media_type: mediaType,
          title: details.title,
          name: details.name,
          poster_path: details.poster_path,
          release_date: details.release_date,
          first_air_date: details.first_air_date,
        });
        showToast("তালিকায় যোগ হয়েছে");
      }
      renderDetail(currentDetailItem);
      renderHomeWatchlistRail();
    });

    const watchedBtn = $("#detailWatchedBtn");
    if (watchedBtn) {
      watchedBtn.addEventListener("click", () => {
        toggleWatchlistStatus(mediaType, id);
        renderDetail(currentDetailItem);
      });
    }

    bindWatchPanelEvents($("#detailContent"));
  }

  // Curated set of major regions to offer as tabs when the user hasn't
  // picked a region — keeps the panel from listing 90 countries at once.
  const GLOBAL_PREVIEW = ["BD", "US", "IN", "GB", "CA", "AU", "JP", "KR", "DE", "FR", "AE", "SA", "SG", "PK"];

  function dedupeProviders(arr) {
    const seen = new Set();
    return arr.filter((p) => (seen.has(p.provider_id) ? false : (seen.add(p.provider_id), true)));
  }

  function countryFlagEmoji(code) {
    if (!code || code.length !== 2) return "🌐";
    return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
  }

  // Build a provider -> list of {code, kind} index from the per-country
  // TMDB response, so we can flip the panel to "pick a platform, see which
  // countries have it" instead of only "pick a country, see its platforms".
  function buildProviderIndex(results) {
    const index = new Map(); // provider_id -> { provider, countries: Map(code -> Set(kind)) }
    Object.entries(results).forEach(([code, regionData]) => {
      if (!regionData) return;
      const kinds = [
        ["flatrate", "স্ট্রিমিং"],
        ["free", "স্ট্রিমিং"],
        ["ads", "স্ট্রিমিং"],
        ["rent", "রেন্ট"],
        ["buy", "কেনা"],
      ];
      kinds.forEach(([key, kindLabel]) => {
        (regionData[key] || []).forEach((p) => {
          if (!index.has(p.provider_id)) {
            index.set(p.provider_id, { provider: p, countries: new Map() });
          }
          const entry = index.get(p.provider_id);
          if (!entry.countries.has(code)) entry.countries.set(code, new Set());
          entry.countries.get(code).add(kindLabel);
        });
      });
    });
    // Sort providers by how many countries they're available in (most first)
    return [...index.values()].sort((a, b) => b.countries.size - a.countries.size);
  }

  function watchGroupBodyHTML(regionData) {
    if (!regionData) return "";
    const { flatrate, rent, buy, ads, free } = regionData;
    const streamProviders = dedupeProviders([...(flatrate || []), ...(free || []), ...(ads || [])]);
    const rentBuyProviders = dedupeProviders([...(rent || []), ...(buy || [])]);
    if (streamProviders.length === 0 && rentBuyProviders.length === 0) return "";

    let html = "";
    if (streamProviders.length) {
      html += `<div class="watch-subgroup">
        <h4 class="watch-subgroup-title"><span class="dot dot--stream"></span>স্ট্রিমিং-এ আছে</h4>
        <div class="provider-row">${streamProviders.map((p) => providerChipHTML(p, regionData.link)).join("")}</div>
      </div>`;
    }
    if (rentBuyProviders.length) {
      html += `<div class="watch-subgroup">
        <h4 class="watch-subgroup-title"><span class="dot dot--rent"></span>রেন্ট / কেনার জন্য</h4>
        <div class="provider-row">${rentBuyProviders.map((p) => providerChipHTML(p, regionData.link)).join("")}</div>
      </div>`;
    }
    return html;
  }

  function watchEmptyHTML(label, mediaType, id) {
    return `<div class="watch-empty">এই দেশে (${escapeHtml(label)}) এখনো অফিসিয়াল স্ট্রিমিং তথ্য পাওয়া যায়নি। নিচ থেকে অন্য দেশ ট্রাই করুন, অথবা <a href="https://www.themoviedb.org/${mediaType}/${id}/watch" target="_blank" rel="noopener">TMDB-তে সরাসরি দেখুন</a>।</div>`;
  }

  function renderWatchProviders(providers, mediaType, id) {
    const results = providers.results || {};
    const availableCodes = Object.keys(results);

    if (availableCodes.length === 0) {
      return `
        <div class="watch-panel">
          <p class="section-label">কোথায় দেখা যাবে</p>
          <div class="watch-empty">কোনো দেশেই এখনো অফিসিয়াল স্ট্রিমিং তথ্য পাওয়া যায়নি এই টাইটেলের জন্য।</div>
        </div>`;
    }

    // Tab order: saved region first (if it has data), then curated majors
    // that have data, then anything else left over — so the panel always
    // opens on the country most relevant to this user.
    const savedRegion = state.region;
    const ordered = [];
    if (savedRegion && results[savedRegion]) ordered.push(savedRegion);
    GLOBAL_PREVIEW.forEach((c) => {
      if (results[c] && !ordered.includes(c)) ordered.push(c);
    });
    availableCodes.forEach((c) => {
      if (!ordered.includes(c)) ordered.push(c);
    });

    const activeCode = ordered[0];

    const tabsHTML = ordered
      .map(
        (code) => `
        <button class="watch-tab ${code === activeCode ? "is-active" : ""}" data-region-tab="${code}" role="tab" aria-selected="${code === activeCode}">
          <span class="watch-tab-flag" aria-hidden="true">${countryFlagEmoji(code)}</span>
          <span class="watch-tab-label">${escapeHtml(regionLabel(code).replace(/^\S+\s/, ""))}</span>
        </button>`
      )
      .join("");

    const panelsHTML = ordered
      .map((code) => {
        const body = watchGroupBodyHTML(results[code]) || watchEmptyHTML(regionLabel(code), mediaType, id);
        return `<div class="watch-tabpanel ${code === activeCode ? "is-active" : ""}" data-region-panel="${code}" role="tabpanel">${body}</div>`;
      })
      .join("");

    // ---- Platform-first mode: pick a provider, see which countries have it ----
    const providerList = buildProviderIndex(results);
    const activeProviderId = providerList[0] ? String(providerList[0].provider.provider_id) : "";

    const platformTabsHTML = providerList
      .map(({ provider }) => {
        const logo = logoUrl(provider.logo_path);
        return `
        <button class="watch-tab watch-tab--platform ${String(provider.provider_id) === activeProviderId ? "is-active" : ""}" data-platform-tab="${provider.provider_id}" role="tab" aria-selected="${String(provider.provider_id) === activeProviderId}">
          ${logo ? `<img class="watch-tab-logo" src="${logo}" alt="">` : ""}
          <span class="watch-tab-label">${escapeHtml(provider.provider_name)}</span>
        </button>`;
      })
      .join("");

    const platformPanelsHTML = providerList
      .map(({ provider, countries }) => {
        const countryChips = [...countries.entries()]
          .sort((a, b) => regionLabel(a[0]).localeCompare(regionLabel(b[0])))
          .map(([code, kindSet]) => {
            const kindsLabel = [...kindSet].join(" / ");
            return `<span class="country-chip"><span class="watch-tab-flag" aria-hidden="true">${countryFlagEmoji(code)}</span>${escapeHtml(regionLabel(code).replace(/^\S+\s/, ""))} <span class="country-chip-kind">(${escapeHtml(kindsLabel)})</span></span>`;
          })
          .join("");
        return `<div class="watch-tabpanel ${String(provider.provider_id) === activeProviderId ? "is-active" : ""}" data-platform-panel="${provider.provider_id}" role="tabpanel">
          <p class="platform-panel-sub">${escapeHtml(provider.provider_name)} — ${countries.size}টি দেশে পাওয়া যাচ্ছে</p>
          <div class="country-chip-row">${countryChips}</div>
        </div>`;
      })
      .join("");

    return `
      <div class="watch-panel">
        <div class="watch-panel-head">
          <p class="section-label" style="margin:0">কোথায় দেখা যাবে</p>
          ${
            !savedRegion || !results[savedRegion]
              ? `<p class="watch-region-note">উপরের 🌐 বাটন থেকে নিজের দেশ সেট করলে সেটাই প্রথমে দেখাবে</p>`
              : ""
          }
        </div>

        <div class="watch-mode-switch" role="tablist" aria-label="দেখার ধরন">
          <button class="watch-mode-btn is-active" data-watch-mode="country">দেশ অনুযায়ী</button>
          <button class="watch-mode-btn" data-watch-mode="platform">প্ল্যাটফর্ম অনুযায়ী</button>
        </div>

        <div class="watch-mode-panel is-active" data-mode-panel="country">
          <div class="watch-tabs" role="tablist">${tabsHTML}</div>
          <div class="watch-tabpanels">${panelsHTML}</div>
        </div>

        <div class="watch-mode-panel" data-mode-panel="platform" hidden>
          <div class="watch-tabs" role="tablist">${platformTabsHTML}</div>
          <div class="watch-tabpanels">${platformPanelsHTML}</div>
        </div>

        <p class="tmdb-attribution">তথ্যসূত্র: TMDB (JustWatch ডেটা)। সাবস্ক্রিপশন লাগতে পারে।</p>
      </div>
    `;
  }

  function bindWatchPanelEvents(container) {
    const panel = container.querySelector(".watch-panel");
    if (!panel) return;

    // Country-tab clicks (existing "pick a country" mode)
    const tabs = panel.querySelector('.watch-mode-panel[data-mode-panel="country"] .watch-tabs');
    if (tabs) {
      tabs.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-region-tab]");
        if (!btn) return;
        const code = btn.dataset.regionTab;
        const scope = tabs.closest(".watch-mode-panel");
        scope.querySelectorAll(".watch-tab").forEach((t) => {
          const active = t.dataset.regionTab === code;
          t.classList.toggle("is-active", active);
          t.setAttribute("aria-selected", String(active));
        });
        scope.querySelectorAll(".watch-tabpanel").forEach((p) => {
          p.classList.toggle("is-active", p.dataset.regionPanel === code);
        });
        btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      });
    }

    // Platform-tab clicks ("pick a platform, see which countries" mode)
    const platformTabs = panel.querySelector('.watch-mode-panel[data-mode-panel="platform"] .watch-tabs');
    if (platformTabs) {
      platformTabs.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-platform-tab]");
        if (!btn) return;
        const pid = btn.dataset.platformTab;
        const scope = platformTabs.closest(".watch-mode-panel");
        scope.querySelectorAll(".watch-tab").forEach((t) => {
          const active = t.dataset.platformTab === pid;
          t.classList.toggle("is-active", active);
          t.setAttribute("aria-selected", String(active));
        });
        scope.querySelectorAll(".watch-tabpanel").forEach((p) => {
          p.classList.toggle("is-active", p.dataset.platformPanel === pid);
        });
        btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      });
    }

    // Mode switch (দেশ অনুযায়ী <-> প্ল্যাটফর্ম অনুযায়ী)
    const modeSwitch = panel.querySelector(".watch-mode-switch");
    if (modeSwitch) {
      modeSwitch.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-watch-mode]");
        if (!btn) return;
        const mode = btn.dataset.watchMode;
        modeSwitch.querySelectorAll(".watch-mode-btn").forEach((b) => {
          b.classList.toggle("is-active", b.dataset.watchMode === mode);
        });
        panel.querySelectorAll(".watch-mode-panel").forEach((p) => {
          const active = p.dataset.modePanel === mode;
          p.classList.toggle("is-active", active);
          p.hidden = !active;
        });
      });
    }
  }

  function providerChipHTML(p, link) {
    const logo = logoUrl(p.logo_path);
    return `
      <a class="provider-chip" href="${link || "#"}" target="_blank" rel="noopener" title="${escapeHtml(p.provider_name)}">
        ${logo ? `<img class="provider-logo" src="${logo}" alt="${escapeHtml(p.provider_name)} লোগো">` : ""}
        <span class="provider-name">${escapeHtml(p.provider_name)}</span>
      </a>`;
  }

  function regionLabel(code) {
    const found = REGIONS.find((r) => r[0] === code);
    return found ? found[1] : code;
  }

  function renderCast(credits) {
    const cast = (credits.cast || []).slice(0, 12);
    if (cast.length === 0) return "";
    return `
      <div class="ticket-divider"></div>
      <p class="section-label">অভিনয়ে</p>
      <div class="cast-track">
        ${cast
          .map((c) => {
            const photo = posterUrl(c.profile_path, PROFILE_SIZE);
            return `
            <div class="cast-card">
              ${
                photo
                  ? `<img class="cast-photo" src="${photo}" alt="${escapeHtml(c.name)}">`
                  : `<div class="cast-photo" style="display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--ink-faint)">${escapeHtml(c.name)}</div>`
              }
              <p class="cast-name">${escapeHtml(c.name)}</p>
              <p class="cast-role">${escapeHtml(c.character || "")}</p>
            </div>`;
          })
          .join("")}
      </div>
    `;
  }

  /* ---------- TRENDING RAIL (home) ---------- */
  let trendingItems = [];

  async function loadTrending() {
    try {
      const data = await tmdbFetch("/trending/all/week");
      trendingItems = (data.results || []).filter((r) => r.media_type === "movie" || r.media_type === "tv").slice(0, 15);
      renderTrendingWithFilter();
    } catch (err) {
      $("#trendingTrack").innerHTML = `<p style="color:var(--ink-faint);font-size:13px">ট্রেন্ডিং লোড করা যায়নি।</p>`;
      console.error(err);
    }
  }

  function renderTrendingWithFilter() {
    const track = $("#trendingTrack");
    const filtered = applyFilters(trendingItems);
    if (filtered.length === 0) {
      track.innerHTML = `<p style="color:var(--ink-faint);font-size:13px">এই ফিল্টারে ট্রেন্ডিং কিছু নেই।</p>`;
      return;
    }
    track.innerHTML = filtered.map(posterCardHTML).join("");
    bindPosterCardEvents(track);
  }

  function renderHomeWatchlistRail() {
    const items = Object.values(state.watchlist).sort((a, b) => b.added_at - a.added_at).slice(0, 10);
    const rail = $("#watchlistRail");
    if (items.length === 0) {
      rail.hidden = true;
      return;
    }
    rail.hidden = false;
    const track = $("#watchlistTrack");
    track.innerHTML = items.map(posterCardHTML).join("");
    bindPosterCardEvents(track);
  }

  /* ---------- WATCHLIST VIEW ---------- */
  let watchlistTab = "towatch";
  function renderWatchlistView() {
    const all = Object.values(state.watchlist).sort((a, b) => b.added_at - a.added_at);
    const towatch = all.filter((i) => i.status !== "watched");
    const watched = all.filter((i) => i.status === "watched");
    $("#towatchCount").textContent = towatch.length;
    $("#watchedCount").textContent = watched.length;

    const list = watchlistTab === "towatch" ? towatch : watched;
    const grid = $("#watchlistGrid");
    const empty = $("#watchlistEmpty");

    if (list.length === 0) {
      grid.innerHTML = "";
      empty.hidden = false;
      empty.querySelector("h3").textContent = watchlistTab === "towatch" ? "তালিকা খালি" : "এখনো কিছু দেখা হয়নি";
      empty.querySelector("p").textContent =
        watchlistTab === "towatch"
          ? "কোনো মুভি বা সিরিজের পাশে + বাটনে চাপুন, এখানে জমা হবে।"
          : "দেখার পর ডিটেইল পেজ থেকে 'দেখা হয়ে গেছে' বলুন।";
    } else {
      empty.hidden = true;
      grid.innerHTML = list.map(posterCardHTML).join("");
      bindPosterCardEvents(grid);
    }
  }

  $$(".tab-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      $$(".tab-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      watchlistTab = btn.dataset.tab;
      renderWatchlistView();
    })
  );
  function $$(sel) {
    return Array.from(document.querySelectorAll(sel));
  }

  /* ---------- ROUTING ---------- */
  function navigateTo(viewName, params = {}) {
    Object.values(views).forEach((v) => (v.hidden = true));
    views[viewName].hidden = false;
    window.scrollTo(0, 0);

    let hash = `#/${viewName}`;
    if (viewName === "detail") hash += `/${params.type}/${params.id}`;
    if (viewName === "results") hash += state.query ? `?q=${encodeURIComponent(state.query)}` : "";
    if (window.location.hash !== hash) {
      history.pushState({}, "", hash);
    }

    if (viewName === "watchlist") renderWatchlistView();
  }

  function handleHashRoute() {
    const hash = window.location.hash.replace(/^#\//, "");
    const [pathPart, queryPart] = hash.split("?");
    const segments = pathPart.split("/").filter(Boolean);
    const route = segments[0] || "home";

    if (route === "results") {
      const params = new URLSearchParams(queryPart || "");
      const q = params.get("q");
      if (q) {
        runSearch(q);
        return;
      }
    } else if (route === "detail" && segments[1] && segments[2]) {
      openDetail(segments[1], Number(segments[2]));
      return;
    } else if (route === "watchlist") {
      navigateTo("watchlist");
      return;
    }
    navigateTo("home");
  }

  /* ---------- EVENT WIRING ---------- */
  // Live suggestion dropdowns
  const heroSuggest = setupSuggest($("#heroSearchInput"), $("#heroSuggest"));
  const resultsSuggest = setupSuggest($("#resultsSearchInput"), $("#resultsSuggest"));

  // Avoid the animated smooth-scroll fighting the keyboard's own
  // "scroll input into view" jump — makes focusing the search box feel instant
  // instead of causing the page to visibly lurch.
  [$("#heroSearchInput"), $("#resultsSearchInput")].forEach((input) => {
    input.addEventListener("focus", () => document.documentElement.classList.add("is-typing"));
    input.addEventListener("blur", () => document.documentElement.classList.remove("is-typing"));
  });

  // Hero search
  $("#heroSearchInput").addEventListener("input", (e) => {
    $("#heroClearBtn").hidden = !e.target.value;
  });
  $("#heroSearchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    clearTimeout(searchDebounce);
    heroSuggest.close();
    const v = $("#heroSearchInput").value.trim();
    if (v) runSearch(v);
  });
  $("#heroClearBtn").addEventListener("click", () => {
    $("#heroSearchInput").value = "";
    $("#heroClearBtn").hidden = true;
    heroSuggest.close();
    $("#heroSearchInput").focus();
  });

  // Quick filter chips on home
  $("#quickFilters").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;

    const wasActive = chip.classList.contains("is-active");
    $$(".chip").forEach((c) => c.classList.remove("is-active"));

    if (wasActive) {
      // Toggling the same chip off clears the quick filter
      state.filterType = "all";
      state.filterLang = "";
    } else {
      chip.classList.add("is-active");
      if (chip.dataset.type) {
        state.filterType = chip.dataset.type;
        state.filterLang = "";
      }
      if (chip.dataset.lang) {
        state.filterLang = chip.dataset.lang;
        state.filterType = "all";
      }
    }

    const q = $("#heroSearchInput").value.trim();
    if (q) {
      runSearch(q, 1, { keepFilters: true });
    } else {
      // No query yet — apply the filter to the trending rail right here
      renderTrendingWithFilter();
    }
  });

  // Results search bar
  $("#resultsSearchInput").addEventListener("input", (e) => {
    $("#resultsClearBtn").hidden = !e.target.value;
  });
  $("#resultsSearchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    clearTimeout(searchDebounce);
    resultsSuggest.close();
    const v = $("#resultsSearchInput").value.trim();
    if (v) runSearch(v);
  });
  $("#resultsClearBtn").addEventListener("click", () => {
    $("#resultsSearchInput").value = "";
    $("#resultsClearBtn").hidden = true;
    resultsSuggest.close();
    $("#resultsSearchInput").focus();
  });
  $("#resultsBackBtn").addEventListener("click", () => history.back());
  $("#detailBackBtn").addEventListener("click", () => history.back());
  $("#watchlistBackBtn").addEventListener("click", () => history.back());

  // Filter bar
  $("#filterBar").addEventListener("click", (e) => {
    const pill = e.target.closest("[data-filter-type]");
    if (!pill) return;
    $$(".filter-pill[data-filter-type]").forEach((p) => p.classList.remove("is-active"));
    pill.classList.add("is-active");
    state.filterType = pill.dataset.filterType;
    renderResults();
    syncClearFiltersVisibility();
  });
  $("#langFilter").addEventListener("change", (e) => {
    state.filterLang = e.target.value;
    renderResults();
    syncClearFiltersVisibility();
  });
  $("#yearFilter").addEventListener("change", (e) => {
    state.filterYear = e.target.value;
    renderResults();
    syncClearFiltersVisibility();
  });
  $("#clearFiltersBtn").addEventListener("click", () => {
    state.filterType = "all";
    state.filterLang = "";
    state.filterYear = "";
    $$(".filter-pill[data-filter-type]").forEach((p) => p.classList.remove("is-active"));
    $('.filter-pill[data-filter-type="all"]').classList.add("is-active");
    $("#langFilter").value = "";
    $("#yearFilter").value = "";
    renderResults();
    syncClearFiltersVisibility();
  });
  function syncClearFiltersVisibility() {
    const active = state.filterType !== "all" || state.filterLang || state.filterYear;
    $("#clearFiltersBtn").hidden = !active;
  }

  function populateYearFilter() {
    const sel = $("#yearFilter");
    const current = new Date().getFullYear();
    let opts = `<option value="">যেকোনো বছর</option>`;
    for (let y = current + 1; y >= 1950; y--) {
      opts += `<option value="${y}">${y}</option>`;
    }
    sel.innerHTML = opts;
  }

  // Load more
  $("#loadMoreBtn").addEventListener("click", () => {
    runSearch(state.query, state.page + 1);
  });

  // Nav brand / watchlist icon
  document.querySelectorAll('[data-nav="home"]').forEach((el) =>
    el.addEventListener("click", (e) => {
      e.preventDefault();
      navigateTo("home");
    })
  );
  $("#watchlistBtn").addEventListener("click", () => navigateTo("watchlist"));
  document.querySelectorAll('[data-nav="watchlist"]').forEach((el) =>
    el.addEventListener("click", () => navigateTo("watchlist"))
  );

  window.addEventListener("popstate", handleHashRoute);

  /* ---------- PWA: SERVICE WORKER ---------- */
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    // Only register over HTTPS or on localhost — avoids console errors
    // when the file is opened directly (file://) during development.
    if (location.protocol !== "https:" && location.hostname !== "localhost") return;
    navigator.serviceWorker.register("sw.js").catch((err) => console.error("SW registration failed", err));
  }

  /* ---------- PWA: INSTALL PROMPT ---------- */
  let deferredInstallPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    $("#installBtn").hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    $("#installBtn").hidden = true;
    showToast("অ্যাপ ইনস্টল হয়ে গেছে 🎬");
  });
  const installBtn = document.getElementById("installBtn");
  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      installBtn.hidden = true;
    });
  }

  /* ---------- INIT ---------- */
  function init() {
    initTheme();
    initRegionSelect();
    populateYearFilter();
    updateWatchlistCount();
    renderHomeWatchlistRail();
    loadTrending();
    registerServiceWorker();

    if (TMDB_KEY === "YOUR_TMDB_API_KEY_HERE") {
      showToast("⚠️ app.js এ TMDB API কী বসান");
    }

    handleHashRoute();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
