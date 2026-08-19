import type { Application } from 'express';

export {
  buildRecordedDailyFritzAttemptResult,
  canFinalizeDailyFritzAttempt,
  hasCompleteDailyFritzGameAuthority,
  hasPriorDailyFritzGameAuthority,
  isIdenticalDailyFritzGameReplay,
  requiresVerifiedDailyFritzEvidence,
} from './dailyFritzVerificationPolicy';

export {
  readActiveGameProgress,
  writeActiveGameProgress,
} from './dailyFritzVerificationGlue';

import { registerDailyFritzTodayRoutes } from './dailyFritzTodayRoute';
import { registerDailyFritzStartRoute } from './dailyFritzStartRoute';
import { registerDailyFritzNextHandRoute } from './dailyFritzNextHandRoute';
import { registerDailyFritzRecordGameRoute } from './dailyFritzRecordGameRoute';
import { registerDailyFritzCompletionRoutes } from './dailyFritzCompletionRoutes';
import { registerDailyFritzAdminRoutes } from './dailyFritzAdminRoutes';
import { registerDailyFritzCheckpointRoute } from './dailyFritzCheckpointRoute';

export function registerDailyFritzRoutes(app: Application): void {
  registerDailyFritzTodayRoutes(app);
  registerDailyFritzStartRoute(app);
  registerDailyFritzCheckpointRoute(app);
  registerDailyFritzNextHandRoute(app);
  registerDailyFritzRecordGameRoute(app);
  registerDailyFritzCompletionRoutes(app);
  registerDailyFritzAdminRoutes(app);
}
