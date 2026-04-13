// === MOCK DATA ===
const sessions = [
  {
    id: 'sess-001',
    name: 'Auth Refactor',
    project: 'Work/ITSM/auth-service/',
    status: 'waiting',
    statusText: 'Permission needed',
    elapsed: '12m',
    files: 3, tools: 12, tokens: '24.1k', cost: '$0.34',
    sessionType: 'hook-monitored',
    activity: 'Requesting permission to run <code>npm run test -- --coverage</code>',
    pendingPermission: { tool: 'Bash', input: 'npm run test -- --coverage' },
    detail: [
      { time: '14:25', tool: 'Read', desc: '<span class="fname">AuthMiddleware.cs</span>' },
      { time: '14:26', tool: 'Edit', desc: '<span class="fname">AuthMiddleware.cs</span> — extracted ValidateJwt()' },
      { time: '14:28', tool: 'Edit', desc: '<span class="fname">TokenService.cs</span>' },
      { time: '14:30', tool: 'Edit', desc: '<span class="fname">AuthService.cs</span>' },
      { time: '14:32', tool: 'Perm', desc: 'Bash: npm run test -- --coverage' },
    ]
  },
  {
    id: 'sess-002',
    name: 'OOH Dashboard',
    project: 'Work/Zendesk Integration/OOH Dashboard/',
    status: 'active',
    statusText: 'Editing files',
    elapsed: '34m',
    files: 7, tools: 28, tokens: '52.3k', cost: '$0.87',
    sessionType: 'hook-monitored',
    activity: 'Editing <code>src/Components/Dashboard.razor</code> — adding Thingsboard telemetry binding',
    pendingPermission: null,
    detail: [
      { time: '14:28', tool: 'Read', desc: '<span class="fname">ThingsboardService.cs</span>' },
      { time: '14:29', tool: 'Edit', desc: '<span class="fname">Dashboard.razor</span> — temperature widget' },
      { time: '14:31', tool: 'Edit', desc: '<span class="fname">Dashboard.razor</span> — humidity widget' },
      { time: '14:32', tool: 'Edit', desc: '<span class="fname">Dashboard.razor.cs</span> — Timer polling' },
    ]
  },
  {
    id: 'sess-003',
    name: 'Zendesk Integration',
    project: 'Work/Zendesk Integration/',
    status: 'active',
    statusText: 'Running tests',
    elapsed: '1h 12m',
    files: 2, tools: 41, tokens: '38.7k', cost: '$0.62',
    sessionType: 'sdk-managed',
    activity: 'Playwright tests — 14/18 passing. Investigating <code>ticket-creation.spec.ts</code>',
    pendingPermission: null,
    detail: [
      { time: '14:28', tool: 'Bash', desc: 'npx playwright test --reporter=list' },
      { time: '14:29', tool: 'Pass', desc: '<span class="fname">ticket-list.spec.ts</span> (4/4)' },
      { time: '14:30', tool: 'Pass', desc: '<span class="fname">ticket-detail.spec.ts</span> (6/6)' },
      { time: '14:30', tool: 'Fail', desc: '<span class="fname">ticket-creation.spec.ts</span> (2/4 failed)' },
      { time: '14:31', tool: 'Read', desc: '<span class="fname">ticket-creation.spec.ts</span>' },
    ]
  },
  {
    id: 'sess-004',
    name: 'IOT Admin Panel',
    project: 'Work/IOT Admin/',
    status: 'active',
    statusText: 'Reading files',
    elapsed: '8m',
    files: 0, tools: 6, tokens: '12.3k', cost: '$0.18',
    sessionType: 'hook-monitored',
    activity: 'Reading <code>ARCHITECTURE.md</code> — mapping device registration flow',
    pendingPermission: null,
    detail: [
      { time: '14:24', tool: 'Read', desc: '<span class="fname">PROJECT_STATUS.md</span>' },
      { time: '14:25', tool: 'Read', desc: '<span class="fname">ARCHITECTURE.md</span>' },
      { time: '14:27', tool: 'Glob', desc: 'src/Services/**/*.cs (8 files)' },
      { time: '14:28', tool: 'Read', desc: '<span class="fname">DeviceService.cs</span>' },
      { time: '14:31', tool: 'Grep', desc: 'Searching "provision" across services' },
    ]
  },
  {
    id: 'sess-005',
    name: 'Holiday Tracker Fix',
    project: 'Work/General/holiday-tracker/',
    status: 'completed',
    statusText: 'Completed',
    elapsed: '45m ago',
    files: 2, tools: 19, tokens: '18.2k', cost: '$0.29',
    sessionType: 'hook-monitored',
    activity: 'Fixed date validation bug. Committed and pushed. All 12 tests passing.',
    pendingPermission: null,
    detail: [
      { time: '13:42', tool: 'Read', desc: '<span class="fname">LeaveRequestForm.razor</span>' },
      { time: '13:48', tool: 'Edit', desc: '<span class="fname">LeaveRequestForm.razor</span> — fixed date validation' },
      { time: '13:52', tool: 'Bash', desc: 'dotnet test (12/12 passed)' },
      { time: '13:55', tool: 'Bash', desc: 'git commit + git push' },
      { time: '13:56', tool: 'Done', desc: 'Session completed' },
    ]
  }
];

const feedEvents = [
  { time: '14:32', session: 'Auth Refactor', event: '&#9888; Permission requested: <code>Bash(npm run test -- --coverage)</code>', color: 'var(--amber)' },
  { time: '14:32', session: 'OOH Dashboard', event: 'Edit: <code>Dashboard.razor.cs</code> (Timer polling)', color: 'var(--blue)' },
  { time: '14:31', session: 'Zendesk', event: 'Read: <code>ticket-creation.spec.ts</code>', color: 'var(--blue)' },
  { time: '14:31', session: 'IOT Admin', event: 'Grep: "provision" across services', color: 'var(--blue)' },
  { time: '14:30', session: 'Zendesk', event: '<span style="color:var(--rose)">&#10007;</span> ticket-creation.spec.ts (2/4 failed)', color: 'var(--blue)' },
  { time: '14:30', session: 'OOH Dashboard', event: 'Edit: <code>Dashboard.razor</code> (humidity widget)', color: 'var(--blue)' },
  { time: '14:30', session: 'Auth Refactor', event: 'Edit: <code>AuthService.cs</code>', color: 'var(--amber)' },
  { time: '14:29', session: 'Zendesk', event: '<span style="color:var(--green)">&#10003;</span> ticket-detail.spec.ts (6/6 passed)', color: 'var(--blue)' },
  { time: '14:29', session: 'OOH Dashboard', event: 'Edit: <code>Dashboard.razor</code> (temperature widget)', color: 'var(--blue)' },
  { time: '14:28', session: 'IOT Admin', event: 'Read: <code>DeviceService.cs</code>', color: 'var(--blue)' },
  { time: '14:25', session: 'Auth Refactor', event: 'Read: <code>AuthMiddleware.cs</code>', color: 'var(--amber)' },
  { time: '13:56', session: 'Holiday Tracker', event: '<span style="color:var(--green)">&#10003;</span> Session completed — 2 files changed, all tests passing', color: 'var(--text-muted)' },
];

// === STATE ===
let selectedSessionId = null;
let feedCollapsed = false;

// === RENDER FUNCTIONS ===
function renderSidebar() {
  const list = document.getElementById('sessionList');
  list.innerHTML = sessions.map(s => `
    <div class="session-item ${s.id === selectedSessionId ? 'selected' : ''} ${s.status === 'waiting' ? 'needs-attention' : ''}"
         onclick="selectSession('${s.id}')">
      <div class="status-dot ${s.status}"></div>
      <div class="session-info">
        <div class="session-name">${s.name}</div>
        <div class="session-meta"><span>${s.statusText}</span><span>${s.elapsed}</span></div>
      </div>
    </div>
  `).join('');
}

function renderGrid() {
  const grid = document.getElementById('sessionGrid');
  const filtered = selectedSessionId ? sessions.filter(s => s.id === selectedSessionId) : sessions;

  grid.innerHTML = filtered.map(s => `
    <div class="session-card ${s.status === 'waiting' ? 'needs-attention' : ''} ${s.status === 'completed' ? 'completed-card' : ''} ${s.id === selectedSessionId ? 'selected' : ''}"
         id="card-${s.id}" onclick="toggleCardDetail('${s.id}')">
      <div class="card-header">
        <div class="card-title">
          <div class="status-dot ${s.status}"></div>
          <h3>${s.name}</h3>
          ${s.sessionType === 'sdk-managed' ? '<span title="Dashboard-managed session" style="font-size:12px;opacity:0.5">&#9000;</span>' : ''}
        </div>
        <div style="display:flex;align-items:center;gap:4px">
          <div class="status-badge ${s.status}">${s.status === 'waiting' ? 'Permission' : s.status === 'held' ? 'On Hold' : s.status === 'stopped' ? 'Stopped' : capitalize(s.status)}</div>
          ${s.status === 'active' || s.status === 'waiting' ? `<button class="card-kill-btn" onclick="event.stopPropagation();openKillModal('${s.id}')" title="Stop session">&#9209;</button>` : ''}
        </div>
      </div>
      <div class="card-project">${s.project}</div>
      <div class="card-activity">${s.activity}</div>
      <div class="card-footer">
        <div class="card-stats">
          <span>&#128196; ${s.files} files</span>
          <span>&#9881; ${s.tools} tools</span>
          <span>&#129689; ${s.tokens} tokens</span>
        </div>
        <div style="text-align:right">
          <div class="card-time">${s.elapsed}</div>
          <div class="card-cost">~${s.cost || '—'}</div>
        </div>
      </div>
      <div class="card-detail">
        <div class="card-detail-feed">
          ${s.detail.map(d => `
            <div class="detail-line">
              <span class="detail-time">${d.time}</span>
              <span class="detail-tool" ${d.tool === 'Fail' ? 'style="color:var(--rose)"' : d.tool === 'Pass' || d.tool === 'Done' ? 'style="color:var(--green)"' : d.tool === 'Perm' ? 'style="color:var(--amber)"' : ''}>${d.tool}</span>
              <span class="detail-desc">${d.desc}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `).join('');
}

function renderPermissions() {
  const container = document.getElementById('permissionBars');
  const pending = sessions.filter(s => s.pendingPermission);

  container.innerHTML = pending.map(s => `
    <div class="permission-bar" id="perm-${s.id}">
      <div class="permission-info">
        <div class="permission-icon">&#9888;</div>
        <div class="permission-text">
          <h4>${s.name} needs permission</h4>
          <p>${s.pendingPermission.tool}: <code>${s.pendingPermission.input}</code></p>
        </div>
      </div>
      <div class="permission-actions">
        <button class="btn btn-deny" onclick="denyPermission('${s.id}')">Deny <kbd class="kbd">D</kbd></button>
        <button class="btn btn-approve" onclick="approvePermission('${s.id}')">Approve <kbd class="kbd">A</kbd></button>
      </div>
    </div>
  `).join('');
}

function renderFeed() {
  const body = document.getElementById('feedBody');
  const filtered = selectedSessionId
    ? feedEvents.filter(e => sessions.find(s => s.id === selectedSessionId)?.name.startsWith(e.session.split(' ')[0]))
    : feedEvents;

  body.innerHTML = filtered.map(e => `
    <div class="feed-item">
      <span class="feed-time">${e.time}</span>
      <span class="feed-session" style="color:${e.color}">${e.session}</span>
      <span class="feed-event">${e.event}</span>
    </div>
  `).join('');
}

function renderAll() {
  renderSidebar();
  renderGrid();
  renderPermissions();
  renderFeed();
  updateMetrics();
  updateTitle();
}

function updateMetrics() {
  const active = sessions.filter(s => s.status === 'active' || s.status === 'waiting').length;
  const attention = sessions.filter(s => s.status === 'waiting' || s.status === 'error').length;
  document.getElementById('metricActive').textContent = active;
  document.getElementById('metricAttention').textContent = attention;
}

function updateTitle() {
  const title = document.getElementById('contentTitle');
  const backBtn = document.getElementById('btnBack');
  if (selectedSessionId) {
    const s = sessions.find(s => s.id === selectedSessionId);
    title.textContent = s ? s.name : 'All Sessions';
    backBtn.style.display = 'inline-flex';
  } else {
    title.textContent = 'All Sessions';
    backBtn.style.display = 'none';
  }
}

function clearSelection() {
  selectedSessionId = null;
  renderAll();
}

// === INTERACTIONS ===
function selectSession(id) {
  selectedSessionId = selectedSessionId === id ? null : id;
  renderAll();
}

function toggleCardDetail(id) {
  const card = document.getElementById('card-' + id);
  if (card) card.classList.toggle('expanded');
}

function approvePermission(sessionId) {
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;

  const bar = document.getElementById('perm-' + sessionId);
  if (bar) { bar.style.animation = 'slideUp 0.2s ease-in forwards'; setTimeout(() => bar.remove(), 200); }

  session.pendingPermission = null;
  session.status = 'active';
  session.statusText = 'Running tests';
  session.activity = 'Running <code>npm run test -- --coverage</code>';

  showToast('success', `Approved: Bash for ${session.name}`);

  // Add event to feed
  feedEvents.unshift({
    time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    session: session.name,
    event: '<span style="color:var(--green)">&#10003;</span> Permission approved: <code>Bash(npm run test)</code>',
    color: 'var(--green)'
  });

  setTimeout(() => renderAll(), 250);
}

function denyPermission(sessionId) {
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;

  const bar = document.getElementById('perm-' + sessionId);
  if (bar) { bar.style.animation = 'slideUp 0.2s ease-in forwards'; setTimeout(() => bar.remove(), 200); }

  session.pendingPermission = null;
  session.status = 'active';
  session.statusText = 'Rethinking approach';
  session.activity = 'Permission denied for test command. Considering alternative approach...';

  showToast('warning', `Denied: Bash for ${session.name}`);

  feedEvents.unshift({
    time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    session: session.name,
    event: '<span style="color:var(--rose)">&#10007;</span> Permission denied: <code>Bash(npm run test)</code>',
    color: 'var(--rose)'
  });

  setTimeout(() => renderAll(), 250);
}

function setView(mode, btn) {
  document.querySelectorAll('.view-toggle button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const grid = document.getElementById('sessionGrid');
  grid.classList.toggle('list-mode', mode === 'list');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

function toggleFeed() {
  feedCollapsed = !feedCollapsed;
  document.getElementById('feedBody').classList.toggle('collapsed', feedCollapsed);
  document.getElementById('feedToggle').classList.toggle('collapsed', feedCollapsed);
}

// === TOASTS ===
function showToast(type, message) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = message;
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('dismissing'); setTimeout(() => toast.remove(), 200); }, 4000);
}

// === NEW SESSION MODAL ===
function openNewSession() {
  document.getElementById('newSessionModal').classList.add('visible');
  document.getElementById('newProjectDir').focus();
}

function closeNewSession() {
  document.getElementById('newSessionModal').classList.remove('visible');
}

function launchSession() {
  const dir = document.getElementById('newProjectDir').value || 'Work/General/';
  const name = document.getElementById('newSessionName').value || dir.split('/').filter(Boolean).pop();

  sessions.unshift({
    id: 'sess-' + Date.now(),
    name: name,
    project: dir,
    status: 'active',
    statusText: 'Starting...',
    elapsed: '0m',
    files: 0, tools: 0, tokens: '0',
    activity: 'Session starting — reading project context...',
    pendingPermission: null,
    detail: [
      { time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), tool: 'Init', desc: 'Session started' },
    ]
  });

  feedEvents.unshift({
    time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    session: name,
    event: '&#9889; New session launched',
    color: 'var(--green)'
  });

  closeNewSession();
  showToast('info', `Launched: ${name}`);
  renderAll();
}

// === B002: LAUNCHER & QUICK LAUNCH ===
function launchViaLauncher() {
  closeNewSession();
  showToast('info', 'Launcher opened — session will appear when started');
}

function toggleQuickLaunch() {
  const opts = document.getElementById('quickLaunchOptions');
  opts.style.display = opts.style.display === 'none' ? 'block' : 'none';
  if (opts.style.display === 'block') {
    document.getElementById('newProjectDir').focus();
  }
}

// === B005: KILL SESSION ===
let killTargetId = null;

function openKillModal(sessionId) {
  killTargetId = sessionId;
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;
  document.getElementById('killModalText').textContent =
    `This will terminate "${session.name}". Any in-progress work will be lost.`;
  document.getElementById('killModal').classList.add('visible');
}

function closeKillModal() {
  document.getElementById('killModal').classList.remove('visible');
  killTargetId = null;
}

function confirmKill() {
  if (!killTargetId) return;
  const session = sessions.find(s => s.id === killTargetId);
  if (!session) return;

  session.status = 'stopped';
  session.statusText = 'Stopped';
  session.activity = 'Session terminated from dashboard.';
  session.pendingPermission = null;

  feedEvents.unshift({
    time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    session: session.name,
    event: '<span style="color:var(--rose)">&#9209;</span> Session stopped from dashboard',
    color: 'var(--rose)'
  });

  closeKillModal();
  showToast('warning', `Stopped: ${session.name}`);
  renderAll();
}

// === COMMAND PALETTE ===
const commands = [
  { icon: '&#9888;', iconBg: 'rgba(245,158,11,0.15)', iconColor: 'var(--amber)', text: 'Approve pending permissions', desc: 'Approve all waiting sessions', action: () => { sessions.filter(s => s.pendingPermission).forEach(s => approvePermission(s.id)); closeCommandPalette(); } },
  { icon: '+', iconBg: 'rgba(59,130,246,0.15)', iconColor: 'var(--blue)', text: 'Launch new session', desc: 'Open new session dialog', action: () => { closeCommandPalette(); openNewSession(); } },
  { icon: '&#8981;', iconBg: 'rgba(255,255,255,0.05)', iconColor: 'var(--text-muted)', text: 'Show only waiting sessions', desc: 'Filter to sessions needing attention', action: () => { closeCommandPalette(); } },
  { icon: '&#8981;', iconBg: 'rgba(255,255,255,0.05)', iconColor: 'var(--text-muted)', text: 'Show all sessions', desc: 'Clear filters', action: () => { selectedSessionId = null; closeCommandPalette(); renderAll(); } },
];

let cmdHighlight = 0;
let cmdFiltered = [];

function openCommandPalette() {
  document.getElementById('cmdOverlay').classList.add('visible');
  const input = document.getElementById('cmdInput');
  input.value = '';
  input.focus();
  cmdHighlight = 0;
  updateCommandResults('');
}

function closeCommandPalette() {
  document.getElementById('cmdOverlay').classList.remove('visible');
}

function updateCommandResults(query) {
  const q = query.toLowerCase();

  // Build results: sessions + commands
  const sessionResults = sessions.map(s => ({
    icon: s.status === 'waiting' ? '&#9888;' : s.status === 'active' ? '&#9679;' : '&#10003;',
    iconBg: s.status === 'waiting' ? 'rgba(245,158,11,0.15)' : s.status === 'active' ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)',
    iconColor: s.status === 'waiting' ? 'var(--amber)' : s.status === 'active' ? 'var(--green)' : 'var(--text-muted)',
    text: `Jump to ${s.name}`,
    desc: s.project,
    action: () => { selectedSessionId = s.id; closeCommandPalette(); renderAll(); }
  }));

  const allResults = [...commands, ...sessionResults];
  cmdFiltered = q ? allResults.filter(r => r.text.toLowerCase().includes(q) || (r.desc && r.desc.toLowerCase().includes(q))) : allResults;
  cmdHighlight = Math.min(cmdHighlight, Math.max(0, cmdFiltered.length - 1));

  const container = document.getElementById('cmdResults');
  container.innerHTML = cmdFiltered.map((r, i) => `
    <div class="cmd-result ${i === cmdHighlight ? 'highlighted' : ''}" onclick="cmdFiltered[${i}].action()">
      <div class="cmd-result-left">
        <div class="cmd-result-icon" style="background:${r.iconBg};color:${r.iconColor}">${r.icon}</div>
        <div>
          <div class="cmd-result-text">${r.text}</div>
          ${r.desc ? `<div class="cmd-result-desc">${r.desc}</div>` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

// === KEYBOARD SHORTCUTS ===
document.addEventListener('keydown', (e) => {
  const cmdOpen = document.getElementById('cmdOverlay').classList.contains('visible');
  const modalOpen = document.getElementById('newSessionModal').classList.contains('visible');

  // Ctrl+K: Command palette
  if (e.ctrlKey && e.key === 'k') { e.preventDefault(); openCommandPalette(); return; }

  // Ctrl+N: New session
  if (e.ctrlKey && e.key === 'n' && !cmdOpen && !modalOpen) { e.preventDefault(); openNewSession(); return; }

  // Escape
  if (e.key === 'Escape') {
    if (cmdOpen) { closeCommandPalette(); return; }
    if (modalOpen) { closeNewSession(); return; }
    if (selectedSessionId) { selectedSessionId = null; renderAll(); return; }
  }

  // Command palette navigation
  if (cmdOpen) {
    if (e.key === 'ArrowDown') { e.preventDefault(); cmdHighlight = Math.min(cmdHighlight + 1, cmdFiltered.length - 1); updateCommandResults(document.getElementById('cmdInput').value); }
    if (e.key === 'ArrowUp') { e.preventDefault(); cmdHighlight = Math.max(cmdHighlight - 1, 0); updateCommandResults(document.getElementById('cmdInput').value); }
    if (e.key === 'Enter' && cmdFiltered[cmdHighlight]) { e.preventDefault(); cmdFiltered[cmdHighlight].action(); }
    return;
  }

  // A: Approve first pending, D: Deny first pending
  if (!modalOpen && !cmdOpen) {
    const pending = sessions.find(s => s.pendingPermission);
    if (e.key === 'a' && pending) { approvePermission(pending.id); }
    if (e.key === 'd' && pending) { denyPermission(pending.id); }

    // 1-9: Jump to session
    const num = parseInt(e.key);
    if (num >= 1 && num <= sessions.length) {
      selectSession(sessions[num - 1].id);
    }
  }
});

// Command palette input
document.getElementById('cmdInput').addEventListener('input', (e) => {
  cmdHighlight = 0;
  updateCommandResults(e.target.value);
});

// Close overlays on backdrop click
document.getElementById('cmdOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('cmdOverlay')) closeCommandPalette();
});
document.getElementById('newSessionModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('newSessionModal')) closeNewSession();
});

// === SIMULATED LIVE UPDATES ===
function simulateActivity() {
  const activeSession = sessions.find(s => s.status === 'active');
  if (!activeSession) return;

  const tools = ['Read', 'Edit', 'Glob', 'Grep', 'Bash'];
  const files = ['Component.razor', 'Service.cs', 'Controller.cs', 'Model.cs', 'appsettings.json', 'Program.cs'];
  const tool = tools[Math.floor(Math.random() * tools.length)];
  const file = files[Math.floor(Math.random() * files.length)];
  const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  activeSession.tools++;

  feedEvents.unshift({
    time,
    session: activeSession.name,
    event: `${tool}: <code>${file}</code>`,
    color: 'var(--blue)'
  });

  // Keep feed trimmed
  if (feedEvents.length > 50) feedEvents.pop();

  renderFeed();

  // Flash new feed item
  const firstItem = document.querySelector('.feed-item');
  if (firstItem) firstItem.classList.add('new');
}

setInterval(simulateActivity, 8000);

// === HELPER ===
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// === RESIZABLE PANELS ===
(function initResize() {
  // --- Activity Feed resize (drag up/down) ---
  const feedHandle = document.getElementById('feedResizeHandle');
  const feedBody = document.getElementById('feedBody');
  let feedDragging = false;

  feedHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    feedDragging = true;
    feedHandle.classList.add('dragging');
    feedBody.classList.add('resizing');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  });

  // --- Sidebar resize (drag left/right) ---
  const sidebarHandle = document.getElementById('sidebarResizeHandle');
  const sidebar = document.getElementById('sidebar');
  let sidebarDragging = false;

  sidebarHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    sidebarDragging = true;
    sidebarHandle.classList.add('dragging');
    sidebar.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (feedDragging) {
      const contentRect = document.querySelector('.content').getBoundingClientRect();
      const newHeight = contentRect.bottom - e.clientY - 28; // 28 = feed header height
      const clamped = Math.max(60, Math.min(newHeight, contentRect.height * 0.6));
      feedBody.style.setProperty('--feed-height', clamped + 'px');
      // Update the CSS variable used by the feed body
      feedBody.style.height = clamped + 'px';
    }
    if (sidebarDragging) {
      const mainRect = document.querySelector('.main').getBoundingClientRect();
      const newWidth = e.clientX - mainRect.left;
      const clamped = Math.max(160, Math.min(newWidth, 500));
      sidebar.style.width = clamped + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    if (feedDragging) {
      feedDragging = false;
      feedHandle.classList.remove('dragging');
      feedBody.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    if (sidebarDragging) {
      sidebarDragging = false;
      sidebarHandle.classList.remove('dragging');
      sidebar.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
})();

// === INIT ===
renderAll();
