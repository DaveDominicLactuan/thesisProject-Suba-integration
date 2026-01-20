import { Injectable } from '@angular/core';
import { BoundingBox, BoxPrediction } from '../types';
import { Capacitor } from '@capacitor/core';

let ort: any = null;

const TYPE_CLASSES = ['branching', 'diagonal', 'horizontal', 'map/web', 'vertical'];
const SHAPE_CLASSES = ['branching', 'curved', 'mapped/network', 'straight'];
const SEVERITY_CLASSES = ['hairline', 'minor', 'moderate', 'severe'];

export type InferenceResult = {
  boxes: BoxPrediction[];
};

@Injectable({
  providedIn: 'root'
})
export class CrackDetectionService {
  private session: any = null;

  private async init() {
    if (!this.session) {
      if (!ort) {
        ort = await import('onnxruntime-web');
      }

      const isFileProtocol = (typeof location !== 'undefined') && location.protocol === 'file:';
      const origin = (typeof location !== 'undefined' && location.origin) ? location.origin : '';
      const isCapacitorLocal = origin.startsWith('capacitor://') || origin.includes('localhost');

      if (ort.env && ort.env.wasm) {
        const wasmBase = (isFileProtocol && !isCapacitorLocal) ? 'assets/onnx/' : `${origin}/assets/onnx/`;
        ort.env.wasm.wasmPaths = wasmBase;
      }

      const modelPath = (isFileProtocol && !isCapacitorLocal) ? 
        'assets/onnx/crack_multihead_cnn_with_mask.onnx' : 
        `${origin}/assets/onnx/crack_multihead_cnn_with_mask.onnx`;

      try {
        const resp = await fetch(modelPath);
        if (!resp.ok) throw new Error(`Model fetch failed: ${resp.status}`);
        const buf = await resp.arrayBuffer();
        const bytes = new Uint8Array(buf);
        this.session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
      } catch (err) {
        console.warn('[CrackDetectionService] Model fetch failed, falling back to URL create:', err);
        this.session = await ort.InferenceSession.create(modelPath, { executionProviders: ['wasm'] });
      }

      console.log('✅ ORT session initialized');
    }
  }

  async runInference(
    imageTensor: Float32Array, // [1,3,H,W]
    imageWidth: number,
    imageHeight: number
  ): Promise<InferenceResult> {

    await this.init();

    // get mask first
    const baseTensor = new ort.Tensor('float32', imageTensor, [1, 3, imageHeight, imageWidth]);
    const results = await this.session.run({ input: baseTensor });

    const mask = results['mask'];
    if (!mask) {
      throw new Error('Model did not output mask');
    }

    // retrieve box
    const boxes = this.maskToBBoxes(
      mask.data,
      mask.dims[3],
      mask.dims[2],
      0.5,
      10
    );

    // classify per box
    const predictions: BoxPrediction[] = [];

    for (const box of boxes) {
      const cropTensor = this.cropAndResize(
        imageTensor,
        imageWidth,
        imageHeight,
        box,
        128,
        128
      );

      const cropOrtTensor = new ort.Tensor('float32', cropTensor, [1, 3, 128, 128]);
      const cropResults = await this.session.run({ input: cropOrtTensor });

      predictions.push({
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        type: TYPE_CLASSES[this.argmax(cropResults['type'].data)],
        shape: SHAPE_CLASSES[this.argmax(cropResults['shape'].data)],
        severity: SEVERITY_CLASSES[this.argmax(cropResults['severity'].data)],
        prediction: {
          type: TYPE_CLASSES[this.argmax(cropResults['type'].data)],
          shape: SHAPE_CLASSES[this.argmax(cropResults['shape'].data)],
          severity: SEVERITY_CLASSES[this.argmax(cropResults['severity'].data)]
        }
      });
    }

    return { boxes: predictions };
  }

  private argmax(arr: Float32Array | number[]): number {
    const nums = Array.from(arr);
    return nums.reduce((maxIdx, val, i) => val > nums[maxIdx] ? i : maxIdx, 0);
  }

  private cropAndResize(
    input: Float32Array,
    W: number,
    H: number,
    box: BoundingBox,
    outW: number,
    outH: number
  ): Float32Array {
    const output = new Float32Array(3 * outW * outH);

    for (let c = 0; c < 3; c++) {
      for (let oy = 0; oy < outH; oy++) {
        for (let ox = 0; ox < outW; ox++) {
          const srcX = Math.floor(box.x + (ox / outW) * box.w);
          const srcY = Math.floor(box.y + (oy / outH) * box.h);

          const clampedX = Math.max(0, Math.min(W - 1, srcX));
          const clampedY = Math.max(0, Math.min(H - 1, srcY));

          const srcIdx = c * W * H + clampedY * W + clampedX;
          const dstIdx = c * outW * outH + oy * outW + ox;

          output[dstIdx] = input[srcIdx];
        }
      }
    }

    return output;
  }

  maskToBBoxes(
    mask: Float32Array | Uint8Array | number[] | number[][],
    width?: number,
    height?: number,
    threshold = 0.5,
    minArea = 10
  ): BoundingBox[] {
    let w = width as number;
    let h = height as number;
    let flat: Uint8Array;

    if (Array.isArray(mask) && mask.length > 0 && Array.isArray(mask[0])) {
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
      const arr = mask as Float32Array | Uint8Array | number[];
      if ((!w || !h) && arr.length) {
        const n = arr.length;
        const side = Math.round(Math.sqrt(n));
        if (side * side === n) { w = side; h = side; }
        else if (!w && height) { h = height; w = Math.floor(n / h); }
        else if (!h && width) { w = width; h = Math.floor(n / w); }
        else { w = n; h = 1; }
      }
      flat = new Uint8Array(w * h);
      for (let i = 0; i < Math.min(arr.length, w * h); i++) {
        flat[i] = (arr as any)[i] >= threshold ? 1 : 0;
      }
    }

    const visited = new Uint8Array(w * h);
    const boxes: BoundingBox[] = [];

    const pushIf = (idx: number, stack: number[]) => {
      if (idx >= 0 && idx < flat.length && flat[idx] && !visited[idx]) stack.push(idx);
    };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (!flat[idx] || visited[idx]) continue;

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
          boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, type: 'unknown', shape: 'unknown', severity: 'unknown' });
        }
      }
    }

    return boxes;
  }
}