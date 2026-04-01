import { generateDailyGauntlet, toPublicGauntletScenarios } from '../client/src/gauntlet/generator';

interface CliOptions {
  from: string;
  days: number;
  overwriteExisting: boolean;
  seedSalt: string;
}

function parseCliArgs(argv: string[]): CliOptions {
  let from = '';
  let days = 14;
  let overwriteExisting = false;
  let seedSalt = 'racehorse-prod';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--from') {
      from = argv[i + 1] ?? '';
      i += 1;
    } else if (arg === '--days') {
      days = Number(argv[i + 1] ?? days);
      i += 1;
    } else if (arg === '--seed-salt') {
      seedSalt = argv[i + 1] ?? seedSalt;
      i += 1;
    } else if (arg === '--overwrite-existing') {
      overwriteExisting = true;
    }
  }

  if (!from || Number.isNaN(Date.parse(`${from}T00:00:00Z`))) {
    throw new Error('Valid --from YYYY-MM-DD is required.');
  }
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error('--days must be a positive integer.');
  }

  return {
    from,
    days: Math.round(days),
    overwriteExisting,
    seedSalt,
  };
}

function addDays(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function fetchExistingGauntletDates(
  supabaseUrl: string,
  serviceKey: string,
  from: string,
  to: string,
): Promise<Set<string>> {
  const url = new URL(`${supabaseUrl}/rest/v1/gauntlet_days`);
  url.searchParams.set('select', 'date');
  url.searchParams.set('and', `(date.gte.${from},date.lte.${to})`);

  const response = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch existing gauntlet days: ${response.status} ${await response.text()}`);
  }

  const rows = (await response.json()) as Array<{ date?: string }>;
  return new Set(rows.map((row) => row.date).filter((value): value is string => Boolean(value)));
}

async function upsertGauntletDay(
  supabaseUrl: string,
  serviceKey: string,
  dayDate: string,
  seedSalt: string,
): Promise<void> {
  const seed = `gauntlet-${dayDate}-${seedSalt}`;
  const rounds = generateDailyGauntlet(seed);
  const publicRounds = toPublicGauntletScenarios(rounds);
  const roundsOptimal = rounds.map((round) => ({
    round: round.round,
    optimalScore: round.optimalScore,
    optimalSolution: round.optimalSolution,
  }));
  const closesAt = `${dayDate}T23:59:59.000Z`;

  const dayResponse = await fetch(`${supabaseUrl}/rest/v1/gauntlet_days`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({
      date: dayDate,
      seed,
      rounds: publicRounds,
      closes_at: closesAt,
    }),
  });

  if (!dayResponse.ok) {
    throw new Error(`Failed to upsert gauntlet day ${dayDate}: ${dayResponse.status} ${await dayResponse.text()}`);
  }

  const insertedDays = (await dayResponse.json()) as Array<{ id?: number }>;
  const gauntletDayId = insertedDays[0]?.id;
  if (!gauntletDayId) {
    throw new Error(`Gauntlet day ${dayDate} did not return an id.`);
  }

  const solutionsResponse = await fetch(`${supabaseUrl}/rest/v1/gauntlet_day_solutions`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      gauntlet_day_id: gauntletDayId,
      rounds_optimal: roundsOptimal,
    }),
  });

  if (!solutionsResponse.ok) {
    throw new Error(`Failed to upsert gauntlet solutions ${dayDate}: ${solutionsResponse.status} ${await solutionsResponse.text()}`);
  }

  console.log(`${dayDate} | published | ${seed}`);
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is required.');
  }
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_KEY is required.');
  }

  const finalDate = addDays(options.from, options.days - 1);
  const existingDates = await fetchExistingGauntletDates(
    supabaseUrl,
    serviceKey,
    options.from,
    finalDate,
  );

  for (let offset = 0; offset < options.days; offset += 1) {
    const dayDate = addDays(options.from, offset);
    if (existingDates.has(dayDate) && !options.overwriteExisting) {
      console.log(`${dayDate} | skipped | existing gauntlet`);
      continue;
    }
    await upsertGauntletDay(supabaseUrl, serviceKey, dayDate, options.seedSalt);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
