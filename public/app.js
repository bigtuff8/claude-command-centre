// === SOCKET.IO CONNECTION ===
const socket = io();

// === APPLICATION STATE ===
let sessions = [];
let feedEvents = [];
let selectedSessionId = null;
let feedCollapsed = false;
let currentView = 'grid';

// === SOCKET EVENT HANDLERS ===
socket.on('connect', () => {
  showToast('info', 'Connected to Command Centre');
});

socket.on('disconnect', () => {
  showToast('error', 'Disconnected from server');
});

socket.on('init', (data) => {
  sessions = data.sessions || [];
  feedEvents = data.feedEvents || [];
  renderAll();
});

socket.on('session-added', (session) => {
  console.log('[CC] session-added:', session.name);
  const existing = sessions.findIndex(s => s.id === session.id);
  if (existing === -1) {
    sessions.unshift(session);
    showToast('info', 'New session: ' + escapeHtml(session.name));
  } else {
    sessions[existing] = session;
  }
  renderAll();
});

socket.on('session-updated', (updated) => {
  console.log('[CC] session-updated:', updated.name, updated.status, 'tools:', updated.toolCount);
  const idx = sessions.findIndex(s => s.id === updated.id);
  if (idx !== -1) {
    sessions[idx] = updated;
  } else {
    sessions.unshift(updated);
  }
  renderAll();
});

socket.on('feed-event', (event) => {
  console.log('[CC] feed-event:', event.sessionName, event.toolName, event.detail);
  feedEvents.unshift(event);
  if (feedEvents.length > 200) feedEvents.length = 200;
  renderAll();
});

socket.on('permission-requested', (data) => {
  const session = sessions.find(s => s.id === data.sessionId);
  if (session) {
    session.pendingPermission = {
      toolName: data.toolName,
      toolInput: data.toolInput,
      toolUseId: data.toolUseId,
      receivedAt: new Date().toISOString()
    };
    session.status = 'waiting';
    showToast('warning', escapeHtml(data.sessionName) + ' needs permission: ' + escapeHtml(data.toolName));
    renderAll();
  }
});

socket.on('permission-resolved', (data) => {
  const session = sessions.find(s => s.id === data.sessionId);
  if (session) {
    session.pendingPermission = null;
    if (session.status === 'waiting') {
      session.status = 'active';
    }
    renderAll();
  }
});

socket.on('permission-timeout', (data) => {
  const session = sessions.find(s => s.id === data.sessionId);
  if (session && session.pendingPermission) {
    session.pendingPermission = null;
    showToast('warning', 'Permission timed out for ' + escapeHtml(session.name));
    renderAll();
  }
});

// === HELPER FUNCTIONS ===
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatElapsed(isoString) {
  if (!isoString) return '';
  const start = new Date(isoString);
  const now = new Date();
  const diffMs = now - start;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const remainMin = diffMin % 60;
  if (diffHr > 0) {
    return diffHr + 'h ' + remainMin + 'm';
  }
  return diffMin + 'm';
}

function formatElapsedForCompleted(isoString) {
  if (!isoString) return '';
  const last = new Date(isoString);
  const now = new Date();
  const diffMs = now - last;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr > 0) {
    return diffHr + 'h ago';
  }
  return diffMin + 'm ago';
}

function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function getSessionColor(status) {
  switch (status) {
    case 'active': return 'var(--green)';
    case 'waiting': return 'var(--amber)';
    case 'errored': return 'var(--rose)';
    case 'completed': return 'var(--text-muted)';
    default: return 'var(--blue)';
  }
}

function getLatestActivityForSession(sessionId) {
  const event = feedEvents.find(e => e.sessionId === sessionId);
  if (event) {
    return event.detail || event.eventName || '';
  }
  return '';
}

// === RENDER FUNCTIONS ===
function renderSidebar() {
  const list = document.getElementById('sessionList');
  if (!list) return;

  if (sessions.length === 0) {
    list.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 12px;">No sessions</div>';
    return;
  }

  list.innerHTML = sessions.map(s => {
    const isSelected = s.id === selectedSessionId;
    const needsAttention = s.status === 'waiting';
    const elapsed = s.status === 'completed'
      ? formatElapsedForCompleted(s.lastActivity)
      : formatElapsed(s.startedAt);

    return '<div class="session-item' +
      (isSelected ? ' selected' : '') +
      (needsAttention ? ' needs-attention' : '') +
      '" onclick="selectSession(\'' + s.id + '\')">' +
      '<div class="status-dot ' + s.status + '"></div>' +
      '<div class="session-info">' +
        '<div class="session-name">' + escapeHtml(s.name) + '</div>' +
        '<div class="session-meta"><span>' + capitalize(s.status) + '</span><span>' + elapsed + '</span></div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderGrid() {
  const grid = document.getElementById('sessionGrid');
  if (!grid) return;

  const filtered = selectedSessionId
    ? sessions.filter(s => s.id === selectedSessionId)
    : sessions;

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state">' +
      '<h3>No sessions running</h3>' +
      '<p>Launch a new session to get started. Use the "+ New Session" button or press Ctrl+N.</p>' +
      '<button class="btn btn-primary" onclick="openNewSession()">+ New Session</button>' +
    '</div>';
    return;
  }

  grid.innerHTML = filtered.map(s => {
    const needsAttention = s.status === 'waiting';
    const isCompleted = s.status === 'completed';
    const isSelected = s.id === selectedSessionId;
    const elapsed = isCompleted
      ? formatElapsedForCompleted(s.lastActivity)
      : formatElapsed(s.startedAt);
    const activity = getLatestActivityForSession(s.id);
    const fileCount = s.filesModified ? s.filesModified.length : 0;

    // Get recent feed events for detail accordion
    const recentEvents = feedEvents
      .filter(e => e.sessionId === s.id)
      .slice(0, 8);

    const detailHtml = recentEvents.map(e => {
      const time = formatTime(e.timestamp);
      const toolName = e.toolName || '';
      const detail = e.detail || e.eventName || '';
      return '<div class="detail-line">' +
        '<span class="detail-time">' + time + '</span>' +
        '<span class="detail-tool">' + escapeHtml(toolName) + '</span>' +
        '<span class="detail-desc">' + escapeHtml(detail) + '</span>' +
      '</div>';
    }).join('');

    return '<div class="session-card' +
      (needsAttention ? ' needs-attention' : '') +
      (isCompleted ? ' completed-card' : '') +
      (isSelected ? ' selected' : '') +
      '" id="card-' + s.id + '" onclick="toggleCardDetail(\'' + s.id + '\')">' +
      '<div class="card-header">' +
        '<div class="card-title">' +
          '<div class="status-dot ' + s.status + '"></div>' +
          '<h3>' + escapeHtml(s.name) + '</h3>' +
        '</div>' +
        '<div class="status-badge ' + s.status + '">' + capitalize(s.status) + '</div>' +
      '</div>' +
      '<div class="card-project">' + escapeHtml(s.project) + '</div>' +
      '<div class="card-activity">' + escapeHtml(activity) + '</div>' +
      '<div class="card-footer">' +
        '<div class="card-stats">' +
          '<span>&#128196; ' + fileCount + ' files</span>' +
          '<span>&#9881; ' + (s.toolCount || 0) + ' tools</span>' +
        '</div>' +
        '<div class="card-time">' + elapsed + '</div>' +
      '</div>' +
      '<div class="card-detail">' +
        '<div class="card-detail-feed">' + detailHtml + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderPermissions() {
  const container = document.getElementById('permissionBars');
  if (!container) return;

  const pending = sessions.filter(s => s.pendingPermission);

  container.innerHTML = pending.map(s => {
    const perm = s.pendingPermission;
    const inputPreview = typeof perm.toolInput === 'string'
      ? perm.toolInput
      : JSON.stringify(perm.toolInput).substring(0, 120);

    return '<div class="permission-bar" id="perm-' + s.id + '">' +
      '<div class="permission-info">' +
        '<div class="permission-icon">&#9888;</div>' +
        '<div class="permission-text">' +
          '<h4>' + escapeHtml(s.name) + ' needs permission</h4>' +
          '<p>' + escapeHtml(perm.toolName) + ': <code>' + escapeHtml(inputPreview) + '</code></p>' +
        '</div>' +
      '</div>' +
      '<div class="permission-actions">' +
        '<button class="btn btn-deny" onclick="event.stopPropagation(); denyPermission(\'' + s.id + '\')">Deny <kbd class="kbd">D</kbd></button>' +
        '<button class="btn btn-approve" onclick="event.stopPropagation(); approvePermission(\'' + s.id + '\')">Approve <kbd class="kbd">A</kbd></button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderFeed() {
  const body = document.getElementById('feedBody');
  if (!body) return;

  const filtered = selectedSessionId
    ? feedEvents.filter(e => e.sessionId === selectedSessionId)
    : feedEvents;

  if (filtered.length === 0) {
    body.innerHTML = '<div style="padding: 16px 24px; color: var(--text-muted); font-size: 12px;">No activity yet</div>';
    return;
  }

  body.innerHTML = filtered.map(e => {
    const time = formatTime(e.timestamp);
    const sessionColor = getSessionColor(
      (sessions.find(s => s.id === e.sessionId) || {}).status
    );
    const detail = e.detail || e.eventName || '';

    return '<div class="feed-item">' +
      '<span class="feed-time">' + time + '</span>' +
      '<span class="feed-session" style="color:' + sessionColor + '">' + escapeHtml(e.sessionName) + '</span>' +
      '<span class="feed-event">' + escapeHtml(detail) + '</span>' +
    '</div>';
  }).join('');
}

function flashFirstFeedItem() {
  requestAnimationFrame(() => {
    const firstItem = document.querySelector('.feed-item');
    if (firstItem) firstItem.classList.add('new');
  });
}

function updateMetrics() {
  const activeCount = sessions.filter(s => s.status === 'active').length;
  const attentionCount = sessions.filter(s => s.status === 'waiting' || s.status === 'errored').length;
  const totalSessions = sessions.length;

  document.getElementById('metricActive').textContent = activeCount;
  document.getElementById('metricAttention').textContent = attentionCount;
  document.getElementById('metricTokens').textContent = totalSessions;
  document.getElementById('metricCost').textContent = '$0.00';
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

function renderAll() {
  try {
    renderSidebar();
    renderGrid();
    renderPermissions();
    renderFeed();
    updateMetrics();
    updateTitle();
    console.log('[CC] renderAll complete — sessions:', sessions.length, 'feed:', feedEvents.length);
  } catch (err) {
    console.error('[CC] renderAll ERROR:', err);
  }
}

// === INTERACTIONS ===
function selectSession(id) {
  selectedSessionId = selectedSessionId === id ? null : id;
  renderAll();
}

function clearSelection() {
  selectedSessionId = null;
  renderAll();
}

function toggleCardDetail(id) {
  const card = document.getElementById('card-' + id);
  if (card) card.classList.toggle('expanded');
}

function approvePermission(sessionId) {
  const session = sessions.find(s => s.id === sessionId);
  if (!session || !session.pendingPermission) return;

  const bar = document.getElementById('perm-' + sessionId);
  if (bar) {
    bar.style.animation = 'slideUp 0.2s ease-in forwards';
    setTimeout(() => bar.remove(), 200);
  }

  socket.emit('permission-response', {
    sessionId: sessionId,
    decision: 'allow'
  });

  showToast('success', 'Approved: ' + escapeHtml(session.pendingPermission.toolName) + ' for ' + escapeHtml(session.name));

  session.pendingPermission = null;
  session.status = 'active';
  setTimeout(() => renderAll(), 250);
}

function denyPermission(sessionId) {
  const session = sessions.find(s => s.id === sessionId);
  if (!session || !session.pendingPermission) return;

  const bar = document.getElementById('perm-' + sessionId);
  if (bar) {
    bar.style.animation = 'slideUp 0.2s ease-in forwards';
    setTimeout(() => bar.remove(), 200);
  }

  socket.emit('permission-response', {
    sessionId: sessionId,
    decision: 'deny'
  });

  showToast('warning', 'Denied: ' + escapeHtml(session.pendingPermission.toolName) + ' for ' + escapeHtml(session.name));

  session.pendingPermission = null;
  session.status = 'active';
  setTimeout(() => renderAll(), 250);
}

function setView(mode, btn) {
  currentView = mode;
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
  toast.className = 'toast ' + type;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('dismissing');
    setTimeout(() => toast.remove(), 200);
  }, 4000);
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
  const dir = document.getElementById('newProjectDir').value.trim();
  const name = document.getElementById('newSessionName').value.trim();
  const prompt = document.getElementById('newSessionPrompt').value.trim();
  const permMode = document.getElementById('newPermMode').value;

  if (!dir) {
    showToast('error', 'Project directory is required');
    return;
  }

  socket.emit('launch-session', {
    projectDir: dir,
    name: name || undefined,
    prompt: prompt || undefined,
    permMode: permMode
  });

  showToast('info', 'Launching session: ' + escapeHtml(name || dir));
  closeNewSession();

  // Reset form
  document.getElementById('newProjectDir').value = '';
  document.getElementById('newSessionName').value = '';
  document.getElementById('newSessionPrompt').value = '';
  document.getElementById('newPermMode').value = 'default';
}

// === COMMAND PALETTE ===
let cmdHighlight = 0;
let cmdFiltered = [];

function getCommands() {
  return [
    {
      icon: '&#9888;',
      iconBg: 'rgba(245,158,11,0.15)',
      iconColor: 'var(--amber)',
      text: 'Approve pending permissions',
      desc: 'Approve all waiting sessions',
      action: function() {
        sessions.filter(s => s.pendingPermission).forEach(s => approvePermission(s.id));
        closeCommandPalette();
      }
    },
    {
      icon: '+',
      iconBg: 'rgba(59,130,246,0.15)',
      iconColor: 'var(--blue)',
      text: 'Launch new session',
      desc: 'Open new session dialog',
      action: function() {
        closeCommandPalette();
        openNewSession();
      }
    },
    {
      icon: '&#8981;',
      iconBg: 'rgba(255,255,255,0.05)',
      iconColor: 'var(--text-muted)',
      text: 'Show all sessions',
      desc: 'Clear filters',
      action: function() {
        selectedSessionId = null;
        closeCommandPalette();
        renderAll();
      }
    }
  ];
}

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

  const sessionResults = sessions.map(s => ({
    icon: s.status === 'waiting' ? '&#9888;' : s.status === 'active' ? '&#9679;' : '&#10003;',
    iconBg: s.status === 'waiting' ? 'rgba(245,158,11,0.15)' : s.status === 'active' ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)',
    iconColor: s.status === 'waiting' ? 'var(--amber)' : s.status === 'active' ? 'var(--green)' : 'var(--text-muted)',
    text: 'Jump to ' + s.name,
    desc: s.project,
    action: function() {
      selectedSessionId = s.id;
      closeCommandPalette();
      renderAll();
    }
  }));

  const allResults = getCommands().concat(sessionResults);
  cmdFiltered = q
    ? allResults.filter(r => r.text.toLowerCase().includes(q) || (r.desc && r.desc.toLowerCase().includes(q)))
    : allResults;
  cmdHighlight = Math.min(cmdHighlight, Math.max(0, cmdFiltered.length - 1));

  const container = document.getElementById('cmdResults');
  container.innerHTML = cmdFiltered.map((r, i) => {
    return '<div class="cmd-result' + (i === cmdHighlight ? ' highlighted' : '') + '" data-idx="' + i + '">' +
      '<div class="cmd-result-left">' +
        '<div class="cmd-result-icon" style="background:' + r.iconBg + ';color:' + r.iconColor + '">' + r.icon + '</div>' +
        '<div>' +
          '<div class="cmd-result-text">' + r.text + '</div>' +
          (r.desc ? '<div class="cmd-result-desc">' + escapeHtml(r.desc) + '</div>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// Command palette click handler (delegated)
document.getElementById('cmdResults').addEventListener('click', (e) => {
  const resultEl = e.target.closest('.cmd-result');
  if (resultEl) {
    const idx = parseInt(resultEl.dataset.idx, 10);
    if (cmdFiltered[idx]) cmdFiltered[idx].action();
  }
});

// === KEYBOARD SHORTCUTS ===
document.addEventListener('keydown', (e) => {
  const cmdOpen = document.getElementById('cmdOverlay').classList.contains('visible');
  const modalOpen = document.getElementById('newSessionModal').classList.contains('visible');
  const isInputFocused = document.activeElement &&
    (document.activeElement.tagName === 'INPUT' ||
     document.activeElement.tagName === 'TEXTAREA' ||
     document.activeElement.tagName === 'SELECT');

  // Ctrl+K: Command palette
  if (e.ctrlKey && e.key === 'k') {
    e.preventDefault();
    openCommandPalette();
    return;
  }

  // Ctrl+N: New session
  if (e.ctrlKey && e.key === 'n' && !cmdOpen && !modalOpen) {
    e.preventDefault();
    openNewSession();
    return;
  }

  // Escape
  if (e.key === 'Escape') {
    if (cmdOpen) { closeCommandPalette(); return; }
    if (modalOpen) { closeNewSession(); return; }
    if (selectedSessionId) { selectedSessionId = null; renderAll(); return; }
  }

  // Command palette navigation
  if (cmdOpen) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cmdHighlight = Math.min(cmdHighlight + 1, cmdFiltered.length - 1);
      updateCommandResults(document.getElementById('cmdInput').value);
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      cmdHighlight = Math.max(cmdHighlight - 1, 0);
      updateCommandResults(document.getElementById('cmdInput').value);
    }
    if (e.key === 'Enter' && cmdFiltered[cmdHighlight]) {
      e.preventDefault();
      cmdFiltered[cmdHighlight].action();
    }
    return;
  }

  // Global shortcuts (only when no input is focused and no modal open)
  if (!modalOpen && !cmdOpen && !isInputFocused) {
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

// Command palette input handler
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

// === ELAPSED TIME AUTO-UPDATE ===
setInterval(() => {
  // Re-render sidebar and grid to update elapsed times
  renderSidebar();
  renderGrid();
}, 30000);

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
      const newHeight = contentRect.bottom - e.clientY - 28;
      const clamped = Math.max(60, Math.min(newHeight, contentRect.height * 0.6));
      feedBody.style.setProperty('--feed-height', clamped + 'px');
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
