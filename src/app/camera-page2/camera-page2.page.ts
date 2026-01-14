import { Component, OnDestroy, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
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
  // Toggle state to switch original vs withBoxes in overlay context
  showWithBoxes: boolean = false;
  // Overlay helpers for updating UI after center detection
  private _overlayTitleEl?: HTMLDivElement;
  private _overlayUpdateThumbs?: () => void;
  lastPrediction: { type: string; shape: string; severity: string } | null = null;

  scaledBoxes = [];
  // Cooldown and flash UI for capture
  isCooldown: boolean = false;
  showFlash: boolean = false;
  flashDurationMs: number = 120; // visual flash length
  cooldownMs: number = 500; // minimum time between pictures
  private backButtonSub: any; // hardware back handler
  // session management
  sessions: any[] = [];
  selectedSessionId: string | null = null;
  // If a sessionId is passed via route query params, it will be stored here
  routeSessionId?: string | null = null;
  // Track if this session is brand new and no images have been added during this visit
  sessionIsPristine: boolean = false;
  imagesUploadedThisSession: number = 0; // Track number of images uploaded during this page visit
  totalBoundingBoxesCreated: number = 0; // Counter for cumulative bounding boxes across all images

  constructor(
    private platform: Platform,
    private router: Router,
    private sanitizer: DomSanitizer,
    private crackDetectionService: CrackDetectionService,
    private imageStorage: ImageStorageService,
    private route: ActivatedRoute
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

  /**
   * Lifecycle: once view is ready, initialize camera and storage/session state.
   * Honors optional route `sessionId` to reuse an existing session.
   */
  ngAfterViewInit() {
    this.platform.ready().then(() => this.initCamera());
    // Handle Android hardware back: prompt before discarding empty session
    
    try {
      this.backButtonSub = this.platform.backButton.subscribeWithPriority(10, async () => {
        await this.handleGoHome();
      });
    } catch (e) {
      console.warn('[CameraPage2] failed to register hardware back handler', e);
    }

    
    // initialize page: load images, sessions and create a new session for this visit
    // read optional sessionId passed via navigation (when opening camera from Sessions list)
    try { this.routeSessionId = this.route.snapshot.queryParamMap.get('sessionId'); } catch (e) { this.routeSessionId = null; }
    //load local images from image storage service
    this.loadStoredImages()
    //loads the sessions from image storage service
      .then(() => this.loadSessions())
      .then(async () => {
        if (this.routeSessionId) {
          // Use existing session instead of creating a new one
          this.selectedSessionId = this.routeSessionId;
          try { await this.refreshDisplayedImages(); } catch (e) { /* ignore */ }
        } else {
          // No session requested; create a new one for this camera visit
          try { await this.createSessionOnEnter(); } catch (e) { /* ignore */ }
        }
      })
      .catch(e => console.warn('[CameraPage2] initialization failed', e));
  }

  
  /** Initialize live camera feed */
  /**
   * Start the live camera preview using getUserMedia (or Capacitor on mobile).
   * Cleans prior streams; wires video element; alerts on permission/device issues.
   */
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
  /**
   * Capture current frame → preprocess → run inference → store entry.
   * Debounced via cooldown; updates session, counters, and lastPrediction.
   */
  async takePicture() {
    // Prevent spamming the shutter: if currently cooling down, ignore
    if (this.isCooldown) {
      console.log('[CameraPage2] takePicture blocked: cooldown active');
      return;
    }
    // Ensure UI shows processing state immediately
    this.isProcessing = true;
    // bump taken so spinner shows while inference runs
    this.photosTaken += 1;

    // start cooldown immediately and show a short visual flash
    this.isCooldown = true;
    this.showFlash = true;
    // hide flash shortly after
    setTimeout(() => { this.showFlash = false; }, this.flashDurationMs);
    // release cooldown after configured ms
    setTimeout(() => { this.isCooldown = false; }, this.cooldownMs);
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
        // add to current session if present
        try {
          if (this.selectedSessionId && typeof (this.imageStorage.addImageToSession) === 'function') {
            this.imageStorage.addImageToSession(this.selectedSessionId, entry.original);
            this.sessionIsPristine = false; // Mark as no longer pristine since we added an image
          }
          await this.refreshDisplayedImages();
        } catch (e) {
          console.warn('[CameraPage2] Failed to add taken picture to session', e);
        }
        this.savedImage = entry;
        this.lastPrediction = prediction;
        // Increment upload counter for this session
        this.imagesUploadedThisSession += 1;

        if (inferenceCalled && inferenceSucceeded && prediction) this.photosProcessed += 1;
        // update UI counters from authoritative storage
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
            try {
              if (this.selectedSessionId && typeof (this.imageStorage.addImageToSession) === 'function') {
                this.imageStorage.addImageToSession(this.selectedSessionId, entry.original);
                this.sessionIsPristine = false; // Mark as no longer pristine since we added an image
              }
              await this.refreshDisplayedImages();
            } catch (err) {
              console.warn('[CameraPage2] Failed to add fallback taken picture to session', err);
            }
            // Increment upload counter for this session
            this.imagesUploadedThisSession += 1;
            // update UI counters from authoritative storage
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
      // Log cumulative bounding box count
      this.logBoundingBoxStats();
    }
  }

  /** Create a new session for this camera visit and set it active */
  /**
   * Create a new empty session for this visit and mark it pristine.
   * Persists via ImageStorageService and refreshes counts and thumbnails.
   */
  async createSessionOnEnter() {
    try {
      //creates session and Generate a human-friendly session name with current date/time. 
      // , and calls service to create a session (empty image list) and Fallback to null if API missing.
      const name = `Session ${new Date().toLocaleString()}`;
      const s = (this.imageStorage && typeof (this.imageStorage.createSession) === 'function') ? this.imageStorage.createSession(name, []) : null;
      if (s) {
        //select session as current session, mark as pristine(new session), 
        //reset counter for uploaded images, abd refresh displayed images and records the newly 
        // created session with its id/name in the the serve as last created session
        this.selectedSessionId = (s as any).id;
        this.sessionIsPristine = true; // Mark as new/pristine (no images added yet)
        this.imagesUploadedThisSession = 0; // Reset counter when creating new session
        try { (this.imageStorage as any).setLastCreatedSession((s as any).id, (s as any).name); } catch {}
        await this.loadSessions();
        await this.refreshDisplayedImages();
        // ensure counts reflect the newly created/selected session
        try { await this.updatePhotoCounts(); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      console.warn('[CameraPage2] createSessionOnEnter failed', e);
    }
  }


  /**
   * Remaining images to finish processing.
   * Interacts with UI spinner; derived from ImageStorage via updatePhotoCounts().
   */
  get countdown() {
    return this.photosTaken - this.photosProcessed;
  }

    /**
   * Request camera permissions (Capacitor) on mobile; fall back to web flow.
   * Attempts to initialize the camera after permission resolution.
   */
  async requestCameraPermission() {
    // Only request Capacitor Camera permissions on android and IOS platforms.
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
        // Web -> permissions handled by the browser when calling getUserMedia
        console.log('Skipping Capacitor Camera.requestPermissions on web platform:', platform);
        // still attempt to init the camera for browser
        this.initCamera();
      }
    } catch (error) {
      // Some Capacitor methods throw on web (Not implemented) — ignore but log.
      console.warn('Permission request failed (continuing):', error);
      // Attempt to initialize camera using browser APIs as a fallback for ionic serve testing
      try { await this.initCamera(); } catch (e) { /* ignore */ }
    }
  }



  /**
   * Pick a photo from device gallery (Capacitor) and process it.
   * if successful, calls processDataUrl() which runs inference and stores results.
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
        //create dataURL and filename
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
        //no photo selected or errror
        console.warn('pickImagesMobile: no photo returned');
      }
    } catch (e) {
      //error picking image
      console.warn('pickImagesMobile failed', e);
    }
  }

  /**
   * End-to-end pipeline for a provided dataUrl: preprocess → inference → store.
   * Updates session state via ImageStorageService and refreshes thumbnails/counters.
   */
  async processDataUrl(dataUrl: string, filename: string, bumpCounters: boolean = true) {
    // mimic upload-image-page behaviour: preprocess, run inference, store
    this.capturedImages.unshift(dataUrl);
    // bump counters early so spinner shows while processing unless caller already did so
    if (bumpCounters) this.photosTaken += 1;
    this.isProcessing = true;

    // Track whether inference was started so if timeout, we can choose the proper status message to store/show
    let inferenceAttempted = false;
    //preprocess
    const doWork = async () => {
      let prediction: any = null;
      try {
        //converts the img dataURL into exact Float32 tensor the model expects
        const tensor = await this.preprocessImage(dataUrl);
        // guard inference with timeout to avoid device hangs
        const inferenceTimeoutMs = 20_000; // (set timeout, to 20sinternal inference guard)
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
      // Prepare storage entry or build StoredImage entry
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
        // helper to compute a single box covering all predicted boxes
        const computeAggregatedBox = (boxes: any[]) => {
          if (!Array.isArray(boxes) || boxes.length === 0) return null;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          boxes.forEach((b: any) => {
            const bx = Number(b.x) || 0;
            const by = Number(b.y) || 0;
            const bw = Number(b.w) || 0;
            const bh = Number(b.h) || 0;
            minX = Math.min(minX, bx);
            minY = Math.min(minY, by);
            maxX = Math.max(maxX, bx + bw);
            maxY = Math.max(maxY, by + bh);
          });
          return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
        };

        if (prediction && Array.isArray(prediction.boxes) && prediction.boxes.length > 0) {
          const rawBoxes = prediction.boxes;
          // compute aggregated (max-extents) box and fallback to original boxes if aggregation fails
          const agg = computeAggregatedBox(rawBoxes);
          const boxesToDraw = agg ? [agg] : rawBoxes.map((b: any) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));

          const maskW = prediction.maskWidth || prediction.maskW || 128;
          const maskH = prediction.maskHeight || prediction.maskH || 128;
         // try to create withBoxes image with drawn boxes based on the bouding box data
          try {
            const withBoxesDataUrl = await this.drawBoxesOnImage(dataUrl, boxesToDraw, maskW, maskH);
            (entry as any).withBoxes = withBoxesDataUrl;
            (entry as any).boxes = boxesToDraw;
            (entry as any).detectionMessage = `Rendered ${boxesToDraw.length} aggregated/simplified box(es) from ${rawBoxes.length} prediction box(es)`;
            this.totalBoundingBoxesCreated += boxesToDraw.length;
          } catch (renderErr) {
            console.warn('[CameraPage2] drawBoxesOnImage failed', renderErr);
            (entry as any).withBoxes = dataUrl;
            (entry as any).boxes = [];
            (entry as any).detectionMessage = 'Box rendering failed';
          }
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
       //store image entry via image storage service
      await this.imageStorage.addImage(entry);
      // also add to active session if one exists
      try {
        //add to current session in use and set sessioIsPristine to false, then refresh displayed images
        if (this.selectedSessionId && typeof (this.imageStorage.addImageToSession) === 'function') {
          this.imageStorage.addImageToSession(this.selectedSessionId, entry.original);
          this.sessionIsPristine = false; // Mark session as no longer pristine
        }
        await this.refreshDisplayedImages();
      } catch (e) {
        console.warn('[CameraPage2] Failed to add image to session or refresh display', e);
      }
      // Increment upload counter for this session
      this.imagesUploadedThisSession += 1;
      // update UI counters from authoritative storage
      if (prediction) this.photosProcessed += 1;
      await this.updatePhotoCounts();
      return entry;
    };

    // Overall processing timeout: 10s, if the process did not finish in under 10s
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
          try {
            if (this.selectedSessionId && typeof (this.imageStorage.addImageToSession) === 'function') {
              this.imageStorage.addImageToSession(this.selectedSessionId, entry.original);
            }
            await this.refreshDisplayedImages();
          } catch (err) {
            console.warn('[CameraPage2] Failed to add timeout fallback image to session', err);
          }
          // Increment upload counter for this session
          this.imagesUploadedThisSession += 1;
          // update UI counters from authoritative storage
          await this.updatePhotoCounts();
        } catch (e) {
          console.warn('[CameraPage2] Failed to persist fallback entry after timeout', e);
        }
      } else {
        console.warn('[CameraPage2] processDataUrl failed', err);
      }
    } finally {
      this.isProcessing = false;
      // Log cumulative bounding box count after processing
      this.logBoundingBoxStats();
    }
  }

    /** Resize + normalize image to [1,3,128,128] Float32Array */
  /**
   * Produce Float32 tensor [1,3,128,128] normalized to [-1,1] from a dataUrl.
   * Used by both photo capture and upload flows prior to inference.
   */
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

    // allow passing an explicit index (useful when deriving name from storage)
  /**
   * Generate a short filename like P{index}{HH}{MM}.jpg for new entries.
   */
  generateFilename(count?: number): string {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const idx = typeof count === 'number' ? count : this.photosTaken;
    return `P${idx}${hh}${mm}.jpg`;
  }


  
  /**
   * Draw bounding boxes on the supplied Base64 image and return a new Base64 image.
   * Boxes are expected to be in mask coordinates; maskW/maskH indicate the mask resolution
   * so boxes can be scaled to the image natural size.
   */
  async drawBoxesOnImage(Base64: string, boxes: BoundingBox[], maskW = 128, maskH = 128): Promise<string> {
    //creates an img and canva/context to draw the image on the canvas
    
    const img = new Image();
    img.src = Base64;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    return new Promise((resolve) => {
      img.onload = () => {
        //determine the size of the img and draw the img to the canvas
        // Use actual image size so boxes are drawn in correct place
        const imgW = img.naturalWidth || img.width || 1280;
        const imgH = img.naturalHeight || img.height || 720;
        canvas.width = imgW;
        canvas.height = imgH;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                //configure styoke style and line width for boxes to draw
        ctx.strokeStyle = 'red';
        ctx.lineWidth = Math.max(2, Math.round(Math.max(canvas.width, canvas.height) / 400));
        //computes the scaling model mask coordinates to image pixel coordinates
        const scaleX = maskW > 0 ? canvas.width / maskW : 1;
        const scaleY = maskH > 0 ? canvas.height / maskH : 1;
        //draw each box on the canvas
        boxes.forEach(box => {
          const x = Math.round(box.x * scaleX);
          const y = Math.round(box.y * scaleY);
          const w = Math.round(box.w * scaleX);
          const h = Math.round(box.h * scaleY);
          ctx.strokeRect(x, y, w, h);
        });

        // Increment total bounding box counter and log
        this.totalBoundingBoxesCreated += boxes.length;
        console.log(`📦 Bounding boxes drawn: ${boxes.length} | 📊 Total cumulative boxes: ${this.totalBoundingBoxesCreated}`);

        resolve(canvas.toDataURL('image/jpeg'));
      };
      // in case image is already cached
      if (img.complete && img.naturalWidth) img.onload!(null as any);
    });
  }


  /**
   * Synchronize photosTaken/photosProcessed from the ImageStorageService
   */
  /**
   * Refresh photosTaken/photosProcessed and storedImages from ImageStorageService.
   * If a sessionId is active, counts are computed from that session’s imageKeys.
   */
  async updatePhotoCounts() {
    try {
      const svc: any = this.imageStorage as any;
      // If a session is active, compute counts from the session image keys
      if (this.selectedSessionId) {
        // ensure sessions are loaded
        if (!this.sessions || this.sessions.length === 0) {
          try { await this.loadSessions(); } catch (e) { /* ignore */ }
        }
        const session = this.sessions.find(s => s.id === this.selectedSessionId) || null;
        if (!session || !Array.isArray(session.imageKeys)) {
          this.photosTaken = 0;
          this.photosProcessed = 0;
          this.storedImages = [];
        } else {
          const keys: string[] = session.imageKeys.slice();
          const imgs: StoredImage[] = [];
          let processed = 0;
          // count only keys that currently have an entry (skip deleted/missing)
          let foundCount = 0;
          for (const k of keys) {
            let entry: any = undefined;
            if (typeof svc.getEntryForImage === 'function') {
              // async or sync-friendly helper
              const maybe = svc.getEntryForImage(k);
              entry = (maybe && typeof (maybe as any).then === 'function') ? await maybe : maybe;
            } else if (typeof svc.getEntry === 'function') {
              const maybe = svc.getEntry(k);
              entry = (maybe && typeof (maybe as any).then === 'function') ? await maybe : maybe;
            } else if (typeof svc.getAllEntries === 'function') {
              const all = await svc.getAllEntries();
              entry = all ? all[k] : undefined;
            }
            if (entry) {
              imgs.push(entry as StoredImage);
              foundCount++;
              if (entry.statusMessage === 'Prediction succeeded') processed++;
            }
          }
          this.photosProcessed = processed;
          this.photosTaken = foundCount; // only count existing entries
          this.storedImages = imgs;
        }
      } else {
        // No active session: fall back to global image list
        const all: StoredImage[] = await this.imageStorage.getAllImages();
        this.photosTaken = Array.isArray(all) ? all.length : 0;
        // Count images that explicitly have a successful prediction status
        this.photosProcessed = Array.isArray(all) ? all.filter(i => (i.statusMessage === 'Prediction succeeded')).length : 0;
        this.storedImages = Array.isArray(all) ? all.slice() : [];
      }
      console.log('[CameraPage2] updatePhotoCounts:', { photosTaken: this.photosTaken, photosProcessed: this.photosProcessed });
    } catch (e) {
      console.warn('[CameraPage2] updatePhotoCounts failed', e);
    }
  }

  /**
   * Stub for flash toggle; logs only. Real flash requires native plugin.
   */
  toggleFlash() {
    // stub — native flash control would require plugin access
    console.log('toggleFlash pressed (stub)');
  }

  /**
   * Stub for additional menu actions.
   */
  openMore() {
    // stub for 'more' menu
    console.log('openMore pressed (stub)');
  }

  /**
   * Show a simple overlay/modal used for quick tests.
   * Mirrors the behaviour implemented on home-page.showTestOverlay()
   */
  /**
   * Append a simple overlay showing thumbnails and quick actions.
   * Mirrors similar helper on Home page; updates selected thumbnail on click.
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
      // box.style.background = '#fff';
      box.style.border = '1px solid transparent';
      box.style.background = 'linear-gradient(#fff, #fff) padding-box, linear-gradient(to right, #ff512f, #f09819) border-box';
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

      // Top bar: title on the left, toggle on the right
      const topBar = document.createElement('div');
      topBar.style.display = 'flex';
      topBar.style.justifyContent = 'space-between';
      topBar.style.alignItems = 'center';
      topBar.style.width = '100%';
      topBar.style.padding = '4px 8px';

      const title = document.createElement('div');
      title.textContent = this.selectedImageTitle || 'No Image Selected';
      title.style.fontWeight = '600';
      title.style.marginBottom = '4px';
      title.style.color = 'black';
      title.style.marginTop = '10px';
      title.style.flex = '0 1 auto';
      this._overlayTitleEl = title;

      const toggleWrapper = document.createElement('div');
      toggleWrapper.className = 'toggle-wrapper';
      toggleWrapper.style.display = 'flex';
      toggleWrapper.style.alignItems = 'center';
      toggleWrapper.style.gap = '10px';
      toggleWrapper.style.margin = '10px 0';
      toggleWrapper.style.flex = '0 0 auto';

      const labelEl = document.createElement('label');
      labelEl.className = 'switch';

      const inputEl = document.createElement('input');
      inputEl.type = 'checkbox';
      inputEl.checked = this.showWithBoxes;
      inputEl.onchange = () => {
        this.showWithBoxes = inputEl.checked;
        // Re-detect center and refresh title/borders
        this.detectCenterThumbnail();
        if (this._overlayUpdateThumbs) this._overlayUpdateThumbs();
      };

      const sliderEl = document.createElement('span');
      sliderEl.className = 'slider round';

      labelEl.appendChild(inputEl);
      labelEl.appendChild(sliderEl);
      toggleWrapper.appendChild(labelEl);

      topBar.appendChild(title);
      topBar.appendChild(toggleWrapper);
       

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
          // If this thumbnail corresponds to a stored image, swap src based on toggle
          const storedIndex = imageElement.dataset['storedIndex'];
          if (storedIndex !== undefined && storedIndex !== '') {
            const si = parseInt(storedIndex, 10);
            const entry = this.storedImages && this.storedImages[si];
            if (entry) {
              imageElement.src = this.showWithBoxes ? (entry as any).withBoxes || entry.original : entry.original;
            }
          }
          // update border highlighting
          imageElement.style.border = imageElement.src === this.selectedThumbSrc ? '3px solid #2ecc71' : '2px solid #fff';
        });
      };
      this._overlayUpdateThumbs = updateThumbnails;

      // Prefer storedImages (persisted) when available so we can toggle between original/withBoxes
      if (this.storedImages && this.storedImages.length > 0) {
        this.storedImages.forEach((entry, idx) => {
          const img = document.createElement('img');
          img.className = 'thumbnail2';
          img.style.display = 'block';
          img.style.maxWidth = '85%';
          img.style.maxHeight = '60vh';
          img.style.objectFit = 'contain';
          img.style.borderRadius = '6px';
          img.style.boxShadow = '0 0 6px rgba(0,0,0,0.12)';
          img.style.cursor = 'pointer';
          img.dataset['storedIndex'] = String(idx);
          img.src = this.showWithBoxes ? (entry as any).withBoxes || entry.original : entry.original;
          img.style.border = img.src === this.selectedThumbSrc ? '3px solid #2ecc71' : '2px solid #fff';
          img.onclick = () => {
            this.selectedThumbSrc = img.src;
            this.selectedImageTitle = entry.filename || `Stored ${idx + 1}`;
            title.textContent = this.selectedImageTitle;
            updateThumbnails();
          };
          thumbScroll.appendChild(img);
        });
      } else if (!this.capturedImages || this.capturedImages.length === 0) {
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

      // create a horizontal button row that reuses app styles
      const btnRow = document.createElement('div');
      btnRow.className = 'bottom-top-row';
      btnRow.style.width = '100%';
      btnRow.style.display = 'flex';
      btnRow.style.justifyContent = 'space-between';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'function-btn';
      deleteBtn.type = 'button';
      deleteBtn.style.display = 'flex';
      deleteBtn.style.alignItems = 'center';
      deleteBtn.style.justifyContent = 'center';
      deleteBtn.style.height = '40px';
      deleteBtn.style.borderRadius = '10px';
      // deleteBtn.style.background = '#ff4d4d';
      // deleteBtn.style.color = '#fff';
      deleteBtn.style.border = '1px solid transparent';
      deleteBtn.style.background = 'linear-gradient(#fff, #fff) padding-box, linear-gradient(to right, #ff512f, #f09819) border-box';
      deleteBtn.style.color = '#ff4d4d';
      
     

      // text + inline trash SVG icon
      const deleteText = document.createTextNode('Delete Selected Image');
      const deleteIcon = document.createElement('img');
      deleteIcon.className = 'action-icon';
      deleteIcon.style.width = '20px';
      deleteIcon.style.height = '20px';
      deleteIcon.style.marginLeft = '8px';
      // use project asset for trash icon
      deleteIcon.src = 'assets/Trash.png';
      deleteBtn.appendChild(deleteText);
      deleteBtn.appendChild(deleteIcon);
      // local cleanup helper unsubscribes overlay back-button subscription and removes overlay
      let overlayBackBtnSub: any = null;
      const cleanupOverlay = () => {
        try {
          if (overlayBackBtnSub && typeof overlayBackBtnSub.unsubscribe === 'function') {
            try { overlayBackBtnSub.unsubscribe(); } catch (e) {}
          }
        } catch (e) {}
        try { overlay.remove(); } catch (e) {}
      };

      deleteBtn.onclick = () => {
        this.deleteSelectedImage();
        cleanupOverlay();
      };

      const closeBtn = document.createElement('button');
      closeBtn.className = 'function-btn';
      closeBtn.type = 'button';
      closeBtn.style.display = 'flex';
      closeBtn.style.alignItems = 'center';
      closeBtn.style.justifyContent = 'center';
      closeBtn.style.height = '40px';
      closeBtn.style.borderRadius = '10px';
       closeBtn.style.background = '#ddd';
      closeBtn.style.color = '#111';
      closeBtn.style.border = '1px solid transparent';
      closeBtn.style.background = 'linear-gradient(#fff, #fff) padding-box, linear-gradient(to right, #ff512f, #f09819) border-box';
      closeBtn.style.color = '#111';
      

      // text + inline check SVG icon for close
      const closeText = document.createTextNode('Close');
      const closeIcon = document.createElement('img');
      closeIcon.className = 'action-icon';
      closeIcon.style.width = '20px';
      closeIcon.style.height = '20px';
      closeIcon.style.marginLeft = '8px';

      // use project asset for check/close icon
      closeIcon.src = 'assets/Check_Black.png';
      closeBtn.appendChild(closeText);
      closeBtn.appendChild(closeIcon);
      closeBtn.onclick = () => { cleanupOverlay(); };

      // make buttons visually fill available space like in bottom-top-row
      deleteBtn.style.flex = '1 1 auto';
      closeBtn.style.flex = '1 1 auto';
      deleteBtn.style.marginRight = '8px';

      btnRow.appendChild(deleteBtn);
      btnRow.appendChild(closeBtn);

      box.appendChild(topBar);
      box.appendChild(thumbContainer);
      box.appendChild(btnRow);
      overlay.appendChild(box);

      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) cleanupOverlay();
      });

      document.body.appendChild(overlay);
      // subscribe to hardware back while overlay is open so back closes it
      try {
        overlayBackBtnSub = this.platform.backButton.subscribeWithPriority(20, () => {
          cleanupOverlay();
        });
      } catch (e) {
        console.warn('[CameraPage2] overlay back button subscription failed', e);
      }

      this.detectCenterThumbnail(); // Detect center thumbnail when overlay is opened
      updateThumbnails();
    } catch (e) {
      console.warn('showTestOverlay failed', e);
    }
  }

   
  /**
   * Compute which thumbnail is centered in the overlay scroller and select it.
   */
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
    // Prefer storedImages (which may have withBoxes) when resolving title
    let newTitle = src;
    const storedIdx = this.storedImages ? this.storedImages.findIndex(s => (s as any).withBoxes === src || s.original === src) : -1;
    if (storedIdx !== -1) {
      newTitle = this.storedImages[storedIdx].filename || `Stored ${storedIdx + 1}`;
    } else {
      const idx = this.capturedImages.indexOf(src);
      if (idx >= 0) newTitle = `Captured ${idx + 1}`;
    }

    this.selectedThumbSrc = src;
    this.selectedImageTitle = newTitle;
    // Update overlay title if present
    if (this._overlayTitleEl) this._overlayTitleEl.textContent = this.selectedImageTitle;
    // Refresh borders to reflect new selection
    if (this._overlayUpdateThumbs) this._overlayUpdateThumbs();

    console.log('[CameraPage2] Center thumbnail selected:', { title: newTitle, src });
  }

  /**
   * Delete the currently-selected image. If it exists in storage, removes via service;
   * otherwise removes from in-memory capturedImages. Refreshes lists and counts.
   */
  async deleteSelectedImage() {
    //ensure an image is selected
    const src = this.selectedThumbSrc || '';
    if (!src) {
      console.warn('[CameraPage2] deleteSelectedImage: no image selected');
      alert('No image selected to delete');
      return;
    }

    // find in imagePaths (stored images) first, delete logic
    // If the selected thumbnail maps to a stored/persisted 
    // image, remove it via the ImageStorageService
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
        // sessions might have been updated by delete; reload and refresh session view
        await this.loadSessions();
        await this.refreshDisplayedImages();
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

  /** Refresh the `storedImages` array to match the active session (or show all if none) */
  /**
   * Sync this.storedImages with either the active session or all stored images.
   * Uses ImageStorageService helpers to resolve image entries by key.
   */
  async refreshDisplayedImages() {
    //find session and load its image entries, 
    // session.imagekeys to storedimages using image storage and populate the storedImages
    // entry for image also allow for refresh the displayed 
    // images after new images are added or deleted

    try {
      if (this.selectedSessionId) {
        const session = this.sessions.find(s => s.id === this.selectedSessionId);
        if (session && Array.isArray(session.imageKeys) && session.imageKeys.length > 0) {
          const imgs: StoredImage[] = [];
          for (const k of session.imageKeys) {
            const e = (this.imageStorage as any).getEntryForImage ? (this.imageStorage as any).getEntryForImage(k) : undefined;
            if (e) imgs.push(e);
          }
          this.storedImages = imgs;
        } else {
          this.storedImages = [];
        }
        //if no session, then load global image list
      } else {
        const all = await this.imageStorage.getAllImages();
        this.storedImages = Array.isArray(all) ? all.slice() : [];
      }
    } catch (e) {
      console.warn('[CameraPage2] refreshDisplayedImages failed', e);
      try { this.storedImages = (await this.imageStorage.getAllImages()) || []; } catch { this.storedImages = []; }
    }
  }

  /**
   * Load available sessions from ImageStorageService into this.sessions.
   */
  async loadSessions() {
    try {
      //prune session if empty
      if (typeof (this.imageStorage as any).pruneEmptySessions === 'function') {
        (this.imageStorage as any).pruneEmptySessions();
      }
      // retrive the session and normalize to array
      const s = (this.imageStorage && typeof (this.imageStorage.getSessions) === 'function') ? this.imageStorage.getSessions() : [];
      this.sessions = Array.isArray(s) ? s.slice() : [];
      //on any failure, log and ensure the sessions array is empty
    } catch (e) {
      console.warn('[CameraPage] loadSessions failed', e);
      this.sessions = [];
    }
  }


    
  /** Drop active session if it contains zero images */
  private pruneEmptySession() {
    if (this.selectedSessionId && typeof this.imageStorage.removeSessionIfEmpty === 'function') {
      this.imageStorage.removeSessionIfEmpty(this.selectedSessionId);
    }
  }
 

  /** Called when user taps a stored-image thumbnail,
   * select it as current in the service and update UI */
  /**
   * Select a stored image in session or ImageStorageService and reflect it in the UI.
   */
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
  /**
   * Load all stored images from ImageStorageService; keep UI selection in sync.
   */
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


  /**
   * Log current bounding box statistics
   */
  private logBoundingBoxStats() {
    console.log(`
╔════════════════════════════════════════╗
║   📊 BOUNDING BOX STATISTICS           ║
╠════════════════════════════════════════╣
║ Total Images Captured/Processed: ${String(this.photosTaken).padEnd(13)}║
║ Total Bounding Boxes Created: ${String(this.totalBoundingBoxesCreated).padEnd(18)}║
║ Avg Boxes Per Image: ${(this.photosTaken > 0 ? (this.totalBoundingBoxesCreated / this.photosTaken).toFixed(2) : '0').padEnd(23)}║
╚════════════════════════════════════════╝
    `);
  }


  /**
   * Reserved for closing an image preview if one is shown (no-op here).
   */
  closePreview() {
    // this.imagePreview = null;
  }

  /**
   * Toggle front/back camera and reinitialize the stream.
   */
  toggleCamera() {
    this.usingFrontCamera = !this.usingFrontCamera;
    this.initCamera();
  }

  /**
   * Optional filter hook for thumbnail list (not implemented).
   */
  filterThumbnails(type: string) {
    //Optional: filtering logic by image origin
  }

  /**
   * Navigate to Feedback page, passing active sessionId when available.
   */
  goToFeedBackPage() {
    const params: any = {};
    if (this.selectedSessionId) params.sessionId = this.selectedSessionId;
    this.router.navigate(['/feedback-page'], { queryParams: params });
    console.log('Navigating to Feedback page', params);
  }

  /**
   * Navigate back to Home; if session is empty, offer to delete it first.
   */
  goToHomePage() {
    this.handleGoHome();
  }

  /**
   * Lifecycle: stop media tracks to release camera on component destroy.
   */
  //prune empty session, if session is empty
  ngOnDestroy() {
    this.mediaStream?.getTracks().forEach(track => track.stop());
    this.pruneEmptySession();
    try { if (this.backButtonSub && typeof this.backButtonSub.unsubscribe === 'function') this.backButtonSub.unsubscribe(); } catch {}
  }

  /**
   * Navigate back to Home Page; falls back to history.back on failure.
   */
  async goBack() {
    await this.handleGoHome();
  }

  // shim so templates can call onBack()
  onBack() {
    this.goBack();
  }

    /**
   * Implements the Home navigation with an empty-session confirmation flow and close overlay if appended.
   */
  private async handleGoHome() {
    try {
      const activeId = this.selectedSessionId;
      const count = (activeId && typeof this.imageStorage.getSessionImageCount === 'function') ? this.imageStorage.getSessionImageCount(activeId) : 0;
      const isEmptySession = !!activeId && count === 0;

      if (isEmptySession) {
        const choice = await this.showExitOverlay();
        if (choice === 'discard') {
          if (typeof this.imageStorage.removeSessionIfEmpty === 'function') {
            this.imageStorage.removeSessionIfEmpty(activeId);
          } else if (typeof this.imageStorage.removeSession === 'function') {
            this.imageStorage.removeSession(activeId);
          }
          this.router.navigate(['/home-page']);
          return;
        }
        if (choice === 'stay' || choice === null) return;
      }

      this.router.navigate(['/home-page']);
    } catch (e) {
      console.warn('handleGoHome failed', e);
      this.router.navigate(['/home-page']);
    }
  }


    /**
   * Show a lightweight overlay asking user either discard empty session or stay.
   * Returns 'discard', 'stay', or null (dismiss).
   */
  private showExitOverlay(): Promise<'discard' | 'stay' | null> {
    return new Promise(resolve => {
      const backdrop = document.createElement('div');
      backdrop.style.position = 'fixed';
      backdrop.style.top = '0';
      backdrop.style.left = '0';
      backdrop.style.width = '100%';
      backdrop.style.height = '100%';
      backdrop.style.background = 'rgba(0,0,0,0.6)';
      backdrop.style.display = 'flex';
      backdrop.style.alignItems = 'center';
      backdrop.style.justifyContent = 'center';
      backdrop.style.zIndex = '9999';

      const modal = document.createElement('div');
      modal.style.background = '#fff';
      modal.style.borderRadius = '12px';
      modal.style.padding = '22px';
      modal.style.maxWidth = '90%';
      modal.style.width = '320px';
      modal.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';

      const title = document.createElement('div');
      title.textContent = 'Leave without saving?';
      title.style.fontSize = '18px';
      title.style.fontWeight = '600';
      title.style.marginBottom = '10px';
      title.style.textAlign = 'center';

      const desc = document.createElement('div');
      desc.textContent = 'This session has no images. Delete it and go home, or stay to continue.';
      desc.style.fontSize = '14px';
      desc.style.color = '#444';
      desc.style.marginBottom = '16px';
      desc.style.textAlign = 'center';

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '10px';

      const cleanup = (result: 'discard' | 'stay' | null) => {
        try { document.body.removeChild(backdrop); } catch {}
        resolve(result);
      };

      const stayBtn = document.createElement('button');
      stayBtn.textContent = 'Stay here';
      stayBtn.style.flex = '1';
      stayBtn.style.padding = '10px';
      stayBtn.style.border = '1px solid #ddd';
      stayBtn.style.borderRadius = '8px';
      stayBtn.style.background = 'linear-gradient(90deg,#ff512f,#f09819)';
      stayBtn.style.color = 'white';
      stayBtn.style.cursor = 'pointer';
      stayBtn.onclick = () => { cleanup('stay'); };

      const discardBtn = document.createElement('button');
      discardBtn.textContent = 'Delete session & Home';
      discardBtn.style.flex = '1';
      discardBtn.style.padding = '10px';
      discardBtn.style.border = 'none';
      discardBtn.style.borderRadius = '8px';
      discardBtn.style.background = 'linear-gradient(90deg,#ff512f,#f09819)';
      discardBtn.style.color = '#fff';
      discardBtn.style.cursor = 'pointer';
      discardBtn.onclick = () => { cleanup('discard'); };

      actions.appendChild(stayBtn);
      actions.appendChild(discardBtn);

      modal.appendChild(title);
      modal.appendChild(desc);
      modal.appendChild(actions);

      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) cleanup(null);
      });
    });
  }


}
