// === SOCKET.IO CONNECTION ===
const socket = io();

// === APPLICATION STATE ===
let sessions = [];
let feedEvents = [];
let selectedSessionId = null;
let feedCollapsed = false;
let currentView = 'grid';
let transcriptMessages = [];
let transcriptAutoScroll = true;
let transcriptLoaded = false;
let sessionThinking = {}; // sessionId -> boolean
let sessionUsage = {}; // sessionId -> { totalTokens, estimatedCostUSD }

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

socket.on('session-removed', (data) => {
  sessions = sessions.filter(s => s.id !== data.sessionId);
  if (selectedSessionId === data.sessionId) selectedSessionId = null;
  renderAll();
});

socket.on('transcript-update', (data) => {
  if (data.sessionId === selectedSessionId && data.messages) {
    transcriptMessages = transcriptMessages.concat(data.messages);
    renderTranscript();
  }
});

socket.on('transcript-error', (data) => {
  console.log('[CC] transcript-error:', data.message);
});

socket.on('permission-timeout', (data) => {
  const session = sessions.find(s => s.id === data.sessionId);
  if (session && session.pendingPermission) {
    session.pendingPermission = null;
    showToast('warning', 'Permission timed out for ' + escapeHtml(session.name));
    renderAll();
  }
});

// SDK session output — streaming messages from dashboard-managed sessions
socket.on('session-output', (data) => {
  if (data.sessionId === selectedSessionId && data.message) {
    transcriptMessages.push(data.message);
    renderTranscript();
  }
});

socket.on('session-thinking', (data) => {
  sessionThinking[data.sessionId] = data.thinking;
  updateInputBar();
  if (data.sessionId === selectedSessionId) {
    renderTranscript();
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

function badgeText(status) {
  const map = { waiting: 'Permission', held: 'On Hold', stopped: 'Stopped' };
  return map[status] || capitalize(status);
}

function isSessionWorking(session) {
  if (session.status !== 'active') return false;
  if (!session.lastActivity) return false;
  var elapsed = Date.now() - new Date(session.lastActivity).getTime();
  return elapsed < 15000; // active within last 15 seconds
}

function renderMarkdown(text) {
  if (!text) return '';
  // Escape HTML first, then apply markdown formatting
  let html = escapeHtml(text);
  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="msg-codeblock"><code>$2</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic (single *)
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
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
    const working = isSessionWorking(s);
    const elapsed = s.status === 'completed'
      ? formatElapsedForCompleted(s.lastActivity)
      : formatElapsed(s.startedAt);

    const usage = sessionUsage[s.id];
    const tokenStr = usage && usage.totalTokens > 0 ? formatTokenCount(usage.totalTokens) : '';

    return '<div class="session-item' +
      (isSelected ? ' selected' : '') +
      (needsAttention ? ' needs-attention' : '') +
      '" onclick="selectSession(\'' + s.id + '\')">' +
      '<div class="status-dot ' + s.status + (working ? ' working' : '') + '"></div>' +
      '<div class="session-info">' +
        '<div class="session-name">' + escapeHtml(s.name) + (s.sessionType === 'sdk-managed' ? ' <span class="sdk-badge">&#9000;</span>' : '') + '</div>' +
        '<div class="session-meta">' +
          '<span>' + (working ? 'Working...' : capitalize(s.status)) + '</span>' +
          '<span>' + formatTime(s.startedAt) + '</span>' +
          '<span>' + elapsed + '</span>' +
          (tokenStr ? '<span class="session-tokens">' + tokenStr + '</span>' : '') +
        '</div>' +
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
    const working = isSessionWorking(s);
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
      '" id="card-' + s.id + '" onclick="if(!event.target.closest(\'.session-name\'))selectSession(\'' + s.id + '\')">' +
      '<div class="card-header">' +
        '<div class="card-title">' +
          '<div class="status-dot ' + s.status + (working ? ' working' : '') + '"></div>' +
          '<h3 class="session-name" ondblclick="event.stopPropagation(); startRename(\'' + s.id + '\', this)" title="Double-click to rename">' + escapeHtml(s.name) + '</h3>' +
        '</div>' +
        '<div class="card-header-actions">' +
          ((isCompleted || s.status === 'errored' || s.status === 'stopped') ? '<button class="btn-dismiss" onclick="event.stopPropagation(); dismissSession(\'' + s.id + '\')" title="Remove session">&times;</button>' : '') +
          (s.sessionType === 'sdk-managed' ? '<span class="sdk-badge" title="Dashboard-managed session">&#9000;</span>' : '') +
          (working ? '<div class="working-badge">Working</div>' : '<div class="status-badge ' + s.status + '">' + badgeText(s.status) + '</div>') +
          ((s.status === 'active' || s.status === 'waiting') ? '<button class="card-kill-btn" onclick="event.stopPropagation(); openKillModal(\'' + s.id + '\')" title="Stop session">&#9209;</button>' : '') +
        '</div>' +
      '</div>' +
      '<div class="card-project">' + escapeHtml(s.project) +
        '<span class="card-started">Started ' + formatTime(s.startedAt) + '</span>' +
      '</div>' +
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
  const activeCount = sessions.filter(s => s.status === 'active' || s.status === 'waiting' || s.status === 'held').length;
  const attentionCount = sessions.filter(s => s.status === 'waiting' || s.status === 'errored').length;

  document.getElementById('metricActive').textContent = activeCount;
  document.getElementById('metricAttention').textContent = attentionCount;

  // B007: Fetch aggregate usage
  fetch('/api/usage').then(r => r.json()).then(data => {
    document.getElementById('metricTokens').textContent = formatTokenCount(data.totalTokens || 0);
    document.getElementById('metricCost').textContent = '$' + (data.estimatedCostUSD || 0).toFixed(2);
  }).catch(() => {});

  // Fetch per-session usage for sidebar display
  for (const s of sessions) {
    fetch('/api/sessions/' + s.id + '/usage')
      .then(r => r.json())
      .then(data => {
        const prev = sessionUsage[s.id];
        const changed = !prev || prev.totalTokens !== (data.totalTokens || 0);
        sessionUsage[s.id] = { totalTokens: data.totalTokens || 0, estimatedCostUSD: data.estimatedCostUSD || 0 };
        if (changed) renderSidebar();
      })
      .catch(() => {});
  }
}

function formatTokenCount(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toString();
}

function updateTitle() {
  const title = document.getElementById('contentTitle');
  const backBtn = document.getElementById('btnBack');
  // B006: hold/resume button in content actions
  let holdBtn = document.getElementById('btnHold');
  if (!holdBtn) {
    holdBtn = document.createElement('button');
    holdBtn.id = 'btnHold';
    holdBtn.className = 'btn';
    holdBtn.style.display = 'none';
    document.querySelector('.content-actions')?.prepend(holdBtn);
  }

  if (selectedSessionId) {
    const s = sessions.find(s => s.id === selectedSessionId);
    title.textContent = s ? s.name : 'All Sessions';
    backBtn.style.display = 'inline-flex';

    // Show hold/resume for sdk-managed active/held sessions
    if (s && s.sessionType === 'sdk-managed' && (s.status === 'active' || s.status === 'held')) {
      holdBtn.style.display = 'inline-flex';
      if (s.status === 'held') {
        holdBtn.textContent = '\u25B6 Resume';
        holdBtn.onclick = () => resumeSession(s.id);
        holdBtn.style.color = 'var(--green)';
      } else {
        holdBtn.textContent = '\u23F8 Hold';
        holdBtn.onclick = () => holdSession(s.id);
        holdBtn.style.color = '';
      }
    } else {
      holdBtn.style.display = 'none';
    }
  } else {
    title.textContent = 'All Sessions';
    backBtn.style.display = 'none';
    holdBtn.style.display = 'none';
  }
}

let transcriptRenderedCount = 0;

function renderTranscriptMessage(msg) {
  const time = msg.timestamp ? formatTime(msg.timestamp) : '';

  if (msg.type === 'user') {
    return '<div class="msg msg-user">' +
      '<div class="msg-role msg-role-user">User <span class="msg-time">' + time + '</span></div>' +
      '<div class="msg-text">' + escapeHtml(msg.text) + '</div>' +
    '</div>';
  }

  if (msg.type === 'assistant') {
    return '<div class="msg msg-assistant">' +
      '<div class="msg-role msg-role-assistant">Claude <span class="msg-time">' + time + '</span></div>' +
      '<div class="msg-text">' + renderMarkdown(msg.text) + '</div>' +
    '</div>';
  }

  if (msg.type === 'tool_use') {
    return '<div class="msg msg-tool-use">' +
      '<div class="msg-role msg-role-tool"><span class="msg-tool-name">' + escapeHtml(msg.toolName || 'Tool') + '</span> <span class="msg-time">' + time + '</span></div>' +
      '<div class="msg-text">' + escapeHtml(msg.text) + '</div>' +
    '</div>';
  }

  if (msg.type === 'tool_result') {
    const isError = msg.text && (msg.text.includes('Error') || msg.text.includes('error') || msg.text.includes('ENOENT'));
    return '<div class="msg msg-tool-result' + (isError ? ' error' : '') + '">' +
      escapeHtml(msg.text) +
    '</div>';
  }

  if (msg.type === 'system') {
    return '<div class="msg msg-system">' + escapeHtml(msg.text) + '</div>';
  }

  return '';
}

function renderTranscript() {
  const panel = document.getElementById('transcriptPanel');
  const body = document.getElementById('transcriptBody');
  if (!panel || !body) return;

  if (!transcriptLoaded) {
    body.innerHTML = '<div class="transcript-loading">Loading transcript...</div>';
    transcriptRenderedCount = 0;
    return;
  }

  if (transcriptMessages.length === 0) {
    body.innerHTML = '<div class="transcript-loading">No transcript data available</div>';
    transcriptRenderedCount = 0;
    return;
  }

  // Check if user has scrolled up (not at bottom)
  const wasAtBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 50;

  // Remove working indicator before appending new messages (may be re-added at end)
  if (transcriptMessages.length > transcriptRenderedCount) {
    const existingWorking = body.querySelector('.msg-working');
    if (existingWorking) existingWorking.remove();
  }

  if (transcriptRenderedCount === 0) {
    // First render — build all messages at once
    body.innerHTML = transcriptMessages.map(renderTranscriptMessage).join('');
    transcriptRenderedCount = transcriptMessages.length;
  } else if (transcriptMessages.length > transcriptRenderedCount) {
    // Incremental append — only add new messages
    const newMessages = transcriptMessages.slice(transcriptRenderedCount);
    const fragment = document.createElement('div');
    fragment.innerHTML = newMessages.map(renderTranscriptMessage).join('');
    while (fragment.firstChild) {
      body.appendChild(fragment.firstChild);
    }
    transcriptRenderedCount = transcriptMessages.length;
  }

  // Add working indicator at the bottom
  const selectedSession = sessions.find(s => s.id === selectedSessionId);
  const shouldShowWorking = selectedSession && (isSessionWorking(selectedSession) || sessionThinking[selectedSessionId]);
  const hasWorking = !!body.querySelector('.msg-working');
  if (shouldShowWorking && !hasWorking) {
    body.insertAdjacentHTML('beforeend', '<div class="msg-working"><div class="working-dots"><span></span><span></span><span></span></div> Claude is working...</div>');
  } else if (!shouldShowWorking && hasWorking) {
    const w = body.querySelector('.msg-working');
    if (w) w.remove();
  }

  // Only auto-scroll if user was already at bottom
  if (wasAtBottom || transcriptAutoScroll) {
    body.scrollTop = body.scrollHeight;
  }
}

function toggleToolExpand(el) {
  const textEl = el.querySelector('.msg-text');
  if (textEl) {
    textEl.classList.toggle('msg-collapsed');
    textEl.classList.toggle('msg-expanded');
  }
}

function renderAll() {
  try {
    const grid = document.getElementById('sessionGrid');
    const panel = document.getElementById('transcriptPanel');

    // Toggle between grid and transcript panel
    if (selectedSessionId) {
      grid.style.display = 'none';
      panel.style.display = 'flex';
      renderTranscript();
    } else {
      grid.style.display = '';
      panel.style.display = 'none';
    }

    renderSidebar();
    renderGrid();
    renderPermissions();
    renderFeed();
    updateMetrics();
    updateTitle();
    updateInputBar();
  } catch (err) {
    console.error('[CC] renderAll ERROR:', err);
  }
}

// === INTERACTIONS ===
function selectSession(id) {
  if (selectedSessionId === id) {
    // Deselect — go back to grid view
    closeTranscript();
    return;
  }
  selectedSessionId = id;
  transcriptMessages = [];
  transcriptLoaded = false;
  transcriptRenderedCount = 0;

  const session = sessions.find(s => s.id === id);
  if (session && session.sessionType === 'sdk-managed') {
    // SDK sessions stream output via session-output events
    // Mark as loaded so the input bar appears immediately
    transcriptLoaded = true;
    renderAll();
    // Also try loading any existing JSONL transcript for history
    loadTranscript(id);
  } else {
    renderAll();
    loadTranscript(id);
  }
}

function clearSelection() {
  closeTranscript();
}

function closeTranscript() {
  if (selectedSessionId) {
    socket.emit('unwatch-transcript');
  }
  selectedSessionId = null;
  transcriptMessages = [];
  transcriptLoaded = false;
  transcriptRenderedCount = 0;
  renderAll();
}

function loadTranscript(sessionId) {
  fetch('/api/sessions/' + sessionId + '/transcript')
    .then(r => r.json())
    .then(data => {
      if (sessionId !== selectedSessionId) return; // selection changed
      transcriptMessages = data.messages || [];
      transcriptLoaded = true;
      renderTranscript();
      // Start polling for new messages
      socket.emit('watch-transcript', { sessionId: sessionId });
    })
    .catch(err => {
      console.error('[CC] Failed to load transcript:', err);
      transcriptLoaded = true;
      transcriptMessages = [];
      renderTranscript();
    });
}

function focusSessionTerminal() {
  if (!selectedSessionId) return;
  fetch('/api/sessions/' + selectedSessionId + '/focus', { method: 'POST' })
    .then(() => showToast('info', 'Switching to terminal...'))
    .catch(() => showToast('warning', 'Could not focus terminal window'));
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

function dismissSession(sessionId) {
  const card = document.getElementById('card-' + sessionId);
  if (card) {
    card.style.animation = 'slideUp 0.2s ease-in forwards';
    setTimeout(() => {
      socket.emit('dismiss-session', { sessionId: sessionId });
    }, 200);
  } else {
    socket.emit('dismiss-session', { sessionId: sessionId });
  }
}

function startRename(sessionId, el) {
  const currentName = el.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentName;
  input.className = 'rename-input';
  input.onclick = function(e) { e.stopPropagation(); };

  function commitRename() {
    const newName = input.value.trim();
    if (newName && newName !== currentName) {
      socket.emit('rename-session', { sessionId: sessionId, name: newName });
    }
    el.textContent = newName || currentName;
    el.style.display = '';
    if (input.parentNode) input.remove();
  }

  input.onblur = commitRename;
  input.onkeydown = function(e) {
    e.stopPropagation();
    if (e.key === 'Enter') { input.blur(); }
    if (e.key === 'Escape') { input.value = currentName; input.blur(); }
  };

  el.style.display = 'none';
  el.parentNode.insertBefore(input, el.nextSibling);
  input.focus();
  input.select();
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
}

function closeNewSession() {
  document.getElementById('newSessionModal').classList.remove('visible');
  // Collapse quick launch on close
  const opts = document.getElementById('quickLaunchOptions');
  if (opts) opts.style.display = 'none';
}

// B002: Open Launcher in a new terminal
function launchViaLauncher() {
  socket.emit('launch-session', { viaLauncher: true });
  showToast('info', 'Launcher opened — session will appear when started');
  closeNewSession();
}

// B002: Toggle quick launch options
function toggleQuickLaunch() {
  const opts = document.getElementById('quickLaunchOptions');
  if (!opts) return;
  opts.style.display = opts.style.display === 'none' ? 'block' : 'none';
  if (opts.style.display === 'block') {
    const dirInput = document.getElementById('newProjectDir');
    if (dirInput) dirInput.focus();
  }
}

// B002: Launch a dashboard-managed quick session
function launchSession() {
  const dir = document.getElementById('newProjectDir').value.trim();
  const name = document.getElementById('newSessionName').value.trim();
  const permMode = document.getElementById('newPermMode').value;

  if (!dir) {
    showToast('error', 'Project directory is required');
    return;
  }

  // Quick session is always dashboard-managed (sdk-managed)
  // The initial prompt will be typed in the transcript input bar after launch
  socket.emit('launch-sdk-session', {
    projectDir: dir,
    name: name || undefined,
    prompt: 'Hello — ready for instructions.',
    permissionMode: permMode,
  });

  showToast('info', 'Launching session: ' + escapeHtml(name || dir));
  closeNewSession();

  // Reset form
  document.getElementById('newProjectDir').value = '';
  document.getElementById('newSessionName').value = '';
  document.getElementById('newPermMode').value = 'default';
}

// B005: Kill session
let killTargetId = null;

function openKillModal(sessionId) {
  killTargetId = sessionId;
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;
  document.getElementById('killModalText').textContent =
    'This will terminate "' + session.name + '". Any in-progress work will be lost.';
  document.getElementById('killModal').classList.add('visible');
}

function closeKillModal() {
  document.getElementById('killModal').classList.remove('visible');
  killTargetId = null;
}

function confirmKill() {
  if (!killTargetId) return;
  socket.emit('kill-session', { sessionId: killTargetId });
  showToast('warning', 'Stopping session...');
  closeKillModal();
}

// B006: Hold/resume session
function holdSession(sessionId) {
  socket.emit('hold-session', { sessionId });
}

function resumeSession(sessionId) {
  socket.emit('resume-session', { sessionId });
}

function sendSessionMessage() {
  const input = document.getElementById('transcriptInput');
  const text = input.value.trim();
  if (!text || !selectedSessionId) return;

  const session = sessions.find(s => s.id === selectedSessionId);
  if (!session || session.sessionType !== 'sdk-managed') return;
  if (sessionThinking[selectedSessionId]) return;

  socket.emit('send-message', { sessionId: selectedSessionId, text: text });
  input.value = '';
  input.style.height = 'auto';
}

function updateInputBar() {
  const bar = document.getElementById('transcriptInputBar');
  const input = document.getElementById('transcriptInput');
  const btn = document.getElementById('transcriptSendBtn');
  const focusBar = document.getElementById('transcriptFocusBar');
  if (!bar || !input || !btn) return;

  if (!selectedSessionId) {
    bar.style.display = 'none';
    return;
  }

  const session = sessions.find(s => s.id === selectedSessionId);
  if (!session) {
    bar.style.display = 'none';
    return;
  }

  if (session.sessionType === 'sdk-managed') {
    bar.style.display = 'flex';
    bar.classList.remove('disabled-bar');
    if (focusBar) focusBar.style.display = 'none';

    // B006: On hold — show hold bar instead of input
    if (session.status === 'held') {
      bar.classList.add('disabled-bar');
      input.disabled = true;
      input.placeholder = 'Session on hold — click Resume to continue';
      btn.disabled = true;
      return;
    }

    const thinking = sessionThinking[selectedSessionId];
    if (thinking) {
      bar.classList.add('thinking');
      input.disabled = true;
      input.placeholder = 'Claude is thinking...';
      btn.disabled = true;
    } else {
      bar.classList.remove('thinking');
      input.disabled = false;
      input.placeholder = 'Type a message...';
      btn.disabled = false;
    }
  } else {
    bar.style.display = 'none';
    if (focusBar) focusBar.style.display = '';
  }
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

// === B009: DRAG AND DROP FILES ===
let pendingFiles = []; // { name, size, content, language }

const TEXT_EXTENSIONS = {
  '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
  '.cs': 'csharp', '.py': 'python', '.json': 'json', '.md': 'markdown',
  '.html': 'html', '.css': 'css', '.sql': 'sql', '.yaml': 'yaml', '.yml': 'yaml',
  '.txt': 'text', '.log': 'text', '.sh': 'bash', '.ps1': 'powershell',
  '.xml': 'xml', '.csv': 'csv', '.env': 'text', '.gitignore': 'text',
};

const MAX_FILE_SIZE = 100 * 1024; // 100KB
const MAX_FILES = 3;

(function initDragDrop() {
  const body = document.getElementById('transcriptBody');
  if (!body) return;

  body.addEventListener('dragover', (e) => {
    e.preventDefault();
    const session = sessions.find(s => s.id === selectedSessionId);
    if (!session || session.sessionType !== 'sdk-managed') return;
    body.classList.add('drag-over');
  });

  body.addEventListener('dragleave', (e) => {
    if (!body.contains(e.relatedTarget)) {
      body.classList.remove('drag-over');
    }
  });

  body.addEventListener('drop', (e) => {
    e.preventDefault();
    body.classList.remove('drag-over');

    const session = sessions.find(s => s.id === selectedSessionId);
    if (!session || session.sessionType !== 'sdk-managed') {
      showToast('warning', 'File drop only available for dashboard-managed sessions');
      return;
    }

    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (pendingFiles.length >= MAX_FILES) {
        showToast('warning', 'Max ' + MAX_FILES + ' files per message');
        break;
      }
      if (file.size > MAX_FILE_SIZE) {
        showToast('error', file.name + ' is too large (max 100KB)');
        continue;
      }
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      const lang = TEXT_EXTENSIONS[ext];
      if (!lang) {
        showToast('error', file.name + ': only text files can be added');
        continue;
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        pendingFiles.push({
          name: file.name,
          size: file.size,
          content: ev.target.result,
          language: lang,
        });
        renderFileIndicators();
      };
      reader.readAsText(file);
    }
  });
})();

function renderFileIndicators() {
  let container = document.getElementById('fileIndicators');
  if (!container) {
    container = document.createElement('div');
    container.id = 'fileIndicators';
    const inputBar = document.getElementById('transcriptInputBar');
    if (inputBar) inputBar.parentNode.insertBefore(container, inputBar);
  }

  container.innerHTML = pendingFiles.map((f, i) =>
    '<div class="file-indicator">' +
      '<span style="font-size:14px">&#128206;</span>' +
      '<span class="file-name">' + escapeHtml(f.name) + '</span>' +
      '<span class="file-size">(' + (f.size / 1024).toFixed(1) + ' KB)</span>' +
      '<button class="file-remove" onclick="removePendingFile(' + i + ')">&times;</button>' +
    '</div>'
  ).join('');
}

function removePendingFile(index) {
  pendingFiles.splice(index, 1);
  renderFileIndicators();
}

// Override sendSessionMessage to prepend file content
const originalSendSessionMessage = sendSessionMessage;
sendSessionMessage = function() {
  if (pendingFiles.length > 0) {
    const input = document.getElementById('transcriptInput');
    let prefix = '';
    for (const f of pendingFiles) {
      prefix += 'Here is the content of `' + f.name + '`:\n\n```' + f.language + '\n' + f.content + '\n```\n\n';
    }
    input.value = prefix + input.value;
    pendingFiles = [];
    renderFileIndicators();
  }
  originalSendSessionMessage();
};

// === INIT ===
renderAll();

// Textarea auto-grow and Enter key handler for text input
(function() {
  const input = document.getElementById('transcriptInput');
  if (!input) return;
  input.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 96) + 'px';
  });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendSessionMessage();
    }
  });
})();
