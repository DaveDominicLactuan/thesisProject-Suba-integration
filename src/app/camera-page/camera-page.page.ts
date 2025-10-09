import { Component, OnDestroy, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { Platform } from '@ionic/angular';
import { Camera } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { CrackDetectionService } from '../services/crack-detection.service';
import { ImageStorageService, StoredImage } from '../services/image-storage.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// declare var ort: any;

// ort.env.wasm.wasmPaths = 'assets/onnx/';

interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ScaledBox {
  x: number;
  y: number;
  w: number;
  h: number;
  original: BoundingBox;
}

console.log('CameraPagePage component file loaded');

@Component({
  selector: 'app-camera-page',
  templateUrl: './camera-page.page.html',
  styleUrls: ['./camera-page.page.scss'],
  standalone: false,
})
export class CameraPagePage implements AfterViewInit {
  @ViewChild('video') videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  imagePreview: string | null = null;
  capturedImages: string[] = [];
  usingFrontCamera = false;
  mediaStream: MediaStream | null = null;
  extraText: string | null = null;
  isProcessing: boolean = true;
  photosTaken = 0;
  photosProcessed = 0;
  savedImage: StoredImage | null = null;
  lastPrediction: { type: string; shape: string; severity: string } | null = null;

  scaledBoxes = [];

  get countdown() {
    return this.photosTaken - this.photosProcessed;
  }

  constructor(
    private platform: Platform,
    private router: Router,
    private sanitizer: DomSanitizer,
    private crackDetectionService: CrackDetectionService,
    private imageStorage: ImageStorageService
  ) {
    this.requestCameraPermission();
  }

  ngAfterViewInit() {
    this.platform.ready().then(() => this.initCamera());
  }

  /** Initialize live camera feed */
  async initCamera() {
    if (Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios') {
      const permissions = await Camera.requestPermissions();
      if (permissions.camera !== 'granted') {
        alert('Camera permission denied. Please enable it in system settings.');
        return;
      }
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    try {
      const constraints: MediaStreamConstraints = { video: { facingMode: 'environment' }, audio: false };
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      const videoEl = this.videoRef.nativeElement;
      videoEl.srcObject = this.mediaStream;
      await new Promise<void>(resolve => {
        videoEl.onloadedmetadata = () => {
          videoEl.play();
          resolve();
        };
      });
      console.log('✅ Live camera preview started');
    } catch (error) {
      console.error('Camera access error:', error);
      alert('Failed to access camera. Please check permissions and device compatibility.');
    }
  }

  /** Capture a frame, preprocess, run inference, and save result */
  async takePicture() {
    // Ensure UI shows processing state immediately
    this.isProcessing = true;
    this.photosTaken++;
    // track whether inference was invoked and whether it succeeded
    let inferenceCalled = false;
    let inferenceSucceeded = false;

    try {
      const video = this.videoRef.nativeElement;
      const canvas = this.canvasRef.nativeElement;
      const ctx = canvas.getContext('2d')!;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL('image/png');
      this.imagePreview = dataUrl;
      this.capturedImages.unshift(dataUrl);

  // Preprocess → inference → save
  const imageTensor = await this.preprocessImage(dataUrl);
  // call the backend/model
  let prediction = null;
  try {
    prediction = await this.crackDetectionService.runInference(imageTensor);
    inferenceCalled = true;
    inferenceSucceeded = true;
  } catch (e) {
    console.warn('Inference failed:', e);
    inferenceCalled = true;
    inferenceSucceeded = false;
  }

      const now = new Date().toISOString();
      const filename = this.generateFilename();

      const entry: StoredImage = {
        original: dataUrl,
        timestamp: now,
        filename,
        prediction: prediction || undefined,
        hasPrediction: !!prediction,
        statusMessage: inferenceSucceeded ? 'Prediction succeeded' : (inferenceCalled ? 'Prediction failed' : 'No prediction')
      };
      await this.imageStorage.addImage(entry); // persists via @ionic/storage
      this.savedImage = entry;
      this.lastPrediction = prediction;

      this.photosProcessed++;

      // Keep console.log before clearing isProcessing so callers/UI see processing until logging completes
      console.log('✅ Prediction stored:', prediction);
      // Print all currently stored images to verify persistence
      try {
        // getAllImages might be synchronous (returns array) or asynchronous in other implementations.
        const allOrPromise = this.imageStorage.getAllImages();
        let all: any[];
        if (allOrPromise && typeof (allOrPromise as any).then === 'function') {
          // await the promise-like value
          all = await (allOrPromise as any);
        } else {
          all = allOrPromise as any;
        }
        // Stringify for more reliable remote/device console output, and also print a table if possible
        try {
          console.log('📂 Currently stored images (latest first):', JSON.stringify(all));
          if (Array.isArray(all) && (console as any).table) (console as any).table(all);
        } catch (e) {
          console.log('📂 Currently stored images (latest first):', all);
        }
      } catch (logErr) {
        console.warn('Failed to read stored images for verification:', logErr);
      }

      // Set a user-facing message depending on whether inference ran/succeeded
      if (inferenceCalled && inferenceSucceeded && prediction) {
        // TypeScript can't infer that `prediction` is non-null from the booleans above,
        // so check explicitly before accessing properties.
        const { type, shape, severity } = prediction;
        this.extraText = `✅ Inference: ${type}, ${shape}, ${severity}`;
      } else if (inferenceCalled && !inferenceSucceeded) {
        this.extraText = '⚠️ Inference was called but failed.';
      } else {
        this.extraText = '⚠️ Inference was not called.';
      }
    } catch (err) {
      console.error('Failed to take picture / run inference:', err);
      // If inference was called but threw, mark as such
      if (inferenceCalled && !inferenceSucceeded) {
        this.extraText = '❌ Inference call failed. See console for details.';
      } else if (!inferenceCalled) {
        this.extraText = '❌ Capture or preprocessing failed before inference.';
      } else {
        this.extraText = '❌ Unknown error during capture/inference.';
      }
      alert('Failed to capture/process image. See console for details.');
    } finally {
      // Always clear processing flag so UI is responsive again
      this.isProcessing = false;
    }
  }

  /** Resize + normalize image to [1,3,128,128] Float32Array */
  async preprocessImage(dataUrl: string): Promise<Float32Array> {
    const img = new Image();
    img.src = dataUrl;
    await new Promise(resolve => (img.onload = resolve));

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, 128, 128);

    const imageData = ctx.getImageData(0, 0, 128, 128);
    const data = new Float32Array(1 * 3 * 128 * 128);

    for (let i = 0; i < 128 * 128; i++) {
      data[i] = (imageData.data[i * 4] / 255 - 0.5) / 0.5;           // R
      data[i + 128 * 128] = (imageData.data[i * 4 + 1] / 255 - 0.5) / 0.5; // G
      data[i + 2 * 128 * 128] = (imageData.data[i * 4 + 2] / 255 - 0.5) / 0.5; // B
    }

    return data;
  }

  closePreview() {
    this.imagePreview = null;
  }

  toggleCamera() {
    this.usingFrontCamera = !this.usingFrontCamera;
    this.initCamera();
  }

  filterThumbnails(type: string) {
    //Optional: filtering logic by image origin
  }

  goToFeedBackPage() {
    this.router.navigate(['/feedback-page']);
    console.log('Navigating to Feedback page');
  }

  goToHomePage() {
    this.router.navigate(['/home-page']);
    console.log('Navigating to Sign Up page');
  }

  onBoxClick(box: any) {
    // Your bounding box logic
  }

  async requestCameraPermission() {
    // Only request Capacitor Camera permissions on native platforms.
    try {
      const platform = Capacitor.getPlatform();
      if (platform === 'android' || platform === 'ios') {
        const permission = await Camera.requestPermissions();

        if (permission.camera === 'granted') {
          console.log('✅ Camera permission granted');
          this.initCamera(); // Call your custom camera init
        } else {
          alert('❌ Camera permission denied. Please allow it in system settings.');
        }
      } else {
        // Web: permissions handled by the browser when calling getUserMedia
        console.log('Skipping Capacitor Camera.requestPermissions on web platform:', platform);
        // still attempt to init the camera for browser
        this.initCamera();
      }
    } catch (error) {
      // Some Capacitor methods throw on web (Not implemented) — ignore but log.
      console.warn('Permission request failed (continuing):', error);
      // Attempt to initialize camera using browser APIs as a fallback
      try { await this.initCamera(); } catch (e) { /* ignore */ }
    }
  }

  generateFilename(): string {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `P${this.photosTaken}${hh}${mm}.jpg`;
  }

  ngOnDestroy() {
    this.mediaStream?.getTracks().forEach(track => track.stop());
  }

  async drawBoxesOnImage(Base64: string, boxes: BoundingBox[]): Promise<string> {
    const img = new Image();
    img.src = Base64;

    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d')!;

    return new Promise((resolve) => {
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 3;
        boxes.forEach(box => ctx.strokeRect(box.x, box.y, box.w, box.h));
        resolve(canvas.toDataURL('image/jpeg'));
      };
    });
  }

  base64ToBlob(base64Data: string, contentType = ''): Blob {
    const byteCharacters = atob(base64Data);
    const byteArrays = [];

    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512);
      const byteNumbers = Array.from(slice).map(c => c.charCodeAt(0));
      byteArrays.push(new Uint8Array(byteNumbers));
    }

    return new Blob(byteArrays, { type: contentType });
  }

  async testWithLocalImage(file: File) {
    const reader = new FileReader();
    const dataUrl: string = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const imageTensor = await this.preprocessImage(dataUrl);
    const prediction = await this.crackDetectionService.runInference(imageTensor);

    console.log("🧪 Test Prediction:", prediction);
    this.lastPrediction = prediction;
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.testWithLocalImage(input.files[0]);
    }
  }
}
