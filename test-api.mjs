/**
 * Omi WhatsApp Integration — API smoke test runner.
 *
 * Reads config from .env (HOST, TEST_UID, TEST_CONTACT, OMI_APP_SECRET).
 * Run:  node test-api.mjs
 */

import 'dotenv/config';

const HOST = process.env.HOST || 'http://localhost:3000';
const UID = process.env.TEST_UID || '';
const CONTACT = process.env.TEST_CONTACT || '';
const SECRET = process.env.OMI_APP_SECRET || '';

if (!UID) {
  console.error('Missing TEST_UID in .env — cannot run tests.');
  process.exit(1);
}

const passed = [];
const failed = [];

async function run(name, fn) {
  try {
    await fn();
    passed.push(name);
    console.log(`  ✓  ${name}`);
  } catch (err) {
    failed.push({ name, error: err.message ?? err });
    console.log(`  ✗  ${name}`);
    console.log(`     ${err.message ?? err}`);
  }
}

async function request(method, path, { body, headers = {}, expectedStatus = 200 } = {}) {
  const url = `${HOST}${path}`;
  const opts = { method, headers: { ...headers } };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }

  if (res.status !== expectedStatus) {
    throw new Error(
      `Expected ${expectedStatus}, got ${res.status} — ${text.slice(0, 200)}`
    );
  }
  return { status: res.status, json, text };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

console.log(`\n  Omi WhatsApp — API Tests`);
console.log(`  ========================`);
console.log(`  Host:    ${HOST}`);
console.log(`  UID:     ${UID}`);
console.log(`  Contact: ${CONTACT || '(none — contact tests will be skipped)'}\n`);

await run('1. Health check', async () => {
  const { json } = await request('GET', '/health');
  assert(json.status === 'ok', `Expected { status: "ok" }, got ${JSON.stringify(json)}`);
});

await run('2. Setup status', async () => {
  const { json } = await request('GET', `/setup/status?uid=${UID}`);
  assert(typeof json.is_setup_completed === 'boolean', 'Missing is_setup_completed field');
  console.log(`     → is_setup_completed: ${json.is_setup_completed}`);
});

await run('3. Setup page (HTML)', async () => {
  const { text } = await request('GET', `/setup?uid=${UID}`);
  assert(text.includes('<'), 'Expected HTML response');
});

await run('4. Tool manifest', async () => {
  const { json } = await request('GET', '/.well-known/omi-tools.json');
  assert(Array.isArray(json.tools), 'Expected tools array');
  assert(json.tools.length >= 5, `Expected ≥5 tools, got ${json.tools.length}`);
  const names = json.tools.map(t => t.name);
  assert(names.includes('save_whatsapp_contact'), 'Missing save_whatsapp_contact tool');
  console.log(`     → ${json.tools.length} tools: ${names.join(', ')}`);
});

await run('5. Webhook — memory recap', async () => {
  await request('POST', `/webhook/memory?uid=${UID}`, {
    headers: SECRET ? { Authorization: `Bearer ${SECRET}` } : {},
    body: {
      id: 'test-memory-001',
      created_at: '2025-01-01T12:00:00Z',
      started_at: '2025-01-01T11:45:00Z',
      finished_at: '2025-01-01T12:00:00Z',
      discarded: false,
      structured: {
        title: 'Test Meeting with Team',
        overview: 'Discussed the Q1 roadmap and assigned action items for the product launch.',
        emoji: '📋',
        category: 'work',
        action_items: [
          { description: 'Finalize the launch plan by Friday', completed: false },
          { description: 'Send design specs to the engineering team', completed: false },
        ],
        events: [],
      },
      transcript_segments: [
        { text: "Let's go over the Q1 roadmap.", speaker: 'SPEAKER_0', speaker_id: 0, is_user: true, start: 0, end: 3 },
        { text: 'Sure, I think we should prioritize the product launch.', speaker: 'SPEAKER_1', speaker_id: 1, is_user: false, start: 3, end: 7 },
      ],
      apps_response: [],
    },
  });
});

await run('6. Webhook — discarded memory (skipped)', async () => {
  await request('POST', `/webhook/memory?uid=${UID}`, {
    headers: SECRET ? { Authorization: `Bearer ${SECRET}` } : {},
    body: {
      id: 'test-memory-discarded',
      created_at: '2025-01-01T12:00:00Z',
      started_at: '2025-01-01T11:50:00Z',
      finished_at: '2025-01-01T12:00:00Z',
      discarded: true,
      structured: { title: '', overview: '', emoji: '', category: '', action_items: [], events: [] },
      transcript_segments: [],
      apps_response: [],
    },
  });
});

if (CONTACT) {
  await run('7. Chat tool — send message to contact', async () => {
    const { json } = await request('POST', `/tools/send_message?uid=${UID}`, {
      body: { uid: UID, contact_name: CONTACT, message: '[Test] Message from API test runner.' },
    });
    assert(json.result, `Unexpected response: ${JSON.stringify(json)}`);
    console.log(`     → ${json.result}`);
  });
} else {
  console.log('  –  7. Chat tool — send message to contact (SKIPPED, no TEST_CONTACT)');
}

await run('8. Chat tool — send meeting notes to self', async () => {
  const { json } = await request('POST', `/tools/send_meeting_notes?uid=${UID}`, {
    body: {
      uid: UID,
      summary: '[Test] Meeting notes from the API test runner.\n\n- Item one\n- Item two\n- Item three',
    },
  });
  assert(json.result, `Unexpected response: ${JSON.stringify(json)}`);
  console.log(`     → ${json.result}`);
});

if (CONTACT) {
  await run('9. Chat tool — send recap to contact', async () => {
    const { json } = await request('POST', `/tools/send_recap_to_contact?uid=${UID}`, {
      body: {
        uid: UID,
        contact_name: CONTACT,
        summary: '[Test] Recap from the API test runner.\n\n1. Point one\n2. Point two',
      },
    });
    assert(json.result, `Unexpected response: ${JSON.stringify(json)}`);
    console.log(`     → ${json.result}`);
  });
} else {
  console.log('  –  9. Chat tool — send recap to contact (SKIPPED, no TEST_CONTACT)');
}

await run('10. Chat tool — set reminder (self, 1 min)', async () => {
  const { json } = await request('POST', `/tools/set_reminder?uid=${UID}`, {
    body: { uid: UID, message: '[Test] Self-reminder from API test runner', delay_minutes: 1 },
  });
  assert(json.result, `Unexpected response: ${JSON.stringify(json)}`);
  console.log(`     → ${json.result}`);
});

if (CONTACT) {
  await run('11. Chat tool — set reminder (contact, 1 min)', async () => {
    const { json } = await request('POST', `/tools/set_reminder?uid=${UID}`, {
      body: { uid: UID, message: '[Test] Contact reminder from API test runner', delay_minutes: 1, contact_name: CONTACT },
    });
    assert(json.result, `Unexpected response: ${JSON.stringify(json)}`);
    console.log(`     → ${json.result}`);
  });
} else {
  console.log('  –  11. Chat tool — set reminder to contact (SKIPPED, no TEST_CONTACT)');
}

// ─── Contacts ────────────────────────────────────────────────────────────────

await run('12. Contacts — list saved contacts (initially)', async () => {
  const { json } = await request('GET', `/contacts?uid=${UID}`);
  assert(Array.isArray(json.contacts), 'Expected contacts array');
  console.log(`     → ${json.contacts.length} saved contact(s)`);
});

await run('13. Contacts — save contact (invalid phone)', async () => {
  await request('POST', `/contacts/save?uid=${UID}`, {
    body: { name: 'Bad Number', phone: '12345' },
    expectedStatus: 400,
  });
});

await run('14. Contacts — save contact (missing name)', async () => {
  await request('POST', `/contacts/save?uid=${UID}`, {
    body: { phone: '+14155551234' },
    expectedStatus: 400,
  });
});

await run('15. Chat tool — save_contact (invalid phone)', async () => {
  await request('POST', `/tools/save_contact?uid=${UID}`, {
    body: { uid: UID, contact_name: 'Test', phone_number: 'abc' },
    expectedStatus: 400,
  });
});

await run('16. Contacts — delete non-existent contact', async () => {
  await request('DELETE', `/contacts?uid=${UID}`, {
    body: { phone: '+10000000000' },
    expectedStatus: 404,
  });
});

// ─── QR code ─────────────────────────────────────────────────────────────────

const QR_UID = 'test-qr-uid';

await run('17. QR code — setup page triggers session init', async () => {
  // Hitting /setup kicks off Baileys session init in the background
  const { text } = await request('GET', `/setup?uid=${QR_UID}`);
  assert(text.includes('<'), 'Expected HTML response from setup page');
});

await run('18. QR code — setup status is false (not yet linked)', async () => {
  const { json } = await request('GET', `/setup/status?uid=${QR_UID}`);
  assert(typeof json.is_setup_completed === 'boolean', 'Missing is_setup_completed field');
  assert(json.is_setup_completed === false, `Expected false for fresh UID, got ${json.is_setup_completed}`);
});

await run('19. QR code — SSE stream emits a QR data URL', async () => {
  const TIMEOUT_MS = 20_000;

  const qrDataUrl = await new Promise(async (resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`No QR event received within ${TIMEOUT_MS / 1000}s`)),
      TIMEOUT_MS
    );

    const controller = new AbortController();
    let res;
    try {
      res = await fetch(`${HOST}/setup/events?uid=${QR_UID}`, {
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });
    } catch (err) {
      clearTimeout(timer);
      reject(err);
      return;
    }

    // Parse the SSE stream line-by-line
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastEvent = '';

    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep incomplete last line

          for (const line of lines) {
            if (line.startsWith('event:')) {
              lastEvent = line.replace('event:', '').trim();
            } else if (line.startsWith('data:') && lastEvent === 'qr') {
              const data = line.replace('data:', '').trim();
              clearTimeout(timer);
              controller.abort();
              resolve(data);
              return;
            }
          }
        }
      } catch (err) {
        // AbortError is expected when we cancel after receiving the QR
        if (err.name !== 'AbortError') {
          clearTimeout(timer);
          reject(err);
        }
      }
    })();
  });

  assert(
    typeof qrDataUrl === 'string' && qrDataUrl.startsWith('data:image/'),
    `Expected a data: image URL, got: ${String(qrDataUrl).slice(0, 80)}`
  );
  console.log(`     → QR data URL received (${qrDataUrl.length} chars)`);
});

// ─── Error cases ─────────────────────────────────────────────────────────────

await run('20. Error — missing UID on webhook', async () => {
  await request('POST', '/webhook/memory', { body: {}, expectedStatus: 400 });
});

await run('21. Error — invalid UID (path traversal)', async () => {
  await request('GET', '/setup/status?uid=../../../etc/passwd', { expectedStatus: 400 });
});

await run('22. Error — unknown session on /tools', async () => {
  await request('POST', '/tools/send_message?uid=nonexistent-uid-12345', {
    body: { uid: 'nonexistent-uid-12345', contact_name: 'Someone', message: 'fail' },
    expectedStatus: 403,
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n  ────────────────────────────');
console.log(`  Passed: ${passed.length}`);
console.log(`  Failed: ${failed.length}`);

if (failed.length > 0) {
  console.log('\n  Failures:');
  for (const f of failed) {
    console.log(`    ✗ ${f.name}`);
    console.log(`      ${f.error}`);
  }
  console.log('');
  process.exit(1);
} else {
  console.log('\n  All tests passed.\n');
}
