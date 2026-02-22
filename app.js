// app.js
const cfg = window.SITE_CONFIG;

const els = {
  voteLink: document.getElementById("voteLink"),
  reportLink: document.getElementById("reportLink"),
  topAuthenticList: document.getElementById("topAuthenticList"),
  fraudList: document.getElementById("fraudList"),
  voteCountPill: document.getElementById("voteCountPill"),
  fraudCountPill: document.getElementById("fraudCountPill"),
  status: document.getElementById("status"),

  // BANNED (from bannedsellers.txt)
  bannedList: document.getElementById("bannedList"),
  bannedCountPill: document.getElementById("bannedCountPill"),
};

function setStatus(msg){ els.status.textContent = msg; }

function repoBase(){
  return `https://api.github.com/repos/${cfg.repoOwner}/${cfg.repoName}`;
}

function issuesNewBase(){
  return `https://github.com/${cfg.repoOwner}/${cfg.repoName}/issues/new`;
}

function issuesListUrl(label){
  const q = new URLSearchParams({
    state: "open",
    labels: label,
    per_page: "100",
    sort: "created",
    direction: "desc"
  });
  return `${repoBase()}/issues?${q.toString()}`;
}

function safeText(s){ return (s || "").toString().trim(); }

/* ---------------------------
   API CACHING + RATE LIMIT HANDLING
----------------------------*/
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_PREFIX = "fi_cache_v1:";

function cacheKeyForUrl(url){
  return `${CACHE_PREFIX}${url}`;
}

function loadCache(url){
  try{
    const raw = localStorage.getItem(cacheKeyForUrl(url));
    if(!raw) return null;
    const obj = JSON.parse(raw);
    if(!obj || typeof obj !== "object") return null;
    return obj;
  }catch{
    return null;
  }
}

function saveCache(url, data){
  try{
    localStorage.setItem(cacheKeyForUrl(url), JSON.stringify({ t: Date.now(), data }));
  }catch{
    // ignore storage errors (private mode, quota, etc)
  }
}

function isFresh(cacheObj){
  return !!cacheObj && (Date.now() - cacheObj.t) < CACHE_TTL_MS;
}

function fmtResetTime(unixSecondsStr){
  const n = parseInt(unixSecondsStr || "", 10);
  if(!Number.isFinite(n)) return "";
  try{
    return new Date(n * 1000).toLocaleTimeString();
  }catch{
    return "";
  }
}

async function fetchJsonCached(url){
  const cached = loadCache(url);

  // If cache is fresh, use it without hitting GitHub at all
  if(isFresh(cached)){
    return { data: cached.data, fromCache: true, rateLimited: false };
  }

  const res = await fetch(url, { headers: { "Accept": "application/vnd.github+json" } });

  // Handle rate limiting / forbidden
  if(res.status === 403){
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    const isRateLimited = remaining === "0";

    if(cached?.data){
      const resetMsg = isRateLimited
        ? `Rate-limited by GitHub. Using cached data (resets ~${fmtResetTime(reset)}).`
        : `GitHub blocked request (403). Using cached data.`;
      setStatus(resetMsg);
      return { data: cached.data, fromCache: true, rateLimited: isRateLimited };
    }

    const txt = await res.text().catch(()=> "");
    throw new Error(`GitHub API 403${isRateLimited ? " (rate limited)" : ""}: ${txt || "Forbidden"}`);
  }

  if(!res.ok){
    const txt = await res.text().catch(()=> "");
    // If we have stale cache, use it instead of failing hard
    if(cached?.data){
      setStatus(`GitHub API error (${res.status}). Using cached data.`);
      return { data: cached.data, fromCache: true, rateLimited: false };
    }
    throw new Error(`GitHub API error ${res.status}: ${txt || res.statusText}`);
  }

  const data = await res.json();
  saveCache(url, data);
  return { data, fromCache: false, rateLimited: false };
}

/**
 * Extract a field value from GitHub Issue Form body.
 * Issue forms typically render like:
 * "### Reported seller Whatnot username (exact)\n\nsellername"
 */
function extractFieldFromBody(body, headingText){
  const b = safeText(body);
  if(!b) return "";
  const pattern = new RegExp(`###\\s+${escapeRegExp(headingText)}\\s*\\n+([\\s\\S]*?)(\\n###\\s+|$)`, "i");
  const m = b.match(pattern);
  if(!m) return "";
  return safeText(m[1]).split("\n").map(x => x.trim()).filter(Boolean).join(" ");
}

function escapeRegExp(str){
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a classic prefilled GitHub issue URL.
 * This is the ONLY GitHub-native way to autofill from buttons.
 */
function buildPrefilledIssueUrl({ title, labels, bodyLines }){
  const base = issuesNewBase();
  const params = new URLSearchParams({
    title: title || "",
    labels: Array.isArray(labels) ? labels.join(",") : (labels || ""),
    body: (bodyLines || []).join("\n"),
  });
  return `${base}?${params.toString()}`;
}

function buildPrefilledVoteUrl(){
  const voteLabelForNewIssues = cfg.voteLabel || "vote-authentic";

  return buildPrefilledIssueUrl({
    title: "Vote – Authentic Seller",
    labels: [voteLabelForNewIssues],
    bodyLines: [
      "### Whatnot seller username (exact)",
      "<paste seller username here>",
      "",
      "### Seller profile link (optional)",
      "<paste Whatnot profile link here>",
      "",
      "### Why do you believe they’re authentic?",
      "<sealed product / receipts shown / consistent batches / reputation / etc.>",
      "",
      "_Submitted via Fragrance Integrity_",
    ],
  });
}

function buildPrefilledFraudUrl(){
  const fraudLabelForNewIssues = cfg.fraudReportLabel || "fraud-report";

  return buildPrefilledIssueUrl({
    title: "Fraud Report – Suspected Seller",
    labels: [fraudLabelForNewIssues],
    bodyLines: [
      "### Your name",
      "<your name>",
      "",
      "### Your Whatnot username",
      "<your Whatnot username>",
      "",
      "### Your email (for follow-up)",
      "<your email>",
      "",
      "### Reported seller Whatnot username (exact)",
      "<paste seller username here>",
      "",
      "### Seller profile link (recommended)",
      "<paste Whatnot profile link here>",
      "",
      "### Complaint / what happened",
      "<order date, item, price, what was wrong (counterfeit/missing/misrepresented), etc.>",
      "",
      "### Proof photos / evidence links",
      "- <link 1>",
      "- <link 2>",
      "",
      "_After submitting, you can drag & drop photos into the issue comments to upload them._",
      "",
      "_Submitted via Fragrance Integrity_",
    ],
  });
}

/**
 * For votes: seller key comes from the issue body field if present.
 */
function sellerKeyFromVoteIssue(issue){
  const body = safeText(issue.body);
  const fromBody = extractFieldFromBody(body, "Whatnot seller username (exact)");
  if(fromBody) return fromBody;
  return safeText(issue.title);
}

/**
 * For fraud: use the seller username field from the issue body.
 */
function sellerKeyFromFraudIssue(issue){
  const body = safeText(issue.body);

  const fromBody = extractFieldFromBody(body, "Reported seller Whatnot username (exact)");
  if(fromBody) return fromBody;

  const t = safeText(issue.title);
  if(!t) return "";
  const first = t.split(" - ")[0].trim();
  return first || t;
}

function sellerSearchUrlForLabel(label, seller){
  const base = `https://github.com/${cfg.repoOwner}/${cfg.repoName}/issues`;
  const q = encodeURIComponent(`is:issue is:open label:"${label}" ${seller}`);
  return `${base}?q=${q}`;
}

/* ---------------------------
   BANNED SELLERS (from bannedsellers.txt)
   Format per line:
   seller
   seller | reason
   seller | reason | link
   Lines starting with # are comments.
----------------------------*/
function parseBannedSellers(text){
  const lines = (text || "").split(/\r?\n/);
  const items = [];

  for(const raw of lines){
    const line = raw.trim();
    if(!line || line.startsWith("#")) continue;

    const parts = line.split("|").map(p => p.trim());
    const seller = (parts[0] || "").trim();
    const reason = (parts[1] || "").trim();
    const link = (parts[2] || "").trim();

    if(!seller) continue;
    items.push({ seller, reason, link });
  }

  // sort alphabetically (optional)
  items.sort((a,b) => a.seller.localeCompare(b.seller));
  return items;
}

function renderBanned(items){
  if(!els.bannedList || !els.bannedCountPill) return;

  els.bannedList.innerHTML = "";

  if(!items.length){
    els.bannedCountPill.textContent = "0";
    els.bannedList.innerHTML = `<li class="muted small">No banned sellers listed.</li>`;
    return;
  }

  els.bannedCountPill.textContent = `${items.length}`;

  for(const it of items){
    const li = document.createElement("li");
    li.className = "listItem";

    const nameHtml = it.link
      ? `<a href="${it.link}" target="_blank" rel="noreferrer">${it.seller}</a>`
      : `<div>${it.seller}</div>`;

    const reasonHtml = it.reason
      ? `<div class="muted small">${it.reason}</div>`
      : `<div class="muted small">Confirmed fraudulent. Do not purchase.</div>`;

    li.innerHTML = `
      <div>
        ${nameHtml}
        ${reasonHtml}
      </div>
      <div class="badge warn">BANNED</div>
    `;
    els.bannedList.appendChild(li);
  }
}

async function loadBannedFromFile(){
  // If you haven't added the HTML section yet, just skip gracefully.
  if(!els.bannedList || !els.bannedCountPill) return;

  try{
    // Fetch from repo root. We add a small cache-bust so updates propagate.
    // You can remove ?v=... if you'd rather rely on normal caching.
    const res = await fetch(`bannedsellers.txt?v=${Date.now()}`, { cache: "no-store" });
    if(!res.ok) throw new Error(`bannedsellers.txt not found (${res.status})`);
    const text = await res.text();
    const items = parseBannedSellers(text);
    renderBanned(items);
  }catch(err){
    console.error(err);
    els.bannedCountPill.textContent = "—";
    els.bannedList.innerHTML = `<li class="muted small">Could not load <code>bannedsellers.txt</code>.</li>`;
  }
}

/* ---------------------------
   AUTHENTIC (VOTES)
----------------------------*/
function renderTopAuthentic(agg){
  els.topAuthenticList.innerHTML = "";

  const entries = Object.entries(agg)
    .map(([seller, meta]) => ({ seller, ...meta }))
    .sort((a,b) => b.count - a.count || a.seller.localeCompare(b.seller))
    .slice(0, 10);

  if(entries.length === 0){
    els.topAuthenticList.innerHTML = `<li class="muted small">No votes yet. Be the first to vote.</li>`;
    return;
  }

  for(const row of entries){
    const li = document.createElement("li");
    li.className = "listItem";
    li.innerHTML = `
      <div>
        <div>
          <a href="${row.latestIssueUrl}" target="_blank" rel="noreferrer">${row.seller}</a>
        </div>
        <div class="muted small">
          Votes are public issues (easy to moderate).
          <a href="${row.allUrl}" target="_blank" rel="noreferrer"
             style="color:var(--muted); text-decoration:underline;">
            View all
          </a>
        </div>
      </div>
      <div class="badge">${row.count} vote${row.count === 1 ? "" : "s"}</div>
    `;
    els.topAuthenticList.appendChild(li);
  }
}

async function loadVotes(){
  const url = issuesListUrl(cfg.voteLabel);
  const { data: issues, fromCache } = await fetchJsonCached(url);

  const agg = {};
  for(const issue of issues){
    const seller = sellerKeyFromVoteIssue(issue);
    if(!seller) continue;

    if(!agg[seller]){
      agg[seller] = {
        count: 0,
        latestIssueUrl: issue.html_url,
        allUrl: sellerSearchUrlForLabel(cfg.voteLabel, seller),
      };
    }
    agg[seller].count += 1;
  }

  els.voteCountPill.textContent = `${issues.length} vote${issues.length === 1 ? "" : "s"}`;
  renderTopAuthentic(agg);

  if(fromCache) setStatus("Loaded (cached).");
}

/* ---------------------------
   FRAUD (APPROVED REPORTS)
----------------------------*/
function renderFraudList(agg){
  els.fraudList.innerHTML = "";

  const entries = Object.entries(agg)
    .map(([seller, meta]) => ({ seller, ...meta }))
    .sort((a,b) => b.count - a.count || a.seller.localeCompare(b.seller));

  if(entries.length === 0){
    els.fraudList.innerHTML = `<li class="muted small">No approved reports yet.</li>`;
    return;
  }

  for(const row of entries){
    const li = document.createElement("li");
    li.className = "listItem";
    li.innerHTML = `
      <div>
        <div>
          <a href="${row.latestIssueUrl}" target="_blank" rel="noreferrer">${row.seller}</a>
        </div>
        <div class="muted small">
          Approved evidence-backed reports.
          <a href="${row.allUrl}" target="_blank" rel="noreferrer"
             style="color:var(--muted); text-decoration:underline;">
            View all
          </a>
        </div>
      </div>
      <div class="badge warn">${row.count} report${row.count === 1 ? "" : "s"}</div>
    `;
    els.fraudList.appendChild(li);
  }
}

async function loadApprovedFraud(){
  const url = issuesListUrl(cfg.fraudApprovedLabel);
  const { data: issues, fromCache } = await fetchJsonCached(url);

  const agg = {};
  for(const issue of issues){
    const seller = sellerKeyFromFraudIssue(issue);
    if(!seller) continue;

    if(!agg[seller]){
      agg[seller] = {
        count: 0,
        latestIssueUrl: issue.html_url,
        allUrl: sellerSearchUrlForLabel(cfg.fraudApprovedLabel, seller),
      };
    }
    agg[seller].count += 1;
  }

  els.fraudCountPill.textContent = `${issues.length} approved`;
  renderFraudList(agg);

  if(fromCache) setStatus("Loaded (cached).");
}

/* ---------------------------
   INIT
----------------------------*/
async function init(){
  // Buttons open PREFILLED classic issue editor
  els.voteLink.href = buildPrefilledVoteUrl();
  els.reportLink.href = buildPrefilledFraudUrl();

  setStatus("Loading lists from GitHub…");

  try{
    // Load banned list from file + the two GitHub API lists
    await Promise.all([loadVotes(), loadApprovedFraud(), loadBannedFromFile()]);

    // If nothing overwrote status (like cache/rate-limit message), set to Loaded.
    if(els.status.textContent === "Loading lists from GitHub…") setStatus("Loaded.");
  }catch(err){
    console.error(err);
    // Don’t nuke UI if cache already filled things; just show helpful message.
    setStatus("Temporarily rate-limited by GitHub. Try again in a bit.");
    if (els.voteCountPill.textContent === "Loading…") els.voteCountPill.textContent = "—";
    if (els.fraudCountPill.textContent === "Loading…") els.fraudCountPill.textContent = "—";
    // banned list is independent (static file), so no need to change it here
  }
}

init();
