import { Injectable } from '@angular/core';
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

      // Detect whether we're running from file:// (mobile WebView) or http(s)
      const isFileProtocol = (typeof location !== 'undefined') && location.protocol === 'file:';

      // Choose wasmPaths appropriate for environment. On file:// (Capacitor/embedded),
      // root-relative URLs may not resolve correctly so use a relative path.
      // ort.env is often a getter-only module export; don't reassign it.
      if (ort.env && ort.env.wasm) {
        // Use origin-absolute path for http/https so the browser resolves
        // module specifiers to full URLs (avoids 'assets/onnx/...' relative imports).
        // For file:// protocol (Capacitor) use relative paths.
        const wasmBase = isFileProtocol ? 'assets/onnx/' : `${location.origin}/assets/onnx/`;
        ort.env.wasm.wasmPaths = wasmBase;
      }

      // Build model path similarly
      const modelPath = isFileProtocol ? 'assets/onnx/crack_multihead_cnn.onnx' : '/assets/onnx/crack_multihead_cnn.onnx';

      // Try fetching model bytes first (works on both file:// and http when accessible).
      try {
        const resp = await fetch(modelPath);
        if (!resp.ok) throw new Error(`Model fetch failed: ${resp.status}`);
        const buf = await resp.arrayBuffer();
        const bytes = new Uint8Array(buf);
        this.session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
      } catch (err) {
        // Fallback to letting ORT load via URL (some environments prefer that)
        console.warn('Model fetch failed, falling back to URL create:', err);
        this.session = await ort.InferenceSession.create(modelPath, { executionProviders: ['wasm'] });
      }
      console.log("✅ ORT session initialized");
    }
  }

  /** Run inference on a Float32Array image tensor [1,3,128,128] */
  async runInference(inputTensor: Float32Array) {
    await this.init();

    const tensor = new ort.Tensor('float32', inputTensor, [1, 3, 128, 128]);
    const feeds: Record<string, any> = { input: tensor };

    const results = await this.session.run(feeds);
    return this.mapResults(results);
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
