(() => {
  // ---------------- Config (ChatGPT) ----------------
  const SITE_ADAPTERS = [
    {
      hostIncludes: ["chat.openai.com", "chatgpt.com"],
      userMessageSelectorCandidates: [
        '[data-message-author-role="user"]',
        'div[data-message-author-role="user"]',
        '.group\\/conversation-turn [data-message-author-role="user"]',
        '[data-testid*="user-message"]',
        '[data-testid^="conversation-turn"] [data-message-author-role="user"]'
      ],
      messageContainerFor(el) {
        // Look for the actual message content container, not just the wrapper
        const contentEl = el.querySelector('div[data-message-id]') || 
                        el.querySelector('.whitespace-pre-wrap') ||
                        el.querySelector('[class*="markdown"]') ||
                        el.querySelector('div > div > div');
        
        if (contentEl) return contentEl;
        
        return el.closest('div[data-message-id]') ||
               el.closest('[data-testid^="conversation-turn"]') ||
               el.closest('div[id^="conversation-turn-"]') ||
               el.closest('article') ||
               el;
      },
      getTextFrom(el) {
        // Try different methods to get the actual message text
        let t = "";
        
        // Method 1: Look for direct text content, excluding "You said:" labels
        const textNodes = [];
        const walker = document.createTreeWalker(
          el,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: function(node) {
              const parent = node.parentElement;
              // Skip if it's just "You said:" or similar labels
              if (parent && (
                parent.textContent.trim() === "You said:" ||
                parent.classList.contains('sr-only') ||
                parent.style.display === 'none'
              )) {
                return NodeFilter.FILTER_REJECT;
              }
              return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
          }
        );
        
        let node;
        while (node = walker.nextNode()) {
          textNodes.push(node.textContent.trim());
        }
        
        t = textNodes.join(' ').trim();
        
        // Fallback to innerText if no good text found
        if (!t) {
          t = (el.innerText || el.textContent || "").trim();
        }
        
        // Clean up common prefixes
        t = t.replace(/^You said:\s*/i, "");
        t = t.replace(/^You:\s*/i, "");
        
        return t;
      },
      headerOffsetPx: 72
    }
  ];
  const adapter =
    SITE_ADAPTERS.find(a => a.hostIncludes.some(h => location.host.includes(h))) ||
    SITE_ADAPTERS[0];

  // ---------------- State ----------------
  let processed = new WeakSet();              // <-- let (so we can reset on chat switch)
  const idForNode = new WeakMap();            // node -> anchor id
  const entries = [];                          // [{id,text,ts,node,index}]
  let counter = 1;
  let sidebar, listEl, toggleBtn;
  let currentChatKey = null; // Track current chat
  let isLoadingChat = false; // Prevent race conditions

  const state = {
    collapsed: false,
    theme: "dark"
  };

  const SHOW_TIME = false; // (hidden per your request)

  // ---------------- Storage helpers ----------------
  function convKey() {
    // Handle different URL patterns
    const path = location.pathname;
    
    // Pattern: /c/conversation-id
    let m = path.match(/\/c\/([a-zA-Z0-9_-]+)/);
    if (m) {
      console.log('Found conversation ID:', m[1]); // Debug log
      return `qsb_conv_${m[1]}`;
    }
    
    // Pattern: chatgpt.com/c/uuid-style-id  
    m = path.match(/\/c\/([a-f0-9-]{36})/);
    if (m) {
      console.log('Found UUID conversation ID:', m[1]); // Debug log
      return `qsb_conv_${m[1]}`;
    }
    
    // Check if there's any ID-like pattern in the URL
    m = path.match(/\/c\/(.+?)(?:\/|$)/);
    if (m) {
      console.log('Found generic conversation ID:', m[1]); // Debug log
      return `qsb_conv_${m[1]}`;
    }
    
    // Fallback for pages without /c/<id> (e.g., "/")
    const fallback = `qsb_conv_path_${encodeURIComponent(path + location.search)}`;
    console.log('Using fallback key:', fallback); // Debug log
    return fallback;
  }

  function loadEntriesFromStorage(cb) {
    const key = convKey();
    console.log('Loading entries for key:', key);
    try {
      chrome.storage?.local.get([key], (res) => {
        const saved = Array.isArray(res[key]) ? res[key] : [];
        console.log('Raw saved entries from storage:', saved.length);
        
        // ALWAYS clear entries first to ensure clean state
        entries.splice(0, entries.length);
        console.log('Cleared entries array, length now:', entries.length);
        
        // Reset counter for new chat
        counter = 1;
        
        // Store saved entries for later matching, but don't add them yet
        window.savedEntriesForCurrentChat = saved;
        
        console.log('Stored saved entries for matching, will add them during DOM scan');
        renderList();
        if (cb) cb();
      });
    } catch {
      // Even on error, ensure entries is cleared
      entries.splice(0, entries.length);
      window.savedEntriesForCurrentChat = [];
      if (cb) cb();
    }
  }

  function saveEntriesToStorage() {
    const key = convKey();
    const minimal = entries.map(({ text, ts }) => ({ text, ts }));
    try { chrome.storage?.local.set({ [key]: minimal }); } catch {}
  }

  // ---------------- Boot ----------------
  const ready = () => {
    injectSidebar();
    currentChatKey = convKey(); // Set initial chat key
    // 1) Load saved list and show it immediately
    loadEntriesFromStorage(() => {
      // 2) Then scan the DOM to attach nodes/anchors (or add brand-new items)
      indexExistingMessages();
      observeNewMessages();
      observeUrlChanges();
    });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }

  // ---------------- UI ----------------
  function injectSidebar() {
    toggleBtn = document.createElement("button");
    toggleBtn.id = "qsb-toggle";
    toggleBtn.textContent = "Questions";
    toggleBtn.addEventListener("click", toggleSidebar);
    document.documentElement.appendChild(toggleBtn);

    sidebar = document.createElement("aside");
    sidebar.id = "qsb-sidebar";
    sidebar.innerHTML = `
      <div id="qsb-header">
        <div id="qsb-title">Questions</div>
        <button class="qsb-btn" id="qsb-theme">Light</button>
        <button class="qsb-btn" id="qsb-hide">Hide</button>
      </div>
      <div id="qsb-list" role="list"></div>
      <div class="qsb-footer">New questions are captured automatically. Resize from the left edge.</div>
    `;
    document.documentElement.appendChild(sidebar);

    listEl = sidebar.querySelector("#qsb-list");
    sidebar.querySelector("#qsb-hide").addEventListener("click", collapseSidebar);
    sidebar.querySelector("#qsb-theme").addEventListener("click", toggleTheme);
    

    try {
      chrome.storage?.sync.get(["qsb_collapsed", "qsb_theme"], (res) => {
        if (typeof res.qsb_collapsed === "boolean" && res.qsb_collapsed) collapseSidebar();
        if (res.qsb_theme === "light" || res.qsb_theme === "dark") state.theme = res.qsb_theme;
        applyTheme();
        renderList();
      });
    } catch {}
  }

  function toggleSidebar() {
    if (document.getElementById("qsb-sidebar")?.style.display === "none") {
      expandSidebar();
    } else {
      collapseSidebar();
    }
  }
  function collapseSidebar() {
    sidebar.style.display = "none";
    toggleBtn.style.display = "block";
    state.collapsed = true;
    try { chrome.storage?.sync.set({ qsb_collapsed: true }); } catch {}
  }
  function expandSidebar() {
    sidebar.style.display = "flex";
    toggleBtn.style.display = "none";
    state.collapsed = false;
    try { chrome.storage?.sync.set({ qsb_collapsed: false }); } catch {}
  }

  

  function applyTheme() {
    const isLight = state.theme === "light";
    document.documentElement.classList.toggle("qsb-light", isLight);
    const btn = sidebar?.querySelector("#qsb-theme");
    if (btn) btn.textContent = isLight ? "Dark" : "Light";
  }

  function toggleTheme() {
    state.theme = state.theme === "light" ? "dark" : "light";
    applyTheme();
    try { chrome.storage?.sync.set({ qsb_theme: state.theme }); } catch {}
  }

  // ---------------- Indexing ----------------
  function indexExistingMessages() {
    const nodes = findUserMessageNodes();
    nodes.forEach(addMessageIfNewOrAttach);
    renderList();
    saveEntriesToStorage();
  }

  function observeNewMessages() {
    const obs = new MutationObserver((mutations) => {
      // Skip if we're currently switching chats
      if (isLoadingChat) return;
      
      let changed = false;
      mutations.forEach(m => {
        m.addedNodes && [...m.addedNodes].forEach(node => {
          if (!(node instanceof Element)) return;
          const candidates = new Set();
          if (matchesAnySelector(node, adapter.userMessageSelectorCandidates)) candidates.add(node);
          adapter.userMessageSelectorCandidates.forEach(sel => {
            node.querySelectorAll?.(sel).forEach(el => candidates.add(el));
          });
          candidates.forEach(el => { if (addMessageIfNewOrAttach(el)) changed = true; });
        });
      });
      if (changed) {
        renderList();
        saveEntriesToStorage();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // Reset the sidebar when switching to a different conversation (by id)
  function observeUrlChanges() {
    const switchToCurrentChat = () => {
      const newKey = convKey();
      console.log('=== CHAT SWITCH CHECK ===');
      console.log('Current URL:', location.href);
      console.log('Generated key:', newKey);
      console.log('Previous key:', currentChatKey);
      
      // If we're already on the same chat, no need to switch
      if (newKey === currentChatKey) {
        console.log('Same chat detected, skipping switch');
        return;
      }
      
      console.log(`🔄 SWITCHING from chat ${currentChatKey} to ${newKey}`);
      
      // Set loading flag to prevent race conditions
      isLoadingChat = true;
      
      // Save current chat's entries before switching (only if we have a previous chat)
      if (currentChatKey && currentChatKey !== newKey && entries.length > 0) {
        console.log('💾 Saving entries for previous chat:', entries.length, 'entries');
        saveEntriesToStorage();
      }
      
      // Clear state immediately and synchronously
      console.log('🗑️ Clearing all state...');
      entries.splice(0, entries.length); // Clear entries array
      counter = 1; // Reset counter
      processed = new WeakSet(); // Reset processed nodes
      window.savedEntriesForCurrentChat = []; // Clear saved entries cache
      
      // Clear WeakMap if supported
      if (typeof idForNode.clear === 'function') {
        idForNode.clear();
      }
      
      // Update current chat key AFTER clearing
      currentChatKey = newKey;
      
      // Clear UI immediately
      if (listEl) {
        listEl.innerHTML = "";
      }
      
      console.log('✅ State cleared. Entries count:', entries.length);
      
      // Load entries for new chat (this will also clear entries again as safety)
      loadEntriesFromStorage(() => {
        console.log('📚 Loaded saved entries, total:', entries.length);
        
        // Then scan DOM for any existing messages in this chat
        setTimeout(() => {
          console.log('🔍 Scanning DOM for existing messages...');
          indexExistingMessages();
          isLoadingChat = false; // Reset loading flag
          console.log(`✨ Chat switch complete! Final count: ${entries.length} entries`);
          console.log('=== CHAT SWITCH COMPLETE ===');
        }, 200);
      });
    };

    // Check for URL changes more frequently and more reliably
    let lastUrl = location.href;
    const checkUrlChange = () => {
      const currentUrl = location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log('URL changed:', currentUrl);
        setTimeout(switchToCurrentChat, 300); // Give time for new DOM to load
      }
    };

    // Multiple detection methods for better reliability
    setInterval(checkUrlChange, 200); // Check every 200ms
    window.addEventListener("popstate", () => setTimeout(switchToCurrentChat, 300));
    
    // Listen for pushstate/replacestate (SPA navigation)
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = function(...args) {
      originalPushState.apply(history, args);
      setTimeout(switchToCurrentChat, 300);
    };
    
    history.replaceState = function(...args) {
      originalReplaceState.apply(history, args);
      setTimeout(switchToCurrentChat, 300);
    };
    
    // Also listen for clicks on navigation elements (ChatGPT specific)
    document.addEventListener('click', (e) => {
      // Check if click might be navigation
      const target = e.target.closest('a, button');
      if (target && (target.href || target.getAttribute('role') === 'button')) {
        setTimeout(checkUrlChange, 500);
      }
    });
  }

  function findUserMessageNodes() {
    const set = new Set();
    adapter.userMessageSelectorCandidates.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => set.add(el));
    });
    return [...set];
  }

  function matchesAnySelector(el, sels) {
    return sels.some(sel => { try { return el.matches(sel); } catch { return false; } });
  }

  // Add new entry OR attach DOM node to an existing saved entry
  function addMessageIfNewOrAttach(rawEl) {
    if (!rawEl || !(rawEl instanceof Element)) return false;
    const container = adapter.messageContainerFor(rawEl);
    if (!container || processed.has(container)) return false;

    const fullText = adapter.getTextFrom(container);
    if (!fullText) { processed.add(container); return false; }

    const text = summarize(fullText);

    // First check if we already have this entry in our current entries
    let entry = entries.find(e => e.text === text);
    if (entry) {
      if (!entry.node) {
        entry.node = container;
        container.setAttribute("data-qsb-anchor", entry.id);
        idForNode.set(container, entry.id);
      }
      processed.add(container);
      return true;
    }

    // Check if this matches a saved entry from storage
    const savedEntries = window.savedEntriesForCurrentChat || [];
    const savedMatch = savedEntries.find(saved => saved.text === text);
    
    const id = `qsb-${counter++}`;
    container.setAttribute("data-qsb-anchor", id);
    idForNode.set(container, id);
    processed.add(container);

    // Create entry with timestamp from saved data if available, otherwise use current time
    entries.push({
      id,
      text,
      ts: savedMatch ? savedMatch.ts : Date.now(),
      node: container,
      index: entries.length
    });
    
    console.log(`Added entry: "${text}" (${savedMatch ? 'from saved' : 'new'})`);
    return true;
  }

  function summarize(text) {
    const firstLine = text.split(/\n/)[0].trim();
    const qm = firstLine.indexOf("?");
    let base = qm >= 0 ? firstLine.slice(0, qm + 1) : firstLine;
    if (base.length > 140) base = base.slice(0, 137) + "…";
    return base;
  }

  // ---------------- Render & Jump ----------------
  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = "";

    entries.forEach((e, i) => {
      const item = document.createElement("div");
      item.className = "qsb-item";
      item.setAttribute("role", "listitem");

      const meta = [`#${i + 1}`];
      const metaHtml = `<div class="qsb-meta"><span>${meta.join(" ")}</span></div>`;

      item.innerHTML = `
        ${metaHtml}
        <div class="qsb-text">${escapeHtml(e.text)}</div>
      `;
      item.addEventListener("click", () => jumpTo(e));
      listEl.appendChild(item);
    });
  }

  function jumpTo(entry) {
    // If we haven't attached a node yet (e.g., very old message), try to locate it now by text
    if (!entry.node || !entry.node.isConnected) {
      const candidates = findUserMessageNodes();
      const match = candidates.find(el => {
        const t = adapter.getTextFrom(adapter.messageContainerFor(el));
        return t && t.trim().startsWith(entry.text.replace(/…$/, "")); // prefix match
      });
      if (match) {
        const container = adapter.messageContainerFor(match);
        entry.node = container;
        container.setAttribute("data-qsb-anchor", entry.id);
        idForNode.set(container, entry.id);
      }
    }

    const target = entry.node;
    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
    setTimeout(() => {
      const y = window.scrollY + target.getBoundingClientRect().top - (adapter.headerOffsetPx || 0) - 12;
      window.scrollTo({ top: y, behavior: "smooth" });
      target.classList.add("qsb-highlight");
      setTimeout(() => target.classList.remove("qsb-highlight"), 1400);
    }, 250);
  }

  // ---------------- Utils ----------------
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    }[c]));
  }
})();