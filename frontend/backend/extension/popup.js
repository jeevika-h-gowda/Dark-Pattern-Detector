// ===== Runs INSIDE the web page: finds dark patterns and highlights them =====
function scanPage() {
  // Remove old highlights
  document.querySelectorAll("[data-darkscan]").forEach((el) => {
    el.style.outline = "";
    el.style.outlineOffset = "";
    el.style.backgroundColor = "";
    el.removeAttribute("data-darkscan");
  });

  const PATTERNS = [
    {
      key: "urgency", name: "Urgency / Scarcity", weight: 25, color: "#f97316",
      tests: [
        /limited[- ]time/i, /offers? ends?/i, /ends in \d+/i, /deals? ends?/i,
        /act now/i, /hurry/i, /only today/i, /today only/i, /sale ends?/i,
        /ending soon/i, /only \d+ (left|remaining)/i, /\d+ left in stock/i,
        /few (items )?left/i, /almost (sold out|gone)/i, /selling fast/i,
        /limited stock/i, /\b\d{1,2}:\d{2}:\d{2}\b/,
        /\d+ (people|others) (are )?(viewing|watching|looking)/i
      ]
    },
    {
      key: "preselected", name: "Preselected Options", weight: 20, color: "#a855f7",
      tests: []
    },
    {
      key: "confirmshaming", name: "Confirmshaming", weight: 20, color: "#ec4899",
      tests: [
        /no,? thanks/i, /i (don'?t|do not) (want|need|like)/i, /i hate/i,
        /miss out/i, /no,? i('m| am) (not|fine)/i
      ]
    },
    {
      key: "hidden", name: "Hidden Costs", weight: 20, color: "#eab308",
      tests: [
        /(handling|processing|convenience|platform|service|packaging|payment handling) (fee|charges?)/i,
        /additional (fees|charges)/i, /extra charges?/i, /fees? (may )?apply/i
      ]
    },
    {
      key: "ads", name: "Disguised Ads", weight: 15, color: "#38bdf8",
      tests: []
    }
  ];

  const found = {};
  PATTERNS.forEach((p) => (found[p.key] = { els: new Set(), count: 0, examples: [] }));
  const byKey = (k) => PATTERNS.find((p) => p.key === k);

  function isVisible(el) {
    if (!el.getClientRects().length) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  }

  function add(p, el, text) {
    const f = found[p.key];
    if (f.els.has(el)) return;
    f.els.add(el);
    f.count++;
    if (f.examples.length < 4 && !f.examples.includes(text)) f.examples.push(text);
    if (!el.getAttribute("data-darkscan")) {
      el.setAttribute("data-darkscan", p.key);
      el.style.outline = "3px solid " + p.color;
      el.style.outlineOffset = "2px";
      el.style.backgroundColor = p.color + "33";
    }
  }

  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "HEAD", "META", "LINK", "TITLE"]);
  const AD_WORDS = /^(ad|ads|sponsored|promoted|advertisement|paid promotion)$/i;

  // 1) Text-based checks
  for (const el of document.body.querySelectorAll("*")) {
    if (SKIP.has(el.tagName.toUpperCase())) continue;

    let own = "";
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
    own = own.replace(/\s+/g, " ").trim();
    if (!own || own.length > 160) continue;
    if (!isVisible(el)) continue;

    const urgency = byKey("urgency");
    if (urgency.tests.some((r) => r.test(own))) add(urgency, el, own);

    const hidden = byKey("hidden");
    if (hidden.tests.some((r) => r.test(own))) add(hidden, el, own);

    const shame = byKey("confirmshaming");
    if (el.closest("button, a, [role='button'], label") &&
        shame.tests.some((r) => r.test(own))) add(shame, el, own);

    const ads = byKey("ads");
    if (AD_WORDS.test(own.replace(/[^a-z ]/gi, "").trim())) add(ads, el, own);
  }

  // 2) Elements whose class/id says "sponsored" or "advert"
  const adSel =
    '[class*="sponsor" i], [id*="sponsor" i], [class*="advert" i], [id*="advert" i], [class*="promoted" i]';
  let adCount = 0;
  for (const el of document.querySelectorAll(adSel)) {
    if (adCount >= 10) break;
    if (!isVisible(el)) continue;
    const name = (el.getAttribute("class") || el.id || "").slice(0, 40);
    add(byKey("ads"), el, "element: " + name);
    adCount++;
  }

  // 3) Pre-ticked checkboxes with upsell-style labels
  const RISKY = /insur|protect|warranty|donat|newsletter|subscri|gift|add |offer|share|extra|premium/i;
  document.querySelectorAll('input[type="checkbox"]:checked').forEach((inp) => {
    const lab =
      inp.closest("label") ||
      (inp.id ? document.querySelector('label[for="' + CSS.escape(inp.id) + '"]') : null);
    let label =
      (lab ? lab.innerText : inp.parentElement ? inp.parentElement.innerText : "") ||
      inp.name || inp.value || "";
    label = label.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!label || !RISKY.test(label)) return;
    add(byKey("preselected"), lab || inp.parentElement || inp, label);
  });

  // 4) Weighted risk score
  const patterns = PATTERNS.map((p) => {
    const f = found[p.key];
    const points = Math.round((p.weight * Math.min(f.count, 3)) / 3);
    return {
      key: p.key, name: p.name, weight: p.weight, color: p.color,
      count: f.count, points, examples: f.examples
    };
  });
  const score = patterns.reduce((sum, p) => sum + p.points, 0);

  return { site: location.hostname, score, patterns };
}

// ===== Runs inside the page: removes the highlights =====
function clearHighlights() {
  document.querySelectorAll("[data-darkscan]").forEach((el) => {
    el.style.outline = "";
    el.style.outlineOffset = "";
    el.style.backgroundColor = "";
    el.removeAttribute("data-darkscan");
  });
}

// ===== Popup UI =====
const scanBtn = document.getElementById("scanBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const arc = document.getElementById("arc");
const scoreNum = document.getElementById("scoreNum");
const levelEl = document.getElementById("level");
const summaryEl = document.getElementById("summary");
const patternsEl = document.getElementById("patterns");
const CIRC = 339.292;

function make(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text; // textContent keeps page text safe
  return e;
}

function getLevel(score) {
  if (score < 20) return { text: "Low Risk", color: "#22c55e" };
  if (score < 45) return { text: "Moderate Risk", color: "#eab308" };
  if (score < 70) return { text: "High Risk", color: "#f97316" };
  return { text: "Very High Risk", color: "#ef4444" };
}

function render(r) {
  resultEl.hidden = false;
  const level = getLevel(r.score);

  arc.style.stroke = level.color;
  arc.style.strokeDashoffset = CIRC * (1 - r.score / 100);

  // count-up animation for the number
  let shown = 0;
  const step = Math.max(1, Math.round(r.score / 25));
  const timer = setInterval(() => {
    shown = Math.min(r.score, shown + step);
    scoreNum.textContent = shown;
    if (shown >= r.score) clearInterval(timer);
  }, 25);
  scoreNum.textContent = 0;

  levelEl.textContent = level.text;
  levelEl.style.color = level.color;

  const flagged = r.patterns.filter((p) => p.count > 0).length;
  const total = r.patterns.reduce((s, p) => s + p.count, 0);
  summaryEl.textContent =
    total + " indicator(s) in " + flagged + " of 5 patterns on " + r.site;

  patternsEl.textContent = "";
  r.patterns.forEach((p) => {
    const row = make("div", "row");
    const top = make("div", "row-top");
    const dot = make("span", "dot");
    dot.style.background = p.color;
    top.appendChild(dot);
    top.appendChild(make("span", "name", p.name));
    top.appendChild(make("span", "pts", p.points + " / " + p.weight));
    row.appendChild(top);

    const bar = make("div", "bar");
    const fill = make("div", "fill");
    fill.style.background = p.color;
    bar.appendChild(fill);
    row.appendChild(bar);
    setTimeout(() => (fill.style.width = (p.points / p.weight) * 100 + "%"), 50);

    const ex = make(
      "div", "ex",
      p.count > 0
        ? p.count + " found: " + p.examples.map((t) => "\u201C" + t + "\u201D").join(", ")
        : "Not detected"
    );
    row.appendChild(ex);
    patternsEl.appendChild(row);
  });
}

scanBtn.addEventListener("click", async () => {
  scanBtn.disabled = true;
  statusEl.textContent = "Scanning...";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scanPage
    });
    statusEl.textContent = "Flagged items are highlighted on the page.";
    render(result);
  } catch (err) {
    resultEl.hidden = true;
    statusEl.textContent =
      "Can't scan this page. Open a normal website tab (not a chrome:// page) and try again.";
  }
  scanBtn.disabled = false;
});

clearBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.scripting.executeScript({ target: { tabId: tab.id }, func: clearHighlights });
  statusEl.textContent = "Highlights cleared.";
});