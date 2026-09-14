// 二维码图片解码：优先使用原生 BarcodeDetector（更快、对真实照片更稳），回退 jsQR，
// 并尝试多种尺度缩放 / 反转组合增强对模糊、反色照片的识别成功率。
import jsQR from 'jsqr';

function toImageData(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function downsample(imgData, maxDim) {
  const { width, height } = imgData;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  if (scale >= 1) return imgData;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  // 先将完整原图绘制到全尺寸画布，再缩放到目标尺寸，
  // 避免 putImageData 直接写入小画布导致仅保留左上角裁剪区域。
  const src = document.createElement('canvas');
  src.width = width;
  src.height = height;
  src.getContext('2d').putImageData(imgData, 0, 0);

  const dst = document.createElement('canvas');
  dst.width = w;
  dst.height = h;
  const dctx = dst.getContext('2d', { willReadFrequently: true });
  dctx.drawImage(src, 0, 0, width, height, 0, 0, w, h);
  return dctx.getImageData(0, 0, w, h);
}

// 原生 BarcodeDetector（Chrome/Edge）对真实拍摄照片鲁棒性最高，优先尝试
async function tryBarcodeDetector(img) {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    const results = await detector.detect(img);
    for (const res of results) {
      if (res?.rawValue) return res.rawValue;
    }
  } catch {
    /* 回退到 jsQR */
  }
  return null;
}

// 让出主线程，避免同步 jsQR 长时间阻塞 UI
const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

// jsQR 多尺度 + 多反转组合遍历。候选按面积从小到大排列，
// 优先跑缩小图（更快又不失识别率），原图最后兜底，且每轮之间让出主线程。
async function tryJsQR(img) {
  const original = toImageData(img);
  const candidates = [
    downsample(original, 640),
    downsample(original, 1024),
    original,
  ];

  for (const c of candidates) {
    await yieldToUI();
    try {
      const found = jsQR(c.data, c.width, c.height, { inversionAttempts: 'dontInvert' });
      if (found?.data) return found.data;
    } catch { /* 跳过该尺度 */ }
    // 反色再试一次（白底黑码照片在暗色显示下可能反色）
    await yieldToUI();
    try {
      const inverted = new Uint8ClampedArray(c.data);
      for (let i = 0; i < inverted.length; i += 4) {
        inverted[i] = 255 - inverted[i];
        inverted[i + 1] = 255 - inverted[i + 1];
        inverted[i + 2] = 255 - inverted[i + 2];
      }
      const invImg = new ImageData(inverted, c.width, c.height);
      const found = jsQR(invImg.data, invImg.width, invImg.height, { inversionAttempts: 'attemptBoth' });
      if (found?.data) return found.data;
    } catch { /* 跳过 */ }
  }
  return null;
}

export async function decodeQRImage(img) {
  const native = await tryBarcodeDetector(img);
  if (native) return native;
  return tryJsQR(img);
}