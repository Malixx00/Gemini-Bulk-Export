// inspect.js — one-shot DOM recon. Attaches to launch-chrome.bat's Chrome.
// Run with Gemini open and logged in:  node inspect.js
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('gemini.google.com')) || ctx.pages()[0];
  console.log('URL before:', page.url());

  const desc = (el) => {
    if (!el) return null;
    const a = {};
    for (const at of el.attributes) a[at.name] = at.value.slice(0, 60);
    return { tag: el.tagName.toLowerCase(), attrs: a };
  };

  // 1) Find a sidebar row by its visible title and print its ancestor chain.
  const chain = await page.evaluate(() => {
    const descr = (el) => {
      const a = {};
      for (const at of el.attributes) a[at.name] = at.value.slice(0, 60);
      return { tag: el.tagName.toLowerCase(), attrs: a };
    };
    // First conversation row in the sidebar, whatever it happens to be.
    const row = document.querySelector('conversations-list a[href^="/app/"]');
    const leaf =
      row && (Array.from(row.querySelectorAll('*')).find((el) => !el.children.length) || row);
    if (!leaf) return 'NO conversation rows found - are you logged in?';
    const out = [];
    let el = leaf;
    for (let i = 0; i < 8 && el; i++) { out.push(descr(el)); el = el.parentElement; }
    return out;
  });
  console.log('\n=== sidebar row ancestor chain ===');
  console.log(JSON.stringify(chain, null, 1));

  // 2) Click it and see if the URL changes.
  await page.evaluate(() => {
    const row = document.querySelector('conversations-list a[href^="/app/"]');
    if (row) row.click();
  });
  await page.waitForTimeout(4000);
  console.log('\nURL after click:', page.url());

  // 3) What custom elements / containers hold the conversation?
  const shape = await page.evaluate(() => {
    const counts = {};
    for (const sel of [
      'user-query', 'model-response', 'message-content', 'chat-window',
      'infinite-scroller', '.conversation-container', 'main', '[role="main"]',
    ]) counts[sel] = document.querySelectorAll(sel).length;
    const tags = {};
    document.querySelectorAll('*').forEach((el) => {
      const t = el.tagName.toLowerCase();
      if (t.includes('-')) tags[t] = (tags[t] || 0) + 1;
    });
    return { counts, customElements: tags };
  });
  console.log('\n=== container counts ===');
  console.log(JSON.stringify(shape.counts, null, 1));
  console.log('\n=== custom elements on page ===');
  console.log(JSON.stringify(shape.customElements, null, 1));

  browser.close();
})();
