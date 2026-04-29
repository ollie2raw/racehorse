const APP_URL = process.env.BROWSER_SMOKE_APP_URL || 'http://127.0.0.1:4173/';
const PORT_A = Number(process.env.BROWSER_SMOKE_PORT_A || 9225);
const PORT_B = Number(process.env.BROWSER_SMOKE_PORT_B || 9226);
const TIMEOUT_MS = Number(process.env.BROWSER_SMOKE_TIMEOUT_MS || 20000);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPageWsUrl(port) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const page = targets.find((target) => target.type === 'page');
  assert(page?.webSocketDebuggerUrl, `No page target on ${port}`);
  return page.webSocketDebuggerUrl;
}

class CdpPage {
  constructor(label, wsUrl) {
    this.label = label;
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${this.label} CDP ${message.error.message}`));
        else resolve(message.result);
        return;
      }
      this.events.push(message);
    };
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.label} CDP connect timeout`)), TIMEOUT_MS);
      this.ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      this.ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`${this.label} CDP websocket error`));
      };
    });
    await this.send('Page.enable');
    await this.send('Runtime.enable');
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.label} ${method} timeout`));
      }, TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`${this.label} eval failed: ${result.exceptionDetails.text}`);
    }
    return result.result.value;
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await this.waitFor('document.readyState === "complete" || document.readyState === "interactive"');
  }

  async waitFor(expression, timeoutMs = TIMEOUT_MS) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = await this.eval(`Boolean(${expression})`);
      if (value) return;
      await delay(100);
    }
    const text = await this.eval('document.body?.innerText?.slice(0, 1000) ?? ""');
    throw new Error(`${this.label} timed out waiting for ${expression}. Body: ${text}`);
  }

  async clickButton(label) {
    const clicked = await this.eval(`(() => {
      const wanted = ${JSON.stringify(label)}.toLowerCase();
      const buttons = [...document.querySelectorAll('button')];
      const button = buttons.find((el) => (el.innerText || el.textContent || '').toLowerCase().includes(wanted));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert(clicked, `${this.label} could not click button containing ${label}`);
  }

  async setRoomCode(code) {
    const ok = await this.eval(`(() => {
      const input = document.querySelector('input.mode-join-input');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter.call(input, ${JSON.stringify(code)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    assert(ok, `${this.label} room code input missing`);
  }

  async close() {
    this.ws.close();
  }
}

async function setupBrowser(label, port) {
  const page = new CdpPage(label, await getPageWsUrl(port));
  await page.open();
  await page.navigate(APP_URL);
  await page.eval(`localStorage.setItem('hasSeenWelcome', '1')`);
  await page.eval(`localStorage.removeItem('racehorse_last_room_code')`);
  await page.navigate(APP_URL);
  await page.waitFor('document.body.innerText.includes("Multiplayer Online")');
  await page.clickButton('Multiplayer Online');
  await page.waitFor('document.body.innerText.toLowerCase().includes("create new room") || document.body.innerText.toLowerCase().includes("connect")');
  if (await page.eval('document.body.innerText.toLowerCase().includes("connect") && !document.body.innerText.toLowerCase().includes("create new room")')) {
    await page.clickButton('Connect');
  }
  await page.waitFor('document.body.innerText.toLowerCase().includes("create new room")');
  return page;
}

function traySummaryExpression() {
  return `(() => {
    const tray = document.querySelector('[data-ui="tray"]');
    const tiles = tray ? [...tray.querySelectorAll('.domino-tile')] : [];
    return {
      title: document.title,
      body: document.body.innerText.slice(0, 800),
      trayExists: Boolean(tray),
      tileCount: tiles.length,
      buttonTileCount: tray ? tray.querySelectorAll('button, [role="button"]').length : 0,
      tileTexts: tiles.map((tile) => (tile.innerText || tile.textContent || '').trim()).filter(Boolean),
    };
  })()`;
}

async function main() {
  const browserA = await setupBrowser('browserA', PORT_A);
  const browserB = await setupBrowser('browserB', PORT_B);
  try {
    await browserA.clickButton('Create New Room');
    await browserA.waitFor('document.querySelector(".multiplayer-room-code")?.textContent?.trim()');
    const roomCode = await browserA.eval('document.querySelector(".multiplayer-room-code")?.textContent?.trim() ?? ""');
    assert(roomCode, 'Room code was not rendered in browser A');

    await browserB.setRoomCode(roomCode);
    await browserB.clickButton('Join Room');
    await browserA.waitFor('document.body.innerText.includes("Players (2/2)")');
    await browserB.waitFor('document.body.innerText.includes("Players (2/2)")');

    await browserA.clickButton('Start Game');
    await browserA.waitFor('document.querySelectorAll("[data-ui=\\"tray\\"] .domino-tile").length === 7');
    await browserB.waitFor('document.querySelectorAll("[data-ui=\\"tray\\"] .domino-tile").length === 7');

    const [summaryA, summaryB] = await Promise.all([
      browserA.eval(traySummaryExpression()),
      browserB.eval(traySummaryExpression()),
    ]);

    assert(summaryA.tileCount === 7, `Browser A rendered ${summaryA.tileCount} hand tiles`);
    assert(summaryB.tileCount === 7, `Browser B rendered ${summaryB.tileCount} hand tiles`);

    console.log(JSON.stringify({ ok: true, roomCode, browserA: summaryA, browserB: summaryB }, null, 2));
  } finally {
    await browserA.close();
    await browserB.close();
  }
}

main().catch((error) => {
  console.error('[browserOnlineSmoke] FAILED', error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
