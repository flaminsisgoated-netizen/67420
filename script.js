/**************************************************
 * SOLMAS Giveaway Script (GLOBAL + Realtime)
 * FIXES:
 * 1) Spinner animation improved (realistic long spin + smooth ease + settle)
 * 2) Admin spin now triggers animation on ALL clients (via global spinEvent)
 **************************************************/

// ================================
// ADMIN (kept local)
// ================================
const ADMIN_PASSWORD_HASH = "267623a30c7aa711126cd873179b8dbb6a5ffb15b72055735f8a7e8cfda24be4";

// Put your CA text here
const CA_DISPLAY_TEXT = "YOUR_PUMPFUN_CA_OR_MINT_HERE";

// Entries formula
// 1% holding = 100 entries
const ENTRIES_PER_1_PERCENT = 100;

// Default roll interval (12h) — admin can change globally
const DEFAULT_ROLL_INTERVAL_MS = 12 * 60 * 60 * 1000;

// ================================
// 🔥 FIREBASE (GLOBAL STORAGE)
// NOTE: index.html must include:
//  <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
//  <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js"></script>
// ================================
const firebaseConfig = {
  apiKey: "AIzaSyDxuOQB76-GB-fOUdNaBDaQy8le-qyM-7Y",
  authDomain: "solmas-c4d91.firebaseapp.com",
  databaseURL: "https://solmas-c4d91-default-rtdb.firebaseio.com",
  projectId: "solmas-c4d91",
  storageBucket: "solmas-c4d91.firebasestorage.app",
  messagingSenderId: "163418127180",
  appId: "1:163418127180:web:ef8c16d7d072b69313ade9",
  measurementId: "G-BMJMGPK82Z"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const sharedRef = db.ref("solmasGiveaway/state");
const SV_TIME = firebase.database.ServerValue.TIMESTAMP;

// ================================
// STATE
// ================================
let state = {
  // Local only
  isAdmin: false,
  isSpinning: false,

  // Shared (GLOBAL)
  solGiven: 0,
  solGoal: 25,
  nextRollAt: null,
  rollIntervalMs: DEFAULT_ROLL_INTERVAL_MS,
  entries: [],      // { wallet, percent, entries }
  lastWinner: null, // { wallet, percent, entries, ts, payoutTx? }

  // NEW (GLOBAL): spin event to trigger animation on all clients
  // spinEvent: { id, startedAt, durationMs, winnerWallet, winnerIndex, items:[{wallet,entries,percent?}] }
  spinEvent: null
};

// Tracks last processed spin event on THIS client (local only)
let lastSeenSpinEventId = null;

// ================================
// DOM
// ================================
const els = {
  track: document.getElementById("slider-track"),

  // Winner
  winnerDisplay: document.getElementById("winner-display"),
  winnerName: document.getElementById("winner-name"),
  winnerWallet: document.getElementById("winner-wallet"),
  winnerEntries: document.getElementById("winner-entries"),
  winnerPercent: document.getElementById("winner-percent"),
  winnerTxWrap: document.getElementById("winner-tx-wrap"),
  winnerTxLink: document.getElementById("winner-tx-link"),

  // Front-page confirm payout button
  confirmPayoutBtn: document.getElementById("confirm-payout-btn"),

  // Christmas countdown UTC
  d: document.getElementById("days"),
  h: document.getElementById("hours"),
  m: document.getElementById("minutes"),
  s: document.getElementById("seconds"),

  // Giveaway roll timer
  rollHH: document.getElementById("roll-hh"),
  rollMM: document.getElementById("roll-mm"),
  rollSS: document.getElementById("roll_ss"),
  entriesStatus: document.getElementById("entries-status"),

  // Giveaway progress
  giveFill: document.getElementById("giveaway-fill"),
  givePercent: document.getElementById("giveaway-percent"),
  giveCurrent: document.getElementById("giveaway-current"),
  giveGoal: document.getElementById("giveaway-goal"),

  // Admin modal
  modal: document.getElementById("admin-modal"),
  adminPass: document.getElementById("admin-password"),
  loginStep: document.getElementById("login-step"),
  controlsWrap: document.getElementById("admin-controls"),
  giveawayInput: document.getElementById("giveaway-input"),
  giveawayGoalInput: document.getElementById("giveaway-goal-input"),

  // Timer controls (admin)
  timerValue: document.getElementById("timer-value"),
  timerUnit: document.getElementById("timer-unit"),
  updateTimerBtn: document.getElementById("update-timer-btn"),
  timerCurrent: document.getElementById("timer-current"),

  // Tabs
  tabControls: document.getElementById("tab-controls"),
  tabEntries: document.getElementById("tab-entries"),
  panelControls: document.getElementById("panel-controls"),
  panelEntries: document.getElementById("panel-entries"),

  // Entries tab
  entryWallet: document.getElementById("entry-wallet"),
  entryPercent: document.getElementById("entry-percent"),
  entriesSearch: document.getElementById("entries-search"),
  entriesTbody: document.getElementById("entries-tbody"),
  entriesSummary: document.getElementById("entries-summary"),

  // CA
  caText: document.getElementById("ca-text"),
  caPill: document.getElementById("ca-pill"),

  // Address search -> pump.fun profile
  searchForm: document.getElementById("search-form"),
  searchInput: document.getElementById("search-input"),
};

// ================================
// HASH HELPERS
// ================================
async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyAdminPassword(input) {
  const h = await sha256Hex(String(input || ""));
  return h === ADMIN_PASSWORD_HASH;
}

// ================================
// GLOBAL (Realtime) helpers
// ================================
function sharedSnapshotToState(remote) {
  const isAdmin = state.isAdmin;
  const isSpinning = state.isSpinning;

  state = {
    ...state,
    solGiven: Number(remote.solGiven ?? 0),
    solGoal: Number(remote.solGoal ?? 25),
    nextRollAt: remote.nextRollAt ?? null,
    rollIntervalMs: Number(remote.rollIntervalMs ?? DEFAULT_ROLL_INTERVAL_MS),
    entries: Array.isArray(remote.entries) ? remote.entries : [],
    lastWinner: remote.lastWinner ?? null,
    spinEvent: remote.spinEvent ?? null
  };

  state.isAdmin = isAdmin;
  state.isSpinning = isSpinning;
}

async function ensureRemoteInitialized() {
  const snap = await sharedRef.get();
  if (snap.exists()) return;

  const initial = {
    solGiven: 0,
    solGoal: 25,
    rollIntervalMs: DEFAULT_ROLL_INTERVAL_MS,
    nextRollAt: Date.now() + DEFAULT_ROLL_INTERVAL_MS,
    entries: [],
    lastWinner: null,
    spinEvent: null,
    updatedAt: SV_TIME
  };
  await sharedRef.set(initial);
}

function saveShared(patch) {
  const payload = {
    ...patch,
    updatedAt: SV_TIME
  };
  return sharedRef.update(payload);
}

// ================================
// INIT
// ================================
document.addEventListener("DOMContentLoaded", init);

async function init() {
  initSnowfall();
  initCursor();
  initChristmasCountdownUTC();

  if (els.caText) els.caText.innerText = CA_DISPLAY_TEXT;

  await ensureRemoteInitialized();

  sharedRef.on("value", (snap) => {
    if (!snap.exists()) return;

    const prevSpinId = state.spinEvent?.id ?? null;

    sharedSnapshotToState(snap.val() || {});

    // Reflect remote in UI
    updateGiveawayUI();
    updateEntriesUI();
    renderSlider();
    renderEntriesTable();
    updateTimerCurrentUI();
    if (state.lastWinner) renderWinner(state.lastWinner);
    updateRollCountdown();

    // ✅ NEW: trigger spin animation for everyone
    // If spinEvent changed (or first time) -> animate locally
    const newSpinId = state.spinEvent?.id ?? null;
    if (newSpinId && newSpinId !== lastSeenSpinEventId) {
      lastSeenSpinEventId = newSpinId;
      runSpinEvent(state.spinEvent);
    } else if (newSpinId && newSpinId !== prevSpinId && newSpinId !== lastSeenSpinEventId) {
      lastSeenSpinEventId = newSpinId;
      runSpinEvent(state.spinEvent);
    }
  });

  setInterval(updateRollCountdown, 1000);
  updateRollCountdown();

  setupEvents();

  safeFetchMarketCap();
  setInterval(safeFetchMarketCap, 30000);
}

// ================================
// ADMIN MODAL
// ================================
function toggleAdmin() {
  if (!els.modal) return;
  els.modal.classList.toggle("hidden");

  if (!state.isAdmin) {
    els.loginStep?.classList.remove("hidden");
    els.controlsWrap?.classList.add("hidden");
    if (els.adminPass) els.adminPass.value = "";
    const err = document.getElementById("login-error");
    if (err) err.classList.add("hidden");
  } else {
    setAdminTab("controls");
    renderEntriesTable();
  }
}

async function handleLogin() {
  const ok = await verifyAdminPassword(els.adminPass?.value);
  if (ok) {
    state.isAdmin = true;
    els.loginStep?.classList.add("hidden");
    els.controlsWrap?.classList.remove("hidden");

    if (els.giveawayInput) els.giveawayInput.value = state.solGiven;
    if (els.giveawayGoalInput) els.giveawayGoalInput.value = state.solGoal;

    try {
      const ms = state.rollIntervalMs || DEFAULT_ROLL_INTERVAL_MS;
      updateTimerInputsFromMs(ms);
      updateTimerCurrentUI();
    } catch {}

    setAdminTab("controls");
    renderEntriesTable();
  } else {
    document.getElementById("login-error")?.classList.remove("hidden");
  }
}

function setAdminTab(which) {
  const isControls = which === "controls";
  els.tabControls?.classList.toggle("active", isControls);
  els.tabEntries?.classList.toggle("active", !isControls);
  els.panelControls?.classList.toggle("hidden", !isControls);
  els.panelEntries?.classList.toggle("hidden", isControls);
}

// ================================
// EVENTS
// ================================
function setupEvents() {
  const trigger = document.getElementById("admin-trigger");
  trigger && (trigger.onclick = toggleAdmin);

  const closeBtn = document.getElementById("close-admin");
  closeBtn && (closeBtn.onclick = toggleAdmin);

  const loginBtn = document.getElementById("login-btn");
  loginBtn && (loginBtn.onclick = () => handleLogin());

  els.tabControls && (els.tabControls.onclick = () => setAdminTab("controls"));
  els.tabEntries &&
    (els.tabEntries.onclick = () => {
      setAdminTab("entries");
      renderEntriesTable();
    });

  // Entries add/update (GLOBAL)
  const addEntryBtn = document.getElementById("add-entry-btn");
  addEntryBtn &&
    (addEntryBtn.onclick = async () => {
      if (!state.isAdmin) {
        alert("Admin only. Login first.");
        return;
      }

      const wallet = (els.entryWallet?.value || "").trim();
      const percent = parseFloat(els.entryPercent?.value);

      if (!wallet || wallet.length < 32 || wallet.length > 80) {
        alert("Enter a valid wallet address.");
        return;
      }
      if (!Number.isFinite(percent) || percent <= 0) {
        alert("Enter a valid % holding (e.g. 1 or 0.25).");
        return;
      }

      const entries = Math.floor(percent * ENTRIES_PER_1_PERCENT);
      const idx = state.entries.findIndex((e) => e.wallet === wallet);
      const record = { wallet, percent, entries };

      const newEntries = [...state.entries];
      if (idx >= 0) newEntries[idx] = record;
      else newEntries.push(record);

      await saveShared({ entries: newEntries });

      if (els.entryWallet) els.entryWallet.value = "";
      if (els.entryPercent) els.entryPercent.value = "";
    });

  // Entries clear all (GLOBAL)
  const clearEntriesBtn = document.getElementById("clear-entries-btn");
  clearEntriesBtn &&
    (clearEntriesBtn.onclick = async () => {
      if (!state.isAdmin) {
        alert("Admin only. Login first.");
        return;
      }
      if (!confirm("Clear ALL manual entries?")) return;
      await saveShared({ entries: [], lastWinner: null });
    });

  els.entriesSearch && els.entriesSearch.addEventListener("input", renderEntriesTable);

  // Roll now (admin)
  const rollBtn = document.getElementById("roll-now-btn");
  rollBtn && (rollBtn.onclick = rollGiveawayManual);

  // Reset timer (admin)
  const resetTimerBtn = document.getElementById("reset-timer-btn");
  resetTimerBtn &&
    (resetTimerBtn.onclick = async () => {
      if (!state.isAdmin) {
        alert("Admin only. Login first.");
        return;
      }
      if (!confirm("Reset giveaway timer back to 12 hours?")) return;

      const ms = DEFAULT_ROLL_INTERVAL_MS;
      await saveShared({
        rollIntervalMs: ms,
        nextRollAt: Date.now() + ms
      });

      updateTimerInputsFromMs(ms);
      updateTimerCurrentUI();
      alert("Timer reset to 12 hours ✅");
    });

  // Update giveaway progress (admin) — GLOBAL
  const updateGiveawayBtn = document.getElementById("update-giveaway-btn");
  updateGiveawayBtn &&
    (updateGiveawayBtn.onclick = async () => {
      if (!state.isAdmin) {
        alert("Admin only. Login first.");
        return;
      }

      const given = parseFloat(els.giveawayInput?.value);
      const goal = parseFloat(els.giveawayGoalInput?.value);

      const patch = {};
      if (Number.isFinite(given)) patch.solGiven = Math.max(0, given);
      if (Number.isFinite(goal)) patch.solGoal = Math.max(0.1, goal);

      await saveShared(patch);
      alert("Giveaway progress updated ✅");
    });

  // Update timer length (admin) — GLOBAL
  const updateTimerBtn = document.getElementById("update-timer-btn");
  updateTimerBtn &&
    (updateTimerBtn.onclick = async () => {
      if (!state.isAdmin) {
        alert("Admin only. Login first.");
        return;
      }

      const val = parseInt(els.timerValue?.value, 10);
      const unit = (els.timerUnit?.value || "minutes").toLowerCase();

      if (!Number.isFinite(val) || val <= 0) {
        alert("Enter a valid timer value (e.g. 10).");
        return;
      }

      let ms = val * 1000;
      if (unit === "minutes") ms = val * 60 * 1000;
      if (unit === "hours") ms = val * 60 * 60 * 1000;

      ms = Math.max(ms, 10 * 1000);

      await saveShared({
        rollIntervalMs: ms,
        nextRollAt: Date.now() + ms
      });

      updateTimerCurrentUI();
      alert(`Timer updated: ${formatMs(ms)} ✅`);
    });

  // Confirm payout (GLOBAL)
  if (els.confirmPayoutBtn) {
    els.confirmPayoutBtn.onclick = async () => {
      if (!state.lastWinner) {
        alert("No winner yet.");
        return;
      }

      const pw = prompt("Enter admin password:");
      if (!(await verifyAdminPassword(pw))) {
        alert("Wrong password.");
        return;
      }

      const tx = prompt("Paste transaction hash / signature:");
      const cleanTx = String(tx || "").trim();
      if (!cleanTx || cleanTx.length < 20) {
        alert("Invalid transaction hash / signature.");
        return;
      }

      const updatedWinner = { ...(state.lastWinner || {}), payoutTx: cleanTx };
      await saveShared({ lastWinner: updatedWinner });
      alert("Payout confirmed ✅");
    };
  }

  // CA copy
  if (els.caPill) {
    els.caPill.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(CA_DISPLAY_TEXT);
      } catch {}
    });
  }

  // Address search -> pump.fun profile
  if (els.searchForm) {
    els.searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const wallet = (els.searchInput?.value || "").trim();
      if (!wallet) return;
      window.location.href = `https://pump.fun/profile/${encodeURIComponent(wallet)}`;
    });
  }
}

// ================================
// ADMIN ENTRIES TABLE
// ================================
function renderEntriesTable() {
  if (!els.entriesTbody) return;

  const q = (els.entriesSearch?.value || "").trim().toLowerCase();

  const list = [...state.entries]
    .sort((a, b) => (b.entries || 0) - (a.entries || 0))
    .filter((e) => !q || (e.wallet || "").toLowerCase().includes(q));

  els.entriesTbody.innerHTML = "";

  for (const e of list) {
    const tr = document.createElement("tr");

    const tdW = document.createElement("td");
    tdW.innerHTML = `
      <span class="monospace">${shortenWallet(e.wallet)}</span>
      <div class="opacity-50 small monospace">${e.wallet}</div>
    `;

    const tdP = document.createElement("td");
    tdP.textContent = `${Number(e.percent).toFixed(2)}%`;

    const tdE = document.createElement("td");
    tdE.innerHTML = `<span class="text-neon bold">${e.entries}</span>`;

    const tdA = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "mini-btn interactive";
    btn.textContent = "Remove";
    btn.onclick = async () => {
      if (!state.isAdmin) {
        alert("Admin only. Login first.");
        return;
      }
      if (!confirm(`Remove ${e.wallet}?`)) return;

      const newEntries = state.entries.filter((x) => x.wallet !== e.wallet);
      await saveShared({ entries: newEntries });
    };
    tdA.appendChild(btn);

    tr.appendChild(tdW);
    tr.appendChild(tdP);
    tr.appendChild(tdE);
    tr.appendChild(tdA);

    els.entriesTbody.appendChild(tr);
  }

  if (els.entriesSummary) {
    const wallets = state.entries.length;
    const total = state.entries.reduce((s, e) => s + (e.entries || 0), 0);
    els.entriesSummary.textContent =
      `Wallets: ${wallets.toLocaleString()} • Total entries: ${total.toLocaleString()}`;
  }
}

// ================================
// TIMER LENGTH UI
// ================================
function formatMs(ms) {
  ms = Math.max(0, Number(ms) || 0);
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} seconds`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minutes`;
  const h = Math.round(m / 60);
  return `${h} hours`;
}

function updateTimerInputsFromMs(ms) {
  if (!els.timerValue || !els.timerUnit) return;

  ms = Number(ms) || DEFAULT_ROLL_INTERVAL_MS;

  if (ms % (60 * 60 * 1000) === 0) {
    els.timerUnit.value = "hours";
    els.timerValue.value = String(ms / (60 * 60 * 1000));
  } else if (ms % (60 * 1000) === 0) {
    els.timerUnit.value = "minutes";
    els.timerValue.value = String(ms / (60 * 1000));
  } else {
    els.timerUnit.value = "seconds";
    els.timerValue.value = String(Math.max(1, Math.round(ms / 1000)));
  }
}

function updateTimerCurrentUI() {
  if (els.timerCurrent) {
    els.timerCurrent.textContent = formatMs(state.rollIntervalMs || DEFAULT_ROLL_INTERVAL_MS);
  }
}

// ================================
// GIVEAWAY PROGRESS
// ================================
function updateGiveawayUI() {
  if (!els.giveFill) return;
  const pct = Math.min((state.solGiven / state.solGoal) * 100, 100);
  els.giveCurrent && (els.giveCurrent.innerText = String(state.solGiven));
  els.giveGoal && (els.giveGoal.innerText = String(state.solGoal));
  els.givePercent && (els.givePercent.innerText = `${pct.toFixed(1)}%`);
  els.giveFill.style.width = `${pct}%`;
}

// ================================
// ENTRIES STATUS
// ================================
function updateEntriesUI() {
  const wallets = state.entries.length;
  const totalEntries = state.entries.reduce((s, e) => s + (e.entries || 0), 0);
  if (els.entriesStatus) {
    els.entriesStatus.innerText =
      `Wallets: ${wallets.toLocaleString()} • Total entries: ${totalEntries.toLocaleString()}`;
  }
}

// ================================
// LAST WINNER + PAYOUT TX
// ================================
function renderWinner(w) {
  if (!els.winnerDisplay) return;

  els.winnerName && (els.winnerName.innerText = shortenWallet(w.wallet));
  els.winnerWallet && (els.winnerWallet.innerText = w.wallet);
  els.winnerEntries && (els.winnerEntries.innerText = String(w.entries));
  els.winnerPercent && (els.winnerPercent.innerText = `${Number(w.percent).toFixed(2)}%`);

  if (w.payoutTx) {
    if (els.winnerTxWrap) els.winnerTxWrap.style.display = "block";
    if (els.winnerTxLink) {
      els.winnerTxLink.textContent = w.payoutTx;
      els.winnerTxLink.href = `https://solscan.io/tx/${encodeURIComponent(w.payoutTx)}`;
    }
  } else {
    if (els.winnerTxWrap) els.winnerTxWrap.style.display = "none";
    if (els.winnerTxLink) {
      els.winnerTxLink.textContent = "—";
      els.winnerTxLink.href = "#";
    }
  }

  els.winnerDisplay.classList.remove("opacity-0");
  els.winnerDisplay.classList.add("opacity-1");
}

// ================================
// GIVEAWAY TIMER (GLOBAL)
// ================================
function updateRollCountdown() {
  if (!state.nextRollAt) return;

  const left = Math.max(0, state.nextRollAt - Date.now());

  const hh = Math.floor(left / (1000 * 60 * 60));
  const mm = Math.floor((left % (1000 * 60 * 60)) / (1000 * 60));
  const ss = Math.floor((left % (1000 * 60)) / 1000);

  els.rollHH && (els.rollHH.innerText = String(hh).padStart(2, "0"));
  els.rollMM && (els.rollMM.innerText = String(mm).padStart(2, "0"));
  els.rollSS && (els.rollSS.innerText = String(ss).padStart(2, "0"));

  if (left === 0 && els.entriesStatus) {
    els.entriesStatus.innerText = "✅ Giveaway is READY to roll (admin must roll manually).";
  }
}

// ================================
// SLIDER BASE RENDER
// ================================
function renderSlider() {
  if (!els.track) return;

  const sorted = [...state.entries].sort((a, b) => (b.entries || 0) - (a.entries || 0));
  const top = sorted.slice(0, 200);
  const renderList = [...top, ...top, ...top];

  els.track.innerHTML = "";
  renderList.forEach((e) => {
    const item = document.createElement("div");
    item.className = "slider-item";
    item.innerHTML = `
      <div class="bold text-white">${shortenWallet(e.wallet)}</div>
      <div class="small monospace">${e.entries} entries</div>
    `;
    els.track.appendChild(item);
  });

  els.track.style.transform = "translateX(0px)";
  els.track.style.transition = "none";
}

/* ================================
 * ✅ NEW GLOBAL SPIN EVENT SYSTEM
 * - Admin writes spinEvent to Firebase
 * - Every client sees spinEvent.id change -> runs animation locally
 ================================ */

function makeSpinEvent(winner, durationMs = 7200) {
  // Build a "reel" that looks random but ends on winner
  const pool = [...state.entries];
  const SPIN_ITEMS = 140;
  const WIN_INDEX = 110;

  const items = [];
  for (let i = 0; i < SPIN_ITEMS; i++) {
    const pick = (i === WIN_INDEX)
      ? winner
      : pool[Math.floor(Math.random() * pool.length)];
    // store minimal data needed for UI
    items.push({ wallet: pick.wallet, entries: pick.entries, percent: pick.percent });
  }

  return {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    startedAt: Date.now(),
    durationMs,
    winnerWallet: winner.wallet,
    winnerIndex: WIN_INDEX,
    items
  };
}

function runSpinEvent(ev) {
  if (!ev || !els.track) return;

  // If user loads mid-spin, run remaining time (or snap if almost done)
  const now = Date.now();
  const endAt = (ev.startedAt || now) + (ev.durationMs || 7000);
  const remaining = Math.max(0, endAt - now);

  // Rebuild reel exactly as admin published it
  els.track.innerHTML = "";
  for (let i = 0; i < ev.items.length; i++) {
    const e = ev.items[i];
    const item = document.createElement("div");
    item.className = "slider-item";
    if (i === ev.winnerIndex) item.id = "spin-target";
    item.innerHTML = `
      <div class="bold text-white">${shortenWallet(e.wallet)}</div>
      <div class="small monospace">${e.entries} entries</div>
    `;
    els.track.appendChild(item);
  }

  // Reset
  els.track.style.transition = "none";
  els.track.style.transform = "translateX(0px)";
  els.track.offsetHeight;

  const windowEl = document.querySelector(".slider-window");
  const targetEl = document.getElementById("spin-target");
  if (!windowEl || !targetEl) return;

  // Measure true step (handles CSS gap/margins/responsive)
  const all = els.track.querySelectorAll(".slider-item");
  let step = 0;
  if (all.length >= 2) step = Math.round(all[1].offsetLeft - all[0].offsetLeft);
  if (!step) step = all[0].offsetWidth || 150;

  const targetWidth = targetEl.offsetWidth || step;
  const centerOffset = (windowEl.offsetWidth / 2) - (targetWidth / 2);

  const finalTranslate = Math.round(-(ev.winnerIndex * step) + centerOffset);

  // Better animation: long glide + micro-settle
  // If joining late, shorten to remaining time
  const mainTime = Math.max(300, Math.min(5600, remaining ? Math.min(5600, remaining - 650) : 5600));
  const settleTime = Math.max(180, Math.min(650, remaining ? Math.min(650, remaining) : 650));

  // Overshoot for realism
  const overshoot = Math.round((Math.random() * 120) + 80) * (Math.random() < 0.5 ? -1 : 1);
  const overshootTranslate = finalTranslate + overshoot;

  // Hide winner card display while spinning (client-side visual)
  els.winnerDisplay?.classList.remove("opacity-1");
  els.winnerDisplay?.classList.add("opacity-0");

  // If almost over, snap
  if (remaining && remaining < 350) {
    els.track.style.transition = "none";
    els.track.style.transform = `translateX(${finalTranslate}px)`;
    highlightTargetAndWinner();
    return;
  }

  // Main spin
  requestAnimationFrame(() => {
    els.track.style.transition = `transform ${mainTime}ms cubic-bezier(0.08, 0.86, 0.12, 1)`;
    els.track.style.transform = `translateX(${overshootTranslate}px)`;
  });

  // Settle
  setTimeout(() => {
    els.track.style.transition = `transform ${settleTime}ms cubic-bezier(0.20, 1.05, 0.22, 1)`;
    els.track.style.transform = `translateX(${finalTranslate}px)`;
  }, mainTime);

  // Reveal/highlight
  setTimeout(() => {
    highlightTargetAndWinner();
  }, mainTime + settleTime + 40);

  function highlightTargetAndWinner() {
    const t = document.getElementById("spin-target");
    if (t) {
      t.style.background = "rgba(0,255,186,0.22)";
      t.style.boxShadow = "0 0 24px rgba(0,255,186,0.45)";
    }
    // winner card shows from global lastWinner (already synced),
    // but force show if available
    if (state.lastWinner) renderWinner(state.lastWinner);
  }
}

// ================================
// ROLL GIVEAWAY (MANUAL, WEIGHTED) — GLOBAL + ANIMATES EVERYONE
// ================================
async function rollGiveawayManual() {
  if (!state.isAdmin) {
    alert("Admin only. Login first.");
    return;
  }
  if (state.isSpinning) return;

  if (!state.entries.length) {
    alert("No entries yet. Add entries in Admin → Entries tab.");
    return;
  }

  const total = state.entries.reduce((s, e) => s + (e.entries || 0), 0);
  if (total <= 0) {
    alert("All entries are 0. Increase holding % values.");
    return;
  }

  state.isSpinning = true;

  // Weighted pick
  let r = Math.random() * total;
  let winner = null;
  for (const e of state.entries) {
    r -= (e.entries || 0);
    if (r <= 0) {
      winner = e;
      break;
    }
  }
  if (!winner) winner = state.entries[state.entries.length - 1];

  // Create global spin event (this makes ALL clients animate)
  const spinEvent = makeSpinEvent(winner, 7200);

  // Save winner globally + reset nextRollAt + publish spinEvent
  const newWinner = {
    wallet: winner.wallet,
    percent: winner.percent,
    entries: winner.entries,
    ts: Date.now(),
    payoutTx: null
  };

  const ms = state.rollIntervalMs || DEFAULT_ROLL_INTERVAL_MS;

  await saveShared({
    lastWinner: newWinner,
    nextRollAt: Date.now() + ms,
    spinEvent
  });

  // Locally mark as not spinning after animation time
  setTimeout(() => { state.isSpinning = false; }, 8000);
}

// ================================
// CHRISTMAS COUNTDOWN (UTC)
// ================================
function initChristmasCountdownUTC() {
  function update() {
    const now = new Date();
    const year = now.getUTCFullYear();

    let target = new Date(Date.UTC(year, 11, 25, 0, 0, 0));
    if (now.getTime() > target.getTime()) {
      target = new Date(Date.UTC(year + 1, 11, 25, 0, 0, 0));
    }

    const dist = target.getTime() - now.getTime();

    const days = Math.floor(dist / (1000 * 60 * 60 * 24));
    const hours = Math.floor((dist % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((dist % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((dist % (1000 * 60)) / 1000);

    els.d && (els.d.innerText = String(days).padStart(2, "0"));
    els.h && (els.h.innerText = String(hours).padStart(2, "0"));
    els.m && (els.m.innerText = String(minutes).padStart(2, "0"));
    els.s && (els.s.innerText = String(seconds).padStart(2, "0"));
  }

  update();
  setInterval(update, 1000);
}

// ================================
// OPTIONAL MARKET CAP (safe placeholder)
// ================================
async function safeFetchMarketCap() {
  try {
    const el = document.getElementById("mcap-value");
    const change = document.getElementById("price-change");
    if (el && !el.innerText) el.innerText = "$0.00";
    if (change && !change.innerText) change.innerText = "—";
  } catch {}
}

// ================================
// EFFECTS
// ================================
function initSnowfall() {
  const canvas = document.getElementById("snow-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const snowCount = 120;
  let width, height;
  const snowflakes = [];

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
  }
  window.addEventListener("resize", resize);
  resize();

  for (let i = 0; i < snowCount; i++) {
    snowflakes.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 1.2,
      vy: Math.random() * 2 + 0.8,
      size: Math.random() * 3 + 1,
      opacity: Math.random() * 0.5 + 0.25,
    });
  }

  function animate() {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "white";

    for (const f of snowflakes) {
      f.x += f.vx;
      f.y += f.vy;

      if (f.y > height) {
        f.y = -10;
        f.x = Math.random() * width;
      }
      if (f.x > width) f.x = 0;
      if (f.x < 0) f.x = width;

      ctx.globalAlpha = f.opacity;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(animate);
  }
  animate();
}

function initCursor() {
  if (window.matchMedia("(max-width: 768px)").matches) return;

  const dot = document.querySelector(".cursor-dot");
  const trail = document.querySelector(".cursor-trail");
  if (!dot || !trail) return;

  let mouse = { x: 0, y: 0 };
  let dotPos = { x: 0, y: 0 };
  let trailPos = { x: 0, y: 0 };

  const dotLerp = 0.55;
  const trailLerp = 0.12;

  document.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  function animate() {
    dotPos.x += (mouse.x - dotPos.x) * dotLerp;
    dotPos.y += (mouse.y - dotPos.y) * dotLerp;

    trailPos.x += (mouse.x - trailPos.x) * trailLerp;
    trailPos.y += (mouse.y - trailPos.y) * trailLerp;

    dot.style.transform = `translate(${dotPos.x}px, ${dotPos.y}px) translate(-50%, -50%)`;
    trail.style.transform = `translate(${trailPos.x}px, ${trailPos.y}px) translate(-50%, -50%)`;

    requestAnimationFrame(animate);
  }
  animate();
}

// ================================
// UTILS
// ================================
function shortenWallet(w) {
  if (!w) return "—";
  return `${w.slice(0, 4)}…${w.slice(-4)}`;
}
