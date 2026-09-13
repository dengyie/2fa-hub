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
  const { data, width, height } = imgData;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  if (scale >= 1) return imgData;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tmp = new ImageData(new Uint8ClampedArray(data), width, height);
  ctx.putImageData(tmp, 0, 0);
  ctx.drawImage(canvas, 0, 0, width, height, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
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

// jsQR 多尺度 + 多反转组合遍历
async function tryJsQR(img) {
  const original = toImageData(img);
  const candidates = [];
  candidates.push(original);
  candidates.push(downsample(original, 1024));
  candidates.push(downsample(original, 640));

  for (const c of candidates) {
    try {
      const found = jsQR(c.data, c.width, c.height, { inversionAttempts: 'dontInvert' });
      if (found?.data) return found.data;
    } catch { /* 跳过该尺度 */ }
    // 反色再试一次（白底黑码照片在暗色显示下可能反色）
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