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
};

function setStatus(msg){ els.status.textContent = msg; }

function repoBase(){
  return `https://api.github.com/repos/${cfg.repoOwner}/${cfg.repoName}`;
}

function issueNewUrl(template){
  return `https://github.com/${cfg.repoOwner}/${cfg.repoName}/issues/new?template=${encodeURIComponent(template)}`;
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

async function fetchJson(url){
  const res = await fetch(url, {
    headers: { "Accept": "application/vnd.github+json" }
  });
  if(!res.ok){
    const txt = await res.text().catch(()=> "");
    throw new Error(`GitHub API error ${res.status}: ${txt || res.statusText}`);
  }
  return res.json();
}

function safeText(s){ return (s || "").toString().trim(); }

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
  // Clean: remove extra newlines/markdown artifacts
  return safeText(m[1]).split("\n").map(x => x.trim()).filter(Boolean).join(" ");
}

function escapeRegExp(str){
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * For votes: seller key comes from issue title (your vote template sets title to seller name)
 */
function sellerKeyFromVoteIssue(issue){
  return safeText(issue.title);
}

/**
 * For fraud: use the actual seller username field from the issue form body.
 * Fallback: attempt to parse from title (before first dash).
 */
function sellerKeyFromFraudIssue(issue){
  const body = safeText(issue.body);

  // This MUST match the label text you used in report_fraud.yml
  const fromBody = extractFieldFromBody(body, "Reported seller Whatnot username (exact)");
  if(fromBody) return fromBody;

  // Fallback: parse first chunk of title
  // Example: "Citimall - Known Fraudulent Seller - Whatnot" => "Citimall"
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
        <div><a href="${row.searchUrl}" target="_blank" rel="noreferrer">${row.seller}</a></div>
        <div class="muted small">Votes are public issues (easy to moderate).</div>
      </div>
      <div class="badge">${row.count} vote${row.count === 1 ? "" : "s"}</div>
    `;
    els.topAuthenticList.appendChild(li);
  }
}

async function loadVotes(){
  const issues = await fetchJson(issuesListUrl(cfg.voteLabel));
  const agg = {};

  for(const issue of issues){
    const seller = sellerKeyFromVoteIssue(issue);
    if(!seller) continue;

    if(!agg[seller]){
      agg[seller] = {
        count: 0,
        searchUrl: sellerSearchUrlForLabel(cfg.voteLabel, seller),
      };
    }
    agg[seller].count += 1;
  }

  const totalVotes = issues.length;
  els.voteCountPill.textContent = `${totalVotes} vote${totalVotes === 1 ? "" : "s"}`;
  renderTopAuthentic(agg);
}

/* ---------------------------
   FRAUD (APPROVED REPORTS)
   Aggregated + links to latest issue
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
  const issues = await fetchJson(issuesListUrl(cfg.fraudApprovedLabel));

  // Aggregate by seller username (from body field)
  const agg = {};
  for(const issue of issues){
    const seller = sellerKeyFromFraudIssue(issue);
    if(!seller) continue;

    if(!agg[seller]){
      agg[seller] = {
        count: 0,
        latestIssueUrl: issue.html_url, // newest first due to API sort
        allUrl: sellerSearchUrlForLabel(cfg.fraudApprovedLabel, seller),
      };
    }

    agg[seller].count += 1;
  }

  els.fraudCountPill.textContent = `${issues.length} approved`;
  renderFraudList(agg);
}

/* ---------------------------
   INIT
----------------------------*/
async function init(){
  els.voteLink.href = issueNewUrl("vote_authentic.yml");
  els.reportLink.href = issueNewUrl("report_fraud.yml");

  setStatus("Loading lists from GitHub…");

  try{
    await Promise.all([loadVotes(), loadApprovedFraud()]);
    setStatus("Loaded.");
  }catch(err){
    console.error(err);
    setStatus("Error loading from GitHub API. Check your repo config + labels.");
    els.voteCountPill.textContent = "Error";
    els.fraudCountPill.textContent = "Error";
  }
}

init();
