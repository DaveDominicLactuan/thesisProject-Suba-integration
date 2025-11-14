import { Component, OnDestroy, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { Platform } from '@ionic/angular';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
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
  selector: 'app-camera-page2',
  templateUrl: './camera-page2.page.html',
  styleUrls: ['./camera-page2.page.scss'],
  standalone: false,
})
export class CameraPage2Page implements AfterViewInit {
  @ViewChild('video') videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('uploadInput') uploadInputRef!: ElementRef<HTMLInputElement>;

  imagePreview: string | null = null;
  capturedImages: string[] = [];
  // authoritative list of images stored via ImageStorageService
  storedImages: StoredImage[] = [];
  usingFrontCamera = false;
  mediaStream: MediaStream | null = null;
  extraText: string | null = null;
  isProcessing: boolean = true;
  photosTaken = 0;
  photosProcessed = 0;
  savedImage: StoredImage | null = null;
  selectedThumbSrc: string | null = null;
  selectedImageTitle: string = '';
  lastPrediction: { type: string; shape: string; severity: string } | null = null;

  scaledBoxes = [];
  // session management
  sessions: any[] = [];
  selectedSessionId: string | null = null;

  get countdown() {
    return this.photosTaken - this.photosProcessed;
  }

  triggerFileInput() {
    try {
      this.uploadInputRef.nativeElement.click();
    } catch (e) {
      console.warn('triggerFileInput failed', e);
    }
  }

  async processFile(file: File) {
    const reader = new FileReader();
    const dataUrl: string = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await this.processDataUrl(dataUrl, file.name);
  }

  /**
   * Mobile image picker — attempts to use Capacitor Photos API and forwards result to processDataUrl
   * Mirrors the behaviour in upload-image-page.pickImagesMobile
   */
  async pickImagesMobile() {
    try {
      const photo = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Photos
      });

      if (photo && photo.base64String) {
        const dataUrl = `data:image/jpeg;base64,${photo.base64String}`;
        const filename = this.generateFilename();
        // reuse existing processing pipeline with a 10s overall timeout
        try {
          await this.processDataUrl(dataUrl, filename);
        } catch (e) {
          // processDataUrl handles its own timeout/cleanup, but catch here to avoid unhandled rejections
          console.warn('[CameraPage2] pickImagesMobile: processing failed or timed out', e);
        }
      } else {
        console.warn('pickImagesMobile: no photo returned');
      }
    } catch (e) {
      console.warn('pickImagesMobile failed', e);
    }
  }

  async processDataUrl(dataUrl: string, filename: string) {
    // mimic upload-image-page behaviour: preprocess, run inference, store
    this.capturedImages.unshift(dataUrl);
    // photosTaken will be synchronized with storage after save; do not increment locally here
    this.isProcessing = true;

    // Track whether inference was started so if we timeout we can choose the proper status message
    let inferenceAttempted = false;

    const doWork = async () => {
      let prediction: any = null;
      try {
        const tensor = await this.preprocessImage(dataUrl);
        // guard inference with timeout to avoid device hangs
        const inferenceTimeoutMs = 20_000; // 20s (internal inference guard)
        try {
          inferenceAttempted = true;
          prediction = await Promise.race([
            this.crackDetectionService.runInference(tensor),
            new Promise((_, rej) => setTimeout(() => rej(new Error('inference-timeout')), inferenceTimeoutMs))
          ]);
        } catch (infErr) {
          console.warn('Inference error/timeout during upload processing', infErr);
          prediction = null;
        }
      } catch (e) {
        console.warn('Inference failed during upload processing', e);
      }

      const entry: StoredImage = {
        original: dataUrl,
        timestamp: new Date().toISOString(),
        filename,
        prediction: prediction || undefined,
        hasPrediction: !!prediction,
        statusMessage: prediction ? 'Prediction succeeded' : (inferenceAttempted ? 'Prediction failed' : 'No prediction')
      };

      // If the model returned bounding boxes, create a "withBoxes" image and attach boxes
      try {
        if (prediction && Array.isArray(prediction.boxes) && prediction.boxes.length > 0) {
          const maskW = prediction.maskWidth || 128;
          const maskH = prediction.maskHeight || 128;
          const withBoxesDataUrl = await this.drawBoxesOnImage(dataUrl, prediction.boxes, maskW, maskH);
          (entry as any).withBoxes = withBoxesDataUrl;
          (entry as any).boxes = prediction.boxes;
          (entry as any).detectionMessage = `Detected ${prediction.boxes.length} region(s)`;
        } else {
          (entry as any).withBoxes = dataUrl;
          (entry as any).boxes = [];
          (entry as any).detectionMessage = 'No boxes detected';
        }
      } catch (e) {
        console.warn('[CameraPage2] Failed to create withBoxes image', e);
        (entry as any).withBoxes = dataUrl;
        (entry as any).boxes = [];
        (entry as any).detectionMessage = 'Box rendering failed';
      }

      await this.imageStorage.addImage(entry);
      // update UI counters
      this.photosProcessed++;
      await this.updatePhotoCounts();
      return entry;
    };

    // Overall processing timeout: 10s
    const overallTimeoutMs = 10_000;
    try {
      await Promise.race([doWork(), new Promise((_, rej) => setTimeout(() => rej(new Error('processing-timeout')), overallTimeoutMs))]);
    } catch (err: any) {
      if (err && err.message === 'processing-timeout') {
        console.warn('[CameraPage2] processDataUrl overall timeout');
        // If we timed out, persist a fallback entry indicating failure/no-prediction
        const entry: StoredImage = {
          original: dataUrl,
          timestamp: new Date().toISOString(),
          filename,
          prediction: undefined,
          hasPrediction: false,
          statusMessage: inferenceAttempted ? 'Prediction failed' : 'No prediction'
        };
        try {
          await this.imageStorage.addImage(entry);
          this.photosProcessed++;
          await this.updatePhotoCounts();
        } catch (e) {
          console.warn('[CameraPage2] Failed to persist fallback entry after timeout', e);
        }
      } else {
        console.warn('[CameraPage2] processDataUrl failed', err);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Synchronize photosTaken/photosProcessed from the ImageStorageService
   */
  async updatePhotoCounts() {
    try {
      const all: StoredImage[] = await this.imageStorage.getAllImages();
      this.photosTaken = Array.isArray(all) ? all.length : 0;
      // Count images that explicitly have a successful prediction status
      this.photosProcessed = Array.isArray(all) ? all.filter(i => (i.statusMessage === 'Prediction succeeded')).length : 0;
      // keep an authoritative local copy of stored images for thumbnail rendering
      this.storedImages = Array.isArray(all) ? all.slice() : [];
      console.log('[CameraPage2] updatePhotoCounts:', { photosTaken: this.photosTaken, photosProcessed: this.photosProcessed });
    } catch (e) {
      console.warn('[CameraPage2] updatePhotoCounts failed', e);
    }
  }

  toggleFlash() {
    // stub — native flash control would require plugin access
    console.log('toggleFlash pressed (stub)');
  }

  openMore() {
    // stub for 'more' menu
    console.log('openMore pressed (stub)');
  }

  /**
   * Show a simple overlay/modal used for quick tests.
   * Mirrors the behaviour implemented on home-page.showTestOverlay()
   */
  showTestOverlay() {
    try {
      // Avoid creating multiple overlays
      if (document.getElementById('test-overlay')) return;

      const overlay = document.createElement('div');
      overlay.id = 'test-overlay';
      overlay.style.position = 'fixed';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.background = 'rgba(0,0,0,0.6)';
      overlay.style.zIndex = '99999';
      overlay.style.display = 'flex';
      overlay.style.flexDirection = 'column';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';

      const box = document.createElement('div');
      box.style.background = '#fff';
      box.style.padding = '12px';
      box.style.borderRadius = '8px';
      box.style.minWidth = '280px';
      box.style.maxWidth = '92vw';
      box.style.boxShadow = '0 6px 18px rgba(0,0,0,0.2)';
      box.style.display = 'flex';
      box.style.flexDirection = 'column';
      box.style.alignItems = 'center';
      box.style.gap = '12px';
      box.style.overflow = 'hidden';

      const title = document.createElement('div');
      title.textContent = this.selectedImageTitle || 'No Image Selected';
      title.style.fontWeight = '600';
      title.style.marginBottom = '4px';

      const thumbContainer = document.createElement('div');
      thumbContainer.style.width = '100%';
      thumbContainer.style.boxSizing = 'border-box';
      thumbContainer.style.display = 'flex';
      thumbContainer.style.justifyContent = 'center';
      thumbContainer.style.overflow = 'hidden';

      const thumbScroll = document.createElement('div');
      thumbScroll.className = 'thumbnail-scroll2';
      thumbScroll.style.display = 'flex';
      thumbScroll.style.flexDirection = 'row';
      thumbScroll.style.alignItems = 'center';
      thumbScroll.style.justifyContent = 'flex-start';
      thumbScroll.style.overflowX = 'auto';
      thumbScroll.style.gap = '16px';
      thumbScroll.style.padding = '12px';
      thumbScroll.style.width = '100%';
      thumbScroll.style.maxHeight = '60vh';
      thumbScroll.style.boxSizing = 'border-box';

      const updateThumbnails = () => {
        const thumbnails = thumbScroll.querySelectorAll('img.thumbnail2');
        thumbnails.forEach((img) => {
          const imageElement = img as HTMLImageElement; // Cast to HTMLImageElement
          imageElement.style.border = imageElement.src === this.selectedThumbSrc ? '3px solid #2ecc71' : '2px solid #fff';
        });
      };

      if (!this.capturedImages || this.capturedImages.length === 0) {
        const placeholder = document.createElement('div');
        placeholder.textContent = 'No thumbnails available';
        placeholder.style.padding = '18px';
        placeholder.style.color = '#666';
        thumbScroll.appendChild(placeholder);
      } else {
        this.capturedImages.forEach((src, idx) => {
          const img = document.createElement('img');
          img.src = src;
          img.className = 'thumbnail2';
          img.style.display = 'block';
          img.style.maxWidth = '85%';
          img.style.maxHeight = '60vh';
          img.style.objectFit = 'contain';
          img.style.borderRadius = '6px';
          img.style.border = src === this.selectedThumbSrc ? '3px solid #2ecc71' : '2px solid #fff';
          img.style.boxShadow = '0 0 6px rgba(0,0,0,0.12)';
          img.style.cursor = 'pointer';
          img.dataset['index'] = String(idx);
          img.onclick = () => {
            this.selectedThumbSrc = src;
            this.selectedImageTitle = `Captured ${idx + 1}`;
            title.textContent = this.selectedImageTitle;
            updateThumbnails();
          };
          thumbScroll.appendChild(img);
        });
      }

      thumbContainer.appendChild(thumbScroll);

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete Selected Image';
      deleteBtn.style.alignSelf = 'stretch';
      deleteBtn.style.padding = '10px';
      deleteBtn.style.border = 'none';
      deleteBtn.style.background = '#ff4d4d';
      deleteBtn.style.color = '#fff';
      deleteBtn.style.borderRadius = '6px';
      deleteBtn.onclick = () => {
        this.deleteSelectedImage();
        overlay.remove();
      };

      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Close';
      closeBtn.style.alignSelf = 'stretch';
      closeBtn.style.padding = '10px';
      closeBtn.style.border = 'none';
      closeBtn.style.background = '#ddd';
      closeBtn.style.color = '#111';
      closeBtn.style.borderRadius = '6px';
      closeBtn.onclick = () => overlay.remove();

      box.appendChild(title);
      box.appendChild(thumbContainer);
      box.appendChild(deleteBtn);
      box.appendChild(closeBtn);
      overlay.appendChild(box);

      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) overlay.remove();
      });

      document.body.appendChild(overlay);
      this.detectCenterThumbnail(); // Detect center thumbnail when overlay is opened
      updateThumbnails();
    } catch (e) {
      console.warn('showTestOverlay failed', e);
    }
  }

  constructor(
    private platform: Platform,
    private router: Router,
    private sanitizer: DomSanitizer,
    private crackDetectionService: CrackDetectionService,
    private imageStorage: ImageStorageService
  ) {
    this.requestCameraPermission();
    // subscribe to current image changes so UI can react when another page selects one
    try {
      this.imageStorage.getCurrentImage$().subscribe(img => {
        if (img) {
          // update selected thumbnail reference and title
          this.selectedThumbSrc = img.withBoxes || img.original;
          this.selectedImageTitle = img.filename ?? '';
        }
      });
    } catch (e) {
      // ignore if observable not available
      console.warn('Failed to subscribe to ImageStorage current image', e);
    }
  }

  ngAfterViewInit() {
    this.platform.ready().then(() => this.initCamera());
    // load stored images from the shared ImageStorageService so thumbnails reflect persisted entries
    this.loadStoredImages().then(() => {
      // load sessions after stored images are available
      try { this.loadSessions(); } catch (e) { console.warn('loadSessions failed', e); }
    });
  }

  async loadSessions() {
    try {
      const s = (this.imageStorage && typeof (this.imageStorage.getSessions) === 'function') ? this.imageStorage.getSessions() : [];
      this.sessions = Array.isArray(s) ? s.slice() : [];
    } catch (e) {
      console.warn('[CameraPage] loadSessions failed', e);
      this.sessions = [];
    }
  }

  async createSessionFromSelection() {
    try {
      const name = prompt('Session name', 'New Session') || `Session ${Date.now()}`;
      // prefer currently selected thumb, else include all stored images
      let keys: string[] = [];
      if (this.selectedThumbSrc) {
        const found = this.storedImages.find(s => (s as any).withBoxes === this.selectedThumbSrc || s.original === this.selectedThumbSrc);
        if (found) keys = [found.original];
      }
      if (keys.length === 0) keys = this.storedImages.map(i => i.original).filter(Boolean);
      const s = (this.imageStorage && typeof (this.imageStorage.createSession) === 'function') ? this.imageStorage.createSession(name, keys) : null;
      await this.loadSessions();
      alert(s ? `Session created: ${(s as any).id}` : 'Session created (fallback)');
    } catch (e) {
      console.warn('[CameraPage] createSessionFromSelection failed', e);
      alert('Failed to create session. See console.');
    }
  }

  onSessionSelect(event: Event) {
    try {
      const val = (event.target as HTMLSelectElement).value;
      this.selectedSessionId = val || null;
      const s = this.sessions.find(x => x.id === val);
      if (s) {
        // select first image and update service
        if (Array.isArray(s.imageKeys) && s.imageKeys.length > 0 && typeof (this.imageStorage.selectImageByOriginal) === 'function') {
          this.imageStorage.selectImageByOriginal(s.imageKeys[0]);
        }
      }
    } catch (e) {
      console.warn('[CameraPage] onSessionSelect failed', e);
    }
  }

  /** Called when user taps a stored-image thumbnail — select it as current in the service and update UI */
  onStoredThumbClick(img: StoredImage) {
    try {
      this.imageStorage.selectImageByOriginal(img.original);
    } catch (e) {
      // ignore
    }
    this.selectedThumbSrc = img.withBoxes || img.original;
    this.selectedImageTitle = img.filename ?? '';
  }

  /** Load all StoredImage entries from the ImageStorageService and update local list */
  async loadStoredImages(): Promise<void> {
    try {
      // prefer async getter if available
      if (typeof (this.imageStorage as any).getAllImages === 'function') {
        const imgs = await (this.imageStorage as any).getAllImages();
        if (Array.isArray(imgs)) {
          this.storedImages = imgs;
        }
      } else if (typeof (this.imageStorage as any).getImages === 'function') {
        const imgs = (this.imageStorage as any).getImages();
        if (Array.isArray(imgs)) this.storedImages = imgs;
      }
      // ensure counts stay in sync
      this.updatePhotoCounts();
      // if a current image is set in the service, reflect it in the UI
      try {
        const cur = (this.imageStorage as any).getCurrentImage ? (this.imageStorage as any).getCurrentImage() : null;
        if (cur) {
          this.selectedThumbSrc = cur.withBoxes || cur.original;
          this.selectedImageTitle = cur.filename ?? '';
        }
      } catch (e) {
        // ignore
      }
    } catch (err) {
      console.warn('loadStoredImages failed', err);
    }
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
    // photosTaken will be derived from storage after save so don't increment here
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

      const now = new Date().toISOString();
      const dataUrl = canvas.toDataURL('image/png');
      this.capturedImages.unshift(dataUrl);

      // Wrap inference + save into a cancellable-timeout-aware sequence
      const work = async () => {
        // Preprocess → inference → save
        const imageTensor = await this.preprocessImage(dataUrl);
        // call the backend/model
        let prediction = null;
        try {
          inferenceCalled = true;
          prediction = await this.crackDetectionService.runInference(imageTensor);
          inferenceSucceeded = true;
        } catch (e) {
          console.warn('Inference failed:', e);
          inferenceSucceeded = false;
        }

        const nowInner = new Date().toISOString();
        // derive filename based on current stored images count so photosTaken reflects storage
        let storedCount = 0;
        try {
          const all = await this.imageStorage.getAllImages();
          storedCount = Array.isArray(all) ? all.length : 0;
        } catch (e) {
          storedCount = this.photosTaken || 0;
        }

        const filename = this.generateFilename(storedCount + 1);

        const entry: StoredImage = {
          original: dataUrl,
          timestamp: nowInner,
          filename,
          prediction: prediction || undefined,
          hasPrediction: !!prediction,
          statusMessage: (inferenceCalled && inferenceSucceeded && prediction) ? 'Prediction succeeded' : (inferenceCalled ? 'Prediction failed' : 'No prediction')
        };

        // Render boxes (if any) and attach withBoxes data
        try {
          if (prediction && Array.isArray(prediction.boxes) && prediction.boxes.length > 0) {
            const maskW = prediction.maskWidth || 128;
            const maskH = prediction.maskHeight || 128;
            const withBoxesDataUrl = await this.drawBoxesOnImage(dataUrl, prediction.boxes, maskW, maskH);
            (entry as any).withBoxes = withBoxesDataUrl;
            (entry as any).boxes = prediction.boxes;
            (entry as any).detectionMessage = `Detected ${prediction.boxes.length} region(s)`;
          } else {
            (entry as any).withBoxes = dataUrl;
            (entry as any).boxes = [];
            (entry as any).detectionMessage = 'No boxes detected';
          }
        } catch (e) {
          console.warn('[CameraPage2] Failed to render boxes for taken picture', e);
          (entry as any).withBoxes = dataUrl;
          (entry as any).boxes = [];
          (entry as any).detectionMessage = 'Box rendering failed';
        }

        await this.imageStorage.addImage(entry);
        this.savedImage = entry;
        this.lastPrediction = prediction;

        this.photosProcessed++;
        await this.updatePhotoCounts();
        return entry;
      };

      // Overall timeout for the inference+save sequence: 10s
      try {
        await Promise.race([work(), new Promise((_, rej) => setTimeout(() => rej(new Error('processing-timeout')), 10_000))]);
      } catch (err: any) {
        if (err && err.message === 'processing-timeout') {
          console.warn('[CameraPage2] takePicture processing timed out');
          // Persist a fallback entry indicating timeout (prediction failed or no prediction)
          try {
            let storedCount = 0;
            try {
              const all = await this.imageStorage.getAllImages();
              storedCount = Array.isArray(all) ? all.length : 0;
            } catch (e) { storedCount = this.photosTaken || 0; }
            const filename = this.generateFilename(storedCount + 1);
            const entry: StoredImage = {
              original: dataUrl,
              timestamp: now,
              filename,
              prediction: undefined,
              hasPrediction: false,
              statusMessage: inferenceCalled ? 'Prediction failed' : 'No prediction'
            };
            await this.imageStorage.addImage(entry);
            this.photosProcessed++;
            await this.updatePhotoCounts();
          } catch (e) {
            console.warn('[CameraPage2] Failed to store fallback entry after timeout', e);
          }
        } else {
          console.error('Failed during takePicture work:', err);
        }
      }

      // Keep console.log before clearing isProcessing so callers/UI see processing until logging completes
  console.log('✅ Prediction stored:', this.lastPrediction);
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
      if (inferenceCalled && inferenceSucceeded && this.lastPrediction) {
        // TypeScript can't infer that `lastPrediction` is non-null from the booleans above,
        // so check explicitly before accessing properties.
        const { type, shape, severity } = (this.lastPrediction as any);
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
    // this.imagePreview = null;
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

  // allow passing an explicit index (useful when deriving name from storage)
  generateFilename(count?: number): string {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const idx = typeof count === 'number' ? count : this.photosTaken;
    return `P${idx}${hh}${mm}.jpg`;
  }

  ngOnDestroy() {
    this.mediaStream?.getTracks().forEach(track => track.stop());
  }

  goBack() {
    try {
      this.router.navigateByUrl('/home-page');
    } catch (e) {
      window.history.back();
    }
  }

  // shim so templates can call onBack()
  onBack() {
    this.goBack();
  }

  /**
   * Draw bounding boxes on the supplied Base64 image and return a new Base64 image.
   * Boxes are expected to be in mask coordinates; maskW/maskH indicate the mask resolution
   * so boxes can be scaled to the image natural size.
   */
  async drawBoxesOnImage(Base64: string, boxes: BoundingBox[], maskW = 128, maskH = 128): Promise<string> {
    const img = new Image();
    img.src = Base64;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    return new Promise((resolve) => {
      img.onload = () => {
        // Use actual image size so boxes are drawn in correct place
        const imgW = img.naturalWidth || img.width || 1280;
        const imgH = img.naturalHeight || img.height || 720;
        canvas.width = imgW;
        canvas.height = imgH;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = 'red';
        ctx.lineWidth = Math.max(2, Math.round(Math.max(canvas.width, canvas.height) / 400));

        const scaleX = maskW > 0 ? canvas.width / maskW : 1;
        const scaleY = maskH > 0 ? canvas.height / maskH : 1;

        boxes.forEach(box => {
          const x = Math.round(box.x * scaleX);
          const y = Math.round(box.y * scaleY);
          const w = Math.round(box.w * scaleX);
          const h = Math.round(box.h * scaleY);
          ctx.strokeRect(x, y, w, h);
        });

        resolve(canvas.toDataURL('image/jpeg'));
      };
      // in case image is already cached
      if (img.complete && img.naturalWidth) img.onload!(null as any);
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

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input || !input.files || input.files.length === 0) return;

    const fileArray = Array.from(input.files);

    // Immediately update counters so UI shows the spinner/count right away
    try {
      const all = await this.imageStorage.getAllImages();
      const storedCount = Array.isArray(all) ? all.length : 0;
      this.photosTaken = storedCount + fileArray.length;
    } catch (e) {
      // fallback to local increment if storage read fails
      this.photosTaken += fileArray.length;
    }
    this.isProcessing = true;

    // yield to the event loop so the spinner can render before heavy work
    await new Promise(resolve => setTimeout(resolve, 20));

    for (const f of fileArray) {
      try {
        // reuse existing processFile flow which reads, preprocesses, runs inference and stores
        await this.processFile(f);
      } catch (e) {
        console.warn('Error processing selected file', e);
        // ensure spinner can clear if something went wrong
        this.photosProcessed++;
      }
    }

    // Clear the input value so selecting the same file(s) again will trigger change event
    try { input.value = ''; } catch (e) { /* ignore */ }

    // turn off processing if everything finished
    if (this.photosProcessed >= this.photosTaken) this.isProcessing = false;
  }

  detectCenterThumbnail() {
    const container = document.querySelector('.thumbnail-scroll2') as HTMLElement | null;
    if (!container) return;
    const images = container.querySelectorAll('img') as NodeListOf<HTMLImageElement>;
    if (images.length === 0) return;

    const containerRect = container.getBoundingClientRect();
    const centerX = containerRect.left + containerRect.width / 2;

    let closestImg: HTMLImageElement | null = null;
    let closestDistance = Infinity;

    images.forEach((img) => {
      const rect = img.getBoundingClientRect();
      const imgCenter = rect.left + rect.width / 2;
      const distance = Math.abs(centerX - imgCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestImg = img;
      }
    });

    if (!closestImg) return;
    const src = (closestImg as HTMLImageElement).src;
    const idx = this.capturedImages.indexOf(src);
    const title = idx >= 0 ? `Captured ${idx + 1}` : src;

    this.selectedThumbSrc = src;
    this.selectedImageTitle = title;

    console.log('[CameraPage2] Center thumbnail selected:', { title, src });
  }

  async deleteSelectedImage() {
    const src = this.selectedThumbSrc || '';
    if (!src) {
      console.warn('[CameraPage2] deleteSelectedImage: no image selected');
      alert('No image selected to delete');
      return;
    }

    // If the selected thumbnail maps to a stored/persisted image, remove it via the ImageStorageService
    const storedIdx = this.storedImages.findIndex(p => p.original === src || p.withBoxes === src);
    if (storedIdx !== -1) {
      const imgEntry = this.storedImages[storedIdx];
      const filename = imgEntry.filename || imgEntry.timestamp || imgEntry.original || '(unnamed)';
      const confirmMsg = `Delete stored image "${filename}"? This action cannot be undone.`;
      if (!confirm(confirmMsg)) return;

      try {
        // Use the canonical delete API on the ImageStorageService
        await (this.imageStorage as any).deleteImage(imgEntry.original);
      } catch (err) {
        console.warn('[CameraPage2] Failed to remove stored image via service', err);
      }

      // Refresh authoritative data so thumbnail strips update immediately
      try {
        await this.updatePhotoCounts();
        await this.loadStoredImages();
      } catch (e) {
        console.warn('[CameraPage2] Error refreshing stored images after delete', e);
      }

      this.selectedThumbSrc = null;
      this.selectedImageTitle = '';
      return;
    }

    // Otherwise, treat it as a captured (in-memory) image
    const idx = this.capturedImages.indexOf(src);
    if (idx === -1) {
      console.warn('[CameraPage2] deleteSelectedImage: image not found in capturedImages');
      alert('Selected image not found');
      return;
    }

    const confirmMsg = `Delete image "${src}"? This action cannot be undone.`;
    if (!confirm(confirmMsg)) return;

    try {
      this.capturedImages.splice(idx, 1);
      this.selectedThumbSrc = null;
      this.selectedImageTitle = '';
      console.log(`[CameraPage2] deleteSelectedImage: removed ${src}. Remaining images: ${this.capturedImages.length}`);
    } catch (err) {
      console.error('[CameraPage2] deleteSelectedImage failed', err);
      alert('Failed to delete image. See console for details.');
    }
  }
}
