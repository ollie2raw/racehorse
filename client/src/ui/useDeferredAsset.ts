import { useEffect, useState } from 'react';

type AssetModule = { default: string };

const assetCache = new Map<string, string>();

export function useDeferredAsset(
  assetKey: string,
  loadAsset: () => Promise<AssetModule>,
): string | null {
  const [assetSrc, setAssetSrc] = useState<string | null>(() => assetCache.get(assetKey) ?? null);
  const [trackedAssetKey, setTrackedAssetKey] = useState(assetKey);
  if (assetKey !== trackedAssetKey) {
    setTrackedAssetKey(assetKey);
    setAssetSrc(assetCache.get(assetKey) ?? null);
  }

  useEffect(() => {
    if (assetCache.has(assetKey)) return;

    if (typeof window === 'undefined') return;

    let cancelled = false;
    const rafId = window.requestAnimationFrame(() => {
      void loadAsset()
        .then((mod) => {
          assetCache.set(assetKey, mod.default);
          if (!cancelled) {
            setAssetSrc(mod.default);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setAssetSrc(null);
          }
        });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
    };
  }, [assetKey, loadAsset]);

  return assetCache.get(assetKey) ?? assetSrc;
}
