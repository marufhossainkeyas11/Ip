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
  const TMDB_KEY = "YOUR_TMDB_API_KEY_HERE";
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
  function debouncedSearch(query) {
    clearTimeout(searchDebounce);
    if (!query.trim()) return;
    searchDebounce = setTimeout(() => runSearch(query), 350);
  }

  async function runSearch(query, page = 1) {
    state.query = query;
    state.page = page;
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
    $("#loadMoreBtn").hidden = state.page >= state.totalPages;
    bindPosterCardEvents(grid);
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
          <button class="poster-quickadd ${inList ? "is-added" : ""}" data-quickadd aria-label="তালিকায় যোগ করুন" title="তালিকায় যোগ করুন">${inList ? "✓" : "+"}</button>
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
          quickAdd.textContent = "+";
          showToast("তালিকা থেকে সরানো হয়েছে");
        } else if (item) {
          addToWatchlist(item);
          quickAdd.classList.add("is-added");
          quickAdd.textContent = "✓";
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
            ${inList ? "✓ তালিকায় আছে" : "+ তালিকায় যোগ করুন"}
          </button>
          ${
            inList
              ? `<button class="action-btn action-btn--outline" id="detailWatchedBtn">${watchedStatus === "watched" ? "↺ আবার 'দেখব' এ রাখুন" : "✓ দেখা হয়ে গেছে বলুন"}</button>`
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
  }

  function renderWatchProviders(providers, mediaType, id) {
    const results = providers.results || {};
    const regionCode = state.region;
    const regionsToShow = regionCode ? [regionCode] : Object.keys(results).slice(0, 0); // handled below

    // Global view: show a curated set of major regions that actually have data,
    // so the page isn't overwhelming with 90 countries.
    const GLOBAL_PREVIEW = ["BD", "US", "IN", "GB", "CA", "AU", "JP", "KR", "DE", "FR", "AE", "SA"];

    function groupBlock(regionData, label) {
      if (!regionData) return "";
      const { flatrate, rent, buy, ads, free } = regionData;
      const streamProviders = [...(flatrate || []), ...(free || []), ...(ads || [])];
      const rentBuyProviders = [...(rent || []), ...(buy || [])];
      if (streamProviders.length === 0 && rentBuyProviders.length === 0) return "";

      const dedupe = (arr) => {
        const seen = new Set();
        return arr.filter((p) => (seen.has(p.provider_id) ? false : (seen.add(p.provider_id), true)));
      };

      let html = `<div class="watch-group"><h3 class="watch-group-title"><span class="dot dot--stream" style="background:var(--accent)"></span>${label}</h3>`;

      if (streamProviders.length) {
        html += `<div class="provider-row" style="margin-bottom:10px">`;
        html += dedupe(streamProviders)
          .map((p) => providerChipHTML(p, regionData.link))
          .join("");
        html += `</div>`;
      }
      if (rentBuyProviders.length) {
        html += `<p style="font-size:12px;color:var(--ink-faint);margin:0 0 8px">রেন্ট / কেনার জন্য:</p>`;
        html += `<div class="provider-row">`;
        html += dedupe(rentBuyProviders)
          .map((p) => providerChipHTML(p, regionData.link))
          .join("");
        html += `</div>`;
      }
      html += `</div>`;
      return html;
    }

    let body = "";
    if (regionCode) {
      body = groupBlock(results[regionCode], regionLabel(regionCode));
      if (!body) {
        body = `<div class="watch-empty">এই দেশে (${regionLabel(regionCode)}) এখনো অফিসিয়াল স্ট্রিমিং তথ্য পাওয়া যায়নি। উপরের রিজিওন বদলে অন্য দেশ ট্রাই করুন, অথবা <a href="https://www.themoviedb.org/${mediaType}/${id}/watch" target="_blank" rel="noopener">TMDB-তে সরাসরি দেখুন</a>।</div>`;
      }
    } else {
      const available = GLOBAL_PREVIEW.filter((c) => results[c]);
      if (available.length === 0) {
        body = `<div class="watch-empty">কোনো দেশেই এখনো অফিসিয়াল স্ট্রিমিং তথ্য পাওয়া যায়নি এই টাইটেলের জন্য।</div>`;
      } else {
        body = available.map((c) => groupBlock(results[c], regionLabel(c))).join("");
      }
    }

    return `
      <div class="watch-panel">
        <p class="section-label">কোথায় দেখা যাবে</p>
        ${!regionCode ? `<p class="watch-region-note">গ্লোবাল ভিউ দেখানো হচ্ছে — উপরে থেকে একটা নির্দিষ্ট দেশ বেছে নিলে শুধু সেই দেশেরটা দেখাবে।</p>` : ""}
        ${body}
        <p class="tmdb-attribution">তথ্যসূত্র: TMDB (JustWatch ডেটা)। সাবস্ক্রিপশন লাগতে পারে।</p>
      </div>
    `;
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
  async function loadTrending() {
    try {
      const data = await tmdbFetch("/trending/all/week");
      const items = (data.results || []).filter((r) => r.media_type === "movie" || r.media_type === "tv").slice(0, 15);
      const track = $("#trendingTrack");
      track.innerHTML = items.map(posterCardHTML).join("");
      bindPosterCardEvents(track);
    } catch (err) {
      $("#trendingTrack").innerHTML = `<p style="color:var(--ink-faint);font-size:13px">ট্রেন্ডিং লোড করা যায়নি।</p>`;
      console.error(err);
    }
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
  // Hero search
  $("#heroSearchInput").addEventListener("input", (e) => {
    $("#heroClearBtn").hidden = !e.target.value;
    debouncedSearch(e.target.value);
  });
  $("#heroSearchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    clearTimeout(searchDebounce);
    const v = $("#heroSearchInput").value.trim();
    if (v) runSearch(v);
  });
  $("#heroClearBtn").addEventListener("click", () => {
    $("#heroSearchInput").value = "";
    $("#heroClearBtn").hidden = true;
    $("#heroSearchInput").focus();
  });

  // Quick filter chips on home
  $("#quickFilters").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const q = $("#heroSearchInput").value.trim();
    if (chip.dataset.type) {
      state.filterType = chip.dataset.type;
    }
    if (chip.dataset.lang) {
      state.filterLang = chip.dataset.lang;
      state.filterType = "all";
    }
    if (q) {
      runSearch(q);
    } else {
      showToast("আগে একটা নাম লিখুন, তারপর ফিল্টার প্রয়োগ হবে");
    }
  });

  // Results search bar
  $("#resultsSearchInput").addEventListener("input", (e) => {
    $("#resultsClearBtn").hidden = !e.target.value;
    debouncedSearch(e.target.value);
  });
  $("#resultsSearchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    clearTimeout(searchDebounce);
    const v = $("#resultsSearchInput").value.trim();
    if (v) runSearch(v);
  });
  $("#resultsClearBtn").addEventListener("click", () => {
    $("#resultsSearchInput").value = "";
    $("#resultsClearBtn").hidden = true;
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

  /* ---------- INIT ---------- */
  function init() {
    initTheme();
    initRegionSelect();
    populateYearFilter();
    updateWatchlistCount();
    renderHomeWatchlistRail();
    loadTrending();

    if (TMDB_KEY === "YOUR_TMDB_API_KEY_HERE") {
      showToast("⚠️ app.js এ TMDB API কী বসান");
    }

    handleHashRoute();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
