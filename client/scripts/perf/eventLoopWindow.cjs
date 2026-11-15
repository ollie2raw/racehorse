/**
 * Preload for the server CPU / event-loop measurement behind docs/perf-budget.md. Start the server with
 *   ELMON_DIR=/tmp/elmon NODE_OPTIONS="--require $PWD/client/scripts/perf/eventLoopWindow.cjs" node server/dist/index.js
 * then `kill -USR2 <pid>` to open a window and `kill -USR2 <pid>` again to close it: the window's record (process CPU time, event-loop
 * utilization and delay p50/p99/p99.9/max, in ms) is appended to $ELMON_DIR/el-<pid>.jsonl. With `npx tsx` several processes load the
 * preload; send the signal to all of them and use the record with the largest cpuMs (the server). Resolution 5 ms, so ~5 ms is the floor.
 */
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');
const fs = require('node:fs');

const dir = process.env.ELMON_DIR;
if (dir) {
  const histogram = monitorEventLoopDelay({ resolution: 5 });
  histogram.enable();
  let start = null;
  process.on('SIGUSR2', () => {
    if (!start) {
      histogram.reset();
      start = { cpu: process.cpuUsage(), t: Date.now(), elu: performance.eventLoopUtilization() };
      return;
    }
    const cpu = process.cpuUsage(start.cpu);
    const elu = performance.eventLoopUtilization(start.elu);
    const record = {
      pid: process.pid,
      ms: Date.now() - start.t,
      cpuMs: (cpu.user + cpu.system) / 1000,
      elu: elu.utilization,
      p50: histogram.percentile(50) / 1e6,
      p99: histogram.percentile(99) / 1e6,
      p999: histogram.percentile(99.9) / 1e6,
      max: histogram.max / 1e6,
    };
    fs.appendFileSync(`${dir}/el-${process.pid}.jsonl`, `${JSON.stringify(record)}\n`);
    start = null;
  });
}
