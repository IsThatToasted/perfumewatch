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
  // 100 per page; if you exceed that, you can add pagination later
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

function sellerKeyFromIssue(issue){
  // Vote issues: use the issue title as the seller name (simple + consistent)
  return safeText(issue.title);
}

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
        <div class="muted small">Votes are public issues (anti-spam moderation is easy).</div>
      </div>
      <div class="badge">${row.count} vote${row.count === 1 ? "" : "s"}</div>
    `;
    els.topAuthenticList.appendChild(li);
  }
}

function renderFraudList(items){
  els.fraudList.innerHTML = "";

  if(items.length === 0){
    els.fraudList.innerHTML = `<li class="muted small">No approved reports yet.</li>`;
    return;
  }

  for(const it of items){
    const seller = safeText(it.title);
    const li = document.createElement("li");
    li.className = "listItem";
    li.innerHTML = `
      <div>
        <div><a href="${it.html_url}" target="_blank" rel="noreferrer">${seller}</a></div>
        <div class="muted small">Click to view the evidence + discussion (public).</div>
      </div>
      <div class="badge warn">Approved</div>
    `;
    els.fraudList.appendChild(li);
  }
}

function sellerSearchUrlForLabel(label, seller){
  // Link to GitHub issues filtered by label + seller text
  const base = `https://github.com/${cfg.repoOwner}/${cfg.repoName}/issues`;
  const q = encodeURIComponent(`is:issue is:open label:"${label}" ${seller}`);
  return `${base}?q=${q}`;
}

async function loadVotes(){
  const issues = await fetchJson(issuesListUrl(cfg.voteLabel));
  const agg = {};
  for(const issue of issues){
    const seller = sellerKeyFromIssue(issue);
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

async function loadApprovedFraud(){
  const issues = await fetchJson(issuesListUrl(cfg.fraudApprovedLabel));
  els.fraudCountPill.textContent = `${issues.length} approved`;
  renderFraudList(issues);
}

async function init(){
  // Wire up links to GitHub Issue Forms:
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