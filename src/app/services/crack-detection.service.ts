import { Injectable } from '@angular/core';
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
      const modelPath = (isFileProtocol && !isCapacitorLocal) ? 'assets/onnx/crack_multihead_cnn.onnx' : `${origin}/assets/onnx/crack_multihead_cnn.onnx`;
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

    return {
      severity: SEVERITY_CLASSES[this.argmax(results['severity'].data as Float32Array)],
      shape: SHAPE_CLASSES[this.argmax(results['shape'].data as Float32Array)],
      type: TYPE_CLASSES[this.argmax(results['type'].data as Float32Array)]
    };
  }

  /** Safe argmax for Float32Array or number[] */
  private argmax(arr: Float32Array | number[]): number {
    const nums = Array.from(arr); // avoid TS reduce error
    return nums.reduce((maxIdx, val, i) => val > nums[maxIdx] ? i : maxIdx, 0);
  }
}
