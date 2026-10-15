# Local-only full migration replay. Requires an owned disposable PostgreSQL
# cluster on loopback 55439. Creates unique databases and never drops an
# existing database. No environment database URLs or production credentials.
# The checked-in Supabase auth shim supplies platform primitives only.
from pathlib import Path
import subprocess,json,os
root=Path(__file__).resolve().parents[2]; pg=os.environ.get('PSQL_BIN','/opt/homebrew/opt/postgresql@16/bin/psql')
suffix=str(os.getpid())
fresh='racehorse_runtime_fresh_'+suffix
upgrade='racehorse_runtime_upgrade_'+suffix
db='postgresql://postgres@127.0.0.1:55439/'+fresh
log=open('/private/tmp/runtime-r1-fresh-chain-'+suffix+'.log','w')
def sql(q): subprocess.run([pg,'-X','-v','ON_ERROR_STOP=1',db,'-c',q],stdout=log,stderr=log,check=True)
def apply(p):
 print(str(p),flush=True);log.write('\nAPPLY '+str(p)+'\n');log.flush();subprocess.run([pg,'-X','-v','ON_ERROR_STOP=1',db,'-f',str(root/p)],stdout=log,stderr=log,check=True)
subprocess.run([pg,'-X','-v','ON_ERROR_STOP=1','postgresql://postgres@127.0.0.1:55439/postgres','-c','create database '+fresh],stdout=log,stderr=log,check=True)
apply(Path('scripts/tournament-db-verify/shim.sql'))
sql("create function auth.jwt() returns jsonb language sql stable as $$$$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$$$".replace('$$$$','$$'))
sql("alter table auth.users add column raw_user_meta_data jsonb default '{}';")
for n in ['schema','verified_matches','ghost','friends','daily_puzzle','daily_puzzle_v2','daily_puzzle_ladder_v1','daily_fritz','fritz_challenges','room_match_logs','room_live_sessions','room_command_receipts']:
 apply(Path('supabase')/(n+'.sql'))
files=sorted((root/'supabase/migrations').glob('*.sql'))
files=[p for p in files if p.name<'2026-10-13']
def before(a,b):
 i=next(i for i,p in enumerate(files) if p.name==a); p=files.pop(i);j=next(i for i,p in enumerate(files) if p.name==b);files.insert(j,p)
before('2026-05-14_scheduled_tournaments.sql','2026-05-14_auto_seed_tournaments.sql')
daily_order=['2026-08-01_daily_fritz_published_challenges.sql','2026-08-01_daily_fritz_command_primitives.sql','2026-08-01_daily_fritz_transactional_commands.sql','2026-08-01_daily_fritz_canonical_telemetry.sql']
pos=next(i for i,p in enumerate(files) if p.name in daily_order)
files=[p for p in files if p.name not in daily_order]
files[pos:pos]=[root/'supabase/migrations'/name for name in daily_order]
for p in files: apply(p.relative_to(root))
print('HISTORICAL CHAIN PASS',flush=True)
subprocess.run([pg,'-X','-v','ON_ERROR_STOP=1','postgresql://postgres@127.0.0.1:55439/postgres','-c','create database '+upgrade+' template '+fresh],stdout=log,stderr=log,check=True)
# Future expand/contract order, never lexical ordering of the same-date migrations.
for n in ['2026-10-13_rating_cutover_gate.sql','2026-10-13_ghost_rating_idempotent_completion.sql','2026-10-13_ghost_cutover_reconciliation.sql','2026-10-13_puzzle_rush_assignment_and_atomic_completion.sql','2026-10-13_ranked_rating_claim.sql','2026-10-15_ranked_rating_context.sql','2026-10-13_puzzle_rush_assignment_contract.sql','2026-10-13_ghost_user_match_uniqueness.sql']:
 if n=='2026-10-13_ghost_rating_idempotent_completion.sql':sql("update rating_cutover_gate set quiesced=true,quiesced_at=now(),enabled_boot_id='local-migration-fixture' where id")
 apply(Path('supabase/migrations')/n)
print('FRESH FULL CHAIN PASS',flush=True)

print(json.dumps({'freshDatabase':fresh,'historicalUpgradeDatabase':upgrade,'historicalMigrations':len(files),'pendingMigrations':8,'result':'PASS'}),flush=True)
