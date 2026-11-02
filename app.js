(function () {
  "use strict";
  var DB_NAME = "linkvault";
  var db = null;
  var bookmarks = [];
  var collections = [];
  var theme = "light";
  var currentView = "dashboard";
  var searchQuery = "";
  var filterCollection = "";
  var sortMode = "newest";
  var favOnly = false;
  var editingId = null;
  var duplicateConfirmedFor = "";
  var pendingDelete = null;
  var renameId = null;
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function showToast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }
  function hideMsg(node) { node.hidden = true; node.textContent = ""; }
  function showMsg(node, msg) { node.textContent = msg; node.hidden = false; }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains("bookmarks")) d.createObjectStore("bookmarks", { keyPath: "id" });
        if (!d.objectStoreNames.contains("collections")) d.createObjectStore("collections", { keyPath: "id" });
        if (!d.objectStoreNames.contains("settings")) d.createObjectStore("settings", { keyPath: "key" });
      };
      req.onsuccess = function () { db = req.result; resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function tx(stores, mode, run) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(stores, mode);
      var result;
      try { result = run(t); } catch (e) { reject(e); return; }
      t.oncomplete = function () { resolve(result); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error || new Error("Transaction aborted")); };
    });
  }
  function getAll(store) {
    return tx([store], "readonly", function (t) {
      return new Promise(function (res, rej) {
        var r = t.objectStore(store).getAll();
        r.onsuccess = function () { res(r.result || []); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }
  function put(store, value) {
    return tx([store], "readwrite", function (t) { t.objectStore(store).put(value); });
  }
  function del(store, id) {
    return tx([store], "readwrite", function (t) { t.objectStore(store).delete(id); });
  }
  function loadAll() {
    return Promise.all([getAll("bookmarks"), getAll("collections"), getAll("settings")]).then(function (parts) {
      bookmarks = parts[0] || [];
      collections = parts[1] || [];
      var s = (parts[2] || []).find(function (x) { return x.key === "main"; });
      theme = s && (s.theme === "dark" || s.theme === "light") ? s.theme : "light";
    });
  }
  function saveTheme() { return put("settings", { key: "main", theme: theme }); }
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", theme);
    $("themeBtn").textContent = theme === "dark" ? "Light mode" : "Dark mode";
    $("themeLight").setAttribute("aria-pressed", theme === "light" ? "true" : "false");
    $("themeDark").setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  }
  function setTheme(next) {
    theme = next; applyTheme();
    saveTheme().catch(function () { showToast("Theme changed, but saving it failed."); });
  }

  function parseUrl(raw) {
    var v = (raw || "").trim();
    if (!v) throw new Error("Enter a website URL.");
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v)) v = "https://" + v;
    var u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http and https links are allowed.");
    u.hash = "";
    return u;
  }
  function dupKey(u) {
    var path = u.pathname.replace(/\/+$/, "") || "/";
    return u.hostname.toLowerCase() + path + u.search;
  }
  function collectionName(id) {
    if (!id) return "";
    var c = collections.find(function (x) { return x.id === id; });
    return c ? c.name : "";
  }
  function matchesSearch(b) {
    if (!searchQuery) return true;
    var q = searchQuery.toLowerCase();
    return (b.title || "").toLowerCase().includes(q) ||
      (b.url || "").toLowerCase().includes(q) ||
      (b.description || "").toLowerCase().includes(q) ||
      collectionName(b.collectionId).toLowerCase().includes(q);
  }
  function sorted(list) {
    var out = list.slice();
    if (sortMode === "newest") out.sort(function (a, b) { return b.createdAt - a.createdAt; });
    if (sortMode === "oldest") out.sort(function (a, b) { return a.createdAt - b.createdAt; });
    if (sortMode === "alpha") out.sort(function (a, b) { return (a.title || "").localeCompare(b.title || ""); });
    if (sortMode === "opened") out.sort(function (a, b) { return (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0); });
    return out;
  }

  function faviconFor(host, title) {
    var wrap = el("span", "favicon-wrap");
    var img = document.createElement("img");
    img.className = "favicon";
    img.alt = "";
    img.src = "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(host) + "&sz=64";
    img.onerror = function () {
      var fb = el("span", "fallback", (host || "?").charAt(0));
      img.replaceWith(fb);
    };
    wrap.appendChild(img);
    return wrap;
  }
  function card(b) {
    var host = "";
    try { host = new URL(b.url).hostname; } catch (e) { host = b.url; }
    var c = el("article", "card");
    var top = el("div", "card-top");
    top.appendChild(faviconFor(host));
    var meta = el("div");
    meta.appendChild(el("div", "card-title", b.title || host));
    meta.appendChild(el("div", "card-host", host));
    top.appendChild(meta);
    c.appendChild(top);
    if (b.description) c.appendChild(el("p", "card-desc", b.description));
    var name = collectionName(b.collectionId);
    if (name) c.appendChild(el("span", "tag", name));
    if (b.lastOpenedAt) {
      var d = new Date(b.lastOpenedAt);
      c.appendChild(el("div", "muted", "Last opened " + d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })));
    }
    var actions = el("div", "card-actions");
    var open = el("a", "mini", "Open");
    open.href = b.url; open.target = "_blank"; open.rel = "noopener noreferrer";
    open.addEventListener("click", function () {
      b.lastOpenedAt = Date.now();
      put("bookmarks", b).then(render).catch(function () {});
    });
    actions.appendChild(open);
    var star = el("button", "mini" + (b.favorite ? " starred" : ""), b.favorite ? "Favorited" : "Favorite");
    star.type = "button";
    star.setAttribute("aria-label", (b.favorite ? "Remove from favorites: " : "Add to favorites: ") + (b.title || host));
    star.addEventListener("click", function () {
      b.favorite = !b.favorite;
      put("bookmarks", b).then(function () { render(); showToast(b.favorite ? "Added to favorites." : "Removed from favorites."); }).catch(function () { showToast("Could not save that change."); });
    });
    actions.appendChild(star);
    var edit = el("button", "mini", "Edit");
    edit.type = "button";
    edit.addEventListener("click", function () { openBookmarkDialog(b); });
    actions.appendChild(edit);
    var delBtn = el("button", "mini", "Delete");
    delBtn.type = "button";
    delBtn.addEventListener("click", function () {
      pendingDelete = { type: "bookmark", id: b.id, label: b.title || host };
      $("confirmTitle").textContent = "Delete bookmark?";
      $("confirmText").textContent = "Delete \"" + (b.title || host) + "\"? This cannot be undone.";
      $("confirmDialog").showModal();
    });
    actions.appendChild(delBtn);
    c.appendChild(actions);
    return c;
  }
  function renderGrid(node, list, emptyText) {
    node.innerHTML = "";
    if (!list.length) {
      var e = el("div", "empty", emptyText);
      node.appendChild(e);
      return;
    }
    list.forEach(function (b) { node.appendChild(card(b)); });
  }

  function refreshCollectionSelects() {
    var selects = [$("bmCollection"), $("filterCollection")];
    // bookmark select
    var bm = $("bmCollection");
    bm.innerHTML = "";
    var none = document.createElement("option"); none.value = ""; none.textContent = "No collection"; bm.appendChild(none);
    collections.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (c) {
      var o = document.createElement("option"); o.value = c.id; o.textContent = c.name; bm.appendChild(o);
    });
    var fc = $("filterCollection");
    var keep = fc.value;
    fc.innerHTML = "";
    var a1 = document.createElement("option"); a1.value = ""; a1.textContent = "All collections"; fc.appendChild(a1);
    var a2 = document.createElement("option"); a2.value = "__none"; a2.textContent = "No collection"; fc.appendChild(a2);
    collections.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (c) {
      var o = document.createElement("option"); o.value = c.id; o.textContent = c.name; fc.appendChild(o);
    });
    fc.value = keep;
    if (fc.value !== keep) fc.value = "";
    filterCollection = fc.value;
  }
  function renderDashboard() {
    $("statTotal").textContent = String(bookmarks.length);
    $("statFav").textContent = String(bookmarks.filter(function (b) { return b.favorite; }).length);
    $("statColl").textContent = String(collections.length);
    $("statOpened").textContent = String(bookmarks.filter(function (b) { return b.lastOpenedAt; }).length);
    var searched = bookmarks.filter(matchesSearch);
    var recentAdded = searched.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).slice(0, 6);
    renderGrid($("recentAdded"), recentAdded, "No bookmarks yet. Add your first bookmark to see it here.");
    var opened = searched.filter(function (b) { return b.lastOpenedAt; }).sort(function (a, b) { return b.lastOpenedAt - a.lastOpenedAt; }).slice(0, 6);
    renderGrid($("recentOpened"), opened, "No bookmarks opened yet. Open a saved link and it will appear here.");
    var chips = $("dashCollections");
    chips.innerHTML = "";
    if (!collections.length) {
      chips.appendChild(el("p", "muted", "No collections yet. Create one on the Collections page."));
    } else {
      collections.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (c) {
        var count = bookmarks.filter(function (b) { return b.collectionId === c.id; }).length;
        var btn = el("button", "chip", c.name + " (" + count + ")");
        btn.type = "button";
        btn.addEventListener("click", function () {
          showView("all");
          refreshCollectionSelects();
          $("filterCollection").value = c.id;
          filterCollection = c.id;
          render();
        });
        chips.appendChild(btn);
      });
    }
  }
  function renderAll() {
    var list = bookmarks.filter(matchesSearch);
    if (filterCollection === "__none") list = list.filter(function (b) { return !b.collectionId; });
    else if (filterCollection) list = list.filter(function (b) { return b.collectionId === filterCollection; });
    if (favOnly) list = list.filter(function (b) { return b.favorite; });
    list = sorted(list);
    $("resultCount").textContent = list.length + " bookmark" + (list.length === 1 ? "" : "s");
    renderGrid($("allGrid"), list, "No bookmarks match. Try a different search, filter, or add a bookmark.");
  }
  function renderCollections() {
    var list = $("collectionList");
    list.innerHTML = "";
    if (!collections.length) {
      list.appendChild(el("div", "empty", "No collections yet. Create your first collection above."));
      return;
    }
    collections.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (c) {
      var count = bookmarks.filter(function (b) { return b.collectionId === c.id; }).length;
      var row = el("div", "collection-row");
      row.appendChild(el("strong", null, c.name));
      row.appendChild(el("span", "muted", count + " bookmark" + (count === 1 ? "" : "s")));
      var viewBtn = el("button", "mini", "View");
      viewBtn.type = "button";
      viewBtn.addEventListener("click", function () {
        showView("all"); refreshCollectionSelects();
        $("filterCollection").value = c.id; filterCollection = c.id; render();
      });
      row.appendChild(viewBtn);
      var ren = el("button", "mini", "Rename");
      ren.type = "button";
      ren.addEventListener("click", function () {
        renameId = c.id; $("renameInput").value = c.name; hideMsg($("renameError")); $("renameDialog").showModal();
      });
      row.appendChild(ren);
      var delBtn = el("button", "mini", "Delete");
      delBtn.type = "button";
      delBtn.addEventListener("click", function () {
        pendingDelete = { type: "collection", id: c.id, label: c.name };
        $("confirmTitle").textContent = "Delete collection?";
        $("confirmText").textContent = "Delete \"" + c.name + "\"? Its bookmarks will stay, but move to No collection.";
        $("confirmDialog").showModal();
      });
      row.appendChild(delBtn);
      list.appendChild(row);
    });
  }
  function render() {
    refreshCollectionSelects();
    renderDashboard();
    renderAll();
    renderCollections();
    updateStorageInfo();
  }
  function updateStorageInfo() {
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (est) {
        var used = est.usage ? (est.usage / 1024).toFixed(1) + " KB used" : "Usage unknown";
        var quota = est.quota ? " of " + (est.quota / 1024 / 1024).toFixed(0) + " MB available" : "";
        $("storageInfo").textContent = "LinkVault storage: " + used + quota + ". " + bookmarks.length + " bookmarks, " + collections.length + " collections.";
      }).catch(function () {});
    } else {
      $("storageInfo").textContent = "Storage estimate not available in this browser. " + bookmarks.length + " bookmarks, " + collections.length + " collections.";
    }
  }
  function showView(view) {
    currentView = view;
    ["dashboard", "all", "collections", "settings"].forEach(function (v) {
      var sec = $("view-" + v);
      sec.hidden = v !== view;
      sec.classList.toggle("active", v === view);
    });
    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-view") === view);
    });
    if (location.hash !== "#" + view) history.replaceState(null, "", "#" + view);
    if (view === "all") { /* keep filter state */ }
  }

  function openBookmarkDialog(b) {
    editingId = b ? b.id : null;
    duplicateConfirmedFor = "";
    hideMsg($("bmError")); hideMsg($("bmWarn"));
    $("dialogTitle").textContent = b ? "Edit bookmark" : "Add bookmark";
    $("bmSubmit").textContent = b ? "Save changes" : "Save bookmark";
    $("bmUrl").value = b ? b.url : "";
    $("bmTitle").value = b ? b.title || "" : "";
    $("bmDesc").value = b ? b.description || "" : "";
    refreshCollectionSelects();
    $("bmCollection").value = b && b.collectionId ? b.collectionId : "";
    $("bmFav").checked = b ? !!b.favorite : false;
    $("bookmarkDialog").showModal();
    $("bmUrl").focus();
  }

  function validateBackup(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Backup must be a JSON object.");
    if (!Array.isArray(data.bookmarks) || !Array.isArray(data.collections)) throw new Error("Backup must contain bookmarks and collections lists.");
    // Settings in a backup file are deliberately ignored, never applied, so a
    // malformed settings block cannot change the theme or corrupt stored data.
    var collIds = new Set();
    data.collections.forEach(function (c) {
      if (!c || typeof c.id !== "string" || !c.id || typeof c.name !== "string" || !c.name.trim() || c.name.length > 80) throw new Error("Invalid collection in backup.");
      if (collIds.has(c.id)) throw new Error("Duplicate collection id in backup.");
      if (c.createdAt !== undefined && (!Number.isFinite(c.createdAt) || c.createdAt < 0)) throw new Error("Invalid collection timestamp in backup.");
      collIds.add(c.id);
    });
    var bmIds = new Set();
    var bmUrls = new Set();
    data.bookmarks.forEach(function (b) {
      if (!b || typeof b.id !== "string" || !b.id) throw new Error("Invalid bookmark id in backup.");
      if (bmIds.has(b.id)) throw new Error("Duplicate bookmark id in backup.");
      bmIds.add(b.id);
      if (typeof b.url !== "string") throw new Error("Invalid bookmark URL in backup.");
      var u = parseUrl(b.url);
      var key = dupKey(u);
      if (bmUrls.has(key)) throw new Error("Duplicate bookmark URL in backup.");
      bmUrls.add(key);
      if (typeof b.title !== "string" || b.title.length > 200 || typeof b.description !== "string" || b.description.length > 500) throw new Error("Invalid bookmark text in backup.");
      if (b.collectionId !== null && b.collectionId !== undefined && !collIds.has(b.collectionId)) throw new Error("Bookmark refers to a missing collection in backup.");
      if (typeof b.favorite !== "boolean" || !Number.isFinite(b.createdAt) || b.createdAt < 0) throw new Error("Invalid bookmark fields in backup.");
      if (b.lastOpenedAt !== null && b.lastOpenedAt !== undefined && (!Number.isFinite(b.lastOpenedAt) || b.lastOpenedAt < 0)) throw new Error("Invalid last-opened value in backup.");
      b.url = u.href; b.title = b.title; b.description = b.description;
      b.collectionId = b.collectionId || null; b.lastOpenedAt = b.lastOpenedAt || null;
    });
    return data;
  }

  function bind() {
    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { showView(btn.getAttribute("data-view")); render(); });
    });
    window.addEventListener("hashchange", function () {
      var v = location.hash.replace("#", "");
      if (["dashboard", "all", "collections", "settings"].includes(v)) { showView(v); render(); }
    });
    $("menuBtn").addEventListener("click", function () {
      var sb = $("sidebar");
      sb.classList.toggle("collapsed");
      $("menuBtn").setAttribute("aria-expanded", sb.classList.contains("collapsed") ? "false" : "true");
    });
    $("addBtnSidebar").addEventListener("click", function () { openBookmarkDialog(null); });
    $("addBtnTop").addEventListener("click", function () { openBookmarkDialog(null); });
    $("themeBtn").addEventListener("click", function () { setTheme(theme === "dark" ? "light" : "dark"); });
    $("themeLight").addEventListener("click", function () { setTheme("light"); });
    $("themeDark").addEventListener("click", function () { setTheme("dark"); });
    $("searchInput").addEventListener("input", function (e) { searchQuery = e.target.value.trim(); render(); });
    $("filterCollection").addEventListener("change", function (e) { filterCollection = e.target.value; renderAll(); });
    $("sortSelect").addEventListener("change", function (e) { sortMode = e.target.value; renderAll(); });
    $("favOnly").addEventListener("change", function (e) { favOnly = e.target.checked; renderAll(); });

    $("bmCancel").addEventListener("click", function () { $("bookmarkDialog").close(); });
    $("bookmarkForm").addEventListener("submit", function (e) {
      e.preventDefault();
      hideMsg($("bmError")); hideMsg($("bmWarn"));
      var rawUrl = $("bmUrl").value;
      var u;
      try { u = parseUrl(rawUrl); } catch (err) { showMsg($("bmError"), err.message); return; }
      var key = dupKey(u);
      var dup = bookmarks.find(function (b) { return dupKey(new URL(b.url)) === key && b.id !== editingId; });
      if (dup && duplicateConfirmedFor !== key) {
        duplicateConfirmedFor = key;
        showMsg($("bmWarn"), "This URL is already saved as \"" + (dup.title || dup.url) + "\". Press Save bookmark again to save it anyway, or change the URL.");
        return;
      }
      var title = $("bmTitle").value.trim() || u.hostname;
      var rec = {
        id: editingId || (crypto.randomUUID ? crypto.randomUUID() : "bm-" + Date.now() + "-" + Math.random().toString(36).slice(2)),
        url: u.href,
        title: title.slice(0, 200),
        description: $("bmDesc").value.trim().slice(0, 500),
        collectionId: $("bmCollection").value || null,
        favorite: $("bmFav").checked,
        createdAt: editingId ? (bookmarks.find(function (b) { return b.id === editingId; }) || {}).createdAt || Date.now() : Date.now(),
        lastOpenedAt: editingId ? (bookmarks.find(function (b) { return b.id === editingId; }) || {}).lastOpenedAt || null : null
      };
      put("bookmarks", rec).then(function () { return loadAll(); }).then(function () {
        $("bookmarkDialog").close();
        showToast(editingId ? "Bookmark updated." : "Bookmark saved.");
        render();
      }).catch(function () { showMsg($("bmError"), "Could not save this bookmark. Try again."); });
    });

    $("collectionForm").addEventListener("submit", function (e) {
      e.preventDefault();
      hideMsg($("collectionError"));
      var name = $("newCollectionName").value.trim();
      if (!name) { showMsg($("collectionError"), "Enter a collection name."); return; }
      if (collections.some(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })) {
        showMsg($("collectionError"), "A collection with that name already exists."); return;
      }
      var rec = { id: crypto.randomUUID ? crypto.randomUUID() : "col-" + Date.now(), name: name.slice(0, 80), createdAt: Date.now() };
      put("collections", rec).then(function () { return loadAll(); }).then(function () {
        $("newCollectionName").value = "";
        showToast("Collection created."); render();
      }).catch(function () { showMsg($("collectionError"), "Could not create this collection."); });
    });

    $("renameCancel").addEventListener("click", function () { $("renameDialog").close(); });
    $("renameForm").addEventListener("submit", function (e) {
      e.preventDefault();
      hideMsg($("renameError"));
      var name = $("renameInput").value.trim();
      if (!name) { showMsg($("renameError"), "Enter a collection name."); return; }
      if (collections.some(function (c) { return c.id !== renameId && c.name.toLowerCase() === name.toLowerCase(); })) {
        showMsg($("renameError"), "A collection with that name already exists."); return;
      }
      var c = collections.find(function (x) { return x.id === renameId; });
      if (!c) { $("renameDialog").close(); return; }
      c.name = name.slice(0, 80);
      put("collections", c).then(function () { return loadAll(); }).then(function () {
        $("renameDialog").close(); showToast("Collection renamed."); render();
      }).catch(function () { showMsg($("renameError"), "Could not rename this collection."); });
    });

    $("confirmNo").addEventListener("click", function () { pendingDelete = null; $("confirmDialog").close(); });
    $("confirmYes").addEventListener("click", function () {
      var p = pendingDelete; pendingDelete = null;
      $("confirmDialog").close();
      if (!p) return;
      if (p.type === "bookmark") {
        del("bookmarks", p.id).then(function () { return loadAll(); }).then(function () { showToast("Bookmark deleted."); render(); });
      } else if (p.type === "collection") {
        // Move its bookmarks to No collection, then delete the collection, in one transaction.
        tx(["bookmarks", "collections"], "readwrite", function (t) {
          var bs = t.objectStore("bookmarks");
          var all = bs.getAll();
          all.onsuccess = function () {
            (all.result || []).forEach(function (b) {
              if (b.collectionId === p.id) { b.collectionId = null; bs.put(b); }
            });
            t.objectStore("collections").delete(p.id);
          };
        }).then(function () { return loadAll(); }).then(function () { showToast("Collection deleted. Its bookmarks moved to No collection."); render(); });
      } else if (p.type === "clear") {
        tx(["bookmarks", "collections", "settings"], "readwrite", function (t) {
          t.objectStore("bookmarks").clear(); t.objectStore("collections").clear(); t.objectStore("settings").clear();
        }).then(function () { theme = "light"; applyTheme(); return loadAll(); }).then(function () { showToast("All LinkVault data deleted."); render(); });
      }
    });

    $("exportBtn").addEventListener("click", function () {
      var data = { app: "LinkVault", version: 1, exportedAt: new Date().toISOString(), bookmarks: bookmarks, collections: collections };
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "linkvault-backup.json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      showToast("Backup downloaded.");
    });
    $("importFile").addEventListener("change", function (e) {
      hideMsg($("importError")); hideMsg($("importOk"));
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var data;
        try { data = validateBackup(JSON.parse(reader.result)); }
        catch (err) { showMsg($("importError"), "Import rejected, your data was not changed: " + err.message); e.target.value = ""; return; }
        // Only after full validation, replace data in a single transaction.
        // IndexedDB transactions are atomic: an abort rolls back the clear
        // and every put, so a mid-import failure cannot leave partial data.
        // As a second layer, a snapshot is restored if the write still fails.
        var snapshotB = bookmarks.slice();
        var snapshotC = collections.slice();
        tx(["bookmarks", "collections"], "readwrite", function (t) {
          t.objectStore("bookmarks").clear(); t.objectStore("collections").clear();
          data.bookmarks.forEach(function (b) { t.objectStore("bookmarks").put(b); });
          data.collections.forEach(function (c) { t.objectStore("collections").put(c); });
        }).then(function () { return loadAll(); }).then(function () {
          showMsg($("importOk"), "Backup restored: " + data.bookmarks.length + " bookmarks, " + data.collections.length + " collections.");
          render();
        }).catch(function () {
          tx(["bookmarks", "collections"], "readwrite", function (t) {
            t.objectStore("bookmarks").clear(); t.objectStore("collections").clear();
            snapshotB.forEach(function (b) { t.objectStore("bookmarks").put(b); });
            snapshotC.forEach(function (c) { t.objectStore("collections").put(c); });
          }).then(function () { return loadAll(); }).then(function () {
            render();
            showMsg($("importError"), "Import failed, your data was not changed.");
          }).catch(function () { showMsg($("importError"), "Import failed, your data was not changed."); });
        });
        e.target.value = "";
      };
      reader.onerror = function () { showMsg($("importError"), "Could not read that file."); e.target.value = ""; };
      reader.readAsText(file);
    });
    $("clearBtn").addEventListener("click", function () {
      pendingDelete = { type: "clear" };
      $("confirmTitle").textContent = "Delete all data?";
      $("confirmText").textContent = "Delete every bookmark, collection, and setting in LinkVault? Export a backup first if you want to keep them. This cannot be undone.";
      $("confirmDialog").showModal();
    });
  }

  openDb().then(loadAll).then(function () {
    applyTheme();
    bind();
    var v = location.hash.replace("#", "");
    if (["dashboard", "all", "collections", "settings"].includes(v)) currentView = v;
    showView(currentView);
    render();
  }).catch(function (err) {
    document.body.innerHTML = "<main style='padding:2rem;font-family:sans-serif'><h1>LinkVault could not open its storage</h1><p>IndexedDB is required. Check that this browser allows local storage for this page, then reload.</p></main>";
    console.error(err);
  });
})();
