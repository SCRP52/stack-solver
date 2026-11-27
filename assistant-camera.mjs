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

export function cameraScanSize(width, height) {
  const scale = Math.min(1, 1024 / Math.max(width, height), Math.sqrt(630000 / (width * height)));
  return {
    scanWidth: Math.round(width * scale),
    scanHeight: Math.round(height * scale),
  };
}

export function previewFrameBounds(width, height, viewWidth, viewHeight) {
  const scale = Math.min(viewWidth / width, viewHeight / height);
  return {
    left: (viewWidth - width * scale) / 2,
    top: (viewHeight - height * scale) / 2,
    width: width * scale,
    height: height * scale,
  };
}
