import { execFileSync, spawn } from 'node:child_process';

const MARKER = 'RACEHORSE_ROW_LOCK_HELD';

/** Hold one real PostgreSQL row lock while independent psql RPCs begin. */
export async function holdPostgresRowLock(
  url: string,
  lockQuery: string,
  psqlBin = 'psql',
): Promise<() => Promise<void>> {
  const child = spawn(psqlBin, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', url], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { errors += chunk; });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`PostgreSQL lock setup timed out: ${errors}`)), 5000);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
      if (output.includes(MARKER)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`PostgreSQL lock holder exited ${code}: ${errors}`));
    });
    child.stdin.write(`begin;\n${lockQuery};\nselect '${MARKER}';\n`);
  });
  return async () => {
    child.stdin.end('commit;\n');
    await new Promise<void>((resolve, reject) => {
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Lock release failed ${code}: ${errors}`)));
    });
  };
}

/** Assert that the RPCs really reached PostgreSQL and overlapped on the lock. */
export async function waitForBlockedPostgresCalls(
  url: string,
  functionName: string,
  count: number,
  psqlBin = 'psql',
): Promise<void> {
  const escaped = functionName.replaceAll("'", "''");
  const query = `select count(*) from pg_stat_activity where datname=current_database() ` +
    `and pid<>pg_backend_pid() and wait_event_type='Lock' and query ilike '%${escaped}%'`;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = execFileSync(psqlBin, ['-X', '-At', url, '-c', query], {
      encoding: 'utf8', timeout: 3000,
    }).trim();
    if (Number(result) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Expected ${count} overlapping blocked ${functionName} calls`);
}
