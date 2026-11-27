const longEdge = 1920;
const shortEdge = 1080;

export function isFullHd(width, height) {
  return Math.max(width, height) >= longEdge && Math.min(width, height) >= shortEdge;
}

export async function requireFullHd(track, nativeResize) {
  for (const [width, height] of [[longEdge, shortEdge], [shortEdge, longEdge]]) {
    try {
      await track.applyConstraints({
        width: { min: width, ideal: width },
        height: { min: height, ideal: height },
        frameRate: { ideal: 24 },
        ...(nativeResize ? { resizeMode: { exact: 'none' } } : {}),
      });
      return;
    } catch (error) {
      // Some cameras report portrait as their primary orientation.
      if (width === shortEdge || error.name !== 'OverconstrainedError' ||
          (error.constraint && !['width', 'height'].includes(error.constraint))) throw error;
    }
  }
}

export function cameraScanRegion(width, height) {
  const size = Math.round(Math.min(width, height) * 4 / 9);
  return {
    x: Math.floor((width - size) / 2),
    y: Math.floor((height - size) / 2),
    size,
    scanSize: Math.min(size, 540),
  };
}

export function previewScanRegion(region, width, height, viewWidth, viewHeight) {
  const scale = Math.min(viewWidth / width, viewHeight / height);
  return {
    left: (viewWidth - width * scale) / 2 + region.x * scale,
    top: (viewHeight - height * scale) / 2 + region.y * scale,
    width: region.size * scale,
    height: region.size * scale,
  };
}
