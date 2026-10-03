// Test stand-in for workers/reviewSearchWorker.cjs. The snapshot's `mode`
// picks the behaviour: 'spin' blocks this thread for snapshot.ms (forever if
// absent), 'crash' exits the thread, anything else answers immediately.
'use strict';
const { parentPort } = require('node:worker_threads');

parentPort.on('message', ({ id, snapshot }) => {
  if (snapshot.mode === 'crash') process.exit(3);
  if (snapshot.mode === 'spin') {
    const until = snapshot.ms == null ? Infinity : Date.now() + snapshot.ms;
    while (Date.now() < until) { /* synchronous search stand-in */ }
  }
  parentPort.postMessage({ id, ok: true, result: { echoed: snapshot.mode ?? 'ok', lifecycle: 'SCORED' } });
});
