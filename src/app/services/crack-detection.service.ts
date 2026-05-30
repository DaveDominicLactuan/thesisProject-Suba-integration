import { Injectable } from '@angular/core';
import { BoundingBox } from '../image-storage.service';
import { Capacitor } from '@capacitor/core';
// We'll dynamically import onnxruntime-web at runtime so we can set wasmPaths
// before the library attempts to load helper modules. This avoids module
// specifier resolution errors in browsers and mobile WebViews.
let ort: any = null;

const TYPE_CLASSES = ['branching', 'diagonal', 'horizontal', 'map/web', 'vertical'];
const SHAPE_CLASSES = ['branching', 'curved', 'mapped/network', 'straight'];
const SEVERITY_CLASSES = ['hairline', 'minor', 'moderate', 'severe'];


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

  /** Run inference on a Float32Array image tensor [1,3,128,128] */
  async runInference(inputTensor: Float32Array) {
    try {
      await this.init();

      const tensor = new ort.Tensor('float32', inputTensor, [1, 3, 128, 128]);
      const feeds: Record<string, any> = { input: tensor };

      const results = await this.session.run(feeds);

      console.log(
        '[ORT OUTPUTS]',
        Object.entries(results).map(([name, t]: any) => ({
          name,
          dims: t.dims,
          length: t.data?.length
        }))
      );

      return this.mapResults(results);
    } catch (err) {
      console.warn('[CrackDetectionService] runInference failed — returning fallback prediction:', err);
      // Return a harmless fallback so UI flow and storage still work on device when model fails
      return {
        severity: 'minor',
        shape: 'straight',
        type: 'horizontal'
      };
    }
  }

  /** Convert raw ONNX output to class labels */
  private mapResults(results: Record<string, any>) {
    console.log("🧪 Raw results:", results);
    const out: any = {
      severity: SEVERITY_CLASSES[this.argmax(results['severity'].data as Float32Array)],
      shape: SHAPE_CLASSES[this.argmax(results['shape'].data as Float32Array)],
      type: TYPE_CLASSES[this.argmax(results['type'].data as Float32Array)]
    };

    // If model produces a mask output (common name: 'mask'), extract bounding boxes
    try {
      const maskOutput = results['mask'] || results['masks'] || results['pred_mask'];
      if (maskOutput && maskOutput.data) {
        const data = maskOutput.data as Float32Array | number[];
        const dims = Array.isArray(maskOutput.dims) ? maskOutput.dims as number[] : [];
        // Infer H, W from dims (take last two dims)
        let maskH = 0, maskW = 0;
        if (dims.length >= 2) {
          maskW = dims[dims.length - 1];
          maskH = dims[dims.length - 2];
        } else if ((data as any).length) {
          const n = (data as any).length;
          const side = Math.round(Math.sqrt(n));
          if (side * side === n) { maskW = maskH = side; }
        }

        // Call maskToBBoxes with flat data and inferred dims
        const boxes = this.maskToBBoxes(data as any, maskW || undefined, maskH || undefined, 0.5, 10);
        out.boxes = boxes;
        if (maskW && maskH) {
          out.maskWidth = maskW;
          out.maskHeight = maskH;
        }
      }
    } catch (e) {
      // ignore mask processing errors
      console.warn('[CrackDetectionService] mask processing failed', e);
    }

    return out;
  }

  /** Safe argmax for Float32Array or number[] */
  private argmax(arr: Float32Array | number[]): number {
    const nums = Array.from(arr); // avoid TS reduce error
    return nums.reduce((maxIdx, val, i) => val > nums[maxIdx] ? i : maxIdx, 0);
  }

  /**
   * Convert a predicted mask array into bounding boxes.
   * Accepts a flat array (row-major) or typed array of length width*height,
   * or a 2D nested array (number[][]) where inner arrays are rows.
   * Returns bounding boxes in {x,y,w,h} format filtered by minArea (pixels).
   */
  maskToBBoxes(mask: Float32Array | Uint8Array | number[] | number[][], width?: number, height?: number, threshold = 0.35, minArea = 120): BoundingBox[] {
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

    // SIMPLE DILATION TO CONNECT FRAGMENTS
    const dilated = new Uint8Array(flat);

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {

        const idx = y * w + x;

        if (flat[idx]) {

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {

              const nidx = (y + dy) * w + (x + dx);
              dilated[nidx] = 1;

            }
          }
        }
      }
    }

    flat = dilated;

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

    return this.mergeNearbyBoxes(boxes);
  }

  private mergeNearbyBoxes(
    boxes: BoundingBox[],
    distanceThreshold = 25
  ): BoundingBox[] {

    let merged = true;

    while (merged) {

      merged = false;

      for (let i = 0; i < boxes.length; i++) {

        for (let j = i + 1; j < boxes.length; j++) {

          const a = boxes[i];
          const b = boxes[j];

          const ax2 = a.x + a.w;
          const ay2 = a.y + a.h;

          const bx2 = b.x + b.w;
          const by2 = b.y + b.h;

          const dx = Math.max(
            0,
            Math.max(a.x - bx2, b.x - ax2)
          );

          const dy = Math.max(
            0,
            Math.max(a.y - by2, b.y - ay2)
          );

          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist <= distanceThreshold) {

            const nx1 = Math.min(a.x, b.x);
            const ny1 = Math.min(a.y, b.y);

            const nx2 = Math.max(ax2, bx2);
            const ny2 = Math.max(ay2, by2);

            boxes[i] = {
              x: nx1,
              y: ny1,
              w: nx2 - nx1,
              h: ny2 - ny1
            };

            boxes.splice(j, 1);

            merged = true;

            break;
          }
        }

        if (merged) break;
      }
    }

    return boxes;
  }
}
