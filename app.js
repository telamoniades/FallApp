"use strict";

/**
 * State
 */
let gameData = null;
let selectedFactionName = "";
let pointsLimit = 300;

// rosterEntries: [{ id, name, points, type }]
let rosterEntries = [];
let nextId = 1;

/**
 * Type ordering (requested)
 */
const TYPE_ORDER = ["Leader", "Core", "Special", "Champion"];
const TYPE_ORDER_MAP = new Map(TYPE_ORDER.map((t, i) => [t, i]));

/**
 * DOM
 */
const elPointsLimit = document.getElementById("pointsLimit");
const elFactionSelect = document.getElementById("factionSelect");
const elUnitList = document.getElementById("unitList");
const elRosterList = document.getElementById("rosterList");
const elTotalPoints = document.getElementById("totalPoints");
const elRosterSummary = document.getElementById("rosterSummary");
const elStatusDot = document.getElementById("statusDot");
const elStatusText = document.getElementById("statusText");
const elCopyBtn = document.getElementById("copyBtn");
const elClearBtn = document.getElementById("clearBtn");
const elUnitHelp = document.getElementById("unitHelp");
const elProfileList = document.getElementById("profileList");
const elProfileHelp = document.getElementById("profileHelp");

/**
 * Boot
 */
init();

async function init() {
  populatePointsDropdown();

  // Load JSON data (requires local server or GitHub Pages)
  try {
    const res = await fetch("./data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load data.json (${res.status})`);
    gameData = await res.json();

    // Normalize legacy type names
    for (const f of gameData?.factions ?? []) {
      for (const u of f.units ?? []) {
        if (u.type === "Elite") u.type = "Champion";
      }
    }
  } catch (err) {
    elUnitHelp.textContent =
      "Could not load data.json. This version requires running a local server or hosting it (e.g., GitHub Pages).";
    elUnitList.innerHTML = renderError(err);
    return;
  }

  populateFactionDropdown();
  bindEvents();

  // Default selections
  pointsLimit = Number(elPointsLimit.value);
  selectedFactionName = elFactionSelect.value;

  renderUnits();
  renderRoster();
  renderProfiles();
}

function populatePointsDropdown() {
  const limits = [];
  for (let p = 200; p <= 500; p += 50) limits.push(p);

  elPointsLimit.innerHTML = limits
    .map((p) => `<option value="${p}">${p} points</option>`)
    .join("");

  // Default to 300
  elPointsLimit.value = "300";
}

function populateFactionDropdown() {
  const factions = gameData?.factions ?? [];
  elFactionSelect.innerHTML = factions
    .map((f) => `<option value="${escapeHtml(f.name)}">${escapeHtml(f.name)}</option>`)
    .join("");

  if (factions.length === 0) {
    elFactionSelect.innerHTML = `<option value="">No factions found</option>`;
  }
}

function bindEvents() {
  elPointsLimit.addEventListener("change", () => {
    pointsLimit = Number(elPointsLimit.value);
    renderUnits(); // champion buttons may enable/disable based on cap
    renderRoster();
    renderProfiles();
  });

  elFactionSelect.addEventListener("change", () => {
    selectedFactionName = elFactionSelect.value;
    clearRoster(); // prevent cross-faction mixing
    renderUnits();
    renderRoster();
    renderProfiles();
  });

  elCopyBtn.addEventListener("click", copyRosterToClipboard);
  elClearBtn.addEventListener("click", () => {
    clearRoster();
    renderRoster();
    renderUnits();
    renderProfiles();
  });
}

/**
 * Rendering
 */
function renderUnits() {
  const faction = getSelectedFaction();
  if (!faction) {
    elUnitHelp.textContent = "Select a faction to see units.";
    elUnitList.innerHTML = "";
    return;
  }

  const comp = computeForceComp();
  const maxChampions = getChampionCap(pointsLimit);
  const championsAtCap = comp.champions >= maxChampions;

  elUnitHelp.textContent =
    `Rules: exactly 1 Leader · Core ≥ Special · Champions ≤ ⌊${pointsLimit}/250⌋ = ${maxChampions}.`;

  const units = [...(faction.units ?? [])].sort((a, b) => {
    const ta = TYPE_ORDER_MAP.get(a.type) ?? 999;
    const tb = TYPE_ORDER_MAP.get(b.type) ?? 999;
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  });

  elUnitList.innerHTML = units
    .map((u) => {
      const isChampion = u.type === "Champion";
      const disabled = isChampion && maxChampions === 0 ? true : (isChampion && championsAtCap);
      const disabledAttr = disabled ? "disabled" : "";

      let reason = "";
      if (disabled && isChampion) {
        reason =
          maxChampions === 0
            ? ` (0 allowed at ${pointsLimit})`
            : ` (cap ${maxChampions})`;
      }

      return `
        <div class="row">
          <div class="row__left">
            <p class="row__title">${escapeHtml(u.name)}</p>
            <div class="row__meta">${escapeHtml(u.type)} · ${u.points} pts${escapeHtml(reason)}</div>
          </div>
          <div class="row__right">
            <button class="btn" data-add="${escapeAttr(u.name)}" ${disabledAttr}>Add</button>
          </div>
        </div>
      `;
    })
    .join("");

  // Wire "Add" buttons
  elUnitList.querySelectorAll("button[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const unitName = btn.getAttribute("data-add");
      addUnit(unitName);
    });
  });
}

function renderProfiles() {
  if (!elProfileList) return;

  if (!rosterEntries || rosterEntries.length === 0) {
    elProfileList.innerHTML = `
      <div class="row">
        <div class="row__left">
          <p class="row__title">No profiles yet</p>
          <div class="row__meta">Add units to your roster to show their profiles here.</div>
        </div>
      </div>
    `;
    return;
  }

  // group by unit name
  const counts = new Map(); // name -> { qty, type, points }
  for (const it of rosterEntries) {
    const cur = counts.get(it.name);
    if (cur) cur.qty += 1;
    else counts.set(it.name, { qty: 1, type: it.type, points: it.points });
  }

  const items = Array.from(counts.entries()).map(([name, meta]) => ({ name, ...meta }));
  items.sort((a, b) => {
    const ta = TYPE_ORDER_MAP.get(a.type) ?? 999;
    const tb = TYPE_ORDER_MAP.get(b.type) ?? 999;
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  });

  elProfileList.innerHTML = items
    .map((it) => {
      const unit = findUnitInSelectedFaction(it.name);
      const p = unit?.profile;

      if (!p) {
        return `
          <div class="profileCard">
            <div class="profileTop">
              <h3 class="profileName">${escapeHtml(it.name)}</h3>
              <div class="profileMeta">Qty ${it.qty} · ${escapeHtml(it.type)} · ${it.points} pts</div>
            </div>
            <div class="profileLine">No profile data for this unit yet.</div>
          </div>
        `;
      }

      const stats = p.stats ?? {};
      const def = p.defense ?? {};
      const weapons = Array.isArray(p.weapons) ? p.weapons : [];
      const rules = Array.isArray(p.specialRules) ? p.specialRules : [];

      const statPairs = [
        ["Fight", stats.Fight],
        ["Accuracy", stats.Accuracy],
        ["Deftness", stats.Deftness],
        ["Arcane", stats.Arcane],
        ["Dodge", def.Dodge],
        ["Resistance", def.Resistance]
      ].filter(([, v]) => v !== undefined && v !== null && String(v).length);

      const normalizedRules = normalizeSpecialRules(rules);

      return `
        <div class="profileCard">
          <div class="profileTop">
            <h3 class="profileName">${escapeHtml(it.name)}</h3>
            <div class="profileMeta">Qty ${it.qty} · ${escapeHtml(it.type)} · ${it.points} pts</div>
          </div>

          ${p.tagline ? `<div class="profileLine">${escapeHtml(p.tagline)}</div>` : ``}
          ${(p.speed || p.wounds) ? `<div class="profileLine">${p.speed ? `Speed: ${escapeHtml(p.speed)}` : ``}${p.speed && p.wounds ? ` · ` : ``}${p.wounds ? `Wounds: ${escapeHtml(p.wounds)}` : ``}</div>` : ``}

          ${statPairs.length ? `
            <div class="profileGrid">
              ${statPairs.map(([k,v]) => `<div class="kv"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(String(v))}</span></div>`).join("")}
            </div>
          ` : ``}

          ${weapons.length ? `
            <div class="profileSection">
              <div class="profileSectionTitle">Weapons</div>
              <ul class="profileList">
                ${weapons.map(w => `<li>${formatWeaponHtml(w)}</li>`).join("")}
              </ul>
            </div>
          ` : ``}

          ${normalizedRules.length ? `
            <div class="profileSection">
              <div class="profileSectionTitle">Special Rules</div>
              <ul class="profileList">
                ${normalizedRules.map(r => `<li><strong>${escapeHtml(r.name)}:</strong> ${escapeHtml(r.text)}</li>`).join("")}
              </ul>
            </div>
          ` : ``}
        </div>
      `;
    })
    .join("");
}

function renderRoster() {
  // Order roster entries by type (Leader -> Core -> Special -> Champion), then by add order within type.
  const ordered = [...rosterEntries].sort((a, b) => {
    const ta = TYPE_ORDER_MAP.get(a.type) ?? 999;
    const tb = TYPE_ORDER_MAP.get(b.type) ?? 999;
    if (ta !== tb) return ta - tb;
    return a.id - b.id; // preserve "added" order within type
  });

  if (ordered.length === 0) {
    elRosterList.innerHTML = `
      <div class="row">
        <div class="row__left">
          <p class="row__title">No units yet</p>
          <div class="row__meta">Add units from the left panel.</div>
        </div>
      </div>
    `;
  } else {
    elRosterList.innerHTML = ordered
      .map((it) => {
        return `
          <div class="row">
            <div class="row__left">
              <p class="row__title">${escapeHtml(it.name)}</p>
              <div class="row__meta">${escapeHtml(it.type)} · ${it.points} pts</div>
            </div>

            <div class="row__right">
              <button class="btn btn--ghost" data-del="${it.id}">Delete</button>
            </div>
          </div>
        `;
      })
      .join("");

    // Wire delete buttons
    elRosterList.querySelectorAll("button[data-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.getAttribute("data-del"));
        deleteEntry(id);
      });
    });
  }

  const total = getRosterTotal();
  elTotalPoints.textContent = String(total);
  elRosterSummary.textContent = `${total} / ${pointsLimit}`;

  // Status indicator: points + force composition
  const comp = computeForceComp();
  const maxChampions = getChampionCap(pointsLimit);
  const over = Math.max(0, total - pointsLimit);
  const remaining = Math.max(0, pointsLimit - total);

  const compProblems = [];

  // Exactly one leader
  if (comp.leaders !== 1) {
    compProblems.push(`Leaders: need exactly 1 (you have ${comp.leaders}).`);
  }

  // Core >= Special
  if (comp.core < comp.requiredCore) {
    compProblems.push(`Core: need at least ${comp.requiredCore} (you have ${comp.core}).`);
  }

  // Champions cap
  if (comp.champions > maxChampions) {
    compProblems.push(`Champions: max ${maxChampions} at ${pointsLimit} pts (you have ${comp.champions}).`);
  }

  const pointsOk = total <= pointsLimit;
  const compOk = compProblems.length === 0;

  if (total === 0) {
    setStatus("Ready.", "ok");
    renderProfiles();
    return;
  }

  if (!pointsOk && !compOk) {
    setStatus(`Over by ${over} pts. ${compProblems.join(" ")}`, "danger");
  } else if (!pointsOk) {
    setStatus(`Over by ${over} pts.`, "danger");
  } else if (!compOk) {
    setStatus(`${remaining} pts remaining. ${compProblems.join(" ")}`, "warn");
  } else if (total === pointsLimit) {
    setStatus("Legal: exact points and legal force composition.", "ok");
  } else {
    setStatus(`${remaining} pts remaining. Legal so far.`, "ok");
  }

  renderProfiles();
}

function renderError(err) {
  return `
    <div class="row">
      <div class="row__left">
        <p class="row__title">Data load error</p>
        <div class="row__meta">${escapeHtml(String(err.message || err))}</div>
        <div class="row__meta">This app must be served by a local web server or hosted (GitHub Pages works).</div>
      </div>
    </div>
  `;
}

/**
 * Roster actions
 */
function addUnit(unitName) {
  const unit = findUnitInSelectedFaction(unitName);
  if (!unit) return;

  // Enforce champion cap at add-time (UX help). Status also enforces it.
  if (unit.type === "Champion") {
    const maxChampions = getChampionCap(pointsLimit);
    const comp = computeForceComp();
    if (comp.champions >= maxChampions) {
      setStatus(`Champion cap reached (${maxChampions} max at ${pointsLimit} pts).`, "warn");
      return;
    }
  }

  rosterEntries.push({
    id: nextId++,
    name: unit.name,
    points: unit.points,
    type: unit.type || "Core"
  });

  renderRoster();
  renderUnits(); // update champion Add button disable state
}

function deleteEntry(id) {
  rosterEntries = rosterEntries.filter((e) => e.id !== id);
  renderRoster();
  renderUnits();
}

function clearRoster() {
  rosterEntries = [];
  nextId = 1;
}

function getRosterTotal() {
  let sum = 0;
  for (const it of rosterEntries) sum += it.points;
  return sum;
}

/**
 * Force composition
 * - Exactly 1 leader.
 * - Core >= Special. (Champions do NOT require Core.)
 * - Champions limited to floor(pointsLimit / 250).
 */
function computeForceComp() {
  let leaders = 0;
  let core = 0;
  let special = 0;
  let champions = 0;

  for (const it of rosterEntries) {
    const t = it.type;
    if (t === "Leader") leaders++;
    else if (t === "Core") core++;
    else if (t === "Special") special++;
    else if (t === "Champion") champions++;
  }

  const requiredCore = special; // champions do not contribute
  return { leaders, core, special, champions, requiredCore };
}

function getChampionCap(limit) {
  return Math.floor(Number(limit) / 250);
}

async function copyRosterToClipboard() {
  // unchanged from your version; left as-is (profiles export still uses normalizeSpecialRules)
  const faction = selectedFactionName || "Unknown faction";
  const total = getRosterTotal();
  const comp = computeForceComp();
  const maxChampions = getChampionCap(pointsLimit);

  const lines = [];
  lines.push(`Fall: A Game of Endings — Roster`);
  lines.push(`Faction: ${faction}`);
  lines.push(`Limit: ${pointsLimit}`);
  lines.push(`Total: ${total}`);
  lines.push(``);
  lines.push(
    `Force Comp: Leaders ${comp.leaders}/1 · Core ${comp.core} (need ≥ ${comp.requiredCore}) · Special ${comp.special} · Champions ${comp.champions}/${maxChampions}`
  );
  lines.push(``);

  const ordered = [...rosterEntries].sort((a, b) => {
    const ta = TYPE_ORDER_MAP.get(a.type) ?? 999;
    const tb = TYPE_ORDER_MAP.get(b.type) ?? 999;
    if (ta !== tb) return ta - tb;
    return a.id - b.id;
  });

  if (ordered.length === 0) {
    lines.push(`(No units)`);
  } else {
    ordered.forEach((it, idx) => {
      lines.push(`${idx + 1}. [${it.type}] ${it.name} — ${it.points}`);
    });
  }

  lines.push(``);
  lines.push(`=== UNIT PROFILES ===`);
  lines.push(``);

  const counts = new Map();
  for (const it of rosterEntries) {
    counts.set(it.name, (counts.get(it.name) ?? 0) + 1);
  }

  const uniq = Array.from(counts.entries()).map(([name, qty]) => {
    const u = findUnitInSelectedFaction(name);
    return {
      name,
      qty,
      type: u?.type ?? "Core",
      points: u?.points ?? 0,
      profile: u?.profile ?? null
    };
  }).sort((a, b) => {
    const ta = TYPE_ORDER_MAP.get(a.type) ?? 999;
    const tb = TYPE_ORDER_MAP.get(b.type) ?? 999;
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  });

  for (const it of uniq) {
    lines.push(`${it.name} — ${it.points} pts — ${it.type} (Qty ${it.qty})`);
    const p = it.profile;
    if (!p) {
      lines.push(`  (No profile data)`);
      lines.push(``);
      continue;
    }
    if (p.tagline) lines.push(`  ${p.tagline}`);
    if (p.speed || p.wounds) {
      const parts = [];
      if (p.speed) parts.push(`Speed: ${p.speed}`);
      if (p.wounds) parts.push(`Wounds: ${p.wounds}`);
      lines.push(`  ${parts.join(" · ")}`);
    }
    const s = p.stats ?? {};
    const d = p.defense ?? {};
    const statLine = [];
    if (s.Fight) statLine.push(`Fi ${s.Fight}`);
    if (s.Accuracy) statLine.push(`Ac ${s.Accuracy}`);
    if (s.Deftness) statLine.push(`De ${s.Deftness}`);
    if (s.Arcane) statLine.push(`Ar ${s.Arcane}`);
    if (d.Dodge) statLine.push(`Do ${d.Dodge}`);
    if (d.Resistance) statLine.push(`Re ${d.Resistance}`);
    if (statLine.length) lines.push(`  ${statLine.join(" · ")}`);

    if (Array.isArray(p.weapons) && p.weapons.length) {
      lines.push(`  Weapons:`);
      for (const w of p.weapons) lines.push(`    - ${formatWeaponText(w)}`);
    }
    if (Array.isArray(p.specialRules) && p.specialRules.length) {
      const nr = normalizeSpecialRules(p.specialRules);
      if (nr.length) {
        lines.push(`  Special Rules:`);
        for (const r of nr) lines.push(`    - ${r.name}: ${r.text}`);
      }
    }
    lines.push(``);
  }

  const text = lines.join("\n");

  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied roster to clipboard.", "ok");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    setStatus("Copied roster to clipboard (fallback).", "ok");
  }
}

/**
 * Special rules normalization:
 * - Supports BOTH "Rule Name: description..." and "Rule Name. description..."
 * - Merges wrapped lines into the previous rule.
 *
 * IMPORTANT heuristic change:
 * - Only treat something as a rule start if the "Name" begins with an uppercase letter.
 *   This prevents splitting on mid-sentence tokens like "sight:" or "started:".
 */
function normalizeSpecialRules(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return [];

  const parseRuleStart = (s) => {
    const line = String(s ?? "").trim();
    if (!line) return null;

    // Try "Name: text"
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const name = line.slice(0, colonIdx).trim();
      const text = line.slice(colonIdx + 1).trim();
      if (looksLikeRuleName(name)) return { name, text };
    }

    // Try "Name. text"
    const dotIdx = line.indexOf(". ");
    if (dotIdx > 0) {
      const name = line.slice(0, dotIdx).trim();
      const text = line.slice(dotIdx + 2).trim();
      if (looksLikeRuleName(name)) return { name, text };
    }

    return null;
  };

  const out = [];
  let current = null;

  for (const raw of lines) {
    const line = String(raw ?? "").trim();
    if (!line) continue;

    const start = parseRuleStart(line);
    if (start) {
      if (current) out.push(current);
      current = start;
      continue;
    }

    // continuation line
    if (!current) {
      current = { name: "Rule", text: line };
    } else {
      current.text = (current.text ? current.text + " " : "") + line;
    }
  }

  if (current) out.push(current);

  return out.map((r) => ({
    name: r.name,
    text: String(r.text ?? "").replace(/\s+/g, " ").trim()
  }));
}

function looksLikeRuleName(name) {
  if (!name) return false;
  const n = String(name).trim();
  if (!n) return false;
  if (n.length > 60) return false;

  // Key heuristic: rule names start with an uppercase letter.
  // Prevents false positives like "sight:" or "started:" that appear mid-sentence.
  const first = n[0];
  const isUpper =
    (first >= "A" && first <= "Z") ||
    (first >= "À" && first <= "Ö") ||
    (first >= "Ø" && first <= "Þ");
  if (!isUpper) return false;

  // Avoid obvious non-rule junk
  if (n.includes("Speed") || n.includes("Wounds")) return false;

  return true;
}

function formatWeaponHtml(w) {
  const parts = splitWeapon(w);
  return `<strong>${escapeHtml(parts.name)}</strong>${escapeHtml(parts.rest)}`;
}

function formatWeaponText(w) {
  const parts = splitWeapon(w);
  return `${parts.name}${parts.rest}`;
}

function splitWeapon(w) {
  const s = String(w ?? "").trim();
  if (!s) return { name: "", rest: "" };

  // Preferred delimiter
  const dashIdx = s.indexOf("—");
  if (dashIdx > 0) {
    const name = s.slice(0, dashIdx).trim();
    const rest = s.slice(dashIdx).trim(); // includes the dash
    return { name, rest: rest ? " " + rest : "" };
  }

  // Otherwise, try to split before "Melee" or "Ranged"/"Shoot" if present.
  const meleeIdx = s.indexOf("Melee");
  const rangedIdx = s.indexOf("Ranged");
  const shootIdx = s.indexOf("Shoot");
  const candidates = [meleeIdx, rangedIdx, shootIdx].filter((x) => x > 0);
  const idx = candidates.length ? Math.min(...candidates) : -1;

  if (idx > 0) {
    const name = s.slice(0, idx).trim();
    const rest = s.slice(idx).trim();
    return { name, rest: rest ? " " + rest : "" };
  }

  // Fallback: bold the first segment up to first period.
  const dotIdx = s.indexOf(".");
  if (dotIdx > 0 && dotIdx < 60) {
    const name = s.slice(0, dotIdx).trim();
    const rest = s.slice(dotIdx).trim();
    return { name, rest: rest ? " " + rest : "" };
  }

  return { name: s, rest: "" };
}

/**
 * Helpers
 */
function getSelectedFaction() {
  if (!gameData) return null;
  return (gameData.factions || []).find((f) => f.name === selectedFactionName) || null;
}

function findUnitInSelectedFaction(unitName) {
  const faction = getSelectedFaction();
  if (!faction) return null;
  return (faction.units || []).find((u) => u.name === unitName) || null;
}

function setStatus(message, type) {
  elStatusText.textContent = message;
  if (type === "danger") elStatusDot.style.background = "var(--danger)";
  else if (type === "warn") elStatusDot.style.background = "var(--warn)";
  else elStatusDot.style.background = "var(--ok)";
}

// Basic escaping
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeAttr(s) {
  return escapeHtml(s);
}
