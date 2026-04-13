/**
 * Playwright global teardown: clean up test sessions from the Command Centre server.
 * Removes any sessions with IDs starting with "test-" via the cleanup API.
 */
async function globalTeardown() {
  try {
    const res = await fetch('http://localhost:4111/api/sessions/test-cleanup', {
      method: 'DELETE',
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`[Teardown] Removed ${data.removed} test sessions`);
    }
  } catch {
    // Server may not be running — that's fine
  }
}

export default globalTeardown;
