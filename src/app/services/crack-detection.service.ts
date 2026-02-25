import { Injectable } from '@angular/core';
import { BoundingBox } from '../image-storage.service';
// We'll dynamically import onnxruntime-web at runtime so we can set wasmPaths
// before the library attempts to load helper modules. This avoids module
// specifier resolution errors in browsers and mobile WebViews.
let ort: any = null;

const TYPE_CLASSES = ['branching', 'diagonal', 'horizontal', 'map/web', 'vertical'];
const SHAPE_CLASSES = ['branching', 'curved', 'mapped/network', 'straight'];
const SEVERITY_CLASSES = ['hairline', 'minor', 'moderate', 'severe'];

export type BoxPrediction = BoundingBox & {
  type: string;
  shape: string;
  severity: string;
  prediction: {
    type: string;
    shape: string;
    severity: string;
  };
};

export type InferenceResult = {
  boxes: BoxPrediction[];
  maskWidth?: number;
  maskHeight?: number;
};


@Injectable({
  providedIn: 'root'
})
export class CrackDetectionService {
  private session: any = null;

  /** Initialize ONNX Runtime Web session */
  private async init() {
    if (!this.session) {
      // Dynamic import ONNX runtime if not already loaded
      if (!ort) {
        ort = await import('onnxruntime-web');
      }

      // Detect environment: file://, Capacitor-localhost, or normal http(s)
      const isFileProtocol = (typeof location !== 'undefined') && location.protocol === 'file:';
      const origin = (typeof location !== 'undefined' && location.origin) ? location.origin : '';
      const isCapacitorLocal = origin.startsWith('capacitor://') || origin.includes('localhost');

      // Choose wasmPaths appropriate for environment. For embedded file:// apps use relative
      // assets; for http(s) and capacitor://localhost use origin-absolute so module specifiers
      // resolve to full URLs (avoids 404s for helper .mjs/.wasm files).
      if (ort.env && ort.env.wasm) {
        const wasmBase = (isFileProtocol && !isCapacitorLocal) ? 'assets/onnx/' : `${origin}/assets/onnx/`;
        ort.env.wasm.wasmPaths = wasmBase;
        console.log('[CrackDetectionService] set wasmPaths =', ort.env.wasm.wasmPaths);
      }

      // Build model path similarly. Use origin when available to ensure absolute URL in WebViews.
      const modelPath = (isFileProtocol && !isCapacitorLocal) ? 'assets/onnx/crack_multihead_cnn_with_mask.onnx' : `${origin}/assets/onnx/crack_multihead_cnn_with_mask.onnx`;
      console.log('[CrackDetectionService] modelPath =', modelPath, 'origin=', origin, 'isFileProtocol=', isFileProtocol, 'isCapacitorLocal=', isCapacitorLocal);

      // Try fetching model bytes first (works on both file:// and http when accessible).
      try {
        const resp = await fetch(modelPath);
        if (!resp.ok) throw new Error(`Model fetch failed: ${resp.status}`);
        const buf = await resp.arrayBuffer();
        const bytes = new Uint8Array(buf);
        this.session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
      } catch (err) {
        // Fallback to letting ORT load via URL (some environments prefer that)
        console.warn('[CrackDetectionService] Model fetch failed, falling back to URL create:', err);
        try {
          this.session = await ort.InferenceSession.create(modelPath, { executionProviders: ['wasm'] });
        } catch (err2) {
          console.error('[CrackDetectionService] Failed to create session from URL:', err2);
          throw err2;
        }
      }
      console.log("✅ ORT session initialized");
    }
  }

  async runInference(
    imageTensor: Float32Array,
    imageWidth: number,
    imageHeight: number
  ): Promise<InferenceResult> {
    await this.init();

    const channels = 3;
    const spatialSize = imageTensor.length / channels;
    if (!Number.isFinite(spatialSize) || !Number.isInteger(spatialSize) || spatialSize <= 0) {
      throw new Error(`[CrackDetectionService] Invalid tensor length: ${imageTensor.length}`);
    }

    let tensorW = imageWidth;
    let tensorH = imageHeight;
    const providedShapeMatches =
      Number.isFinite(tensorW) && Number.isFinite(tensorH) && tensorW > 0 && tensorH > 0 && (tensorW * tensorH === spatialSize);

    if (!providedShapeMatches) {
      const side = Math.round(Math.sqrt(spatialSize));
      if (side * side === spatialSize) {
        tensorW = side;
        tensorH = side;
      } else {
        tensorW = spatialSize;
        tensorH = 1;
      }

      console.warn(
        `[CrackDetectionService] Tensor shape mismatch: got ${imageWidth}x${imageHeight} for data length ${imageTensor.length}. Using ${tensorW}x${tensorH}.`
      );
    }

    const baseTensor = new ort.Tensor('float32', imageTensor, [1, 3, tensorH, tensorW]);
    const results = await this.session.run({ input: baseTensor });

    console.log(
      '[ORT OUTPUTS]',
      Object.entries(results).map(([name, t]: any) => ({
        name,
        dims: t.dims,
        length: t.data?.length
      }))
    );

    const mask = results['mask'] || results['masks'] || results['pred_mask'];
    if (!mask || !mask.data) {
      throw new Error('[CrackDetectionService] Model did not output a usable mask tensor');
    }

    const maskDims = Array.isArray(mask.dims) ? (mask.dims as number[]) : [];
    let maskW = maskDims.length >= 2 ? Number(maskDims[maskDims.length - 1]) : tensorW;
    let maskH = maskDims.length >= 2 ? Number(maskDims[maskDims.length - 2]) : tensorH;

    if (!Number.isFinite(maskW) || maskW <= 0 || !Number.isFinite(maskH) || maskH <= 0) {
      const dataLength = Array.isArray(mask.data) ? mask.data.length : (mask.data?.length || 0);
      const side = Math.round(Math.sqrt(dataLength));
      if (side * side === dataLength && side > 0) {
        maskW = side;
        maskH = side;
      } else {
        maskW = tensorW;
        maskH = tensorH;
      }
    }

    const boxes = this.maskToBBoxes(mask.data, maskW, maskH, 0.5, 10);
    const predictions: BoxPrediction[] = [];

    for (const box of boxes) {
      const cropBox: BoundingBox = {
        x: Math.round((box.x / maskW) * tensorW),
        y: Math.round((box.y / maskH) * tensorH),
        w: Math.max(1, Math.round((box.w / maskW) * tensorW)),
        h: Math.max(1, Math.round((box.h / maskH) * tensorH))
      };

      const cropTensor = this.cropAndResize(
        imageTensor,
        tensorW,
        tensorH,
        cropBox,
        128,
        128
      );

      const cropOrtTensor = new ort.Tensor('float32', cropTensor, [1, 3, 128, 128]);
      const cropResults = await this.session.run({ input: cropOrtTensor });

      const type = TYPE_CLASSES[this.argmax(cropResults['type']?.data as Float32Array | number[])];
      const shape = SHAPE_CLASSES[this.argmax(cropResults['shape']?.data as Float32Array | number[])];
      const severity = SEVERITY_CLASSES[this.argmax(cropResults['severity']?.data as Float32Array | number[])];

      predictions.push({
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        type,
        shape,
        severity,
        prediction: { type, shape, severity }
      });
    }

    return {
      boxes: predictions,
      maskWidth: maskW,
      maskHeight: maskH
    };
  }

  /** Safe argmax for Float32Array or number[] */
  private argmax(arr: Float32Array | number[]): number {
    if (!arr || (arr as any).length === 0) return 0;
    const nums = Array.from(arr); // avoid TS reduce error
    return nums.reduce((maxIdx, val, i) => val > nums[maxIdx] ? i : maxIdx, 0);
  }

  private cropAndResize(
    input: Float32Array,
    width: number,
    height: number,
    box: BoundingBox,
    outW: number,
    outH: number
  ): Float32Array {
    const output = new Float32Array(3 * outW * outH);

    for (let channel = 0; channel < 3; channel++) {
      for (let outY = 0; outY < outH; outY++) {
        for (let outX = 0; outX < outW; outX++) {
          const srcX = Math.floor(box.x + (outX / outW) * box.w);
          const srcY = Math.floor(box.y + (outY / outH) * box.h);

          const clampedX = Math.max(0, Math.min(width - 1, srcX));
          const clampedY = Math.max(0, Math.min(height - 1, srcY));

          const srcIdx = channel * width * height + clampedY * width + clampedX;
          const dstIdx = channel * outW * outH + outY * outW + outX;

          output[dstIdx] = input[srcIdx];
        }
      }
    }

    return output;
  }

  /**
   * Convert a predicted mask array into bounding boxes.
   * Accepts a flat array (row-major) or typed array of length width*height,
   * or a 2D nested array (number[][]) where inner arrays are rows.
   * Returns bounding boxes in {x,y,w,h} format filtered by minArea (pixels).
   */
  maskToBBoxes(mask: Float32Array | Uint8Array | number[] | number[][], width?: number, height?: number, threshold = 0.5, minArea = 10): BoundingBox[] {
    // Normalize input to a flat Uint8 binary mask of 0/1 values
    let w = width as number;
    let h = height as number;
    let flat: Uint8Array;

    if (Array.isArray(mask) && mask.length > 0 && Array.isArray(mask[0])) {
      // mask is number[][] rows
      const rows = mask as number[][];
      h = rows.length;
      w = rows[0].length;
      flat = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        const row = rows[y];
        for (let x = 0; x < w; x++) {
          flat[y * w + x] = (row[x] >= threshold) ? 1 : 0;
        }
      }
    } else {
      // 1D typed/number array
      const arr = mask as Float32Array | Uint8Array | number[];
      if ((w === undefined || h === undefined) && arr.length) {
        // if only one dimension provided, try to infer square shape
        if (!w || !h) {
          const n = arr.length;
          const side = Math.round(Math.sqrt(n));
          if (side * side === n) {
            w = side; h = side;
          } else if (!w && height) {
            h = height; w = Math.floor(n / h);
          } else if (!h && width) {
            w = width; h = Math.floor(n / w);
          } else {
            // fallback: treat as 1-row
            w = n; h = 1;
          }
        }
      }
      flat = new Uint8Array(w * h);
      for (let i = 0; i < Math.min(arr.length, w * h); i++) {
        const val = (arr as any)[i];
        flat[i] = (val >= threshold) ? 1 : 0;
      }
    }

    const visited = new Uint8Array(w * h);
    const boxes: BoundingBox[] = [];

    // helper to push neighbor index
    const pushIf = (idx: number, stack: number[]) => {
      if (idx >= 0 && idx < flat.length && flat[idx] && !visited[idx]) stack.push(idx);
    };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (!flat[idx] || visited[idx]) continue;

        // BFS / flood fill to find connected component
        const stack = [idx];
        let minX = x, maxX = x, minY = y, maxY = y;
        let area = 0;

        while (stack.length) {
          const cur = stack.pop() as number;
          if (visited[cur]) continue;
          visited[cur] = 1;
          const cy = Math.floor(cur / w);
          const cx = cur % w;
          area++;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          // 4-neighbors
          const left = cur - 1;
          const right = cur + 1;
          const up = cur - w;
          const down = cur + w;
          if (cx > 0) pushIf(left, stack);
          if (cx < w - 1) pushIf(right, stack);
          if (cy > 0) pushIf(up, stack);
          if (cy < h - 1) pushIf(down, stack);
        }

        if (area >= minArea) {
          boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
        }
      }
    }

    return boxes;
  }
}
