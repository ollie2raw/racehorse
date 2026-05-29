import { useState } from 'react';
import {
  MATCH_ARENA_WATERMARK,
  MATCH_ARENA_WATERMARK_FALLBACK,
  MATCH_ARENA_WATERMARK_SALVAGE,
} from './matchV2Assets';

export function BoardWatermark() {
  const [src, setSrc] = useState(MATCH_ARENA_WATERMARK);

  return (
    <div className="nbl-board-watermark rh-board-watermark" aria-hidden="true">
      <img
        src={src}
        alt=""
        onError={() => {
          if (src === MATCH_ARENA_WATERMARK) {
            setSrc(MATCH_ARENA_WATERMARK_FALLBACK);
          } else if (src === MATCH_ARENA_WATERMARK_FALLBACK) {
            setSrc(MATCH_ARENA_WATERMARK_SALVAGE);
          }
        }}
      />
    </div>
  );
}
