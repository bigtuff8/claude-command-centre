import { test, expect } from '@playwright/test';

/**
 * Command Centre E2E Tests
 *
 * Tests against the live server at localhost:4111.
 * Server must be running before executing these tests.
 *
 * Covers: F033 (start time), F032 (rename), F031 (scroll-lock),
 *         F026 (toast notifications - limited to UI toasts),
 *         spawner fix, dashboard rendering, Socket.io connectivity.
 */

// --- Helpers ---

/** Wait for Socket.io to connect and sessions to load */
async function waitForDashboard(page) {
  await page.goto('/');
  // Wait for Socket.io init — the metrics bar updates when connected
  await expect(page.locator('.metrics-bar')).toBeVisible();
  // Give Socket.io a moment to deliver init payload
  await page.waitForTimeout(1000);
}

/** Inject a fake session via the server's hook endpoint */
async function injectTestSession(page, sessionId: string, cwd: string) {
  await page.request.post('/hooks/session-start', {
    data: {
      session_id: sessionId,
      cwd: cwd,
    },
  });
  // Allow Socket.io to propagate the event
  await page.waitForTimeout(500);
}

/** Inject a tool use event via post-tool-use (non-blocking, no permission hold) */
async function injectToolEvent(page, sessionId: string, toolName: string) {
  await page.request.post('/hooks/post-tool-use', {
    data: {
      session_id: sessionId,
      tool_name: toolName,
      tool_input: { command: 'echo test' },
      tool_use_id: `tu_${Date.now()}`,
    },
  });
  await page.waitForTimeout(300);
}

// --- Tests ---

test.describe('Dashboard Loading & Connectivity', () => {

  test('dashboard loads and displays metrics bar', async ({ page }) => {
    await waitForDashboard(page);

    // Data fidelity: check actual text content, not just element existence
    await expect(page.locator('.logo')).toContainText('Command Centre');
    await expect(page.locator('#metricActive')).toBeVisible();
    await expect(page.locator('#metricAttention')).toBeVisible();
  });

  test('healthz endpoint returns ok', async ({ request }) => {
    const response = await request.get('/healthz');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.uptime).toBeGreaterThan(0);
  });

  test('Socket.io connects and receives init payload', async ({ page }) => {
    await waitForDashboard(page);

    // The session list should be rendered (even if empty)
    await expect(page.locator('#sessionList')).toBeVisible();
    // The grid should be rendered
    await expect(page.locator('#sessionGrid')).toBeVisible();
  });

});


test.describe('F033: Session Start Time on Cards', () => {

  test('session card displays "Started HH:MM" text', async ({ page }) => {
    const testId = `test-f033-${Date.now()}`;
    await waitForDashboard(page);
    await injectTestSession(page, testId, 'C:/Projects/TestApp');

    // Find the card for our test session
    const card = page.locator(`#card-${testId}`);
    await expect(card).toBeVisible({ timeout: 5000 });

    // Data fidelity: verify "Started" text appears with a time pattern
    const startedSpan = card.locator('.card-started');
    await expect(startedSpan).toBeVisible();
    const startedText = await startedSpan.textContent();
    expect(startedText).toMatch(/Started \d{1,2}:\d{2}/);
  });

  test('start time is positioned on the project path row', async ({ page }) => {
    const testId = `test-f033b-${Date.now()}`;
    await waitForDashboard(page);
    await injectTestSession(page, testId, 'C:/Projects/AnotherApp');

    const card = page.locator(`#card-${testId}`);
    await expect(card).toBeVisible({ timeout: 5000 });

    // The started span should be inside the card-project div
    const projectDiv = card.locator('.card-project');
    await expect(projectDiv).toBeVisible();
    await expect(projectDiv.locator('.card-started')).toBeVisible();

    // Data fidelity: project path should also display
    const projectText = await projectDiv.textContent();
    expect(projectText).toContain('AnotherApp');
  });

});


test.describe('F032: Rename Sessions from Dashboard', () => {

  test('double-clicking session name shows rename input', async ({ page }) => {
    const testId = `test-f032a-${Date.now()}`;
    await waitForDashboard(page);
    await injectTestSession(page, testId, 'C:/Projects/RenameTest');

    const card = page.locator(`#card-${testId}`);
    await expect(card).toBeVisible({ timeout: 5000 });

    // Find the h3 session name
    const nameEl = card.locator('h3.session-name');
    await expect(nameEl).toHaveText('RenameTest');

    // Double-click to trigger rename (card onclick ignores clicks on .session-name)
    await nameEl.dblclick();
    await page.waitForTimeout(300);

    // Rename input should appear inside the card
    const renameInput = card.locator('input.rename-input');
    await expect(renameInput).toBeVisible({ timeout: 3000 });
    await expect(renameInput).toHaveValue('RenameTest');
  });

  test('typing a new name and pressing Enter renames the session', async ({ page }) => {
    const testId = `test-f032b-${Date.now()}`;
    await waitForDashboard(page);
    await injectTestSession(page, testId, 'C:/Projects/BeforeRename');

    const card = page.locator(`#card-${testId}`);
    await expect(card).toBeVisible({ timeout: 5000 });

    const nameEl = card.locator('h3.session-name');
    await expect(nameEl).toHaveText('BeforeRename');

    // Double-click to rename
    await nameEl.dblclick();
    await page.waitForTimeout(300);
    const renameInput = card.locator('input.rename-input');
    await expect(renameInput).toBeVisible({ timeout: 3000 });

    // Realistic input simulation: use pressSequentially
    await renameInput.clear();
    await renameInput.pressSequentially('AfterRename', { delay: 30 });
    await renameInput.press('Enter');

    // Wait for Socket.io round-trip (server rename + session-updated broadcast)
    await page.waitForTimeout(1500);

    // Data fidelity: verify the name actually changed
    // After session-updated event, the card re-renders with new name
    const updatedName = card.locator('h3.session-name');
    await expect(updatedName).toHaveText('AfterRename', { timeout: 3000 });
  });

  test('pressing Escape cancels rename without changing name', async ({ page }) => {
    const testId = `test-f032c-${Date.now()}`;
    await waitForDashboard(page);
    await injectTestSession(page, testId, 'C:/Projects/KeepName');

    const card = page.locator(`#card-${testId}`);
    await expect(card).toBeVisible({ timeout: 5000 });

    const nameEl = card.locator('h3.session-name');
    await nameEl.dblclick();
    await page.waitForTimeout(300);

    const renameInput = card.locator('input.rename-input');
    await expect(renameInput).toBeVisible({ timeout: 3000 });
    await renameInput.clear();
    await renameInput.pressSequentially('ShouldNotStick', { delay: 30 });
    await renameInput.press('Escape');

    await page.waitForTimeout(500);

    // Removal assertion: input should be gone
    await expect(renameInput).not.toBeVisible();

    // Data fidelity: name should be unchanged
    await expect(nameEl).toHaveText('KeepName');
  });

  test('rename with empty string keeps original name', async ({ page }) => {
    const testId = `test-f032d-${Date.now()}`;
    await waitForDashboard(page);
    await injectTestSession(page, testId, 'C:/Projects/OriginalName');

    const card = page.locator(`#card-${testId}`);
    await expect(card).toBeVisible({ timeout: 5000 });

    const nameEl = card.locator('h3.session-name');
    await nameEl.dblclick();
    await page.waitForTimeout(300);

    const renameInput = card.locator('input.rename-input');
    await expect(renameInput).toBeVisible({ timeout: 3000 });
    await renameInput.clear();
    await renameInput.press('Enter');

    await page.waitForTimeout(500);

    // Data fidelity: name should fall back to original
    await expect(nameEl).toHaveText('OriginalName');
  });

});


test.describe('F031: Transcript Scroll-Lock', () => {

  test('transcript panel opens when session is selected', async ({ page }) => {
    const testId = `test-f031a-${Date.now()}`;
    await waitForDashboard(page);
    await injectTestSession(page, testId, 'C:/Projects/ScrollTest');

    // Click session card to open transcript
    const card = page.locator(`#card-${testId}`);
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.click();

    // Transcript panel should appear
    const transcriptPanel = page.locator('#transcriptPanel');
    await expect(transcriptPanel).toBeVisible();

    // Back button should appear
    await expect(page.locator('#btnBack')).toBeVisible();
  });

  test('transcript body does not lose scroll position when new messages arrive', async ({ page }) => {
    const testId = `test-f031b-${Date.now()}`;
    await waitForDashboard(page);
    await injectTestSession(page, testId, 'C:/Projects/ScrollLockTest');

    // Generate several tool events to create transcript content
    for (let i = 0; i < 5; i++) {
      await injectToolEvent(page, testId, `Read_${i}`);
    }

    // Select the session to open transcript
    const card = page.locator(`#card-${testId}`);
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.click();

    const transcriptBody = page.locator('#transcriptBody');
    await expect(transcriptBody).toBeVisible();

    // Wait for transcript to load
    await page.waitForTimeout(2000);

    // Scroll up (simulate user reading history)
    await transcriptBody.evaluate(el => { el.scrollTop = 0; });
    const scrollTopBefore = await transcriptBody.evaluate(el => el.scrollTop);
    expect(scrollTopBefore).toBe(0);

    // Inject a new event while scrolled up
    await injectToolEvent(page, testId, 'NewToolWhileScrolled');
    await page.waitForTimeout(1500);

    // Scroll position should be preserved (still at top, not jumped to bottom)
    const scrollTopAfter = await transcriptBody.evaluate(el => el.scrollTop);
    // Allow small tolerance but should NOT have jumped to bottom
    const scrollHeight = await transcriptBody.evaluate(el => el.scrollHeight);
    const clientHeight = await transcriptBody.evaluate(el => el.clientHeight);

    // If content exceeds viewport, scroll should NOT be at the bottom
    if (scrollHeight > clientHeight) {
      const distanceFromBottom = scrollHeight - scrollTopAfter - clientHeight;
      expect(distanceFromBottom).toBeGreaterThan(10);
    }
  });

  test('back button returns to grid view and closes transcript', async ({ page }) => {
    const testId = `test-f031c-${Date.now()}`;
    await waitForDashboard(page);
    await injectTestSession(page, testId, 'C:/Projects/BackTest');

    const card = page.locator(`#card-${testId}`);
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.click();

    await expect(page.locator('#transcriptPanel')).toBeVisible();

    // Click back
    await page.locator('#btnBack').click();

    // Multi-step verification: transcript gone, grid back
    await expect(page.locator('#transcriptPanel')).not.toBeVisible();
    await expect(page.locator('#sessionGrid')).toBeVisible();
    await expect(page.locator('#btnBack')).not.toBeVisible();
  });

});


test.describe('Session Lifecycle', () => {

  test('new session appears on dashboard via hook', async ({ page }) => {
    const testId = `test-lifecycle-${Date.now()}`;
    await waitForDashboard(page);

    // Count sessions before
    const countBefore = await page.locator('.session-card').count();

    await injectTestSession(page, testId, 'C:/Projects/LifecycleTest');

    // Session should appear as a card
    const card = page.locator(`#card-${testId}`);
    await expect(card).toBeVisible({ timeout: 5000 });

    // Data fidelity: card should show session name derived from path
    await expect(card.locator('h3.session-name')).toHaveText('LifecycleTest');

    // Should also appear in sidebar
    const sidebar = page.locator('#sessionList');
    await expect(sidebar).toContainText('LifecycleTest');

    // Count should have increased
    const countAfter = await page.locator('.session-card').count();
    expect(countAfter).toBeGreaterThan(countBefore);
  });

  test('session card shows correct status badge', async ({ page }) => {
    const testId = `test-status-${Date.now()}`;
    await waitForDashboard(page);
    await injectTestSession(page, testId, 'C:/Projects/StatusTest');

    const card = page.locator(`#card-${testId}`);
    await expect(card).toBeVisible({ timeout: 5000 });

    // Active sessions should show Active badge or Working badge
    const badge = card.locator('.status-badge, .working-badge');
    await expect(badge).toBeVisible();
    const badgeText = await badge.textContent();
    expect(['Active', 'Working']).toContain(badgeText);
  });

  test('session end hook marks session as completed', async ({ page }) => {
    const testId = `test-end-${Date.now()}`;
    await waitForDashboard(page);
    await injectTestSession(page, testId, 'C:/Projects/EndTest');

    const card = page.locator(`#card-${testId}`);
    await expect(card).toBeVisible({ timeout: 5000 });

    // Send session-end hook
    await page.request.post('/hooks/session-end', {
      data: { session_id: testId },
    });
    await page.waitForTimeout(500);

    // Status should change to completed
    const badge = card.locator('.status-badge');
    await expect(badge).toHaveText('Completed');

    // Dismiss button should appear
    await expect(card.locator('.btn-dismiss')).toBeVisible();
  });

  test('dismiss button removes completed session from dashboard', async ({ page }) => {
    const testId = `test-dismiss-${Date.now()}`;
    await waitForDashboard(page);
    await injectTestSession(page, testId, 'C:/Projects/DismissTest');

    const card = page.locator(`#card-${testId}`);
    await expect(card).toBeVisible({ timeout: 5000 });

    // End the session
    await page.request.post('/hooks/session-end', {
      data: { session_id: testId },
    });
    await page.waitForTimeout(500);

    // Click dismiss
    await card.locator('.btn-dismiss').click();
    await page.waitForTimeout(500);

    // Removal assertion: card should be gone
    await expect(card).not.toBeVisible();
  });

});


test.describe('B002: New Session Modal (Redesigned)', () => {

  test('clicking +New Session opens the redesigned modal with two options', async ({ page }) => {
    await waitForDashboard(page);

    await page.locator('button:has-text("+ New Session")').click();

    const modal = page.locator('#newSessionModal');
    await expect(modal).toBeVisible();

    // B002: Should have "Open Launcher" and "Quick Session" buttons
    await expect(page.locator('.launch-primary')).toBeVisible();
    await expect(page.locator('.launch-secondary')).toBeVisible();
    await expect(page.locator('.launch-primary')).toContainText('Open Launcher');
    await expect(page.locator('.launch-secondary')).toContainText('Quick Session');

    // Quick launch options should be collapsed by default
    const quickOpts = page.locator('#quickLaunchOptions');
    await expect(quickOpts).not.toBeVisible();
  });

  test('clicking Quick Session expands the form', async ({ page }) => {
    await waitForDashboard(page);

    await page.locator('button:has-text("+ New Session")').click();
    await page.locator('.launch-secondary').click();

    // Quick launch form should now be visible
    const quickOpts = page.locator('#quickLaunchOptions');
    await expect(quickOpts).toBeVisible();
    await expect(page.locator('#newProjectDir')).toBeVisible();
    await expect(page.locator('#newSessionName')).toBeVisible();
    await expect(page.locator('#newPermMode')).toBeVisible();
  });

  test('Open Launcher shows toast and closes modal', async ({ page }) => {
    await waitForDashboard(page);

    await page.locator('button:has-text("+ New Session")').click();
    await page.locator('.launch-primary').click();

    // Modal should close
    await expect(page.locator('#newSessionModal')).not.toBeVisible();

    // Toast should appear with launcher message
    const toast = page.locator('.toast.info:has-text("Launcher opened")');
    await expect(toast).toBeVisible({ timeout: 3000 });
  });

  test('quick launch without project dir shows error toast', async ({ page }) => {
    await waitForDashboard(page);

    await page.locator('button:has-text("+ New Session")').click();
    await page.locator('.launch-secondary').click();
    // Leave project dir empty and click Start Session
    await page.locator('button:has-text("Start Session")').click();

    const toast = page.locator('.toast.error');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toContainText('required');
  });

  test('closing modal collapses quick launch options', async ({ page }) => {
    await waitForDashboard(page);

    await page.locator('button:has-text("+ New Session")').click();
    await page.locator('.launch-secondary').click();
    await expect(page.locator('#quickLaunchOptions')).toBeVisible();

    // Close via X button
    await page.locator('.modal-close').first().click();

    // Reopen — quick launch should be collapsed again
    await page.locator('button:has-text("+ New Session")').click();
    await expect(page.locator('#quickLaunchOptions')).not.toBeVisible();
  });

});


test.describe('Activity Feed', () => {

  test('activity feed shows events from session hooks', async ({ page }) => {
    const testId = `test-feed-${Date.now()}`;
    await waitForDashboard(page);
    await injectTestSession(page, testId, 'C:/Projects/FeedTest');

    // Inject a tool event
    await injectToolEvent(page, testId, 'Bash');

    // Feed should contain the event
    const feed = page.locator('#feedBody');
    await expect(feed).toContainText('FeedTest', { timeout: 3000 });
  });

});


test.describe('Metrics Bar', () => {

  test('active count updates when sessions are added', async ({ page }) => {
    await waitForDashboard(page);

    const metricActive = page.locator('#metricActive');
    const countBefore = parseInt(await metricActive.textContent() || '0');

    const testId = `test-metric-${Date.now()}`;
    await injectTestSession(page, testId, 'C:/Projects/MetricTest');

    // Active count should increase
    await expect(metricActive).toHaveText(String(countBefore + 1), { timeout: 3000 });
  });

});


test.describe('B005: Session Kill', () => {

  test('active session card shows kill button', async ({ page }) => {
    const testId = `test-kill-btn-${Date.now()}`;
    await waitForDashboard(page);
    await injectTestSession(page, testId, 'C:/Projects/KillBtnTest');

    const card = page.locator(`#card-${testId}`);
    await expect(card).toBeVisible({ timeout: 5000 });

    // Kill button should be visible on active cards
    const killBtn = card.locator('.card-kill-btn');
    await expect(killBtn).toBeVisible();
  });

  test('kill button opens confirmation modal', async ({ page }) => {
    const testId = `test-kill-modal-${Date.now()}`;
    await waitForDashboard(page);
    await injectTestSession(page, testId, 'C:/Projects/KillModalTest');

    const card = page.locator(`#card-${testId}`);
    await expect(card).toBeVisible({ timeout: 5000 });

    await card.locator('.card-kill-btn').click();

    const killModal = page.locator('#killModal');
    await expect(killModal).toBeVisible();
    await expect(killModal).toContainText('Stop Session');
    await expect(killModal).toContainText('KillModalTest');
  });

  test('cancel in kill modal closes it without stopping', async ({ page }) => {
    const testId = `test-kill-cancel-${Date.now()}`;
    await waitForDashboard(page);
    await injectTestSession(page, testId, 'C:/Projects/KillCancelTest');

    const card = page.locator(`#card-${testId}`);
    await expect(card).toBeVisible({ timeout: 5000 });

    await card.locator('.card-kill-btn').click();
    await expect(page.locator('#killModal')).toBeVisible();

    // Click cancel
    await page.locator('#killModal button:has-text("Cancel")').click();
    await expect(page.locator('#killModal')).not.toBeVisible();

    // Session should still be active — check it's NOT stopped/completed
    // The badge may be .status-badge or .working-badge depending on timing
    const badgeOrWorking = card.locator('.status-badge, .working-badge');
    await expect(badgeOrWorking.first()).toBeVisible({ timeout: 3000 });
    const text = await badgeOrWorking.first().textContent();
    expect(text).not.toBe('Stopped');
    expect(text).not.toBe('Completed');
  });

  test('completed sessions do not show kill button', async ({ page }) => {
    const testId = `test-kill-no-btn-${Date.now()}`;
    await waitForDashboard(page);
    await injectTestSession(page, testId, 'C:/Projects/KillNoBtnTest');

    // End the session
    await page.request.post('/hooks/session-end', {
      data: { session_id: testId },
    });
    await page.waitForTimeout(500);

    const card = page.locator(`#card-${testId}`);
    await expect(card).toBeVisible({ timeout: 5000 });

    // Kill button should NOT be visible on completed sessions
    await expect(card.locator('.card-kill-btn')).not.toBeVisible();
  });

  test('stopped sessions can be dismissed', async ({ page }) => {
    const testId = `test-kill-dismiss-${Date.now()}`;
    await waitForDashboard(page);
    await injectTestSession(page, testId, 'C:/Projects/KillDismissTest');

    // End session to make it dismissible (stopped status comes from kill, which we can't easily trigger in test)
    await page.request.post('/hooks/session-end', {
      data: { session_id: testId },
    });
    await page.waitForTimeout(500);

    const card = page.locator(`#card-${testId}`);
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('.btn-dismiss')).toBeVisible();

    await card.locator('.btn-dismiss').click();
    await page.waitForTimeout(500);
    await expect(card).not.toBeVisible();
  });

});


test.describe('B007: Usage API', () => {

  test('aggregate usage endpoint returns valid data', async ({ request }) => {
    const response = await request.get('/api/usage');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toHaveProperty('totalTokens');
    expect(data).toHaveProperty('estimatedCostUSD');
    expect(typeof data.totalTokens).toBe('number');
    expect(typeof data.estimatedCostUSD).toBe('number');
  });

  test('session usage endpoint returns valid data', async ({ page, request }) => {
    const testId = `test-usage-${Date.now()}`;
    await injectTestSession(page, testId, 'C:/Projects/UsageTest');

    const response = await request.get(`/api/sessions/${testId}/usage`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toHaveProperty('inputTokens');
    expect(data).toHaveProperty('outputTokens');
    expect(data).toHaveProperty('totalTokens');
    expect(data).toHaveProperty('estimatedCostUSD');
  });

  test('metrics bar shows token count and cost', async ({ page }) => {
    await waitForDashboard(page);

    // Metrics bar should have token and cost fields
    await expect(page.locator('#metricTokens')).toBeVisible();
    await expect(page.locator('#metricCost')).toBeVisible();

    // Should contain numeric-like content
    const tokenText = await page.locator('#metricTokens').textContent();
    const costText = await page.locator('#metricCost').textContent();
    expect(costText).toMatch(/\$/);
  });

});


test.describe('B008: Mobile Responsive', () => {

  test('sidebar hides on small viewport', async ({ page }) => {
    await waitForDashboard(page);

    // Set small viewport
    await page.setViewportSize({ width: 500, height: 800 });
    await page.waitForTimeout(300);

    // Sidebar should not be visible
    const sidebar = page.locator('#sidebar');
    const box = await sidebar.boundingBox();
    // Either hidden or zero width
    expect(box === null || box.width === 0).toBeTruthy();
  });

  test('cards stack single-column on mobile', async ({ page }) => {
    const testId1 = `test-mobile-${Date.now()}-1`;
    const testId2 = `test-mobile-${Date.now()}-2`;
    await waitForDashboard(page);
    await injectTestSession(page, testId1, 'C:/Projects/Mobile1');
    await injectTestSession(page, testId2, 'C:/Projects/Mobile2');

    await page.setViewportSize({ width: 500, height: 800 });
    await page.waitForTimeout(300);

    const card1 = page.locator(`#card-${testId1}`);
    const card2 = page.locator(`#card-${testId2}`);
    await expect(card1).toBeVisible();
    await expect(card2).toBeVisible();

    // Both cards should have the same x position (stacked vertically)
    const box1 = await card1.boundingBox();
    const box2 = await card2.boundingBox();
    if (box1 && box2) {
      expect(Math.abs(box1.x - box2.x)).toBeLessThan(5);
    }
  });

});
