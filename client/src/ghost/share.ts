import { SITE_DOMAIN } from '../lib/siteUrl';
export async function shareGhostResultCard(params: {
  playerScore: number;
  ghostScore: number;
  previousRating: number;
  newRating: number;
  ratingDelta: number;
  message: string;
}): Promise<void> {
  const width = 1200;
  const height = 630;
  const maxScore = Math.max(params.playerScore, params.ghostScore, 1);
  const playerBar = Math.round((params.playerScore / maxScore) * 420);
  const ghostBar = Math.round((params.ghostScore / maxScore) * 420);
  const deltaLabel = `${params.ratingDelta >= 0 ? '+' : ''}${params.ratingDelta}`;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0b1323" />
          <stop offset="100%" stop-color="#120d1d" />
        </linearGradient>
        <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#191f34" />
          <stop offset="100%" stop-color="#0f1424" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)" />
      <rect x="84" y="72" rx="30" ry="30" width="1032" height="486" fill="url(#card)" stroke="rgba(255,255,255,0.16)" />
      <text x="120" y="138" fill="#f7f6ff" font-size="42" font-family="Arial, sans-serif" font-weight="700">Ghost Mode</text>
      <text x="120" y="180" fill="#cdd4ea" font-size="24" font-family="Arial, sans-serif">${SITE_DOMAIN}</text>
      <text x="120" y="260" fill="#eef2ff" font-size="28" font-family="Arial, sans-serif">YOU</text>
      <text x="300" y="260" fill="#eef2ff" font-size="34" font-family="Arial, sans-serif" font-weight="700">${params.playerScore} pts</text>
      <rect x="520" y="232" width="420" height="24" rx="12" fill="rgba(255,255,255,0.09)" />
      <rect x="520" y="232" width="${playerBar}" height="24" rx="12" fill="#8ef0c8" />
      <text x="120" y="336" fill="#d5d8e5" font-size="28" font-family="Arial, sans-serif">GHOST</text>
      <text x="300" y="336" fill="#d5d8e5" font-size="34" font-family="Arial, sans-serif" font-weight="700">${params.ghostScore} pts</text>
      <rect x="520" y="308" width="420" height="24" rx="12" fill="rgba(255,255,255,0.09)" />
      <rect x="520" y="308" width="${ghostBar}" height="24" rx="12" fill="#b999ff" />
      <text x="120" y="430" fill="#f7f6ff" font-size="30" font-family="Arial, sans-serif">Ghost Rating: ${params.previousRating} → ${params.newRating}   ${deltaLabel}</text>
      <text x="120" y="494" fill="#f6d3ff" font-size="34" font-family="Arial, sans-serif" font-weight="700">${params.message}</text>
    </svg>
  `.trim();

  const blob = await svgToPng(svg, width, height);
  const file = new File([blob], 'ghost-mode-result.png', { type: 'image/png' });

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({
      title: 'Racehorse Dominoes Ghost Mode',
      text: `${params.message} Ghost Rating ${params.previousRating} → ${params.newRating} (${deltaLabel}).`,
      files: [file],
    });
    return;
  }

  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ghost-mode-result.png';
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function svgToPng(svg: string, width: number, height: number): Promise<Blob> {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unable to render share card.'));
    img.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');
  ctx.drawImage(image, 0, 0, width, height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Unable to export share card.'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}
