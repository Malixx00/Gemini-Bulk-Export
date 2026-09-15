// scrape.js
// Scrapes all Gemini (gemini.google.com) conversations into individual .txt files.
//
// USAGE:
//   1. Run launch-chrome.bat  -> opens a NORMAL Chrome with a debug port.
//   2. Log into Gemini in that window (no automation flags, so Google does not
//      show "this browser may not be secure").
//   3. node scrape.js         -> attaches to that already-logged-in window.
//
// Output: one .txt file per conversation in ./output/
// Re-runnable: conversations already saved are skipped.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'output');
const CDP_URL = 'http://localhost:9222';

// Confirmed against the live DOM (see inspect.js):
//   sidebar row  = conversations-list a[href^="/app/"], aria-label holds the title
//   turns        = <user-query> and <model-response>, in document order
const ROW_SEL = 'conversations-list a[href^="/app/"]';

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\|?*\x00-\x1F]/g, '_').trim().slice(0, 120) || 'untitled';
}

// Scroll a virtualised list until its item count stops growing.
async function scrollUntilStable(page, countFn, scrollFn, label) {
  let previous = -1;
  let stable = 0;
  for (let i = 0; i < 300; i++) {
    const count = await page.evaluate(countFn);
    if (count === previous) {
      if (++stable >= 3) break;
    } else {
      stable = 0;
      process.stdout.write(`\r${label}: ${count}   `);
    }
    previous = count;
    await page.evaluate(scrollFn);
    await page.waitForTimeout(500);
  }
  console.log(`\r${label}: ${previous} (settled)   `);
  return previous;
}

async function loadFullSidebar(page) {
  await scrollUntilStable(
    page,
    (sel) => document.querySelectorAll(sel).length,
    (sel) => {
      const rows = document.querySelectorAll(sel);
      const last = rows[rows.length - 1];
      if (last) last.scrollIntoView({ block: 'end' });
    },
    'Conversations found'
  );
}

async function collectConversations(page) {
  return page.evaluate((sel) => {
    const seen = new Set();
    const out = [];
    document.querySelectorAll(sel).forEach((a) => {
      const id = a.getAttribute('href').split('/').pop();
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push({ id, title: (a.getAttribute('aria-label') || a.innerText || '').trim() });
    });
    return out;
  }, ROW_SEL);
}

async function extractConversationText(page) {
  // Long chats lazy-load older turns as you scroll up.
  await scrollUntilStable(
    page,
    () => document.querySelectorAll('user-query').length,
    () => {
      const first = document.querySelector('user-query');
      if (first) first.scrollIntoView({ block: 'start' });
    },
    '  turns'
  );

  return page.evaluate(() => {
    const parts = [];
    // One combined query => turns come back in document order.
    document.querySelectorAll('user-query, model-response').forEach((el) => {
      const isUser = el.tagName.toLowerCase() === 'user-query';
      // Drill into the content element so we skip buttons, disclaimers and
      // feedback widgets that live inside <model-response>.
      const body =
        el.querySelector(isUser ? 'user-query-content' : 'message-content') || el;
      const text = (body.innerText || '').trim();
      if (text) parts.push(`## ${isUser ? 'You' : 'Gemini'}\n\n${text}`);
    });
    return parts.join('\n\n---\n\n');
  });
}

(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (err) {
    console.log(`Could not attach to Chrome on ${CDP_URL}.`);
    console.log('Run launch-chrome.bat first, log into Gemini there, then re-run this script.');
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const page =
    context.pages().find((p) => p.url().includes('gemini.google.com')) ||
    context.pages()[0] ||
    (await context.newPage());
  if (!page.url().includes('gemini.google.com')) {
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
  }

  await page.waitForSelector(ROW_SEL, { timeout: 60000 }).catch(() => {
    console.log('No conversation links in the sidebar — are you logged in?');
    process.exit(1);
  });

  await loadFullSidebar(page);
  const items = await collectConversations(page);
  console.log(`\n${items.length} conversations to export.\n`);

  // Resume support: match on title, since the leading index can shift between runs.
  const done = new Set(fs.readdirSync(OUTPUT_DIR).map((f) => f.replace(/^\d+_/, '')));

  let saved = 0;
  let skipped = 0;
  const failures = [];

  for (let i = 0; i < items.length; i++) {
    const { id, title } = items[i];
    const safe = sanitizeFilename(title);
    const tag = `[${i + 1}/${items.length}]`;

    if (done.has(`${safe}.txt`)) {
      skipped++;
      continue;
    }

    try {
      console.log(`${tag} ${safe}`);
      await page.goto(`https://gemini.google.com/app/${id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('user-query', { timeout: 30000 });

      const text = await extractConversationText(page);
      if (!text) throw new Error('conversation rendered but extracted no turns');

      const header = `${title}\nhttps://gemini.google.com/app/${id}\n\n${'='.repeat(60)}\n\n`;
      const outPath = path.join(OUTPUT_DIR, `${String(i + 1).padStart(4, '0')}_${safe}.txt`);
      fs.writeFileSync(outPath, header + text, 'utf-8');
      saved++;
    } catch (err) {
      console.log(`${tag} FAILED: ${safe} — ${err.message}`);
      failures.push({ id, title, error: err.message });
    }
  }

  console.log(`\nDone. Saved ${saved}, skipped ${skipped} already-present, ${failures.length} failed.`);
  if (failures.length) {
    fs.writeFileSync(path.join(__dirname, 'failures.json'), JSON.stringify(failures, null, 2));
    console.log('Failures written to failures.json — re-run to retry them.');
  }
  browser.close(); // detach only — your Chrome window stays open
  process.exit(0);
})();
