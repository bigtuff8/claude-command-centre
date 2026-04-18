// ============================================================================
// Command Centre — Portfolio Dashboard JavaScript
// Fetches data from /api/portfolio/* endpoints and populates the portfolio HTML.
// ============================================================================

// === STATE ===
let portfolioData = {
  projects: [],
  risks: [],
  activity: [],
  audit: [],
  gates: [],
  health: { score: 0, lastSync: null }
};
let activeTab = 'portfolio';
let activeFilters = { scope: 'all', view: 'board' };
let activeRiskFilters = { status: 'all', project: 'all' };
let activeActivityFilters = { date: 'week', project: 'all', type: 'all' };
let selectedProjectId = null;
let permissionTimerInterval = null;

// === SOCKET.IO ===
const socket = io();

socket.on('portfolio:update', function (data) {
  try {
    if (data) {
      if (data.projects || data.portfolioProjects) {
        portfolioData.projects = data.projects || data.portfolioProjects || [];
      }
      if (data.risks || data.portfolioRisks) {
        portfolioData.risks = data.risks || data.portfolioRisks || [];
      }
      if (data.activity || data.portfolioActivity) {
        portfolioData.activity = data.activity || data.portfolioActivity || [];
      }
      if (data.audit || data.portfolioAudit) {
        portfolioData.audit = data.audit || data.portfolioAudit || [];
      }
    }
    renderAll();
    showToast('Portfolio data updated');
  } catch (err) {
    console.error('[Portfolio] Error handling socket update:', err);
  }
});

socket.on('permission-request', function (data) {
  try {
    showPermissionBar(data);
  } catch (err) {
    console.error('[Portfolio] Error showing permission bar:', err);
  }
});

socket.on('permission-resolved', function () {
  try {
    hidePermissionBar();
  } catch (err) {
    console.error('[Portfolio] Error hiding permission bar:', err);
  }
});

// === HELPERS ===
function safeArray(json, ...keys) {
  if (Array.isArray(json)) return json;
  for (const k of keys) {
    if (json && Array.isArray(json[k])) return json[k];
  }
  if (json && typeof json === 'object' && !Array.isArray(json)) return [json];
  return [];
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}

function formatDate(iso) {
  if (!iso) return '--';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

function formatDateShort(iso) {
  if (!iso) return '--';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  } catch { return iso; }
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function daysBetween(iso1, iso2) {
  if (!iso1 || !iso2) return null;
  try {
    const d1 = new Date(iso1);
    const d2 = new Date(iso2);
    return Math.floor((d2 - d1) / 86400000);
  } catch { return null; }
}

function daysAgo(iso) {
  if (!iso) return null;
  return daysBetween(iso, new Date().toISOString());
}

function getDecayClass(days) {
  if (days === null || days === undefined) return '';
  if (days <= 3) return '';
  if (days <= 7) return 'decay-1';
  if (days <= 14) return 'decay-2';
  if (days <= 21) return 'decay-3';
  if (days <= 30) return 'decay-4';
  return 'decay-5';
}

function stalenessColor(staleness) {
  if (staleness === 'stale') return 'var(--amber)';
  if (staleness === 'very-stale') return 'var(--rose)';
  if (staleness === 'aging') return 'var(--amber)';
  return 'var(--green)';
}

function statusColor(status) {
  if (!status) return 'var(--text-muted)';
  const s = status.toLowerCase();
  if (s === 'active') return 'var(--green)';
  if (s === 'planning') return 'var(--blue)';
  if (s === 'blocked') return 'var(--rose)';
  if (s === 'paused') return 'var(--amber)';
  if (s.includes('archived') || s === 'complete') return 'var(--text-muted)';
  return 'var(--text-secondary)';
}

function severityColor(severity) {
  if (!severity) return 'var(--text-muted)';
  const s = severity.toLowerCase();
  if (s === 'critical') return 'var(--rose)';
  if (s === 'high') return 'var(--amber)';
  if (s === 'medium') return 'var(--blue)';
  return 'var(--text-muted)';
}

function perspectiveColor(perspective) {
  if (!perspective) return 'var(--text-muted)';
  const p = perspective.toLowerCase();
  if (p === 'security') return 'var(--rose)';
  if (p === 'compliance') return 'var(--amber)';
  if (p === 'technical') return 'var(--text-muted)';
  if (p === 'finance') return 'var(--blue)';
  if (p === 'transition') return 'var(--green)';
  if (p === 'product') return 'var(--blue)';
  return 'var(--text-muted)';
}

function riskStatusColor(status) {
  if (!status) return 'var(--text-muted)';
  const s = status.toLowerCase();
  if (s === 'open') return 'var(--rose)';
  if (s === 'accepted') return 'var(--amber)';
  if (s === 'mitigated') return 'var(--green)';
  return 'var(--text-muted)';
}

function el(id) {
  return document.getElementById(id);
}

// === INIT ===
async function init() {
  await fetchAllData();
  renderAll();
  setupEventListeners();
}

function renderAll() {
  try { renderMetrics(); } catch (e) { console.error('[Portfolio] renderMetrics error:', e); }
  try { renderPortfolioTab(); } catch (e) { console.error('[Portfolio] renderPortfolioTab error:', e); }
  try { renderRisksTab(); } catch (e) { console.error('[Portfolio] renderRisksTab error:', e); }
  try { renderActivityTab(); } catch (e) { console.error('[Portfolio] renderActivityTab error:', e); }
  try { renderAuditTab(); } catch (e) { console.error('[Portfolio] renderAuditTab error:', e); }
}

// === DATA FETCHING ===
async function fetchAllData() {
  try {
    const [projectsRes, gatesRes, risksRes, activityRes, auditRes, healthRes] = await Promise.all([
      fetch('/api/portfolio/projects').then(r => r.ok ? r.json() : []),
      fetch('/api/portfolio/gates').then(r => r.ok ? r.json() : []),
      fetch('/api/portfolio/risks').then(r => r.ok ? r.json() : []),
      fetch('/api/portfolio/activity?limit=200').then(r => r.ok ? r.json() : []),
      fetch('/api/portfolio/audit').then(r => r.ok ? r.json() : []),
      fetch('/api/portfolio/health').then(r => r.ok ? r.json() : { score: 0, lastSync: null })
    ]);

    portfolioData.projects = safeArray(projectsRes, 'projects', 'portfolioProjects');
    portfolioData.gates = safeArray(gatesRes, 'projects', 'portfolioProjects');
    portfolioData.risks = safeArray(risksRes, 'risks', 'portfolioRisks');
    portfolioData.activity = safeArray(activityRes, 'activity', 'portfolioActivity');
    portfolioData.audit = safeArray(auditRes, 'audit', 'portfolioAudit');
    portfolioData.health = healthRes && typeof healthRes === 'object' && !Array.isArray(healthRes)
      ? healthRes
      : { score: 0, lastSync: null };
  } catch (err) {
    console.error('[Portfolio] Error fetching data:', err);
    showToast('Failed to load portfolio data');
  }
}

// === METRICS BAR ===
function renderMetrics() {
  const projects = portfolioData.projects;
  const total = projects.length;
  const active = projects.filter(p => p.portfolioProjectStatus && p.portfolioProjectStatus.toLowerCase() === 'active').length;
  const stale = projects.filter(p => p.portfolioProjectStaleness === 'stale' || p.portfolioProjectStaleness === 'very-stale').length;
  const atGate = projects.filter(p => p.portfolioProjectGateType).length;
  const openRisks = portfolioData.risks.filter(r => r.riskStatus && r.riskStatus.toLowerCase() === 'open').length;

  const metricProjects = el('metricProjects');
  const metricActive = el('metricActive');
  const metricStale = el('metricStale');
  const metricAtGate = el('metricAtGate');
  const metricRisks = el('metricRisks');

  if (metricProjects) metricProjects.textContent = total;
  if (metricActive) metricActive.textContent = active;
  if (metricStale) metricStale.textContent = stale;
  if (metricAtGate) metricAtGate.textContent = atGate;
  if (metricRisks) metricRisks.textContent = openRisks;
}

// === PORTFOLIO TAB ===
function renderPortfolioTab() {
  renderGateQueue();
  renderPortfolioOverview();
  renderStaleProjects();
  renderRiskSummary();
  renderProjectCards();
  renderDictAudit();
  renderRecentActivity();
  renderQuickStats();
  renderListView();
}

// --- Gate Queue ---
function renderGateQueue() {
  const container = el('gateQueueItems');
  if (!container) return;

  const gates = portfolioData.projects.filter(p => p.portfolioProjectGateType);

  if (gates.length === 0) {
    container.innerHTML = '<div style="color:var(--green);font-size:14px;padding:12px 0;">All Clear &#10003; &mdash; No projects awaiting gate review</div>';
    return;
  }

  let html = '';
  for (const p of gates) {
    const daysWaiting = daysAgo(p.portfolioProjectGateDate);
    const daysStr = daysWaiting !== null ? daysWaiting + 'd waiting' : '';
    const reviewBtn = p.portfolioProjectHasReviewHtml
      ? `<button class="btn btn-sm" onclick="openReview('${escapeHtml(p.portfolioProjectReviewHtmlPath || '')}')">Open Review</button>`
      : '';
    html += `
      <div class="gate-item" style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-subtle);">
        <div>
          <div style="font-size:14px;font-weight:600;color:var(--text-primary);">${escapeHtml(p.portfolioProjectName)}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:2px;">
            <span class="pill-badge" style="background:rgba(245,158,11,0.15);color:var(--amber);font-size:11px;padding:2px 8px;border-radius:99px;">${escapeHtml(p.portfolioProjectGateType)}</span>
            <span style="font-size:12px;color:var(--text-muted);">${formatDate(p.portfolioProjectGateDate)}</span>
            ${daysStr ? `<span style="font-size:12px;color:var(--amber);">${daysStr}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          ${reviewBtn}
          <button class="btn btn-sm btn-primary" onclick="launchSession('${escapeHtml(p.portfolioProjectPath || '')}')">Launch Session</button>
        </div>
      </div>`;
  }
  container.innerHTML = html;
}

// --- Portfolio Overview ---
function renderPortfolioOverview() {
  const container = el('portfolioMetrics');
  if (!container) return;

  const projects = portfolioData.projects;
  const total = projects.length;
  const active = projects.filter(p => p.portfolioProjectStatus && p.portfolioProjectStatus.toLowerCase() === 'active').length;
  const stale = projects.filter(p => p.portfolioProjectStaleness === 'stale' || p.portfolioProjectStaleness === 'very-stale').length;
  const atGate = projects.filter(p => p.portfolioProjectGateType).length;
  const openRisks = projects.reduce((sum, p) => sum + (p.portfolioProjectRiskCount || 0), 0);
  const archived = projects.filter(p => p.portfolioProjectStatus && p.portfolioProjectStatus.toLowerCase().includes('archived')).length;

  const metrics = [
    { label: 'Total', value: total, color: 'var(--text-secondary)' },
    { label: 'Active', value: active, color: 'var(--green)' },
    { label: 'Stale', value: stale, color: 'var(--amber)' },
    { label: 'At Gate', value: atGate, color: 'var(--blue)' },
    { label: 'Open Risks', value: openRisks, color: 'var(--rose)' },
    { label: 'Archived', value: archived, color: 'var(--text-muted)' }
  ];

  container.innerHTML = metrics.map(m => `
    <div class="portfolio-metric-box">
      <div style="font-size:24px;font-weight:700;color:${m.color};font-family:'JetBrains Mono',monospace;">${m.value}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${m.label}</div>
    </div>`).join('');
}

// --- Stale Projects ---
function renderStaleProjects() {
  const container = el('staleProjectItems');
  const countEl = el('staleCount');
  if (!container) return;

  const stale = portfolioData.projects.filter(p =>
    p.portfolioProjectStaleness === 'stale' || p.portfolioProjectStaleness === 'very-stale'
  );

  if (countEl) countEl.textContent = stale.length || '';

  if (stale.length === 0) {
    container.innerHTML = '<div style="color:var(--green);font-size:13px;padding:8px 0;">All projects are fresh</div>';
    return;
  }

  let html = '';
  for (const p of stale) {
    const days = p.portfolioProjectDaysSinceActive;
    const badgeColor = p.portfolioProjectStaleness === 'very-stale' ? 'var(--rose)' : 'var(--amber)';
    const badgeBg = p.portfolioProjectStaleness === 'very-stale' ? 'rgba(244,63,94,0.15)' : 'rgba(245,158,11,0.15)';
    html += `
      <div class="stale-item" style="padding:8px 0;border-bottom:1px solid var(--border-subtle);cursor:pointer;" onclick="openDetailPanel('${escapeHtml(p.portfolioProjectId)}')">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div>
            <span style="font-size:13px;font-weight:600;color:var(--text-primary);">${escapeHtml(p.portfolioProjectName)}</span>
            <span class="pill-badge" style="background:${escapeHtml(statusColor(p.portfolioProjectStatus)).replace(/var\(--/g,'rgba(').replace(/\)/g,',0.15)')};color:${statusColor(p.portfolioProjectStatus)};font-size:10px;padding:1px 6px;border-radius:99px;margin-left:6px;">${escapeHtml(p.portfolioProjectStatus)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="pill-badge" style="background:${badgeBg};color:${badgeColor};font-size:11px;padding:2px 8px;border-radius:99px;">${days !== null ? days + 'd' : '?'}</span>
            <button class="btn btn-sm btn-primary" onclick="event.stopPropagation();launchSession('${escapeHtml(p.portfolioProjectPath || '')}')">Launch</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
          <span style="font-size:11px;color:var(--text-muted);">Last active: ${formatDate(p.portfolioProjectLastActive)}</span>
          ${renderHeatTrail(p)}
        </div>
      </div>`;
  }
  container.innerHTML = html;
}

// --- Risk Summary ---
function renderRiskSummary() {
  const container = el('riskSummaryItems');
  const countEl = el('riskSummaryCount');
  if (!container) return;

  const risks = portfolioData.risks.slice(0, 5);
  if (countEl) countEl.textContent = portfolioData.risks.length || '';

  if (risks.length === 0) {
    container.innerHTML = '<div style="color:var(--green);font-size:13px;padding:8px 0;">No risks registered</div>';
    return;
  }

  let html = `<table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead><tr style="color:var(--text-muted);text-align:left;">
      <th style="padding:4px 6px;">ID</th>
      <th style="padding:4px 6px;">Project</th>
      <th style="padding:4px 6px;">Severity</th>
      <th style="padding:4px 6px;">Status</th>
      <th style="padding:4px 6px;">Description</th>
    </tr></thead><tbody>`;

  for (const r of risks) {
    html += `<tr style="border-top:1px solid var(--border-subtle);">
      <td style="padding:6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text-muted);">${escapeHtml(r.riskId)}</td>
      <td style="padding:6px;color:var(--text-secondary);">${escapeHtml(r.riskProject)}</td>
      <td style="padding:6px;">
        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${perspectiveColor(r.riskPerspective)};margin-right:4px;"></span>
        <span class="pill-badge" style="background:rgba(0,0,0,0.3);color:${severityColor(r.riskSeverity)};font-size:10px;padding:1px 6px;border-radius:99px;">${escapeHtml(r.riskSeverity)}</span>
      </td>
      <td style="padding:6px;">
        <span class="pill-badge" style="border:1px solid ${riskStatusColor(r.riskStatus)};color:${riskStatusColor(r.riskStatus)};font-size:10px;padding:1px 6px;border-radius:99px;background:transparent;">${escapeHtml(r.riskStatus)}</span>
      </td>
      <td style="padding:6px;color:var(--text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(truncate(r.riskDescription, 60))}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

// --- Project Cards ---
function renderProjectCards() {
  const grid = el('projectsGrid');
  const countEl = el('projectsCount');
  if (!grid) return;

  let projects = portfolioData.projects.filter(p =>
    !p.portfolioProjectStatus || !p.portfolioProjectStatus.toLowerCase().includes('archived')
  );

  // Apply filters
  if (activeFilters.scope === 'work') {
    projects = projects.filter(p => p.portfolioProjectScope === 'work');
  } else if (activeFilters.scope === 'personal') {
    projects = projects.filter(p => p.portfolioProjectScope === 'personal');
  } else if (activeFilters.scope === 'stale') {
    projects = projects.filter(p => p.portfolioProjectStaleness === 'stale' || p.portfolioProjectStaleness === 'very-stale');
  } else if (activeFilters.scope === 'gate') {
    projects = projects.filter(p => p.portfolioProjectGateType);
  }

  if (countEl) countEl.textContent = projects.length;

  // Update filter hint
  const hint = el('portfolioFilterHint');
  if (hint) {
    if (activeFilters.scope !== 'all') {
      hint.textContent = projects.length + ' project' + (projects.length !== 1 ? 's' : '') + ' shown';
    } else {
      hint.textContent = '';
    }
  }

  if (projects.length === 0) {
    grid.innerHTML = '<div style="color:var(--text-muted);padding:20px;text-align:center;">No projects match the current filter</div>';
    return;
  }

  let html = '';
  for (const p of projects) {
    const decay = getDecayClass(p.portfolioProjectDaysSinceActive);
    const stalenessDot = p.portfolioProjectStaleness
      ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${stalenessColor(p.portfolioProjectStaleness)};"></span>`
      : '';

    const featureBar = (p.portfolioProjectFeaturesTotal && p.portfolioProjectFeaturesTotal > 0)
      ? `<div style="margin-top:6px;">
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-bottom:2px;">
            <span>Features</span>
            <span>${p.portfolioProjectFeaturesDone || 0}/${p.portfolioProjectFeaturesTotal}</span>
          </div>
          <div style="height:3px;background:var(--bg-card-hover);border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${Math.round(((p.portfolioProjectFeaturesDone || 0) / p.portfolioProjectFeaturesTotal) * 100)}%;background:var(--green);border-radius:2px;"></div>
          </div>
        </div>`
      : '';

    html += `
      <div class="glass project-card ${decay}" onclick="openDetailPanel('${escapeHtml(p.portfolioProjectId)}')" style="cursor:pointer;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:13px;font-weight:600;color:var(--text-primary);">${escapeHtml(p.portfolioProjectName)}</span>
            <span class="pill-badge" style="font-size:10px;padding:1px 6px;border-radius:99px;color:${statusColor(p.portfolioProjectStatus)};border:1px solid ${statusColor(p.portfolioProjectStatus)};background:transparent;">${escapeHtml(p.portfolioProjectStatus || 'Unknown')}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="font-size:10px;padding:1px 6px;border-radius:99px;background:var(--bg-card-hover);color:var(--text-muted);">${escapeHtml(p.portfolioProjectScope || '')}</span>
          ${stalenessDot}
          ${p.portfolioProjectGateType ? `<span style="font-size:10px;padding:1px 6px;border-radius:99px;background:rgba(245,158,11,0.15);color:var(--amber);">Gate</span>` : ''}
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;line-height:1.4;">${escapeHtml(truncate(p.portfolioProjectQuickContext, 80))}</div>
        ${featureBar}
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;">
          ${renderHeatTrail(p)}
          <span style="font-size:10px;color:var(--text-muted);white-space:nowrap;margin-left:6px;">${formatDateShort(p.portfolioProjectLastActive)}</span>
        </div>
        <div style="margin-top:8px;text-align:right;">
          <button class="btn btn-sm btn-primary" onclick="event.stopPropagation();launchSession('${escapeHtml(p.portfolioProjectPath || '')}')">Launch Session</button>
        </div>
      </div>`;
  }
  grid.innerHTML = html;
}

// --- List View ---
function renderListView() {
  const tbody = el('tableBody');
  if (!tbody) return;

  const projects = portfolioData.projects;
  const gateProjects = projects.filter(p => p.portfolioProjectGateType);
  const workProjects = projects.filter(p => p.portfolioProjectScope === 'work' && !p.portfolioProjectGateType && !(p.portfolioProjectStatus && p.portfolioProjectStatus.toLowerCase().includes('archived')));
  const personalProjects = projects.filter(p => p.portfolioProjectScope === 'personal' && !p.portfolioProjectGateType && !(p.portfolioProjectStatus && p.portfolioProjectStatus.toLowerCase().includes('archived')));
  const archivedProjects = projects.filter(p => p.portfolioProjectStatus && p.portfolioProjectStatus.toLowerCase().includes('archived'));

  const sections = [
    { label: 'Gate Queue', items: gateProjects, color: 'var(--amber)' },
    { label: 'Work', items: workProjects, color: 'var(--blue)' },
    { label: 'Personal', items: personalProjects, color: 'var(--green)' },
    { label: 'Archived', items: archivedProjects, color: 'var(--text-muted)' }
  ];

  let html = '';
  for (const section of sections) {
    if (section.items.length === 0) continue;
    html += `<tr class="section-header" onclick="this.classList.toggle('collapsed');let s=this.nextElementSibling;while(s&&!s.classList.contains('section-header')){s.style.display=s.style.display==='none'?'':'none';s=s.nextElementSibling;}">
      <td colspan="10" style="padding:10px 12px;font-weight:600;font-size:12px;color:${section.color};background:var(--bg-card);cursor:pointer;user-select:none;">
        <span style="margin-right:6px;">&#9654;</span> ${section.label} <span style="color:var(--text-muted);font-weight:400;">(${section.items.length})</span>
      </td>
    </tr>`;

    for (const p of section.items) {
      const days = p.portfolioProjectDaysSinceActive;
      const ageColor = days === null ? 'var(--text-muted)' : days <= 7 ? 'var(--green)' : days <= 21 ? 'var(--amber)' : 'var(--rose)';
      const featureProg = (p.portfolioProjectFeaturesTotal && p.portfolioProjectFeaturesTotal > 0)
        ? `<div style="display:flex;align-items:center;gap:4px;">
            <div style="width:40px;height:3px;background:var(--bg-card-hover);border-radius:2px;overflow:hidden;">
              <div style="height:100%;width:${Math.round(((p.portfolioProjectFeaturesDone || 0) / p.portfolioProjectFeaturesTotal) * 100)}%;background:var(--green);border-radius:2px;"></div>
            </div>
            <span style="font-size:10px;">${p.portfolioProjectFeaturesDone || 0}/${p.portfolioProjectFeaturesTotal}</span>
          </div>`
        : '<span style="color:var(--text-muted);">--</span>';

      html += `<tr style="cursor:pointer;border-bottom:1px solid var(--border-subtle);" onclick="openDetailPanel('${escapeHtml(p.portfolioProjectId)}')">
        <td style="padding:8px 12px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColor(p.portfolioProjectStatus)};"></span>
        </td>
        <td style="padding:8px 6px;font-weight:500;font-size:13px;color:var(--text-primary);">${escapeHtml(p.portfolioProjectName)}</td>
        <td style="padding:8px 6px;font-size:11px;color:var(--text-muted);">${escapeHtml(p.portfolioProjectScope || '')}</td>
        <td style="padding:8px 6px;font-size:11px;color:var(--text-muted);">${formatDateShort(p.portfolioProjectLastActive)}</td>
        <td style="padding:8px 6px;font-size:11px;color:${ageColor};font-family:'JetBrains Mono',monospace;">${days !== null ? days + 'd' : '--'}</td>
        <td style="padding:8px 6px;">${p.portfolioProjectGateType ? `<span style="font-size:10px;padding:1px 6px;border-radius:99px;background:rgba(245,158,11,0.15);color:var(--amber);">${escapeHtml(p.portfolioProjectGateType)}</span>` : ''}</td>
        <td style="padding:8px 6px;">${featureProg}</td>
        <td style="padding:8px 6px;font-size:11px;color:${p.portfolioProjectRiskCount > 0 ? 'var(--rose)' : 'var(--text-muted)'};">${p.portfolioProjectRiskCount || 0}</td>
        <td style="padding:8px 6px;font-size:11px;">${p.portfolioProjectHasDataDictionary ? '<span style="color:var(--green);">&#10003;</span>' : '<span style="color:var(--rose);">&#10007;</span>'}</td>
        <td style="padding:8px 6px;">${renderHeatTrail(p)}</td>
      </tr>`;
    }
  }
  tbody.innerHTML = html;
}

// --- Data Dictionary Audit ---
function renderDictAudit() {
  const container = el('dictList');
  if (!container) return;

  const audit = portfolioData.audit;
  if (audit.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">No audit data available</div>';
    return;
  }

  let html = '';
  for (const a of audit) {
    const hasDict = a.auditHasDataDictionary;
    const updated = a.auditDataDictionaryUpdated;
    const freshness = a.auditDataDictionaryFreshness;
    const dateColor = freshness === 'stale' ? 'var(--amber)' : freshness === 'missing' ? 'var(--rose)' : 'var(--text-muted)';
    const icon = hasDict ? '<span style="color:var(--green);">&#10003;</span>' : '<span style="color:var(--rose);">&#10007;</span>';
    const dateStr = hasDict ? formatDateShort(updated) : 'Missing';

    html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-subtle);font-size:12px;">
      <div style="display:flex;align-items:center;gap:6px;">
        ${icon}
        <span style="color:var(--text-secondary);">${escapeHtml(a.auditProjectName)}</span>
      </div>
      <span style="color:${dateColor};font-size:11px;">${dateStr}</span>
    </div>`;
  }
  container.innerHTML = html;
}

// --- Recent Activity ---
function renderRecentActivity() {
  const container = el('recentActivityList');
  if (!container) return;

  const activities = portfolioData.activity.slice(0, 10);
  if (activities.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">No recent activity</div>';
    return;
  }

  let html = '';
  for (const a of activities) {
    const typeBadge = a.activityType === 'commit'
      ? '<span style="font-size:9px;padding:1px 5px;border-radius:99px;background:rgba(96,165,250,0.15);color:var(--blue);">COMMIT</span>'
      : a.activityType === 'session'
        ? '<span style="font-size:9px;padding:1px 5px;border-radius:99px;background:rgba(16,185,129,0.15);color:var(--green);">SESSION</span>'
        : '<span style="font-size:9px;padding:1px 5px;border-radius:99px;background:rgba(255,255,255,0.08);color:var(--text-muted);">CHANGE</span>';

    html += `<div style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:1px solid var(--border-subtle);font-size:12px;">
      <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-muted);white-space:nowrap;min-width:36px;">${formatTime(a.activityTimestamp)}</span>
      ${typeBadge}
      <span style="color:var(--blue);white-space:nowrap;">${escapeHtml(a.activityProject)}</span>
      <span style="color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(truncate(a.activityDescription, 50))}</span>
    </div>`;
  }
  container.innerHTML = html;
}

// --- Quick Stats ---
function renderQuickStats() {
  const container = el('quickStatsContent');
  if (!container) return;

  const projects = portfolioData.projects;
  const workCount = projects.filter(p => p.portfolioProjectScope === 'work').length;
  const personalCount = projects.filter(p => p.portfolioProjectScope === 'personal').length;
  const totalProjects = workCount + personalCount || 1;

  // Most recent project
  const sorted = [...projects].sort((a, b) => {
    const da = a.portfolioProjectLastActive ? new Date(a.portfolioProjectLastActive).getTime() : 0;
    const db = b.portfolioProjectLastActive ? new Date(b.portfolioProjectLastActive).getTime() : 0;
    return db - da;
  });
  const mostRecent = sorted[0];

  // Features
  const totalDone = projects.reduce((s, p) => s + (p.portfolioProjectFeaturesDone || 0), 0);
  const totalFeatures = projects.reduce((s, p) => s + (p.portfolioProjectFeaturesTotal || 0), 0);

  // This week's commits
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekCommits = portfolioData.activity.filter(a =>
    a.activityType === 'commit' && a.activityTimestamp && new Date(a.activityTimestamp) >= weekAgo
  ).length;

  const workPct = Math.round((workCount / totalProjects) * 100);

  container.innerHTML = `
    <div style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:4px;">
        <span>Work ${workCount}</span>
        <span>Personal ${personalCount}</span>
      </div>
      <div style="height:6px;background:var(--bg-card-hover);border-radius:3px;overflow:hidden;display:flex;">
        <div style="width:${workPct}%;background:var(--blue);"></div>
        <div style="width:${100 - workPct}%;background:var(--green);"></div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;">
        <span style="color:var(--text-muted);">Most Recent</span>
        <span style="color:var(--text-secondary);font-weight:500;">${mostRecent ? escapeHtml(truncate(mostRecent.portfolioProjectName, 20)) : '--'}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;">
        <span style="color:var(--text-muted);">Features</span>
        <span style="color:var(--text-secondary);font-weight:500;">${totalDone}/${totalFeatures}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;">
        <span style="color:var(--text-muted);">Commits (7d)</span>
        <span style="color:var(--text-secondary);font-weight:500;font-family:'JetBrains Mono',monospace;">${weekCommits}</span>
      </div>
    </div>`;
}

// === RISKS TAB ===
function renderRisksTab() {
  const risks = portfolioData.risks;

  // Metrics
  const open = risks.filter(r => r.riskStatus && r.riskStatus.toLowerCase() === 'open').length;
  const accepted = risks.filter(r => r.riskStatus && r.riskStatus.toLowerCase() === 'accepted').length;
  const mitigated = risks.filter(r => r.riskStatus && r.riskStatus.toLowerCase() === 'mitigated').length;

  const elOpen = el('riskMetricOpen');
  const elAccepted = el('riskMetricAccepted');
  const elMitigated = el('riskMetricMitigated');
  const elTotal = el('riskMetricTotal');
  if (elOpen) elOpen.textContent = open;
  if (elAccepted) elAccepted.textContent = accepted;
  if (elMitigated) elMitigated.textContent = mitigated;
  if (elTotal) elTotal.textContent = risks.length;

  // Populate project filter dropdown
  const projectFilter = el('riskProjectFilter');
  if (projectFilter) {
    const projectNames = [...new Set(risks.map(r => r.riskProject).filter(Boolean))].sort();
    const currentVal = projectFilter.value;
    projectFilter.innerHTML = '<option value="all">All Projects</option>' +
      projectNames.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    projectFilter.value = currentVal || 'all';
  }

  // Filter risks
  let filtered = risks;
  if (activeRiskFilters.status !== 'all') {
    filtered = filtered.filter(r => r.riskStatus && r.riskStatus.toLowerCase() === activeRiskFilters.status);
  }
  if (activeRiskFilters.project !== 'all') {
    filtered = filtered.filter(r => r.riskProject === activeRiskFilters.project);
  }

  // Table
  const tbody = el('risksTableBody');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted);">No risks match the current filters</td></tr>';
    return;
  }

  let html = '';
  for (const r of filtered) {
    const isOpen = r.riskStatus && r.riskStatus.toLowerCase() === 'open';
    html += `<tr class="risk-row" style="border-bottom:1px solid var(--border-subtle);cursor:pointer;" onclick="this.nextElementSibling&&this.nextElementSibling.classList.contains('risk-detail')?this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'table-row':'none':null">
      <td style="padding:10px 12px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text-muted);">${escapeHtml(r.riskId)}</td>
      <td style="padding:10px 6px;font-size:11px;color:var(--text-muted);">${formatDate(r.riskDateRaised)}</td>
      <td style="padding:10px 6px;font-size:12px;color:var(--text-secondary);">${escapeHtml(r.riskProject)}</td>
      <td style="padding:10px 6px;">
        <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${perspectiveColor(r.riskPerspective)};"></span>
          <span style="color:var(--text-muted);">${escapeHtml(r.riskPerspective)}</span>
        </span>
      </td>
      <td style="padding:10px 6px;">
        <span style="font-size:10px;padding:2px 8px;border-radius:99px;background:rgba(0,0,0,0.3);color:${severityColor(r.riskSeverity)};">${escapeHtml(r.riskSeverity)}</span>
      </td>
      <td style="padding:10px 6px;">
        <span style="font-size:10px;padding:2px 8px;border-radius:99px;border:1px solid ${riskStatusColor(r.riskStatus)};color:${riskStatusColor(r.riskStatus)};background:transparent;">${escapeHtml(r.riskStatus)}</span>
      </td>
      <td style="padding:10px 6px;font-size:12px;color:var(--text-secondary);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(truncate(r.riskDescription, 80))}</td>
      <td style="padding:10px 6px;">
        ${isOpen ? `<div style="display:flex;gap:4px;">
          <button class="btn btn-sm" onclick="event.stopPropagation();acceptRisk('${escapeHtml(r.riskId)}')">Accept</button>
          <button class="btn btn-sm" onclick="event.stopPropagation();mitigateRisk('${escapeHtml(r.riskId)}')">Mitigate</button>
        </div>` : ''}
      </td>
    </tr>
    <tr class="risk-detail" style="display:none;">
      <td colspan="8" style="padding:12px 20px;background:var(--bg-card);font-size:12px;">
        <div style="margin-bottom:6px;"><strong style="color:var(--text-secondary);">Full Description:</strong> <span style="color:var(--text-muted);">${escapeHtml(r.riskDescription)}</span></div>
        ${r.riskMitigation ? `<div style="margin-bottom:6px;"><strong style="color:var(--text-secondary);">Mitigation:</strong> <span style="color:var(--text-muted);">${escapeHtml(r.riskMitigation)}</span></div>` : ''}
        ${r.riskAcceptedBy ? `<div style="margin-bottom:6px;"><strong style="color:var(--text-secondary);">Accepted By:</strong> <span style="color:var(--text-muted);">${escapeHtml(r.riskAcceptedBy)}</span></div>` : ''}
        ${r.riskDateResolved ? `<div><strong style="color:var(--text-secondary);">Resolved:</strong> <span style="color:var(--text-muted);">${formatDate(r.riskDateResolved)}</span></div>` : ''}
      </td>
    </tr>`;
  }
  tbody.innerHTML = html;
}

// === ACTIVITY TAB ===
function renderActivityTab() {
  renderTimeline();
  renderHeatmap();
  renderActivityStats();
}

function getFilteredActivities() {
  let activities = portfolioData.activity;
  const now = new Date();

  // Date filter
  if (activeActivityFilters.date === 'today') {
    const todayStr = now.toISOString().split('T')[0];
    activities = activities.filter(a => a.activityTimestamp && a.activityTimestamp.startsWith(todayStr));
  } else if (activeActivityFilters.date === 'week') {
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    activities = activities.filter(a => a.activityTimestamp && new Date(a.activityTimestamp) >= weekAgo);
  } else if (activeActivityFilters.date === 'month') {
    const monthAgo = new Date(now);
    monthAgo.setDate(monthAgo.getDate() - 30);
    activities = activities.filter(a => a.activityTimestamp && new Date(a.activityTimestamp) >= monthAgo);
  }

  // Project filter
  if (activeActivityFilters.project !== 'all') {
    activities = activities.filter(a => a.activityProject === activeActivityFilters.project);
  }

  // Type filter
  if (activeActivityFilters.type === 'commits') {
    activities = activities.filter(a => a.activityType === 'commit');
  } else if (activeActivityFilters.type === 'sessions') {
    activities = activities.filter(a => a.activityType === 'session');
  }

  return activities;
}

function renderTimeline() {
  const container = el('timelineContainer');
  if (!container) return;

  // Populate activity project filter
  const projectFilter = el('activityProjectFilter');
  if (projectFilter) {
    const projectNames = [...new Set(portfolioData.activity.map(a => a.activityProject).filter(Boolean))].sort();
    const currentVal = projectFilter.value;
    projectFilter.innerHTML = '<option value="all">All Projects</option>' +
      projectNames.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    projectFilter.value = currentVal || 'all';
  }

  const activities = getFilteredActivities();

  if (activities.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);padding:20px;text-align:center;">No activity matches the current filters</div>';
    return;
  }

  // Group by date
  const grouped = {};
  for (const a of activities) {
    const dateStr = a.activityTimestamp ? a.activityTimestamp.split('T')[0] : 'Unknown';
    if (!grouped[dateStr]) grouped[dateStr] = [];
    grouped[dateStr].push(a);
  }

  let html = '';
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
  for (const date of dates) {
    html += `<div style="margin-bottom:16px;">
      <div style="font-size:12px;font-weight:600;color:var(--text-secondary);padding:6px 0;border-bottom:1px solid var(--border-subtle);margin-bottom:6px;">${formatDate(date)}</div>`;

    for (const a of grouped[date]) {
      const typeBadge = a.activityType === 'commit'
        ? '<span style="font-size:9px;padding:1px 5px;border-radius:99px;background:rgba(96,165,250,0.15);color:var(--blue);">COMMIT</span>'
        : a.activityType === 'session'
          ? '<span style="font-size:9px;padding:1px 5px;border-radius:99px;background:rgba(16,185,129,0.15);color:var(--green);">SESSION</span>'
          : '<span style="font-size:9px;padding:1px 5px;border-radius:99px;background:rgba(255,255,255,0.08);color:var(--text-muted);">CHANGE</span>';

      let extra = '';
      if (a.activityType === 'commit' && a.activityMeta && a.activityMeta.hash) {
        extra = `<span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-muted);margin-left:6px;">${escapeHtml(a.activityMeta.hash.substring(0, 7))}</span>`;
      }
      if (a.activityType === 'session' && a.activityMeta) {
        const parts = [];
        if (a.activityMeta.duration) parts.push(a.activityMeta.duration);
        if (a.activityMeta.tokens) parts.push(a.activityMeta.tokens.toLocaleString() + ' tokens');
        if (parts.length) {
          extra = `<span style="font-size:10px;color:var(--text-muted);margin-left:6px;">${escapeHtml(parts.join(' / '))}</span>`;
        }
      }

      html += `<div style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;font-size:12px;">
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-muted);white-space:nowrap;min-width:40px;">${formatTime(a.activityTimestamp)}</span>
        ${typeBadge}
        <span style="color:var(--blue);white-space:nowrap;">${escapeHtml(a.activityProject)}</span>
        <span style="color:var(--text-secondary);flex:1;">${escapeHtml(a.activityDescription)}${extra}</span>
      </div>`;
    }
    html += '</div>';
  }
  container.innerHTML = html;
}

function renderHeatmap() {
  const container = el('heatmapGrid');
  if (!container) return;

  const activities = portfolioData.activity;
  const now = new Date();

  // Count events per day for last 84 days (12 weeks)
  const dayCounts = {};
  for (const a of activities) {
    if (!a.activityTimestamp) continue;
    const dateStr = a.activityTimestamp.split('T')[0];
    dayCounts[dateStr] = (dayCounts[dateStr] || 0) + 1;
  }

  // Build 12-week grid (columns) x 7 days (rows)
  // Find the most recent Sunday to align the grid
  const today = new Date(now);
  const dayOfWeek = today.getDay(); // 0=Sun
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + (6 - dayOfWeek)); // next Saturday (or today if Saturday)

  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 83); // 12 weeks * 7 - 1

  // Build cells: 7 rows (Mon-Sun) x 12 columns (weeks)
  // We'll arrange as CSS grid: 7 rows, auto columns
  const weeks = 12;
  const cells = [];
  const monthLabels = [];
  let lastMonth = -1;

  for (let w = 0; w < weeks; w++) {
    const weekStart = new Date(startDate);
    weekStart.setDate(weekStart.getDate() + w * 7);

    // Track month labels
    if (weekStart.getMonth() !== lastMonth) {
      monthLabels.push({ week: w, label: weekStart.toLocaleDateString('en-GB', { month: 'short' }) });
      lastMonth = weekStart.getMonth();
    }

    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(weekStart);
      cellDate.setDate(cellDate.getDate() + d);
      const dateStr = cellDate.toISOString().split('T')[0];
      const count = dayCounts[dateStr] || 0;
      const isFuture = cellDate > now;

      let level = 0;
      if (count >= 10) level = 4;
      else if (count >= 6) level = 3;
      else if (count >= 3) level = 2;
      else if (count >= 1) level = 1;

      cells.push({ week: w, day: d, count, level, dateStr, isFuture });
    }
  }

  // Render
  const dayLabels = ['', 'M', '', 'W', '', 'F', ''];
  let html = '<div style="display:flex;gap:2px;">';

  // Day labels column
  html += '<div style="display:flex;flex-direction:column;gap:2px;margin-right:4px;">';
  for (let d = 0; d < 7; d++) {
    html += `<div style="width:12px;height:12px;font-size:9px;color:var(--text-muted);display:flex;align-items:center;justify-content:center;">${dayLabels[d]}</div>`;
  }
  html += '</div>';

  // Week columns
  for (let w = 0; w < weeks; w++) {
    html += '<div style="display:flex;flex-direction:column;gap:2px;">';
    for (let d = 0; d < 7; d++) {
      const cell = cells.find(c => c.week === w && c.day === d);
      const opacity = cell && cell.isFuture ? '0.2' : '1';
      html += `<div class="heatmap-level-${cell ? cell.level : 0}" style="width:12px;height:12px;border-radius:2px;opacity:${opacity};" title="${cell ? cell.dateStr + ': ' + cell.count + ' events' : ''}"></div>`;
    }
    html += '</div>';
  }

  html += '</div>';

  // Month labels
  html += '<div style="display:flex;margin-top:4px;margin-left:16px;">';
  let prevWeek = 0;
  for (const ml of monthLabels) {
    const offset = (ml.week - prevWeek) * 14; // 12px cell + 2px gap
    html += `<span style="font-size:9px;color:var(--text-muted);margin-left:${offset}px;">${ml.label}</span>`;
    prevWeek = ml.week;
  }
  html += '</div>';

  container.innerHTML = html;
}

function renderActivityStats() {
  const container = el('activityStatsContent');
  const titleEl = el('activityStatsTitle');
  if (!container) return;

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const weekActivities = portfolioData.activity.filter(a =>
    a.activityTimestamp && new Date(a.activityTimestamp) >= weekAgo
  );

  const sessions = weekActivities.filter(a => a.activityType === 'session').length;
  const commits = weekActivities.filter(a => a.activityType === 'commit').length;
  const totalTokens = weekActivities
    .filter(a => a.activityType === 'session' && a.activityMeta && a.activityMeta.tokens)
    .reduce((s, a) => s + (a.activityMeta.tokens || 0), 0);
  const totalCost = weekActivities
    .filter(a => a.activityMeta && a.activityMeta.cost)
    .reduce((s, a) => s + (a.activityMeta.cost || 0), 0);

  if (titleEl) titleEl.textContent = 'This Week';

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;padding:8px 0;">
      <div style="display:flex;justify-content:space-between;font-size:13px;">
        <span style="color:var(--text-muted);">Sessions</span>
        <span style="color:var(--text-secondary);font-weight:600;font-family:'JetBrains Mono',monospace;">${sessions}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;">
        <span style="color:var(--text-muted);">Commits</span>
        <span style="color:var(--text-secondary);font-weight:600;font-family:'JetBrains Mono',monospace;">${commits}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;">
        <span style="color:var(--text-muted);">Tokens</span>
        <span style="color:var(--text-secondary);font-weight:600;font-family:'JetBrains Mono',monospace;">${totalTokens.toLocaleString()}</span>
      </div>
      ${totalCost > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;">
        <span style="color:var(--text-muted);">Est. Cost</span>
        <span style="color:var(--text-secondary);font-weight:600;font-family:'JetBrains Mono',monospace;">$${totalCost.toFixed(2)}</span>
      </div>` : ''}
    </div>`;
}

// === AUDIT TAB ===
function renderAuditTab() {
  renderHealthGauge();
  renderAuditDictTile();
  renderAuditFreshnessTile();
  renderAuditFeaturesTile();
  renderAuditRiskTile();
}

function renderHealthGauge() {
  const valueEl = el('healthGaugeValue');
  const fillEl = el('healthGaugeFill');
  if (!valueEl || !fillEl) return;

  const score = portfolioData.health.score || 0;
  const circumference = 2 * Math.PI * 60; // ~377
  const offset = circumference * (1 - score / 100);

  valueEl.textContent = Math.round(score) + '%';
  fillEl.setAttribute('stroke-dashoffset', offset.toString());

  let color = 'var(--green)';
  if (score < 50) color = 'var(--rose)';
  else if (score < 70) color = 'var(--amber)';
  fillEl.setAttribute('stroke', color);
  valueEl.style.color = color;
}

function renderAuditDictTile() {
  const scoreEl = el('auditDictScore');
  const progressEl = el('auditDictProgress');
  const tbody = el('auditDictBody');
  if (!tbody) return;

  const audit = portfolioData.audit;
  const hasDict = audit.filter(a => a.auditHasDataDictionary).length;
  const total = audit.length || 1;
  const pct = Math.round((hasDict / total) * 100);

  if (scoreEl) scoreEl.textContent = hasDict + '/' + audit.length;
  if (progressEl) progressEl.style.width = pct + '%';

  let html = '';
  for (const a of audit) {
    const freshness = a.auditDataDictionaryFreshness;
    const statusColor = freshness === 'current' ? 'var(--green)' : freshness === 'stale' ? 'var(--amber)' : 'var(--rose)';
    const statusText = freshness === 'current' ? 'Current' : freshness === 'stale' ? 'Stale' : 'Missing';
    html += `<tr style="border-top:1px solid var(--border-subtle);">
      <td style="padding:6px 8px;font-size:12px;color:var(--text-secondary);">${escapeHtml(a.auditProjectName)}</td>
      <td style="padding:6px 8px;font-size:12px;">${a.auditHasDataDictionary ? '<span style="color:var(--green);">&#10003;</span>' : '<span style="color:var(--rose);">&#10007;</span>'}</td>
      <td style="padding:6px 8px;font-size:11px;color:var(--text-muted);">${a.auditDataDictionaryUpdated ? formatDateShort(a.auditDataDictionaryUpdated) : '--'}</td>
      <td style="padding:6px 8px;"><span style="font-size:10px;color:${statusColor};">${statusText}</span></td>
    </tr>`;
  }
  tbody.innerHTML = html;
}

function renderAuditFreshnessTile() {
  const scoreEl = el('auditFreshnessScore');
  const countsEl = el('freshnessCounts');
  const tbody = el('auditFreshnessBody');
  if (!tbody) return;

  const audit = portfolioData.audit;
  const fresh = audit.filter(a => a.auditStatusFileFreshness === 'fresh').length;
  const stale = audit.filter(a => a.auditStatusFileFreshness === 'stale').length;
  const veryStale = audit.filter(a => a.auditStatusFileFreshness === 'very-stale').length;
  const missing = audit.filter(a => a.auditStatusFileFreshness === 'missing' || !a.auditHasStatusFile).length;

  if (scoreEl) scoreEl.textContent = fresh + '/' + audit.length + ' fresh';

  if (countsEl) {
    countsEl.innerHTML = `
      <div style="display:flex;gap:12px;margin-bottom:10px;font-size:12px;">
        <span style="color:var(--green);">&#9679; Fresh: ${fresh}</span>
        <span style="color:var(--amber);">&#9679; Stale: ${stale}</span>
        <span style="color:var(--rose);">&#9679; Very Stale: ${veryStale}</span>
        <span style="color:var(--text-muted);">&#9679; Missing: ${missing}</span>
      </div>`;
  }

  let html = '';
  for (const a of audit) {
    const freshness = a.auditStatusFileFreshness || 'missing';
    const color = freshness === 'fresh' ? 'var(--green)' : freshness === 'stale' ? 'var(--amber)' : freshness === 'very-stale' ? 'var(--rose)' : 'var(--text-muted)';
    const label = freshness === 'fresh' ? 'Fresh' : freshness === 'stale' ? 'Stale' : freshness === 'very-stale' ? 'Very Stale' : 'Missing';
    html += `<tr style="border-top:1px solid var(--border-subtle);">
      <td style="padding:6px 8px;font-size:12px;color:var(--text-secondary);">${escapeHtml(a.auditProjectName)}</td>
      <td style="padding:6px 8px;font-size:11px;color:var(--text-muted);">${a.auditHasStatusFile ? formatDateShort(a.auditDataDictionaryUpdated) : '--'}</td>
      <td style="padding:6px 8px;"><span style="font-size:10px;color:${color};">${label}</span></td>
    </tr>`;
  }
  tbody.innerHTML = html;
}

function renderAuditFeaturesTile() {
  const scoreEl = el('auditFeaturesScore');
  const container = el('auditFeaturesContent');
  if (!container) return;

  const audit = portfolioData.audit.filter(a => a.auditHasFeatureList);
  const total = portfolioData.audit.length || 1;

  if (scoreEl) scoreEl.textContent = audit.length + '/' + portfolioData.audit.length + ' have features';

  if (audit.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">No feature lists found</div>';
    return;
  }

  // Summary progress
  const totalDone = audit.reduce((s, a) => s + (a.auditFeaturesDone || 0), 0);
  const totalFeatures = audit.reduce((s, a) => s + (a.auditFeaturesTotal || 0), 0);
  const overallPct = totalFeatures > 0 ? Math.round((totalDone / totalFeatures) * 100) : 0;

  let html = `
    <div style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:4px;">
        <span>Overall Progress</span>
        <span>${totalDone}/${totalFeatures} (${overallPct}%)</span>
      </div>
      <div style="height:4px;background:var(--bg-card-hover);border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:${overallPct}%;background:var(--green);border-radius:2px;"></div>
      </div>
    </div>`;

  for (const a of audit) {
    const done = a.auditFeaturesDone || 0;
    const tot = a.auditFeaturesTotal || 0;
    const pct = tot > 0 ? Math.round((done / tot) * 100) : 0;
    html += `<div style="margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px;">
        <span style="color:var(--text-secondary);">${escapeHtml(a.auditProjectName)}</span>
        <span style="color:var(--text-muted);font-size:11px;">${done}/${tot}</span>
      </div>
      <div style="height:3px;background:var(--bg-card-hover);border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:var(--green);border-radius:2px;"></div>
      </div>
    </div>`;
  }
  container.innerHTML = html;
}

function renderAuditRiskTile() {
  const scoreEl = el('auditRiskScore');
  const container = el('auditRiskContent');
  const linkEl = el('auditRiskLink');
  if (!container) return;

  const risks = portfolioData.risks;
  const open = risks.filter(r => r.riskStatus && r.riskStatus.toLowerCase() === 'open').length;

  if (scoreEl) scoreEl.textContent = open + ' open';
  if (scoreEl) scoreEl.style.color = open > 0 ? 'var(--rose)' : 'var(--green)';

  if (risks.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">No risks registered</div>';
    return;
  }

  // Severity breakdown
  const critical = risks.filter(r => r.riskSeverity && r.riskSeverity.toLowerCase() === 'critical').length;
  const high = risks.filter(r => r.riskSeverity && r.riskSeverity.toLowerCase() === 'high').length;
  const medium = risks.filter(r => r.riskSeverity && r.riskSeverity.toLowerCase() === 'medium').length;
  const low = risks.filter(r => r.riskSeverity && r.riskSeverity.toLowerCase() === 'low').length;

  // Project breakdown
  const byProject = {};
  for (const r of risks) {
    const proj = r.riskProject || 'Unknown';
    byProject[proj] = (byProject[proj] || 0) + 1;
  }

  let html = `
    <div style="margin-bottom:12px;">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">Severity Breakdown</div>
      <div style="display:flex;gap:12px;font-size:12px;">
        <span style="color:var(--rose);">Critical: ${critical}</span>
        <span style="color:var(--amber);">High: ${high}</span>
        <span style="color:var(--blue);">Medium: ${medium}</span>
        <span style="color:var(--text-muted);">Low: ${low}</span>
      </div>
    </div>
    <div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">By Project</div>`;

  for (const [proj, count] of Object.entries(byProject).sort((a, b) => b[1] - a[1])) {
    const barWidth = Math.round((count / risks.length) * 100);
    html += `<div style="margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px;">
        <span style="color:var(--text-secondary);">${escapeHtml(proj)}</span>
        <span style="color:var(--text-muted);">${count}</span>
      </div>
      <div style="height:3px;background:var(--bg-card-hover);border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:${barWidth}%;background:var(--rose);border-radius:2px;"></div>
      </div>
    </div>`;
  }
  html += '</div>';
  container.innerHTML = html;

  // Link to risk tab
  if (linkEl) {
    linkEl.onclick = function () {
      switchTab('risks');
    };
    linkEl.style.cursor = 'pointer';
  }
}

// === SHARED COMPONENTS ===

function renderHeatTrail(project) {
  let cells = '';
  const today = new Date();
  for (let i = 0; i < 30; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - (29 - i));
    const dateStr = date.toISOString().split('T')[0];

    // Check commits
    const hasCommit = project.portfolioProjectRecentCommits && project.portfolioProjectRecentCommits.some(function (c) {
      return c.commitDate && c.commitDate.startsWith(dateStr);
    });
    // Also check session log entries
    const hasSession = project.portfolioProjectSessionLogEntries && project.portfolioProjectSessionLogEntries.some(function (s) {
      return s.sessionLogDate && s.sessionLogDate.startsWith(dateStr);
    });

    const active = hasCommit || hasSession;
    const cls = active ? 'heat-cell active' : 'heat-cell';
    cells += '<div class="' + cls + '"></div>';
  }
  return '<div class="heat-trail">' + cells + '</div>';
}

function openDetailPanel(projectId) {
  const project = portfolioData.projects.find(function (p) { return p.portfolioProjectId === projectId; });
  if (!project) return;

  selectedProjectId = projectId;
  const content = el('detailContent');
  if (!content) return;

  const featureBar = (project.portfolioProjectFeaturesTotal && project.portfolioProjectFeaturesTotal > 0)
    ? `<div style="margin:12px 0;">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:4px;">
          <span>Feature Progress</span>
          <span>${project.portfolioProjectFeaturesDone || 0}/${project.portfolioProjectFeaturesTotal}</span>
        </div>
        <div style="height:4px;background:var(--bg-card-hover);border-radius:2px;overflow:hidden;">
          <div style="height:100%;width:${Math.round(((project.portfolioProjectFeaturesDone || 0) / project.portfolioProjectFeaturesTotal) * 100)}%;background:var(--green);border-radius:2px;"></div>
        </div>
      </div>`
    : '';

  // Session log
  let sessionHtml = '';
  if (project.portfolioProjectSessionLogEntries && project.portfolioProjectSessionLogEntries.length > 0) {
    sessionHtml = '<div style="margin-top:16px;"><div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:8px;">Session Log</div>';
    for (const s of project.portfolioProjectSessionLogEntries.slice(0, 10)) {
      sessionHtml += `<div style="padding:4px 0;border-bottom:1px solid var(--border-subtle);font-size:12px;">
        <span style="color:var(--text-muted);font-family:'JetBrains Mono',monospace;font-size:11px;">${formatDate(s.sessionLogDate)}</span>
        <div style="color:var(--text-secondary);margin-top:2px;">${escapeHtml(s.sessionLogSummary)}</div>
      </div>`;
    }
    sessionHtml += '</div>';
  }

  // Recent commits
  let commitsHtml = '';
  if (project.portfolioProjectRecentCommits && project.portfolioProjectRecentCommits.length > 0) {
    commitsHtml = '<div style="margin-top:16px;"><div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:8px;">Recent Commits</div>';
    for (const c of project.portfolioProjectRecentCommits.slice(0, 10)) {
      commitsHtml += `<div style="padding:4px 0;border-bottom:1px solid var(--border-subtle);font-size:12px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--blue);">${escapeHtml((c.commitHash || '').substring(0, 7))}</span>
          <span style="color:var(--text-muted);font-size:10px;">${formatDate(c.commitDate)}</span>
        </div>
        <div style="color:var(--text-secondary);margin-top:2px;">${escapeHtml(truncate(c.commitMessage, 100))}</div>
      </div>`;
    }
    commitsHtml += '</div>';
  }

  // Risks for this project
  const projectRisks = portfolioData.risks.filter(function (r) {
    return r.riskProject === project.portfolioProjectName;
  });
  let risksHtml = '';
  if (projectRisks.length > 0) {
    risksHtml = '<div style="margin-top:16px;"><div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:8px;">Risks (' + projectRisks.length + ')</div>';
    for (const r of projectRisks) {
      risksHtml += `<div style="padding:6px 0;border-bottom:1px solid var(--border-subtle);font-size:12px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:10px;padding:1px 6px;border-radius:99px;background:rgba(0,0,0,0.3);color:${severityColor(r.riskSeverity)};">${escapeHtml(r.riskSeverity)}</span>
          <span style="font-size:10px;padding:1px 6px;border-radius:99px;border:1px solid ${riskStatusColor(r.riskStatus)};color:${riskStatusColor(r.riskStatus)};background:transparent;">${escapeHtml(r.riskStatus)}</span>
        </div>
        <div style="color:var(--text-muted);margin-top:4px;">${escapeHtml(r.riskDescription)}</div>
      </div>`;
    }
    risksHtml += '</div>';
  }

  // Documentation badges
  const badges = [];
  if (project.portfolioProjectHasGit) badges.push('<span style="font-size:10px;padding:2px 6px;border-radius:99px;background:rgba(16,185,129,0.15);color:var(--green);">Git</span>');
  if (project.portfolioProjectHasDataDictionary) badges.push('<span style="font-size:10px;padding:2px 6px;border-radius:99px;background:rgba(16,185,129,0.15);color:var(--green);">Data Dict</span>');
  if (project.portfolioProjectHasFeatureList) badges.push('<span style="font-size:10px;padding:2px 6px;border-radius:99px;background:rgba(16,185,129,0.15);color:var(--green);">Features</span>');
  if (project.portfolioProjectHasReviewHtml) badges.push('<span style="font-size:10px;padding:2px 6px;border-radius:99px;background:rgba(16,185,129,0.15);color:var(--green);">Review</span>');

  content.innerHTML = `
    <div style="margin-bottom:16px;">
      <h2 style="margin:0 0 4px 0;font-size:18px;font-weight:700;color:var(--text-primary);">${escapeHtml(project.portfolioProjectName)}</h2>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:11px;padding:2px 8px;border-radius:99px;color:${statusColor(project.portfolioProjectStatus)};border:1px solid ${statusColor(project.portfolioProjectStatus)};background:transparent;">${escapeHtml(project.portfolioProjectStatus || 'Unknown')}</span>
        <span style="font-size:11px;padding:2px 8px;border-radius:99px;background:var(--bg-card-hover);color:var(--text-muted);">${escapeHtml(project.portfolioProjectScope || '')}</span>
        ${project.portfolioProjectStaleness ? `<span style="font-size:11px;color:${stalenessColor(project.portfolioProjectStaleness)};">${escapeHtml(project.portfolioProjectStaleness)} (${project.portfolioProjectDaysSinceActive || '?'}d)</span>` : ''}
        ${project.portfolioProjectGateType ? `<span style="font-size:11px;padding:2px 8px;border-radius:99px;background:rgba(245,158,11,0.15);color:var(--amber);">${escapeHtml(project.portfolioProjectGateType)}</span>` : ''}
      </div>
    </div>

    ${badges.length > 0 ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;">${badges.join('')}</div>` : ''}

    ${project.portfolioProjectQuickContext ? `<div style="margin-bottom:12px;">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">Quick Context</div>
      <div style="font-size:13px;color:var(--text-secondary);line-height:1.5;">${escapeHtml(project.portfolioProjectQuickContext)}</div>
    </div>` : ''}

    ${project.portfolioProjectCurrentState ? `<div style="margin-bottom:12px;">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">Current State</div>
      <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;white-space:pre-wrap;">${escapeHtml(project.portfolioProjectCurrentState)}</div>
    </div>` : ''}

    ${project.portfolioProjectNextSteps ? `<div style="margin-bottom:12px;">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">Next Steps</div>
      <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;white-space:pre-wrap;">${escapeHtml(project.portfolioProjectNextSteps)}</div>
    </div>` : ''}

    ${featureBar}

    <div style="margin:12px 0;">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Activity (30d)</div>
      ${renderHeatTrail(project)}
    </div>

    <div style="display:flex;gap:6px;margin:16px 0;">
      <button class="btn btn-sm btn-primary" onclick="launchSession('${escapeHtml(project.portfolioProjectPath || '')}')">Launch Session</button>
      ${project.portfolioProjectHasReviewHtml ? `<button class="btn btn-sm" onclick="openReview('${escapeHtml(project.portfolioProjectReviewHtmlPath || '')}')">Open Review</button>` : ''}
    </div>

    <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">
      Path: <span style="font-family:'JetBrains Mono',monospace;font-size:10px;">${escapeHtml(project.portfolioProjectPath || '')}</span>
    </div>
    ${project.portfolioProjectLastActive ? `<div style="font-size:11px;color:var(--text-muted);">Last Active: ${formatDate(project.portfolioProjectLastActive)}</div>` : ''}
    ${project.portfolioProjectDataDictionaryUpdated ? `<div style="font-size:11px;color:var(--text-muted);">Data Dict Updated: ${formatDate(project.portfolioProjectDataDictionaryUpdated)}</div>` : ''}

    ${sessionHtml}
    ${commitsHtml}
    ${risksHtml}
  `;

  // Show panel
  const panel = el('detailPanel');
  const overlay = el('detailOverlay');
  if (panel) panel.classList.add('open');
  if (overlay) overlay.classList.add('open');
}

function closeDetailPanel() {
  selectedProjectId = null;
  const panel = el('detailPanel');
  const overlay = el('detailOverlay');
  if (panel) panel.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
}

function showToast(message) {
  const container = el('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(function () {
    toast.classList.add('show');
  });

  setTimeout(function () {
    toast.classList.remove('show');
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 3000);
}

// === ACTIONS ===

function launchSession(cwd) {
  if (!cwd) {
    showToast('No project path available');
    return;
  }
  socket.emit('launch-session', { cwd: cwd, viaLauncher: true });
  showToast('Launching session...');
}

function openReview(path) {
  if (!path) {
    showToast('No review document path available');
    return;
  }
  window.open(path);
}

async function acceptRisk(riskId) {
  try {
    const resp = await fetch('/api/portfolio/risks/' + encodeURIComponent(riskId) + '/accept', { method: 'POST' });
    if (resp.ok) {
      showToast('Risk ' + riskId + ' accepted');
      await fetchAllData();
      renderAll();
    } else {
      showToast('Failed to accept risk');
    }
  } catch (err) {
    console.error('[Portfolio] Error accepting risk:', err);
    showToast('Failed to accept risk');
  }
}

async function mitigateRisk(riskId) {
  try {
    const resp = await fetch('/api/portfolio/risks/' + encodeURIComponent(riskId) + '/mitigate', { method: 'POST' });
    if (resp.ok) {
      showToast('Risk ' + riskId + ' mitigation recorded');
      await fetchAllData();
      renderAll();
    } else {
      showToast('Failed to mitigate risk');
    }
  } catch (err) {
    console.error('[Portfolio] Error mitigating risk:', err);
    showToast('Failed to mitigate risk');
  }
}

// === PERMISSION BAR ===

function showPermissionBar(data) {
  const bar = el('globalPermissionBar');
  const textEl = el('permissionText');
  const timerEl = el('permissionTimer');
  if (!bar || !textEl) return;

  const sessionName = (data && data.sessionName) || 'Session';
  const tool = (data && data.tool) || 'unknown tool';
  const timeout = (data && data.permissionTimeoutSeconds) || 30;

  textEl.innerHTML = '<strong>' + escapeHtml(sessionName) + '</strong> needs permission: <code>' + escapeHtml(tool) + '</code>';
  bar.style.display = 'flex';

  // Store data for approve/deny
  bar.dataset.sessionId = (data && data.sessionId) || '';
  bar.dataset.permissionId = (data && data.permissionId) || '';

  // Countdown timer
  let remaining = timeout;
  if (timerEl) timerEl.textContent = remaining + 's';
  if (permissionTimerInterval) clearInterval(permissionTimerInterval);
  permissionTimerInterval = setInterval(function () {
    remaining--;
    if (timerEl) timerEl.textContent = remaining + 's';
    if (remaining <= 0) {
      clearInterval(permissionTimerInterval);
      permissionTimerInterval = null;
      hidePermissionBar();
    }
  }, 1000);
}

function hidePermissionBar() {
  const bar = el('globalPermissionBar');
  if (bar) bar.style.display = 'none';
  if (permissionTimerInterval) {
    clearInterval(permissionTimerInterval);
    permissionTimerInterval = null;
  }
}

// === TAB SWITCHING ===

function switchTab(tabName) {
  activeTab = tabName;

  // Update nav tabs
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(function (tab) {
    if (tab.tagName === 'A') return; // Skip link tabs
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  // Show/hide tab content
  const allTabs = ['portfolio', 'risks', 'activity', 'audit'];
  allTabs.forEach(function (t) {
    const tabEl = el('tab-' + t);
    if (tabEl) tabEl.style.display = (t === tabName) ? '' : 'none';
  });

  // Show/hide tab filters
  allTabs.forEach(function (t) {
    const filterEl = el('filters-' + t);
    if (filterEl) filterEl.style.display = (t === tabName) ? '' : 'none';
  });
}

// === EVENT LISTENERS ===

function setupEventListeners() {
  // Tab switching
  document.querySelectorAll('.nav-tab').forEach(function (tab) {
    if (tab.tagName === 'A') return; // Links handle their own navigation
    tab.addEventListener('click', function () {
      switchTab(this.dataset.tab);
    });
  });

  // Portfolio filter pills
  const filterPills = document.querySelectorAll('#filters-portfolio .filter-pills .pill');
  filterPills.forEach(function (pill) {
    pill.addEventListener('click', function () {
      filterPills.forEach(function (p) { p.classList.remove('active'); });
      this.classList.add('active');
      activeFilters.scope = this.dataset.filter;
      try { renderProjectCards(); } catch (e) { console.error(e); }
      try { renderListView(); } catch (e) { console.error(e); }
    });
  });

  // View toggle (board/list)
  document.querySelectorAll('.btn-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.btn-toggle').forEach(function (b) { b.classList.remove('active'); });
      this.classList.add('active');
      activeFilters.view = this.dataset.view;
      const boardView = el('boardView');
      const listView = el('listView');
      if (boardView) boardView.classList.toggle('active', activeFilters.view === 'board');
      if (listView) listView.classList.toggle('active', activeFilters.view === 'list');
      // board-view.active = display:block, otherwise none; same for list-view
      if (boardView) boardView.style.display = activeFilters.view === 'board' ? '' : 'none';
      if (listView) listView.style.display = activeFilters.view === 'list' ? '' : 'none';
    });
  });

  // Risk status filters
  document.querySelectorAll('.risk-filter-pill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      document.querySelectorAll('.risk-filter-pill').forEach(function (p) { p.classList.remove('active'); });
      this.classList.add('active');
      activeRiskFilters.status = this.dataset.val;
      try { renderRisksTab(); } catch (e) { console.error(e); }
    });
  });

  // Risk project filter
  const riskProjFilter = el('riskProjectFilter');
  if (riskProjFilter) {
    riskProjFilter.addEventListener('change', function () {
      activeRiskFilters.project = this.value;
      try { renderRisksTab(); } catch (e) { console.error(e); }
    });
  }

  // Activity date filters
  document.querySelectorAll('#activityDateFilters .pill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      document.querySelectorAll('#activityDateFilters .pill').forEach(function (p) { p.classList.remove('active'); });
      this.classList.add('active');
      activeActivityFilters.date = this.dataset.val;
      try { renderActivityTab(); } catch (e) { console.error(e); }
    });
  });

  // Activity type filters
  document.querySelectorAll('#activityTypeFilters .pill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      document.querySelectorAll('#activityTypeFilters .pill').forEach(function (p) { p.classList.remove('active'); });
      this.classList.add('active');
      activeActivityFilters.type = this.dataset.val;
      try { renderActivityTab(); } catch (e) { console.error(e); }
    });
  });

  // Activity project filter
  const actProjFilter = el('activityProjectFilter');
  if (actProjFilter) {
    actProjFilter.addEventListener('change', function () {
      activeActivityFilters.project = this.value;
      try { renderActivityTab(); } catch (e) { console.error(e); }
    });
  }

  // Detail panel close
  const closeBtn = el('detailClose');
  if (closeBtn) closeBtn.addEventListener('click', closeDetailPanel);
  const overlay = el('detailOverlay');
  if (overlay) overlay.addEventListener('click', closeDetailPanel);

  // Permission bar buttons
  const approveBtn = el('permApproveBtn');
  if (approveBtn) {
    approveBtn.addEventListener('click', function () {
      const bar = el('globalPermissionBar');
      if (bar) {
        socket.emit('permission-response', {
          sessionId: bar.dataset.sessionId,
          permissionId: bar.dataset.permissionId,
          approved: true
        });
      }
      hidePermissionBar();
    });
  }

  const denyBtn = el('permDenyBtn');
  if (denyBtn) {
    denyBtn.addEventListener('click', function () {
      const bar = el('globalPermissionBar');
      if (bar) {
        socket.emit('permission-response', {
          sessionId: bar.dataset.sessionId,
          permissionId: bar.dataset.permissionId,
          approved: false
        });
      }
      hidePermissionBar();
    });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeDetailPanel();
    }
  });

  // Sync button (if present elsewhere, or the auto-approve button, etc.)
  // New Session button navigates to the sessions page
  const newSessionBtn = el('newSessionBtn');
  if (newSessionBtn) {
    newSessionBtn.addEventListener('click', function () {
      window.location.href = '/';
    });
  }

  // Audit "View full risk register" link
  const auditRiskLink = el('auditRiskLink');
  if (auditRiskLink) {
    auditRiskLink.addEventListener('click', function () {
      switchTab('risks');
    });
  }

  // List view should be hidden by default (board is active)
  const listView = el('listView');
  if (listView) listView.style.display = 'none';
}

// === BOOTSTRAP ===
document.addEventListener('DOMContentLoaded', init);
