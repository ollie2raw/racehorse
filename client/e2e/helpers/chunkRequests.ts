import type { Page, Request } from '@playwright/test';
import { isAnalyzerChunkRequest, isLessonV2ChunkRequest } from '../../scripts/checkBotMatchLazyBoundaries.mjs';

export type ChunkRequestTracker = {
  reset: () => void;
  lessonV2Urls: () => string[];
  analyzerUrls: () => string[];
  scriptUrls: () => string[];
};

function isScriptLikeRequest(request: Request): boolean {
  const resourceType = request.resourceType();
  if (resourceType === 'script') return true;
  const url = request.url();
  return /\.m?js(\?|$)/i.test(url);
}

/** Track script/module requests for lazy-chunk regression tests. */
export function trackChunkRequests(page: Page): ChunkRequestTracker {
  const urls: string[] = [];

  const onRequest = (request: Request) => {
    if (!isScriptLikeRequest(request)) return;
    urls.push(request.url());
  };

  page.on('request', onRequest);

  return {
    reset: () => {
      urls.length = 0;
    },
    lessonV2Urls: () => urls.filter(isLessonV2ChunkRequest),
    analyzerUrls: () => urls.filter(isAnalyzerChunkRequest),
    scriptUrls: () => [...urls],
  };
}