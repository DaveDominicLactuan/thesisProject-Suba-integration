import { Component, OnDestroy, AfterViewInit, ElementRef, ViewChild, ChangeDetectorRef } from '@angular/core';
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
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { Filesystem } from '@capacitor/filesystem';
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

interface QueueItem {
  dataUrl: string;
  blob?: Blob; // ADDED: Store the blob natively
  filename: string;
}

interface UploadResponse {
  message: string;
  rawImagePath: string;
  processedImagePath: string;
  bounding_boxes: { w: number; h: number; x: number; y: number }[];
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
  public imagePaths: any[] = [];
  isProcessing: boolean = true;
  fastApiConnection: boolean = false;
  apiStatusMessage: string = '';
  photosTaken = 0;
  private _photosProcessed = 0;
  // public transient flag used to show a short glow when a photo finishes processing
  processedGlowActive: boolean = false;
  private _processedGlowTimer?: any;
  // glow duration in milliseconds (default 2.5s)
  glowDurationMs: number = 2500;
  isUploading = false;
  uploadResult: any;
  // Define an interface for items in the queue


  get photosProcessed() {
    return this._photosProcessed;
  }
  set photosProcessed(v: number) {
    const prev = this._photosProcessed;
    this._photosProcessed = v;
    if (v > prev) {
      this.triggerProcessedGlow();
    }
  }
  savedImage: StoredImage | null = null;
  selectedThumbSrc: string | null = null;
  selectedImageTitle: string = '';
  private selectedImageSelectionKey: string = '';
  get selectedImageKey(): string {
    return this.selectedImageSelectionKey || this.selectedThumbSrc || '';
  }
  getImageSelectionKey(img: StoredImage): string {
    return img.filename || img.withBoxes || img.original;
  }
  // Toggle state to switch original vs withBoxes in overlay context
  showWithBoxes: boolean = false;
  // Overlay helpers for updating UI after center detection
  private _overlayTitleEl?: HTMLDivElement;
  private _overlayUpdateThumbs?: () => void;
  lastPrediction: { type: string; shape: string; severity: string } | null = null;
  // Process Window state
  isProcessWindowOpen: boolean = false;

  scaledBoxes = [];
  // Cooldown and flash UI for capture
  isCooldown: boolean = false;
  showFlash: boolean = false;
  isFlashEnabled: boolean = false;
  isLevelEnabled: boolean = false;
  isPhoneLeveled: boolean = false;
  levelRollDeg: number = 0;
  // Hysteresis keeps the level indicator from flickering near center.
  private levelGreenEnterThresholdDeg: number = 1.5;
  private levelGreenExitThresholdDeg: number = 2.2;
  private levelTargetRoll: number = 0; // Target roll angle for smooth interpolation
  private levelSmoothingFactor: number = 0.68; // More responsive, but still smoothed (0-1)
  private levelAnimationFrameId?: number; // RAF ID for cleanup
  private lastRawRoll: number = 0; // Track last raw value for velocity calculation
  private deadZoneDeg: number = 0.14; // Ignore movements smaller than this to filter noise
  private velocityDampingFactor: number = 0.7; // Apply damping to sudden changes (0-1, higher = more damping)
  private lastProcessedRoll: number = 0; // Track the last applied roll for velocity calculation
  private extremeChangeThreshold: number = 18; // Flag changes > this as potential sporadic movements
  private levelMotionSettling: boolean = false;
  private levelLastSampleAt: number = 0;
  private levelSettleTimer?: any;
  private levelSettleDelayMs: number = 120;
  private levelResyncThresholdDeg: number = 0.08;
  private levelVelocityThresholdDegPerSec: number = 85;
  private levelSnapThresholdDeg: number = 0.18;
  private levelFastFollowFloor: number = 0.72;
  private levelFastFollowCeil: number = 0.94;
  flashDurationMs: number = 120; // visual flash length
  cooldownMs: number = 500; // minimum time between pictures
  private backButtonSub: any; // hardware back handler
  private imageRecordCounter = 0;
  // Add these inside your CameraPage2Page class declaration
private imageQueue: QueueItem[] = [];
private isQueueProcessing: boolean = false;

apiMessage: string = 'Loading...';
  apiStatus: number = 0;
  boxes: { w: number; h: number; x: number; y: number }[] = [];
private apiUrl = 'https://your-vscode-forwarded-url.app.github.dev/';
apiUrlWeb = 'http://127.0.0.1:8000/';
apiUrlWeb2 = 'http://127.0.0.1:8000/helloWorld';
// private baseUrl2 = 'http://127.0.0.1:8000'; 
// private baseUrl = 'https://16z6llmg-8000.asse.devtunnels.ms';
// private baseUrl2 = 'https://crack-api-repo.onrender.com'; 
// private baseUrl = 'https://crack-api-repo.onrender.com';
private baseUrl2 = 'https://your-render-url.onrender.com/process-all'; 
baseUrl = 'https://your-render-url.onrender.com/process-all';
  uploadedImageUrl: string = '';
  selectedFile: File | null = null;

  private generateImageRecordId(prefix: 'original' | 'cropped' | 'resized'): string {
    this.imageRecordCounter += 1;
    return `${prefix}-${Date.now()}-${this.imageRecordCounter}`;
  }

  private sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

  private updateLevelIndicatorState(absRollDeg: number): void {
    const threshold = this.isPhoneLeveled
      ? this.levelGreenExitThresholdDeg
      : this.levelGreenEnterThresholdDeg;

    this.isPhoneLeveled = !this.levelMotionSettling && absRollDeg <= threshold;
  }

  private orientationHandler = (event: DeviceOrientationEvent) => {
    if (!this.isLevelEnabled) return;
    if (typeof event.gamma !== 'number') return;

    const rawRoll = event.gamma;
    const boundedRoll = Math.max(-45, Math.min(45, rawRoll));
    const now = performance.now();
    const elapsedMs = this.levelLastSampleAt > 0 ? Math.max(16, now - this.levelLastSampleAt) : 16;
    const rawDelta = boundedRoll - this.lastRawRoll;
    const velocityDegPerSec = Math.abs(rawDelta) / elapsedMs * 1000;
    const velocityFactor = Math.min(1, velocityDegPerSec / 180);
    const followFactor = this.levelMotionSettling
      ? this.levelFastFollowCeil
      : Math.min(this.levelFastFollowCeil, this.levelFastFollowFloor + (velocityFactor * 0.22));
    this.levelLastSampleAt = now;
    this.lastRawRoll = boundedRoll;
    
    // Apply dead zone filtering: ignore small movements
    const changeDelta = Math.abs(boundedRoll - this.lastProcessedRoll);
    if (changeDelta < this.deadZoneDeg) {
      const absRollDeg = Math.abs(boundedRoll);
      if (absRollDeg <= this.levelGreenEnterThresholdDeg) {
        if (this.levelSettleTimer) {
          clearTimeout(this.levelSettleTimer);
          this.levelSettleTimer = undefined;
        }
        this.levelMotionSettling = false;
        this.levelTargetRoll = 0;
        this.levelRollDeg = 0;
        this.lastProcessedRoll = boundedRoll;
      }
      this.updateLevelIndicatorState(absRollDeg);
      return; // Ignore small noise
    }
    
    // Detect and dampen extreme/sporadic movements
    const isSporadicMovement = changeDelta > this.extremeChangeThreshold || velocityDegPerSec > this.levelVelocityThresholdDegPerSec;
    let targetRoll = boundedRoll;
    if (isSporadicMovement) {
      // Large sudden change detected - apply velocity damping
      // Blend between the displayed line and the new sensor value to prevent jitter while still following motion.
      targetRoll = this.levelRollDeg + (boundedRoll - this.levelRollDeg) * followFactor;
      this.levelMotionSettling = true;
      console.log('[Level] Extreme movement detected, applying damping:', {
        changeDelta,
        velocityDegPerSec,
        original: boundedRoll,
        damped: targetRoll,
      });

      if (this.levelSettleTimer) {
        clearTimeout(this.levelSettleTimer);
      }
      this.levelSettleTimer = setTimeout(() => {
        if (!this.isLevelEnabled) return;
        this.levelMotionSettling = false;
        this.levelTargetRoll = this.lastRawRoll;
        if (Math.abs(this.levelRollDeg - this.levelTargetRoll) <= this.levelResyncThresholdDeg) {
          this.levelRollDeg = this.levelTargetRoll;
        }
        this.updateLevelIndicatorState(Math.abs(this.levelRollDeg));
      }, this.levelSettleDelayMs);
    } else {
      this.levelMotionSettling = false;
    }
    
    // Update target for smooth interpolation loop
    if (!isSporadicMovement && Math.abs(boundedRoll - this.levelRollDeg) <= this.levelSnapThresholdDeg) {
      targetRoll = boundedRoll;
    }

    this.levelTargetRoll = targetRoll;
    this.lastProcessedRoll = targetRoll; // Track processed value for velocity calculation
    
    // Update level status
    this.updateLevelIndicatorState(Math.abs(this.levelRollDeg));
  };
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
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
    private http: HttpClient
  ) {
    this.requestCameraPermission();
    // subscribe to current image changes so UI can react when another page selects one
    try {
      this.imageStorage.getCurrentImage$().subscribe(img => {
        if (img) {
          // update selected thumbnail reference and title
          this.selectedThumbSrc = img.withBoxes || img.original;
          this.selectedImageSelectionKey = this.getImageSelectionKey(img);
          this.selectedImageTitle = this.getShortImageTitle(img.filename ?? '');
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

    this.photosTaken = 0;
    this.photosProcessed = 0;
    this.imageQueue = [];

    this.platform.ready().then(() => this.initCamera());
    // Handle Android hardware back: prompt before discarding empty session
    
    try {
      this.backButtonSub = this.platform.backButton.subscribeWithPriority(10, async () => {
        await this.handleGoHome();
      });
    } catch (e) {
      console.warn('[CameraPage2] failed to register hardware back handler', e);
    }
    this.getFastApiMessage();
    this.apiStatus = 1;

    
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

// async takePicture() {
//   if (this.isCooldown) return;
//   if (this.isLevelEnabled && !this.isPhoneLeveled) return;

//   this.isCooldown = true;
//   this.showFlash = true;
//   console.log('[PIPELINE] STEP 1: takePicture function triggered!'); // <--- ADD THIS
//   setTimeout(() => { this.showFlash = false; }, this.flashDurationMs);
//   setTimeout(() => { this.isCooldown = false; }, this.cooldownMs);
   
//   console.log('[PIPELINE] takePicture: Starting camera capture...');
//   try {
//     const video = this.videoRef?.nativeElement;
//     if (!video) throw new Error("Video element not found");

//     // CRITICAL: Ensure dimensions are actually valid (Common mobile failure point)
//     if (video.videoWidth === 0 || video.videoHeight === 0) {
//       console.error("[Camera] Video stream not active: dimensions are zero.");
//       return; 
//     }

//     const canvas = this.canvasRef?.nativeElement;
//     canvas.width = video.videoWidth;
//     canvas.height = video.videoHeight;
//     const ctx = canvas.getContext('2d');
    
//     if (!ctx) throw new Error("Canvas context not available");

//     ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

//     // Inside takePicture()
// canvas.toBlob((blob) => {
//   if (!blob) return;

//   const reader = new FileReader();
//   reader.onloadend = () => {
//     const dataUrl = reader.result as string;
//     const cameraFilename = `Camera-${Date.now()}.jpg`;
    
//     console.log(`[Camera] Capture successful: ${cameraFilename}`);
    
//     console.log('[PIPELINE] takePicture: Blob created. Calling processQueue.');
//     // FIX: Send the raw Blob alongside the dataUrl
//     this.processQueue(dataUrl, cameraFilename, blob);
//   };
//   reader.readAsDataURL(blob);
// }, 'image/jpeg', 0.85);

//   } catch (err) {
//     console.error('[Camera] takePicture failed:', err);
//     console.error('[PIPELINE] takePicture: ERROR encountered:', err);
//   }
// }

// async takePicture() {
//   if (this.isCooldown) return;
//   // If your level checking is required, keep this logic:
//   if (this.isLevelEnabled && !this.isPhoneLeveled) return;

//   this.isCooldown = true;
//   this.showFlash = true;
//   setTimeout(() => { this.showFlash = false; }, this.flashDurationMs);
//   setTimeout(() => { this.isCooldown = false; }, this.cooldownMs);
   
//   console.log('[PIPELINE] takePicture: Starting native camera capture...');

//   try {
//     // 1. Trigger the Native Capacitor Camera
//     const image = await Camera.getPhoto({
//       quality: 90,
//       allowEditing: false,
//       resultType: CameraResultType.Uri, // Returns a URI that can be fetched as a blob
//       source: CameraSource.Camera       // Force native camera source
//     });

//     if (!image.webPath) {
//       throw new Error("No webPath found for captured image.");
//     }

//     // 2. Fetch the Blob from the native URI
//     const response = await fetch(image.webPath);
//     const blob = await response.blob();

//     // 3. Convert Blob to DataURL for your existing processQueue
//     const reader = new FileReader();
//     reader.onloadend = () => {
//       const dataUrl = reader.result as string;
//       const cameraFilename = `Camera-${Date.now()}.jpg`;
      
//       console.log(`[Camera] Capture successful: ${cameraFilename}`);
      
//       // 4. Pass the blob and dataUrl to your existing processing pipeline
//       this.processQueue(dataUrl, cameraFilename, blob);
//     };
//     reader.readAsDataURL(blob);

//   } catch (err: any) {
//     // Capacitor throws an error if the user cancels the camera
//     if (err?.message?.includes('User cancelled')) {
//       console.log('[Camera] User cancelled capture');
//     } else {
//       console.error('[Camera] takePicture failed:', err);
//       console.error('[PIPELINE] takePicture: ERROR encountered:', err);
//     }
//   }
// }

// async takePicture() {
//   if (this.isCooldown) return;
//   if (this.isLevelEnabled && !this.isPhoneLeveled) return;

//   this.isCooldown = true;
//   this.showFlash = true;
//   setTimeout(() => { this.showFlash = false; }, this.flashDurationMs);
//   setTimeout(() => { this.isCooldown = false; }, this.cooldownMs);
   
//   console.log('[PIPELINE] takePicture: Starting camera capture...');

//   try {
//     const video = this.videoRef?.nativeElement;
//     if (!video || video.videoWidth === 0) throw new Error("Video stream inactive");

//     const canvas = this.canvasRef?.nativeElement;
//     canvas.width = video.videoWidth;
//     canvas.height = video.videoHeight;
//     const ctx = canvas.getContext('2d');
//     if (!ctx) throw new Error("Canvas context missing");

//     ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
//     console.log("Draw picture to canvas, attempting blob conversion...");

//     // Call the retry helper
//     const blob = await this.convertCanvasToBlobWithRetry(canvas, 3);
//     console.log("Blob conversion successful, size:", blob.size);

//     // Continue with the existing logic
//     const reader = new FileReader();
//     reader.onloadend = () => {
//       const dataUrl = reader.result as string;
//       const cameraFilename = `Camera-${Date.now()}.jpg`;
//       console.log(`[Camera] Capture successful: ${cameraFilename}`);
//       console.log(`[Camera] Blob size: ${blob.size} bytes`);
//       this.processQueue(dataUrl, cameraFilename, blob);
//     };
//     reader.readAsDataURL(blob);

//   } catch (err) {
//     console.error('[Camera] takePicture failed:', err);
//   }
// }

async takePicture() {
  if (this.isCooldown) return;
  if (this.isLevelEnabled && !this.isPhoneLeveled) return;

  this.isCooldown = true;
  this.showFlash = true;
  setTimeout(() => { this.showFlash = false; }, this.flashDurationMs);
  setTimeout(() => { this.isCooldown = false; }, this.cooldownMs);
   
  console.log('[PIPELINE] takePicture: Starting camera capture...');
  try {
    const video = this.videoRef?.nativeElement;
    if (!video || video.videoWidth === 0) throw new Error("Video stream inactive");
    const canvas = this.canvasRef?.nativeElement;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Canvas context missing");

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    console.log("Draw picture to canvas, attempting blob conversion...");
    
    // 1. Retrieve the Blob using your working retry helper
    const blob = await this.convertCanvasToBlobWithRetry(canvas, 3);
    console.log("Blob conversion successful, size:", blob.size);
    
    // 2. Extract DataURL synchronously directly from the active canvas buffer
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const cameraFilename = `Camera-${Date.now()}.jpg`;
    
    console.log(`[Camera] Capture successful: ${cameraFilename}`);
    console.log(`[Camera] Blob size: ${blob.size} bytes`);
    
    // 3. Safely pass both objects directly to your processing queue
    this.processQueue(dataUrl, cameraFilename, blob);
    
  } catch (err) {
    console.error('[Camera] takePicture failed:', err);
  }
}

/**
 * Helper to convert canvas to blob with a retry mechanism.
 */
private async convertCanvasToBlobWithRetry(canvas: HTMLCanvasElement, maxRetries: number = 3): Promise<Blob> {
  let lastError;
  console.log(`[Camera] Starting blob conversion with up to ${maxRetries} attempts...`);
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            console.log(`[Camera] Blob conversion successful, size: ${blob.size} bytes`);
            resolve(blob);
          } else {
            console.log(`[Camera] Blob conversion failed.`);
            reject(new Error("Canvas toBlob returned null"));
          }
        }, 'image/jpeg', 0.85);
      });
    } catch (e) {
      lastError = e;
      console.warn(`[Camera] Blob conversion attempt ${i + 1} failed, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 200)); // Small pause between retries
    }
  }
  throw lastError || new Error("Failed to convert canvas to blob");
}

  /**
 * Helper function to print the current state of the queue.
 * Triggered whenever an item is added or popped for processing.
 */
private printQueueStatus(action: 'added' | 'sent_to_processing', item: QueueItem): void {
  console.log(`=== 📋 [Queue Update: ${action.toUpperCase()}] ===`);
  console.log(`Target File: ${item.filename}`);
  console.log(`Pending in Queue: ${this.imageQueue.length} image(s)`);
  console.log(`Current Queue Order:`, this.imageQueue.map(q => q.filename));
  console.log(`======================================`);
}


// Add the optional blob parameter
async processQueue(dataUrl: string, filename: string, blob?: Blob): Promise<void> {
  const newItem: QueueItem = { dataUrl, filename, blob };
  this.imageQueue.push(newItem);
console.log(`[PIPELINE] processQueue: Item added. Queue length: ${this.imageQueue.length + 1}`);
  this.photosTaken += 1;
  this.printQueueStatus('added', newItem);

  if (!this.isQueueProcessing) {
    console.log('[PIPELINE] processQueue: Queue idle. Starting processor.');
    this.runQueueProcessor();
  }
}

private async runQueueProcessor(): Promise<void> {
  this.isQueueProcessing = true;
  console.log('[PIPELINE] runQueueProcessor: Processor loop started.');
  while (this.imageQueue.length > 0) {
    const nextItem = this.imageQueue.shift()!;
    console.log(`[PIPELINE] runQueueProcessor: Processing ${nextItem.filename}`);
    this.printQueueStatus('sent_to_processing', nextItem);
    try {
      // FIX: Pass the blob down to processDataUrl
      await this.processDataUrl(nextItem.dataUrl, nextItem.filename, nextItem.blob, false);
    } catch (error) {
      console.error(`[Queue Error] Processing failed for ${nextItem.filename}:`, error);
      console.error(`[PIPELINE] runQueueProcessor: Critical error in processing ${nextItem.filename}:`, error);
    }
  }
  this.isQueueProcessing = false;
  console.log('[PIPELINE] runQueueProcessor: Queue empty. Finished.');
}

  /** Create a new session for this camera visit and set it active */
  /**
   * Create a new empty session for this visit and mark it pristine.
   * Persists via ImageStorageService and refreshes counts and thumbnails.
   */
  async createSessionOnEnter() {
    try {
      //creates session and Generate a human-friendly session name with current date/time. 
      const name = `Session ${new Date().toLocaleString()}`;
      
      // Retrieve the stored userID from storage
      let userId: string | undefined = undefined;
      try {
        const storage = await (this.imageStorage as any)._storage;
        if (storage) {
          userId = await storage.get('userID');
        }
      } catch (e) {
        console.warn('[CameraPage2] Failed to retrieve userID from storage', e);
      }
      
      // calls service to create a session (empty image list) with userId and Fallback to null if API missing.
      const s = (this.imageStorage && typeof (this.imageStorage.createSession) === 'function') ? this.imageStorage.createSession(name, [], userId) : null;
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
        this.photosProcessed = 0;
        console.log("Photos Taken", this.photosTaken, "Photos Processed", this.photosProcessed);
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


// async pickImagesMobile() {
//   console.log('[PIPELINE] pickImagesMobile: Opening gallery for MULTI-SELECT...');
//   try {
//     const imageGallery = await Camera.pickImages({
//       quality: 90,
//       limit: 10
//     });
    
//     console.log(`[PIPELINE] pickImagesMobile: User selected ${imageGallery.photos.length} images.`);

//     for (const photo of imageGallery.photos) {
//       // Wrap in try/catch so one corrupt image doesn't stop the whole batch
//       try {
//         // 1. Use the native absolute 'path' instead of 'webPath' to bypass the WebView deadlock
//         if (!photo.path) {
//           console.warn('[Gallery] Skipping image: No native path provided by Capacitor.');
//           continue;
//         }

//         console.log(`[Gallery] Reading file natively: ${photo.path}`);

//         // 2. Read the file over the native bridge (bypasses HTTP completely)
//         const readFileResult = await Filesystem.readFile({
//           path: photo.path
//         });

//         // 3. Construct the Data URL from the native base64 string
//         const format = photo.format || 'jpeg';
//         const dataUrl = `data:image/${format};base64,${readFileResult.data}`;

//         // 4. Convert Data URL to Blob (fetch handles raw data URLs instantly without network calls)
//         const response = await fetch(dataUrl);
//         const blob = await response.blob();

//         const galleryFilename = `Gallery-${Date.now()}-${Math.random().toString(36).substring(2, 7)}.jpg`;
//         console.log(`[Gallery] Queueing image: ${galleryFilename}`);
        
//         // 5. Send to your queue pipeline
//         this.processQueue(dataUrl, galleryFilename, blob);

//       } catch (innerErr) {
//         console.error(`[Gallery] Failed to process a selected image. Skipping to next.`, innerErr);
//       }
//     }

//   } catch (error) {
//     // Capacitor throws here if the user just closes the gallery without selecting anything
//     console.error('Error picking images from gallery:', error);
//   }
// }

async pickImagesMobile() {
  console.log('[PIPELINE] pickImagesMobile: Opening gallery for MULTI-SELECT...');
  try {
    const imageGallery = await Camera.pickImages({
      quality: 90,
      limit: 10
    });
    console.log(`[PIPELINE] pickImagesMobile: User selected ${imageGallery.photos.length} images.`);

    for (const photo of imageGallery.photos) {
      try {
        let finalDataUrl: string | null = null;
        let finalBlob: Blob | null = null;

        // ==========================================
        // ATTEMPT 1: Your Original Native Pipeline
        // ==========================================
        if (photo.path) {
          try {
            console.log(`[Gallery] Reading file natively: ${photo.path}`);
            const readFileResult = await Filesystem.readFile({ path: photo.path });
            
            const format = photo.format || 'jpeg';
            finalDataUrl = `data:image/${format};base64,${readFileResult.data}`;

            // Convert Data URL to Blob
            const response = await fetch(finalDataUrl);
            finalBlob = await response.blob();
            
            console.log('[Gallery] Native read successful.');
          } catch (nativeErr) {
            console.warn(`[Gallery] Native read failed, triggering fallback...`, nativeErr);
            finalDataUrl = null; // Reset to trigger the fallback
          }
        }

        // ==========================================
        // ATTEMPT 2: Fallback to webPath (WebView)
        // ==========================================
        if (!finalDataUrl && photo.webPath) {
          console.log(`[Gallery] Using webPath fallback: ${photo.webPath}`);
          
          // Fetch Blob directly from the virtual URL
          const response = await fetch(photo.webPath);
          finalBlob = await response.blob();

          // Convert Blob back to DataUrl for preview/processing compatibility
          finalDataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(finalBlob!);
          });
        }

        // ==========================================
        // VALIDATE & SEND TO QUEUE
        // ==========================================
        if (!finalDataUrl || !finalBlob) {
          console.warn('[Gallery] Skipping image: Both native path and webPath failed.');
          continue;
        }

        const ext = photo.format || 'jpg';
        const galleryFilename = `Gallery-${Date.now()}-${Math.random().toString(36).substring(2, 7)}.${ext}`;
        
        console.log(`[Gallery] Queueing image: ${galleryFilename}`);
        this.processQueue(finalDataUrl, galleryFilename, finalBlob);

      } catch (innerErr) {
        console.error(`[Gallery] Failed to process a selected image. Skipping to next.`, innerErr);
      }
    }

  } catch (error) {
    // Capacitor throws here if the user closes the gallery without selecting
    console.error('Error picking images from gallery:', error);
  }
}

private fetchBlobSafely(url: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.responseType = 'blob';
    
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response);
      } else {
        // Fallback for local files which sometimes return status 0 on success
        if (xhr.status === 0 && xhr.response) {
            resolve(xhr.response);
        } else {
            reject(new Error(`HTTP Error ${xhr.status} while fetching blob`));
        }
      }
    };
    
    xhr.onerror = () => reject(new Error('Network error while fetching blob via XHR'));
    xhr.open('GET', url);
    xhr.send();
  });
}
  
async processDataUrl(
  dataUrl: string,
  filename: string,
  blob?: Blob, // ADDED: Receive the blob here
  bumpCounters: boolean = true,
  addToCapturedImages: boolean = true,
  refreshCountsAfterSave: boolean = true
) {
 console.log(`🎥 [CameraProcessor] Current image name is: ${filename}`);
 console.log(`[PIPELINE] processDataUrl: Entering for ${filename}`);
  this.isProcessing = true;
  this.imagePreview = dataUrl;

  let backendUploadResult: UploadResponse | null = null;
  
  if (addToCapturedImages) {
    this.capturedImages.unshift(dataUrl);
  }

  // Detect center thumbnails
  setTimeout(() => {
    if (typeof this.detectCenterThumbnail === 'function') {
      this.detectCenterThumbnail();
    }
  }, 60);

  // Yield execution
  if (typeof this.sleep === 'function') {
    await this.sleep(50);
  } else {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  
  try {
    this.cdr.detectChanges();
  } catch (e) {
    /* ignore change detection spikes */
  }


  // 2. Master try block to guarantee the finally block clears the spinner
  try {
    // --- BACKEND UPLOAD FLOW ---
    try {
      // FIX: Use the passed blob. If it's missing (e.g. from gallery base64), fall back to fetching it.
      // Ensure we absolutely have a valid Blob instance
let finalBlob = blob;
if (!finalBlob || !(finalBlob instanceof Blob)) {
  const response = await fetch(dataUrl);
  finalBlob = await response.blob();
}

const generatedName = filename || `capture-${Date.now()}.jpg`;

console.log(`[CameraProcessor] Triggering uploadToServer for backend server: ${generatedName}`);

// 1. Check for finalBlob, NOT this.selectedFile
if (finalBlob) {
  console.log(`[PIPELINE] processDataUrl: Calling uploadToServer for ${generatedName}`);
  // Pass the raw blob directly to our fixed uploadToServer function
  this.apiStatus = 1;
  console.log(`Api status`, this.apiStatus);
  backendUploadResult = await this.uploadToServer(finalBlob, generatedName);
  this.apiStatus = 4; // Green
  // this.photosProcessed += 1;
   console.log(`Api status`, this.apiStatus);
  console.log(`[PIPELINE] processDataUrl: Upload result:`, backendUploadResult);
} else {
  console.warn('[CameraProcessor] Cannot upload: finalBlob is null or missing.');
}

      const croppedImages: any[] = [];

      console.log("Backend Result check cropped boi:", backendUploadResult?.message);
      console.log("Backend Result check bounding boxes:", backendUploadResult?.rawImagePath);
      console.log("Backend Result check cropped ROI:", backendUploadResult?.processedImagePath);
      console.log("Backend Result check cropped ROI object store:", backendUploadResult?.bounding_boxes);
      // console.log("Backend Result check cropped ROI:", backendUploadResult?.cropped_roi_objectStore);
      // console.log("Backend Result check cropped ROI object store:", backendUploadResult?.resizedImagePath);

  
      

      
      console.log('[CameraProcessor] Successfully saved backend upload response:', backendUploadResult);
    } catch (uploadSetupErr) {
      console.error('[CameraProcessor] Failed to execute backend upload payload:', uploadSetupErr);
    }

    if (bumpCounters) this.photosTaken += 1;

    let finalizationClaimed = false;
    const claimFinalization = () => {
      if (finalizationClaimed) return false;
      finalizationClaimed = true;
      return true;
    };

    let inferenceCalled = false;
    let userId: string | undefined = undefined;

    // Authoritative check on User Identifiers
    try {
      const storage = await (this.imageStorage as any)._storage;
      if (storage) {
        userId = await storage.get('userID');
      }
    } catch (e) {
      console.warn('[CameraProcessor] Failed to retrieve userID from storage context', e);
    }

    const sessionImgIndex = typeof (this.imageStorage as any).getNextOriginalImageNumber === 'function'
      ? (this.imageStorage as any).getNextOriginalImageNumber(this.selectedSessionId || undefined)
      : undefined;
    const originalId = this.generateImageRecordId('original');

    // Execution Core Worker
    const doWork = async () => {
      let prediction: any = null;
      try {
        inferenceCalled = true;
       
        const tensor = await this.preprocessImage(dataUrl);
        
        try {
          // prediction = await this.crackDetectionService.runInference(tensor);
        } catch (infErr) {
          console.warn('Local client model inference timed out or faulted', infErr);
        }
      } catch (err) {
        console.warn('Client-side preview preprocessing failed', err);
      }

      // --- CRITICAL FIX: LINK BACKEND RESULTS TO bounding_boxes ENGINE ---
      if (!prediction) {
        prediction = { boxes: [] };
      }
      if (!prediction.boxes || prediction.boxes.length === 0) {
        if (backendUploadResult && Array.isArray(backendUploadResult.bounding_boxes) && backendUploadResult.bounding_boxes.length > 0) {
          console.log(`[CameraProcessor] Local model found 0 boxes. Feeding ${backendUploadResult.bounding_boxes.length} server boxes into drawing canvas engine.`);
          // this.photosTaken += backendUploadResult.bounding_boxes.length;
          prediction.boxes = backendUploadResult.bounding_boxes;
        }
      }

      const maxBytes = 900_000;
      const safeOriginal = await this.shrinkDataUrlToBytes(dataUrl, maxBytes, 4000);
      const timestamp = new Date().toISOString();
      const generatedFilename = this.buildSessionFilename(
        !!(prediction.boxes && prediction.boxes.length > 0), 
        timestamp, 
        filename, 
        sessionImgIndex
      );
      const userFriendlyname = this.generateUserFriendlyFilename(); 

      const entry: StoredImage = {
        original: safeOriginal,
        timestamp,
        filename: generatedFilename,
        userFriendlyname: userFriendlyname,
        fileImageName: filename || undefined,
        prediction: prediction || undefined,
        hasPrediction: !!(prediction.boxes && prediction.boxes.length > 0),
        statusMessage: (prediction.boxes && prediction.boxes.length > 0) ?
          'Prediction succeeded' : (inferenceCalled ? 'Prediction failed' : 'No prediction'),
        userId: userId,
        sessionId: this.selectedSessionId || undefined,
        original_id: originalId,
        cropped_id: originalId
      };
       console.log("It worked line 871! Boxes to draw:");
      // Canvas Rendering & Cropping Queue Loop
      try {
        if (prediction && Array.isArray(prediction.boxes) && prediction.boxes.length > 0) {
          const rawBoxes2 = backendUploadResult?.bounding_boxes || []; 
          const boxesToDraw2 = rawBoxes2.map((b: any) => ({
            x: b.x,
            y: b.y,
            w: b.w,
            h: b.h
          }));
          const maskW = prediction.maskWidth || prediction.maskW || 128;
          const maskH = prediction.maskHeight || prediction.maskH || 128;

          let croppedCracks: any[] = [];
          let resizedImage: any[] = [];

// 1. Check if the backend provided pre-processed crops
const backendCrops = (backendUploadResult as any)?.cropped_roi_objectStore;
// With this:
const backendResize = (backendUploadResult as any)?.resizedImagePath;

console.log("BackendResize", backendResize);

if (backendResize && typeof backendResize === 'string' && !backendResize.startsWith('data:image/')) {
  try {
    const response = await fetch(backendResize);
    const blob = await response.blob();
    const base64 = await this.convertBlobToBase64(blob);
    resizedImage = [{ image: base64 }];
  } catch (e) {
    console.error("[CameraProcessor] Failed to fetch resized image from URL", e);
    resizedImage = [];
  }
} else if (backendResize?.startsWith('data:image/')) {
  // Handle the case where it might be base64 already
  resizedImage = [{ image: backendResize }];
} else {
  resizedImage = [];
}

if (Array.isArray(backendCrops) && backendCrops.length > 0) {
  console.log("[CameraProcessor] Using server-provided crops:", backendCrops);
  
  // FIX: Map the backend's 'image_data' and 'box_id' keys to the expected 'image' and 'croppedNumber' keys
  croppedCracks = backendCrops.map((crop: any, index: number) => ({
    croppedNumber: crop.box_id !== undefined ? crop.box_id : index + 1,
    image: crop.image_data || crop.image, // Securely grabs the base64 string
    box: crop.box || boxesToDraw2[index] || null,
    type: crop.type || 'unknown',
    shape: crop.shape || 'unknown',
    severity: crop.severity || 'unknown'
  }));
} else {
  // 2. Fallback: Run local cropping only if backend crops are missing
  console.log("[CameraProcessor] No backend crops found, running local cropping.");


for (const box of boxesToDraw2) {
  const croppedNumber = croppedCracks.length + 1;
  try {
    // Wrap the operations in a localized function
    const cropOperation = async () => {
      const crop = await this.cropBoxFromImage(dataUrl, box, maskW, maskH);
      const cropTensor = await this.preprocessImage(crop);
      return crop;
    };

    // GUARDRAIL: Give each crop a maximum of 2 seconds to complete
    const cropTimeout = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error(`Crop ${croppedNumber} timed out.`)), 2000)
    );

    // Race the crop against the 2-second timeout
    const cropResult = await Promise.race([cropOperation(), cropTimeout]);

    croppedCracks.push({
      croppedNumber,
      image: cropResult,
      box,
      type: 'unknown',
      shape: 'unknown',
      severity:'unknown'
    });
  } catch (cropErr) {
    // If one box fails or times out, it logs the error but safely continues to the next box!
    console.warn(`[CameraProcessor] Failed handling bounding box ${croppedNumber}`, cropErr);
  }
}
}

console.log("It worked line 905! Final croppedCracks:", croppedCracks);
console.log("It worked line 927! Final resizedImage:", resizedImage);

          console.log("It worked line 907! Boxes to draw:");

          try {
            const withBoxesDataUrl = await this.drawBoxesOnImage(dataUrl, boxesToDraw2, maskW, maskH);
            const safeWithBoxes = await this.shrinkDataUrlToBytes(withBoxesDataUrl, maxBytes, 4000);
            (entry as any).withBoxes = safeWithBoxes;
            (entry as any).boxes = boxesToDraw2;
            (entry as any).croppedCracks = croppedCracks;
            (entry as any).resizedImage = resizedImage;
            (entry as any).detectionMessage = `Rendered ${boxesToDraw2.length} detected crack box(es)`;
            this.totalBoundingBoxesCreated += boxesToDraw2.length;
          } catch (renderErr) {
            console.warn('[CameraProcessor] drawBoxesOnImage canvas drawing threw exception:', renderErr);
            (entry as any).withBoxes = safeOriginal;
            (entry as any).boxes = [];
            (entry as any).detectionMessage = 'Box rendering failed';
          }
        } else {
          (entry as any).withBoxes = safeOriginal;
          (entry as any).boxes = [];
          (entry as any).detectionMessage = 'No boxes detected';
        }
      } catch (e) {
        console.warn('[CameraProcessor] Context breakdown while handling canvas configurations', e);
        (entry as any).withBoxes = safeOriginal;
        (entry as any).boxes = [];
        (entry as any).detectionMessage = 'Box rendering failed';
      }

      console.log("Line 957");
      this.photosProcessed += 1;

      if (!claimFinalization()) {
        console.warn('[CameraProcessor] Skipping storage write because processing state is already completed');
        return entry;
      }
     
      console.log("Line 964 added to image storage");
      await this.imageStorage.addImage(entry, this.selectedSessionId || undefined);
      
      try {
        if (this.selectedSessionId && typeof (this.imageStorage.addImageToSession) === 'function') {
          this.imageStorage.addImageToSession(this.selectedSessionId, entry.filename);
          this.sessionIsPristine = false;
        }
      } catch (e) {
        console.warn('[CameraProcessor] Failed linking image identifier to active session key', e);
      }
      
      console.log("Line 976 cropped images");
      if (typeof (this as any).processAndStoreCroppedCracks === 'function') {
        await (this as any).processAndStoreCroppedCracks(entry, filename, userId, sessionImgIndex, originalId);
      } else if (Array.isArray((entry as any).croppedCracks) && (entry as any).croppedCracks.length > 0) {
        console.log("Cropped Crack Image Data 1197", (entry as any).croppedCracks);
        const storedCroppedCracks = await this.persistCroppedCracksAsSessionImages(
          (entry as any).croppedCracks, 
          filename, 
          entry.timestamp, 
          userId, 
          sessionImgIndex, 
          originalId
        );
        (entry as any).croppedCracks = storedCroppedCracks;
        try {
          if (typeof (this.imageStorage as any).setEntryForImage === 'function') {
            (this.imageStorage as any).setEntryForImage(entry.filename, entry);
          }
        } catch (setErr) {
          console.warn('[CameraProcessor] Failed matching parent index to sub-crops object mapping', setErr);
        }
      }
      
      console.log("Line 998 resized images");
    // --- Process and store resized images ---
      if (typeof (this as any).processAndStoreResizedImages === 'function') {
        await (this as any).processAndStoreResizedImages(entry, filename, userId, sessionImgIndex, originalId);
      } else if (Array.isArray((entry as any).resizedImage) && (entry as any).resizedImage.length > 0) {
        console.log("Resized Image Data 1208", (entry as any).resizedImage);
        const storedResizedImages = await this.persistResizedImagesAsSessionImages(
          (entry as any).resizedImage, 
          filename, 
          entry.timestamp, 
          userId, 
          sessionImgIndex, 
          originalId
        );
        (entry as any).resizedImage = storedResizedImages;
        try {
          if (typeof (this.imageStorage as any).setEntryForImage === 'function') {
            (this.imageStorage as any).setEntryForImage(entry.filename, entry);
          }
        } catch (setErr) {
          console.warn('[CameraProcessor] Failed matching parent index to resized image object mapping', setErr);
        }
      }

      await this.refreshDisplayedImages();

      if (this.imagePaths) {
        this.imagePaths.unshift({
          original: entry.original,
          withBoxes: (entry as any).withBoxes || entry.original,
          fileName: entry.filename,
          rawPrediction: entry.prediction,
          original_id: (entry as any).original_id,
          cropped_id: (entry as any).cropped_id,
        });
      }

      if (userId) {
        try {
          if (typeof this.imageStorage.saveImageToUser === 'function') {
            await this.imageStorage.saveImageToUser(userId, entry);
          }
          if (this.selectedSessionId && typeof (this.imageStorage.getSession) === 'function' && typeof this.imageStorage.saveSessionToUser === 'function') {
            const session = this.imageStorage.getSession(this.selectedSessionId);
            if (session) await this.imageStorage.saveSessionToUser(userId, session);
          }
        } catch (e) {
          console.warn('[CameraProcessor] Cloud storage transaction rejected', e);
        }
      }

      if (bumpCounters) this.imagesUploadedThisSession += 1;
      if (prediction && prediction.boxes && prediction.boxes.length > 0)
      console.log("Photos Taken", this.photosTaken, "Photos Processed", this.photosProcessed);
      console.log("Photos Taken", this.photosTaken, "Photos Processed", this.photosProcessed);
      if (refreshCountsAfterSave) await this.updatePhotoCounts();
      
      await this.logCurrentSessionImageObjects();
      
      setTimeout(() => {
        if (typeof this.detectCenterThumbnail === 'function') {
          this.detectCenterThumbnail();
        }
      }, 250);
      return entry;
    };

    // Race Configuration
    const overallTimeoutMs = 17_000;
    try {
      await Promise.race([
        doWork(), 
        new Promise((_, rej) => setTimeout(() => rej(new Error('processing-timeout')), overallTimeoutMs))
      ]);
    } catch (err: any) {
      if (err && err.message === 'processing-timeout') {
        // Fallback logic on timeout
        const maxBytes = 900_000;
        const safeOriginal = await this.shrinkDataUrlToBytes(dataUrl, maxBytes, 4000);
        const timestamp = new Date().toISOString();
        const fallbackFilename = this.buildSessionFilename(false, timestamp, filename, sessionImgIndex);
        const userFriendlyname = this.generateUserFriendlyFilename();
        
        const entry: StoredImage = {
          original: safeOriginal,
          timestamp,
          filename: fallbackFilename,
          userFriendlyname: userFriendlyname,
          fileImageName: filename || undefined,
          prediction: undefined,
          hasPrediction: false,
          statusMessage: inferenceCalled ? 'Prediction failed' : 'No prediction',
          userId: userId,
          sessionId: this.selectedSessionId || undefined,
          original_id: originalId,
          cropped_id: originalId
        };
        try {
          if (claimFinalization()) {
            await this.imageStorage.addImage(entry, this.selectedSessionId || undefined);
            if (this.selectedSessionId && typeof (this.imageStorage.addImageToSession) === 'function') {
              this.imageStorage.addImageToSession(this.selectedSessionId, entry.filename);
              this.sessionIsPristine = false;
            }
            await this.refreshDisplayedImages();
            if (this.imagePaths) {
              this.imagePaths.unshift({
                original: entry.original,
                withBoxes: entry.original,
                fileName: entry.filename,
                rawPrediction: entry.prediction,
                original_id: entry.original_id,
                cropped_id: entry.cropped_id,
              });
            }
            this.imagesUploadedThisSession += 1;
            console.log("Photos Taken", this.photosTaken, "Photos Processed", this.photosProcessed);
            await this.updatePhotoCounts();
          }
        } catch (fallbackErr) {
          console.warn('[CameraProcessor] Aborting database write operations during fallback handling', fallbackErr);
        }
      }
    }
  } finally {
    this.isProcessing = false;
    if (typeof this.logCurrentSessionStateAfterProcessDataUrl === 'function') {
      await this.logCurrentSessionStateAfterProcessDataUrl();
    }
    if (typeof this.logBoundingBoxStats === 'function') {
      this.logBoundingBoxStats();
    }
  }
}

  /** Print the current session's stored image objects after processing completes. */
  private async logCurrentSessionImageObjects() {
    try {
      const sessionId = this.selectedSessionId;
      if (!sessionId || !this.imageStorage || typeof (this.imageStorage as any).getSessionImages !== 'function') {
        console.log('[CameraPage2] No active session or storage helper unavailable for image-object dump');
        return;
      }

      const sessionImages = await (this.imageStorage as any).getSessionImages(sessionId);
      console.log('[CameraPage2] Session image objects:', sessionImages);
    } catch (e) {
      console.warn('[CameraPage2] Failed to log session image objects', e);
    }
  }

  // private async persistResizedImagesAsSessionImages(
  //   resizedImages: Array<any>,
  //   originalFilename: string,
  //   timestamp: string,
  //   userId?: string,
  //   imgIndex?: number,
  //   parentOriginalId?: string
  // ): Promise<any[]> {
  //   const storedResizedImages: any[] = [];
  //   const service: any = this.imageStorage as any;
  //   const sessionId = this.selectedSessionId || undefined;

  //   for (let index = 0; index < resizedImages.length; index++) {
  //     const resizeObj = resizedImages[index];
  //     const resizeNumber = index + 1;
  //     const baseName = String(originalFilename || `session-${timestamp}`);

  //     let generatedFilename = typeof service?.generateSessionFilename === 'function'
  //       ? service.generateSessionFilename({
  //           sessionId,
  //           filename: originalFilename,
  //           originalFilename,
  //           designatedPart: 'resized',
  //           croppedNumber: resizeNumber, 
  //           imageType: 'resized',
  //           imgIndex,
  //           timestamp,
  //         })
  //       : this.generateFilename();

  //     // Ensure we extract the base64 URL correctly whether passed as an object or direct string
  //     const imageDataUrl = typeof resizeObj === 'object' && resizeObj.image ? resizeObj.image : resizeObj;
  //     const safeResize = await this.shrinkDataUrlToBytes(imageDataUrl, 900_000, 4000);

  //     // Create the entry. Type asserted as 'any' to dynamically assign the requested 'Type' property
  //     const resizeEntry: any = {
  //       original: safeResize,
  //       timestamp,
  //       filename: generatedFilename,
  //       fileImageName: `${baseName.replace(/\.[^.]+$/, '')}-resize-${resizeNumber}`,
  //       hasPrediction: false,
  //       statusMessage: `Stored resized image ${resizeNumber}`,
  //       detectionMessage: `Stored resized image ${resizeNumber}`,
  //       boxes: [],
  //       userId,
  //       sessionId,
  //       original_id: parentOriginalId || undefined,
  //       cropped_id: this.generateImageRecordId('resized'),
  //       resized_id: this.generateImageRecordId('resized'),
  //       Type: 'Resized' // New field added explicitly
  //     };

  //     let addedOk = false;
  //     try {
  //       await this.imageStorage.addImage(resizeEntry as StoredImage, sessionId);
  //       addedOk = true;
  //     } catch (addErr) {
  //       console.warn('[CameraPage2] Failed to add resized image to storage', addErr);
  //     }

  //     if (addedOk) {
  //       try {
  //         if (sessionId && typeof (this.imageStorage as any).addImageToSession === 'function') {
  //           (this.imageStorage as any).addImageToSession(sessionId, resizeEntry.filename);
  //         }
  //       } catch (sessErr) {
  //         console.warn('[CameraPage2] Failed to add resized image to session', sessErr);
  //       }

  //       if (userId) {
  //         try {
  //           await this.imageStorage.saveImageToUser(userId, resizeEntry as StoredImage);
  //         } catch (saveErr) {
  //           console.warn('[CameraPage2] Failed to save resized image to user storage', saveErr);
  //         }
  //       }

  //       storedResizedImages.push({
  //         ...(typeof resizeObj === 'object' ? resizeObj : { image: resizeObj }),
  //         filename: resizeEntry.filename,
  //         original_id: resizeEntry.original_id,
  //         cropped_id: resizeEntry.cropped_id,
  //         sessionImage: resizeEntry,
  //       });
  //     } else {
  //       storedResizedImages.push({
  //         ...(typeof resizeObj === 'object' ? resizeObj : { image: resizeObj }),
  //         filename: generatedFilename,
  //         original_id: parentOriginalId || undefined,
  //         cropped_id: this.generateImageRecordId('resized'),
  //         resized_id: this.generateImageRecordId('resized'),
  //         sessionImage: null,
  //         error: true,
  //       });
  //     }
  //   }

  //   return storedResizedImages;
  // }

    /** Resize + normalize image to [1,3,128,128] Float32Array */
  /**
   * Produce Float32 tensor [1,3,128,128] normalized to [-1,1] from a dataUrl.
   * Used by both photo capture and upload flows prior to inference.
   */
  // async preprocessImage(dataUrl: string): Promise<Float32Array> {
  //   const img = new Image();
  //   img.src = dataUrl;
  //   await new Promise(resolve => (img.onload = resolve));

  //   const canvas = document.createElement('canvas');
  //   canvas.width = 128;
  //   canvas.height = 128;
  //   const ctx = canvas.getContext('2d')!;
  //   ctx.drawImage(img, 0, 0, 128, 128);

  //   const imageData = ctx.getImageData(0, 0, 128, 128);
  //   const data = new Float32Array(1 * 3 * 128 * 128);

  //   for (let i = 0; i < 128 * 128; i++) {
  //     data[i] = (imageData.data[i * 4] / 255 - 0.5) / 0.5;           // R
  //     data[i + 128 * 128] = (imageData.data[i * 4 + 1] / 255 - 0.5) / 0.5; // G
  //     data[i + 2 * 128 * 128] = (imageData.data[i * 4 + 2] / 255 - 0.5) / 0.5; // B
  //   }

  //   return data;
  // }

  async preprocessImage(dataUrl: string): Promise<Float32Array> {
    return new Promise((resolve, reject) => { // ADDED REJECT
      const img = new Image();
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, 128, 128);

        const imageData = ctx.getImageData(0, 0, 128, 128);
        const data = new Float32Array(1 * 3 * 128 * 128);
        for (let i = 0; i < 128 * 128; i++) {
          data[i] = (imageData.data[i * 4] / 255 - 0.5) / 0.5;
          data[i + 128 * 128] = (imageData.data[i * 4 + 1] / 255 - 0.5) / 0.5;
          data[i + 2 * 128 * 128] = (imageData.data[i * 4 + 2] / 255 - 0.5) / 0.5;
        }
        resolve(data);
      };

      // GUARDRAIL: Reject promise on load failure
      img.onerror = () => {
        reject(new Error('Failed to load image for tensor preprocessing.'));
      };

      img.src = dataUrl;
    });
  }

  // Reduce data URL size to stay under Firestore document limits.
  private async shrinkDataUrlToBytes(dataUrl: string, maxBytes: number, timeoutMs: number = 4000): Promise<string> {
    try {
      const estimateBytes = (url: string) => {
        const commaIdx = url.indexOf(',');
        if (commaIdx === -1) return url.length;
        const b64 = url.slice(commaIdx + 1);
        const padding = (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
        return Math.floor((b64.length * 3) / 4) - padding;
      };

      if (!dataUrl || estimateBytes(dataUrl) <= maxBytes) return dataUrl;

      const img = new Image();
      const loadStart = Date.now();
      img.src = dataUrl;
      const loadResult = await Promise.race([
        new Promise<'loaded' | 'error'>(resolve => {
          img.onload = () => resolve('loaded');
          img.onerror = () => resolve('error');
        }),
        new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), timeoutMs))
      ]);

      if (loadResult !== 'loaded') {
        console.warn('[CameraPage2] shrinkDataUrlToBytes image load failed or timed out:', loadResult);
        return dataUrl;
      }

      let scale = 1;
      let quality = 0.92;
      const minQuality = 0.5;
      const scaleStep = 0.85;
      const maxLoops = 8;

      for (let i = 0; i < maxLoops; i += 1) {
        if (Date.now() - loadStart > timeoutMs) {
          console.warn('[CameraPage2] shrinkDataUrlToBytes timeout while resizing');
          return dataUrl;
        }
        const canvas = document.createElement('canvas');
        const w = Math.max(1, Math.floor((img.naturalWidth || img.width) * scale));
        const h = Math.max(1, Math.floor((img.naturalHeight || img.height) * scale));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) break;
        ctx.drawImage(img, 0, 0, w, h);

        const candidate = canvas.toDataURL('image/jpeg', quality);
        if (estimateBytes(candidate) <= maxBytes) return candidate;

        if (quality > minQuality) {
          quality = Math.max(minQuality, quality - 0.12);
        } else {
          scale = scale * scaleStep;
        }
      }
    } catch (e) {
      console.warn('[CameraPage2] shrinkDataUrlToBytes failed', e);
    }
    return dataUrl;
  }

  /**
 * Generates a user-friendly filename based on the number of original images taken.
 * Example outputs: 'image(1).jpg', 'image(2).jpg', etc.
 */
generateUserFriendlyFilename(): string {
  // 1. Get the current count of original images. 
  // Safely falls back to filtering storedImages if the getter doesn't exist yet.
  const currentOriginalCount = (this as any).originalStoredImages 
    ? (this as any).originalStoredImages.length 
    : (this.storedImages ? this.storedImages.filter((img: any) => img.type === 'original').length : 0);

  // 2. Add + 1 so the very first photo taken is labeled image(1) instead of image(0)
  const nextImageNumber = currentOriginalCount + 1;

  // 3. Return the formatted filename with the file extension
  return `image(${nextImageNumber}).jpg`;
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

  private buildSessionFilename(hasCrack: boolean, timestamp?: string, fallbackName?: string, imgIndex?: number): string {
    const svc: any = this.imageStorage as any;
    if (svc && typeof svc.generateSessionFilename === 'function') {
      return svc.generateSessionFilename({
        sessionId: this.selectedSessionId || undefined,
        filename: fallbackName,
        designatedPart: 'original',
        imageType: 'original',
        hasCrack,
        imgIndex,
        timestamp
      });
    }
    return fallbackName || this.generateFilename();
  }

  // private async persistCroppedCracksAsSessionImages(
  //   croppedCracks: Array<{ croppedNumber?: number; image: string; box: BoundingBox; type: string; shape: string; severity: string; }>,
  //   originalFilename: string,
  //   timestamp: string,
  //   userId?: string,
  //   imgIndex?: number,
  //   parentOriginalId?: string
  // ): Promise<any[]> {
  //   const storedCroppedCracks: any[] = [];
  //   const service: any = this.imageStorage as any;
  //   const sessionId = this.selectedSessionId || undefined;

  //   for (let index = 0; index < croppedCracks.length; index++) {
  //     const crop = croppedCracks[index];
  //     const croppedNumber = typeof crop.croppedNumber === 'number' ? crop.croppedNumber : index + 1;
  //     const baseName = String(originalFilename || `session-${timestamp}`);
  //     let generatedFilename = typeof service?.generateSessionFilename === 'function'
  //       ? service.generateSessionFilename({
  //           sessionId,
  //           filename: originalFilename,
  //           originalFilename,
  //           designatedPart: 'cropped',
  //           croppedNumber,
  //           imageType: 'cropped',
  //           imgIndex,
  //           timestamp,
  //         })
  //       : this.generateFilename();

  //     const safeCrop = await this.shrinkDataUrlToBytes(crop.image, 900_000, 4000);
  //     const cropEntry: StoredImage = {
  //       original: safeCrop,
  //       timestamp,
  //       filename: generatedFilename,
  //       fileImageName: `${baseName.replace(/\.[^.]+$/, '')}-crop-${croppedNumber}`,
  //       // prediction: {
  //       //   type: crop.type,
  //       //   shape: crop.shape,
  //       //   severity: crop.severity,
  //       // },
  //       // hasPrediction: true,
  //       // statusMessage: `Prediction succeeded - Cropped crack ${croppedNumber} prediction stored`,
  //       // detectionMessage: `Stored cropped crack ${croppedNumber}`,
  //       boxes: [],
  //       userId,
  //       sessionId,
  //       original_id: parentOriginalId || undefined,
  //       cropped_id: this.generateImageRecordId('cropped'),
  //     };

  //     let addedOk = false;
  //     try {
  //       await this.imageStorage.addImage(cropEntry, sessionId);
  //       addedOk = true;
  //     } catch (addErr) {
  //       console.warn('[CameraPage2] Failed to add cropped crack image to storage', addErr);
  //     }

  //     if (addedOk) {
  //       try {
  //         if (sessionId && typeof (this.imageStorage as any).addImageToSession === 'function') {
  //           (this.imageStorage as any).addImageToSession(sessionId, cropEntry.filename);
  //         }
  //       } catch (sessErr) {
  //         console.warn('[CameraPage2] Failed to add cropped image to session', sessErr);
  //       }

  //       if (userId) {
  //         try {
  //           await this.imageStorage.saveImageToUser(userId, cropEntry);
  //         } catch (saveErr) {
  //           console.warn('[CameraPage2] Failed to save cropped crack to user storage', saveErr);
  //         }
  //       }

  //       storedCroppedCracks.push({
  //         ...crop,
  //         filename: cropEntry.filename,
  //         original_id: cropEntry.original_id,
  //         cropped_id: cropEntry.cropped_id,
  //         sessionImage: cropEntry,
  //       });
  //     } else {
  //       storedCroppedCracks.push({
  //         ...crop,
  //         filename: generatedFilename,
  //         original_id: parentOriginalId || undefined,
  //         cropped_id: this.generateImageRecordId('cropped'),
  //         sessionImage: null,
  //         error: true,
  //       });
  //     }
  //   }

  //   return storedCroppedCracks;
  // }

  // private async persistCroppedCracksAsSessionImages(
  //   croppedCracks: Array<{ croppedNumber?: number; image: string; box: BoundingBox; type: string; shape: string; severity: string; }>,
  //   originalFilename: string,
  //   timestamp: string,
  //   userId?: string,
  //   imgIndex?: number,
  //   parentOriginalId?: string
  // ): Promise<any[]> {
  //   const storedCroppedCracks: any[] = [];
  //   const service: any = this.imageStorage as any;
  //   const sessionId = this.selectedSessionId || undefined;

  //   for (let index = 0; index < croppedCracks.length; index++) {
  //     const crop = croppedCracks[index];
  //     const croppedNumber = typeof crop.croppedNumber === 'number' ? crop.croppedNumber : index + 1;
  //     const baseName = String(originalFilename || `session-${timestamp}`);

  //     let generatedFilename = typeof service?.generateSessionFilename === 'function'
  //       ? service.generateSessionFilename({
  //           sessionId,
  //           filename: originalFilename,
  //           originalFilename,
  //           designatedPart: 'cropped',
  //           croppedNumber,
  //           imageType: 'cropped',
  //           imgIndex,
  //           timestamp,
  //         })
  //       : this.generateFilename();

  //       console.log("Image_data 1740", crop.image);

  //     const safeCrop = await this.shrinkDataUrlToBytes(crop.image, 900_000, 4000);
  //     console.log("Image_data 1740", safeCrop);
  //     const cropEntry: StoredImage = {
  //       original: safeCrop,
  //       timestamp,
  //       filename: generatedFilename,
  //       fileImageName: `${baseName.replace(/\.[^.]+$/, '')}-crop-${croppedNumber}`,
  //       boxes: [],
  //       userId,
  //       sessionId,
  //       original_id: parentOriginalId || undefined,
  //       cropped_id: this.generateImageRecordId('cropped'),
  //     };

  //     let addedOk = false;
  //     try {
  //       await this.imageStorage.addImage(cropEntry, sessionId);
  //       addedOk = true;
  //     } catch (addErr) {
  //       console.warn('[CameraPage2] Failed to add cropped crack image to storage', addErr);
  //     }

  //     if (addedOk) {
  //       try {
  //         if (sessionId && typeof (this.imageStorage as any).addImageToSession === 'function') {
  //           (this.imageStorage as any).addImageToSession(sessionId, cropEntry.filename);
  //         }
  //       } catch (sessErr) {
  //         console.warn('[CameraPage2] Failed to add cropped image to session', sessErr);
  //       }

  //       if (userId) {
  //         try {
  //           await this.imageStorage.saveImageToUser(userId, cropEntry);
  //         } catch (saveErr) {
  //           console.warn('[CameraPage2] Failed to save cropped crack to user storage', saveErr);
  //         }
  //       }

  //       // ---> ADDED: Increment counters for the cropped image
  //       // this.photosTaken += 1;
  //        this.photosProcessed +=1;
  //        console.log("Photos Taken", this.photosTaken, "Photos Processed", this.photosProcessed);
  //       // Optional: If you also want these to count as "processed" to balance your UI countdown spinner
  //       // this.photosProcessed += 1; 

  //       storedCroppedCracks.push({
  //         ...crop,
  //         filename: cropEntry.filename,
  //         original_id: cropEntry.original_id,
  //         cropped_id: cropEntry.cropped_id,
  //         sessionImage: cropEntry,
  //       });
  //     } else {
  //       storedCroppedCracks.push({
  //         ...crop,
  //         filename: generatedFilename,
  //         original_id: parentOriginalId || undefined,
  //         cropped_id: this.generateImageRecordId('cropped'),
  //         sessionImage: null,
  //         error: true,
  //       });
  //     }
  //   }

  //   return storedCroppedCracks;
  // }

  private async persistCroppedCracksAsSessionImages(
    croppedCracks: Array<any>, // Updated to Array<any> to accept both strings and objects
    originalFilename: string,
    timestamp: string,
    userId?: string,
    imgIndex?: number,
    parentOriginalId?: string
  ): Promise<any[]> {
    const storedCroppedCracks: any[] = [];
    const service: any = this.imageStorage as any;
    const sessionId = this.selectedSessionId || undefined;

    for (let index = 0; index < croppedCracks.length; index++) {
      const crop = croppedCracks[index];
      
      // Safely extract the cropped number if it's an object
      const croppedNumber = typeof crop === 'object' && typeof crop.croppedNumber === 'number' 
        ? crop.croppedNumber 
        : index + 1;
        
      const baseName = String(originalFilename || `session-${timestamp}`);

      let generatedFilename = typeof service?.generateSessionFilename === 'function'
        ? service.generateSessionFilename({
            sessionId,
            filename: originalFilename,
            originalFilename,
            designatedPart: 'cropped',
            croppedNumber,
            imageType: 'cropped',
            imgIndex,
            timestamp,
          })
        : this.generateFilename();

      // FIX 1: Safely extract the base64 string whether 'crop' is an object or a raw string
      const imageDataUrl = typeof crop === 'object' && crop.image ? crop.image : crop;
      
      console.log("Image_data 1740", imageDataUrl);

      // Pass the safely extracted string to your compressor
      const safeCrop = await this.shrinkDataUrlToBytes(imageDataUrl, 900_000, 4000);
      
      const cropEntry: StoredImage = {
        original: safeCrop,
        timestamp,
        filename: generatedFilename,
        fileImageName: `${baseName.replace(/\.[^.]+$/, '')}-crop-${croppedNumber}`,
        // boxes: typeof crop === 'object' && crop.box ? [crop.box] : [], // Safely extract box if present
        userId,
        sessionId,
        original_id: parentOriginalId || undefined,
        cropped_id: this.generateImageRecordId('cropped'),
      };

      let addedOk = false;
      try {
        await this.imageStorage.addImage(cropEntry, sessionId);
        addedOk = true;
      } catch (addErr) {
        console.warn('[CameraPage2] Failed to add cropped crack image to storage', addErr);
      }

      if (addedOk) {
        try {
          if (sessionId && typeof (this.imageStorage as any).addImageToSession === 'function') {
            (this.imageStorage as any).addImageToSession(sessionId, cropEntry.filename);
          }
        } catch (sessErr) {
          console.warn('[CameraPage2] Failed to add cropped image to session', sessErr);
        }

        if (userId) {
          try {
            await this.imageStorage.saveImageToUser(userId, cropEntry);
          } catch (saveErr) {
            console.warn('[CameraPage2] Failed to save cropped crack to user storage', saveErr);
          }
        }

        // this.photosProcessed += 1;
        console.log("Photos Taken", this.photosTaken, "Photos Processed", this.photosProcessed);
        
        // FIX 2: Safely spread the object exactly as done in resizedImages
        storedCroppedCracks.push({
          ...(typeof crop === 'object' ? crop : { image: crop }),
          filename: cropEntry.filename,
          original_id: cropEntry.original_id,
          cropped_id: cropEntry.cropped_id,
          sessionImage: cropEntry,
        });
      } else {
        storedCroppedCracks.push({
          ...(typeof crop === 'object' ? crop : { image: crop }),
          filename: generatedFilename,
          original_id: parentOriginalId || undefined,
          cropped_id: this.generateImageRecordId('cropped'),
          sessionImage: null,
          error: true,
        });
      }
    }

    return storedCroppedCracks;
  }

  private async persistResizedImagesAsSessionImages(
    resizedImages: Array<any>,
    originalFilename: string,
    timestamp: string,
    userId?: string,
    imgIndex?: number,
    parentOriginalId?: string
  ): Promise<any[]> {
    const storedResizedImages: any[] = [];
    const service: any = this.imageStorage as any;
    const sessionId = this.selectedSessionId || undefined;

    for (let index = 0; index < resizedImages.length; index++) {
      const resizeObj = resizedImages[index];
      const resizeNumber = index + 1;
      const baseName = String(originalFilename || `session-${timestamp}`);

      let generatedFilename = typeof service?.generateSessionFilename === 'function'
        ? service.generateSessionFilename({
            sessionId,
            filename: originalFilename,
            originalFilename,
            designatedPart: 'resized',
            croppedNumber: resizeNumber, 
            imageType: 'resized',
            imgIndex,
            timestamp,
          })
        : this.generateFilename();

      const imageDataUrl = typeof resizeObj === 'object' && resizeObj.image ? resizeObj.image : resizeObj;
      const safeResize = await this.shrinkDataUrlToBytes(imageDataUrl, 900_000, 4000);

      const resizeEntry: any = {
        original: safeResize,
        timestamp,
        filename: generatedFilename,
        fileImageName: `${baseName.replace(/\.[^.]+$/, '')}-resize-${resizeNumber}`,
        hasPrediction: false,
        statusMessage: `Stored resized image ${resizeNumber}`,
        detectionMessage: `Stored resized image ${resizeNumber}`,
        boxes: [],
        userId,
        sessionId,
        original_id: parentOriginalId || undefined,
        cropped_id: this.generateImageRecordId('resized'),
        resized_id: this.generateImageRecordId('resized'),
        Type: 'Resized' 
      };

      let addedOk = false;
      try {
        await this.imageStorage.addImage(resizeEntry as StoredImage, sessionId);
        addedOk = true;
      } catch (addErr) {
        console.warn('[CameraPage2] Failed to add resized image to storage', addErr);
      }

      if (addedOk) {
        try {
          if (sessionId && typeof (this.imageStorage as any).addImageToSession === 'function') {
            (this.imageStorage as any).addImageToSession(sessionId, resizeEntry.filename);
          }
        } catch (sessErr) {
          console.warn('[CameraPage2] Failed to add resized image to session', sessErr);
        }

        if (userId) {
          try {
            await this.imageStorage.saveImageToUser(userId, resizeEntry as StoredImage);
          } catch (saveErr) {
            console.warn('[CameraPage2] Failed to save resized image to user storage', saveErr);
          }
        }

        // ---> ADDED: Increment counters for the resized image
        // this.photosTaken += 1;
        // this.photosProcessed +=1;
        console.log("Photos Taken", this.photosTaken, "Photos Processed", this.photosProcessed);
        
        // Optional: If you also want these to count as "processed" to balance your UI countdown spinner
        // this.photosProcessed += 1; 

        storedResizedImages.push({
          ...(typeof resizeObj === 'object' ? resizeObj : { image: resizeObj }),
          filename: resizeEntry.filename,
          original_id: resizeEntry.original_id,
          cropped_id: resizeEntry.cropped_id,
          sessionImage: resizeEntry,
        });
      } else {
        storedResizedImages.push({
          ...(typeof resizeObj === 'object' ? resizeObj : { image: resizeObj }),
          filename: generatedFilename,
          original_id: parentOriginalId || undefined,
          cropped_id: this.generateImageRecordId('resized'),
          resized_id: this.generateImageRecordId('resized'),
          sessionImage: null,
          error: true,
        });
      }
    }

    return storedResizedImages;
  }

  // async cropBoxFromImage(
  //   imageDataUrl: string,
  //   box: BoundingBox,
  //   maskW: number,
  //   maskH: number
  // ): Promise<string> {
  //   const img = new Image();
  //   img.src = imageDataUrl;

  //   return new Promise(resolve => {
  //     img.onload = () => {
  //       const imgW = img.naturalWidth;
  //       const imgH = img.naturalHeight;

  //       const scaleX = imgW / maskW;
  //       const scaleY = imgH / maskH;

  //       const padding = 100;

  //       let cropX = Math.round(box.x * scaleX);
  //       let cropY = Math.round(box.y * scaleY);
  //       let cropW = Math.round(box.w * scaleX);
  //       let cropH = Math.round(box.h * scaleY);

  //       // Add context around crack
  //       cropX = Math.max(0, cropX - padding);
  //       cropY = Math.max(0, cropY - padding);

  //       cropW = Math.min(imgW - cropX, cropW + padding * 2);
  //       cropH = Math.min(imgH - cropY, cropH + padding * 2);

  //       // Keep a 4:3 aspect ratio
  //       const targetRatio = 4 / 3;
  //       const centerX = cropX + cropW / 2;
  //       const centerY = cropY + cropH / 2;

  //       if (cropH > cropW) {
  //         cropW = cropH * targetRatio;
  //       } else {
  //         cropH = cropW / targetRatio;
  //       }

  //       cropX = Math.round(centerX - cropW / 2);
  //       cropY = Math.round(centerY - cropH / 2);

  //       cropX = Math.max(0, cropX);
  //       cropY = Math.max(0, cropY);

  //       if (cropX + cropW > imgW) {
  //         cropW = imgW - cropX;
  //       }

  //       if (cropY + cropH > imgH) {
  //         cropH = imgH - cropY;
  //       }

  //       const canvas = document.createElement('canvas');
  //       canvas.width = cropW;
  //       canvas.height = cropH;

  //       const ctx = canvas.getContext('2d')!;
  //       ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  //       resolve(canvas.toDataURL('image/jpeg'));
  //     };
  //   });
  // }

  async cropBoxFromImage(
    imageDataUrl: string,
    box: BoundingBox,
    maskW: number,
    maskH: number
  ): Promise<string> {
    return new Promise((resolve, reject) => { // ADDED REJECT
      const img = new Image();
      
      img.onload = () => {
        const imgW = img.naturalWidth;
        const imgH = img.naturalHeight;
        const scaleX = imgW / maskW;
        const scaleY = imgH / maskH;
        const padding = 100;

        let cropX = Math.round(box.x * scaleX);
        let cropY = Math.round(box.y * scaleY);
        let cropW = Math.round(box.w * scaleX);
        let cropH = Math.round(box.h * scaleY);

        cropX = Math.max(0, cropX - padding);
        cropY = Math.max(0, cropY - padding);
        cropW = Math.min(imgW - cropX, cropW + padding * 2);
        cropH = Math.min(imgH - cropY, cropH + padding * 2);

        const targetRatio = 4 / 3;
        const centerX = cropX + cropW / 2;
        const centerY = cropY + cropH / 2;

        if (cropH > cropW) {
          cropW = cropH * targetRatio;
        } else {
          cropH = cropW / targetRatio;
        }

        cropX = Math.round(centerX - cropW / 2);
        cropY = Math.round(centerY - cropH / 2);
        cropX = Math.max(0, cropX);
        cropY = Math.max(0, cropY);

        if (cropX + cropW > imgW) {
          cropW = imgW - cropX;
        }
        if (cropY + cropH > imgH) {
          cropH = imgH - cropY;
        }

        const canvas = document.createElement('canvas');
        canvas.width = cropW;
        canvas.height = cropH;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        resolve(canvas.toDataURL('image/jpeg'));
      };

      // GUARDRAIL: Prevent infinite hanging if image fails to parse
      img.onerror = () => {
        reject(new Error('Failed to load image into canvas for cropping.'));
      };

      // Best Practice: Always set src AFTER assigning onload/onerror
      img.src = imageDataUrl; 
    });
  }

  private convertBlobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

  
  /**
   * Draw bounding boxes on the supplied Base64 image and return a new Base64 image.
   * Boxes are expected to be in mask coordinates; maskW/maskH indicate the mask resolution
   * so boxes can be scaled to the image natural size.
   */
async drawBoxesOnImage(Base64: string, boxes: BoundingBox[], maskW = 128, maskH = 128): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    // 1. Setup handlers FIRST
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        
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

        console.log(`📦 Bounding boxes drawn: ${boxes.length}`);
        resolve(canvas.toDataURL('image/jpeg'));
      } catch (err) {
        reject(err);
      }
    };

    // 2. Add an onerror handler to prevent the code from hanging infinitely
    img.onerror = (err) => reject(new Error('Failed to load base64 image into canvas'));

    // 3. Assign src LAST
    img.src = Base64; 
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
      const isProcessedStatus = (statusMessage?: string | null) => {
        const normalized = (statusMessage || '').toLowerCase();
        return normalized.includes('prediction succeeded') || normalized.includes('cropped crack');
      };

      // If a session is active, compute counts from the session image keys
      if (this.selectedSessionId) {
        const freshSession = typeof svc.getSession === 'function'
          ? svc.getSession(this.selectedSessionId)
          : null;
        if (freshSession) {
          this.sessions = [freshSession];
        } else if (!this.sessions || this.sessions.length === 0) {
          try {
            await this.loadSessions();
          } catch (e) {
            /* ignore */
          }
        }

        // Find the active session by its ID
        const session = freshSession || this.sessions.find(s => s.id === this.selectedSessionId) || null;

        if (!session || !Array.isArray(session.imageKeys)) {
          // If no session or invalid image keys, reset counts and stored images
          this.photosTaken = 0;
          this.photosProcessed = 0;
          this.storedImages = [];
        } else {
          // Extract image keys from the session
          const keys: string[] = session.imageKeys.slice();
          const imgs: StoredImage[] = [];
          let processed = 0;
          let foundCount = 0;

          // Iterate over each image key to fetch its entry
          for (const k of keys) {
            let entry: any = undefined;

            // Fetch the image entry using available methods in the service
            if (typeof svc.getEntryForImage === 'function') {
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
              // Add the entry to the stored images list
              imgs.push(entry as StoredImage);
              foundCount++;

              // Count images with successful predictions
              if (isProcessedStatus(entry.statusMessage)) {
                processed++;
              }
            }
          }

          // Update counts and stored images
          // this.photosProcessed = processed;
          // console.log("Original Stored Image", this.originalStoredImages.length)
          // this.photosTaken = this.originalStoredImages.length;
          // this.storedImages = imgs;
        }
      } else {
        // No active session: fall back to global image list
        const all: StoredImage[] = await this.imageStorage.getAllImages();

        // Update counts based on all stored images
        // this.photosTaken = Array.isArray(all) ? all.length : 0;
        // this.photosProcessed = Array.isArray(all) ? all.filter(i => isProcessedStatus(i.statusMessage)).length : 0;
        this.storedImages = Array.isArray(all) ? all.slice() : [];
      }

      // Log the updated counts
      console.log('[CameraPage2] updatePhotoCounts:', {
        photosTaken: this.photosTaken,
        photosProcessed: this.photosProcessed
      });
    } catch (e) {
      // Log any errors encountered during the update process
      console.warn('[CameraPage2] updatePhotoCounts failed', e);
    }
  }

  /**
   * Stub for flash toggle; logs only. Real flash requires native plugin.
   */
  async toggleFlash() {
    const targetState = !this.isFlashEnabled;
    const applied = await this.applyTorchState(targetState);
    if (!applied && targetState) {
      alert('Torch/flash is not available on this camera.');
    }
  }

  private async applyTorchState(enabled: boolean): Promise<boolean> {
    try {
      if (!this.mediaStream) return false;
      const track = this.mediaStream.getVideoTracks()[0] as MediaStreamTrack | undefined;
      if (!track || typeof (track as any).applyConstraints !== 'function') return false;

      const capabilities = typeof (track as any).getCapabilities === 'function'
        ? (track as any).getCapabilities()
        : null;

      if (!capabilities || !capabilities.torch) return false;

      await (track as any).applyConstraints({ advanced: [{ torch: enabled }] });
      this.isFlashEnabled = enabled;
      return true;
    } catch (e) {
      console.warn('[CameraPage2] applyTorchState failed', e);
      // Revert toggle state in UI when constraints fail.
      this.isFlashEnabled = false;
      return false;
    }
  }

  async toggleLevelGuide() {
    if (this.isLevelEnabled) {
      this.disableLevelGuide();
      return;
    }

    try {
      const orientationAny: any = DeviceOrientationEvent as any;
      if (orientationAny && typeof orientationAny.requestPermission === 'function') {
        const permission = await orientationAny.requestPermission();
        if (permission !== 'granted') {
          alert('Motion permission denied. Unable to enable level guide.');
          return;
        }
      }

      this.isLevelEnabled = true;
      this.isPhoneLeveled = false;
      this.levelRollDeg = 0;
      this.levelTargetRoll = 0;
      this.levelMotionSettling = false;
      this.levelLastSampleAt = 0;
      // Initialize processed roll to current value to establish baseline
      this.lastProcessedRoll = 0;
      this.lastRawRoll = 0;
      if (this.levelSettleTimer) {
        clearTimeout(this.levelSettleTimer);
        this.levelSettleTimer = undefined;
      }
      
      // Add event listener for raw orientation data
      window.addEventListener('deviceorientation', this.orientationHandler, true);
      
      // Start smooth interpolation loop for responsive updates
      this.startLevelSmoothingLoop();
      console.log('[Level] Level guide enabled with improved responsiveness and guardrails');
    } catch (e) {
      console.warn('[CameraPage2] toggleLevelGuide failed', e);
      this.disableLevelGuide();
      alert('Unable to start level guide on this device.');
    }
  }

  /** Smooth interpolation loop for responsive level guide using requestAnimationFrame */
  private startLevelSmoothingLoop() {
    const updateLevel = () => {
      if (!this.isLevelEnabled) return;

      // Smooth interpolation using linear interpolation (lerp)
      const angleDelta = this.levelTargetRoll - this.levelRollDeg;
      const smoothing = this.levelMotionSettling ? this.levelFastFollowCeil : this.levelSmoothingFactor;
      
      // Only update if there's a meaningful change to avoid excessive redraws
      if (Math.abs(angleDelta) > 0.01) {
        // Apply improved smoothing with faster responsiveness
        this.levelRollDeg += angleDelta * smoothing;
        
        // Ensure we stay within reasonable bounds to prevent drift
        this.levelRollDeg = Math.max(-45, Math.min(45, this.levelRollDeg));
        if (!this.levelMotionSettling && Math.abs(this.levelTargetRoll - this.levelRollDeg) <= this.levelSnapThresholdDeg) {
          this.levelRollDeg = this.levelTargetRoll;
        }
      } else if (Math.abs(angleDelta) > 0) {
        // Snap to target if very close to avoid oscillation
        this.levelRollDeg = this.levelTargetRoll;
      }

      if (!this.levelMotionSettling && Math.abs(this.levelRollDeg) <= this.levelSnapThresholdDeg) {
        this.levelRollDeg = 0;
        this.levelTargetRoll = 0;
      }

      this.updateLevelIndicatorState(Math.abs(this.levelRollDeg));

      // Schedule next frame
      this.levelAnimationFrameId = window.requestAnimationFrame(updateLevel);
    };

    // Start the loop
    this.levelAnimationFrameId = window.requestAnimationFrame(updateLevel);
  }

  private disableLevelGuide() {
    this.isLevelEnabled = false;
    this.isPhoneLeveled = false;
    this.levelRollDeg = 0;
    this.levelTargetRoll = 0;
    this.lastProcessedRoll = 0; // Reset processed roll on disable
    this.levelMotionSettling = false;
    this.levelLastSampleAt = 0;
    if (this.levelSettleTimer) {
      clearTimeout(this.levelSettleTimer);
      this.levelSettleTimer = undefined;
    }
    
    // Cancel RAF loop
    if (this.levelAnimationFrameId) {
      window.cancelAnimationFrame(this.levelAnimationFrameId);
      this.levelAnimationFrameId = undefined;
    }
    
    window.removeEventListener('deviceorientation', this.orientationHandler, true);
  }

  /** Briefly enable processed glow for `glowDurationMs` milliseconds */
  private triggerProcessedGlow(durationMs?: number) {
    const ms = typeof durationMs === 'number' ? durationMs : this.glowDurationMs;
    this.processedGlowActive = true;
    if (this._processedGlowTimer) {
      clearTimeout(this._processedGlowTimer);
    }
    // ensure the animation starts
    try { this.cdr.detectChanges(); } catch (e) {}
    this._processedGlowTimer = setTimeout(() => {
      this.processedGlowActive = false;
      this._processedGlowTimer = undefined;
      try { this.cdr.detectChanges(); } catch (e) {}
    }, ms);
  }

  /**
   * Open the Process Window modal showing Photos Taken, Photos Processed, and Cracks Detected
   */
  openProcessWindow() {
    this.isProcessWindowOpen = true;
  }

  /**
   * Close the Process Window modal
   */
  closeProcessWindow() {
    this.isProcessWindowOpen = false;
  }

  /**
   * Stub for additional menu actions.
   */
  openMore() {
    // stub for 'more' menu
    console.log('openMore pressed (stub)');
  }

  openTestOverlay() {
    this.showTestOverlay();
  }

  /**
   * Show a simple overlay/modal used for quick tests.
   */
  /**
   append a overlay to show interface to view images and ability to delete img from selection
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
      // box.style.padding = '15px';
      box.style.paddingTop = '10px';
      box.style.paddingBottom = '15px';
      box.style.paddingLeft = '15px';
      box.style.paddingRight = '15px';
      box.style.borderRadius = '8px';
      box.style.minWidth = '280px';
      box.style.maxWidth = '92vw';
      box.style.height = '600px';
      box.style.width = '400px';
      box.style.boxShadow = '0 6px 18px rgba(0,0,0,0.2)';
      box.style.display = 'flex';
      box.style.flexDirection = 'column';
      box.style.alignItems = 'center';
      box.style.gap = '12px';
      box.style.overflow = 'hidden';

      // Top bar: title on the left, close action on the right
      const topBar = document.createElement('div');
      topBar.style.display = 'flex';
      topBar.style.justifyContent = 'end';
      topBar.style.alignItems = 'center';
      topBar.style.width = '100%';
      topBar.style.padding = '4px 8px 0';
      topBar.style.gap = '12px';

      const title = document.createElement('div');
      title.textContent = this.getShortImageTitle(this.selectedImageTitle) || 'No Image Selected';
      title.style.fontWeight = '600';
      title.style.marginBottom = '0';
      title.style.color = 'black';
      title.style.marginTop = '10px';
      title.style.flex = '0 1 auto';
      title.style.width = '220px';
      title.style.maxWidth = '220px';
      title.style.whiteSpace = 'nowrap';
      title.style.overflow = 'hidden';
      title.style.textOverflow = 'ellipsis';
      this._overlayTitleEl = title;

      const toggleWrapper = document.createElement('div');
      toggleWrapper.className = 'toggle-wrapper';
      toggleWrapper.style.display = 'flex';
      toggleWrapper.style.alignItems = 'center';
      toggleWrapper.style.gap = '10px';
      toggleWrapper.style.margin = '10px 0 0';
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

      // keep the close button in the top bar (above the toggle row)
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', 'Close overlay');
      closeBtn.style.width = '28px';
      closeBtn.style.height = '28px';
      closeBtn.style.borderRadius = '9999px';
      closeBtn.style.border = '1px solid #f2a15a';
      closeBtn.style.background = '#fff';
      closeBtn.style.color = '#ff8a2a';
      closeBtn.style.fontSize = '18px';
      closeBtn.style.fontWeight = '600';
      closeBtn.style.lineHeight = '1';
      closeBtn.style.display = 'flex';
      closeBtn.style.alignItems = 'center';
      closeBtn.style.justifyContent = 'center';
      closeBtn.style.cursor = 'pointer';
      closeBtn.textContent = '×';
      closeBtn.onclick = () => { cleanupOverlay(); };

      topBar.appendChild(closeBtn);

      // Toggle row: place the toggle on the left and the filename on the right
      const toggleRow = document.createElement('div');
      toggleRow.style.display = 'flex';
      toggleRow.style.justifyContent = 'space-between';
      toggleRow.style.alignItems = 'center';
      toggleRow.style.width = '100%';
      toggleRow.style.padding = '0 8px';
      toggleRow.style.marginTop = '2px';
      // left: the toggle control
      toggleRow.appendChild(toggleWrapper);
      // right: move the title into the toggle row so it's aligned with the toggle
      title.style.marginTop = '0';
      title.style.marginBottom = '0';
      title.style.flex = '0 0 auto';
      title.style.textAlign = 'right';
      title.style.width = '180px';
      title.style.maxWidth = '180px';
      toggleRow.appendChild(title);
       

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
      thumbScroll.style.height = '490px';
      thumbScroll.style.maxHeight = '90vh';
      thumbScroll.style.boxSizing = 'border-box';
      thumbScroll.style.position = 'relative';
      thumbScroll.style.top = '-20px';


      const updateThumbnails = () => {
        const thumbnails = thumbScroll.querySelectorAll('img.thumbnail2');
        thumbnails.forEach((img) => {
          const imageElement = img as HTMLImageElement; // Cast to HTMLImageElement
          // If this thumbnail corresponds to a stored image, swap src based on toggle
          const storedIndex = imageElement.dataset['storedIndex'];
          if (storedIndex !== undefined && storedIndex !== '') {
            const si = parseInt(storedIndex, 10);
            const entry = this.originalStoredImages && this.originalStoredImages[si];
            if (entry) {
              imageElement.src = this.showWithBoxes ? (entry as any).withBoxes || entry.original : entry.original;
            }
          }
          const imageKey = imageElement.dataset['overlayKey'] || imageElement.dataset['storedIndex'] || imageElement.dataset['index'] || imageElement.src;
          // update border highlighting
          imageElement.style.border = imageKey === this.selectedImageKey ? '3px solid #2ecc71' : '2px solid #fff';
        });
      };
      this._overlayUpdateThumbs = updateThumbnails;

   

      // Prefer storedImages (persisted) when available so we can toggle between original/withBoxes
      //checks if there is stored images and if so create thumbnails for each stored image
      // with onclick to select image. iterates over storedImages to create thumbnails
      if (this.originalStoredImages && this.originalStoredImages.length > 0) {
        this.originalStoredImages.forEach((entry, idx) => {
          const img = document.createElement('img');
          img.className = 'thumbnail2';
          img.style.display = 'block';
          img.style.maxWidth = '95%';
          // img.style.maxHeight = '60vh';
          img.style.maxHeight = '95%';
          img.style.height = '400px'
          img.style.width = '490px';
          img.style.minWidth = '250px';
          img.style.minHeight = '250px'
          img.style.objectFit = 'contain';
          img.style.borderRadius = '6px';
          img.style.boxShadow = '0 0 6px rgba(0,0,0,0.12)';
          img.style.cursor = 'pointer';
          img.dataset['storedIndex'] = String(idx);
          img.dataset['overlayKey'] = this.getImageSelectionKey(entry);
          img.src = this.showWithBoxes ? (entry as any).withBoxes || entry.original : entry.original;
          img.style.border = img.dataset['overlayKey'] === this.selectedImageKey ? '3px solid #2ecc71' : '2px solid #fff';
          img.onclick = () => {
            this.selectedThumbSrc = img.src;
            this.selectedImageSelectionKey = img.dataset['overlayKey'] || this.getImageSelectionKey(entry);
            this.selectedImageTitle = this.getShortImageTitle(entry.userFriendlyname || `Stored ${idx + 1}`);
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
        //if no storedImages, fall back to capturedImages (in-memory only)
        this.capturedImages.forEach((src, idx) => {
          const img = document.createElement('img');
          img.src = src;
          img.className = 'thumbnail2';
          img.style.display = 'block';
          // img.style.maxWidth = '85%';
          // img.style.maxHeight = '60vh';
          img.style.maxWidth = '95%';
          // img.style.maxHeight = '60vh';
          img.style.maxHeight = '95%';
          img.style.height = '400px'
          img.style.width = '490px';
          img.style.minWidth = '250px';
          img.style.minHeight = '250px'
          img.style.objectFit = 'contain';
          img.style.borderRadius = '6px';
          img.style.border = src === this.selectedThumbSrc ? '3px solid #2ecc71' : '2px solid #fff';
          img.style.boxShadow = '0 0 6px rgba(0,0,0,0.12)';
          img.style.cursor = 'pointer';
          img.dataset['index'] = String(idx);
          img.dataset['overlayKey'] = `captured-${idx}`;
          img.onclick = () => {
            this.selectedThumbSrc = src;
            this.selectedImageSelectionKey = `captured-${idx}`;
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
      btnRow.style.gap = '8px';

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

      const reprocessBtn = document.createElement('button');
      reprocessBtn.className = 'function-btn';
      reprocessBtn.type = 'button';
      reprocessBtn.style.display = 'flex';
      reprocessBtn.style.alignItems = 'center';
      reprocessBtn.style.justifyContent = 'center';
      reprocessBtn.style.height = '40px';
      reprocessBtn.style.borderRadius = '10px';
      reprocessBtn.style.border = '1px solid transparent';
      reprocessBtn.style.background = 'linear-gradient(#fff, #fff) padding-box, linear-gradient(to right, #ff512f, #f09819) border-box';
      reprocessBtn.style.color = '#ff7a00';

      const reprocessText = document.createTextNode('Reprocess Image');
      const reprocessIcon = document.createElement('span');
      reprocessIcon.textContent = '↻';
      reprocessIcon.style.display = 'inline-flex';
      reprocessIcon.style.alignItems = 'center';
      reprocessIcon.style.justifyContent = 'center';
      reprocessIcon.style.width = '20px';
      reprocessIcon.style.height = '20px';
      reprocessIcon.style.marginLeft = '8px';
      reprocessIcon.style.fontSize = '18px';
      reprocessIcon.style.fontWeight = '700';
      reprocessBtn.appendChild(reprocessText);
      reprocessBtn.appendChild(reprocessIcon);

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


      // make buttons visually fill available space like in bottom-top-row
      deleteBtn.style.flex = '1 1 auto';
      reprocessBtn.style.flex = '1 1 auto';
      deleteBtn.style.marginRight = '8px';

      btnRow.appendChild(deleteBtn);
      // btnRow.appendChild(reprocessBtn);

      box.appendChild(topBar);
      box.appendChild(toggleRow);
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
    //Get container element and image nodes
    //Purpose: locate the thumbnail container and the img elements; bail out if missing.
    const container = document.querySelector('.thumbnail-scroll2') as HTMLElement | null;
    if (!container) return;
    const images = container.querySelectorAll('img') as NodeListOf<HTMLImageElement>;
    if (images.length === 0) return;
    
    //Compute center X of the container
   //Purpose: get the horizontal center coordinate to compare image centers against.
    const containerRect = container.getBoundingClientRect();
    const centerX = containerRect.left + containerRect.width / 2;

    //Find the image whose center is closest to container center
   //Purpose: iterate thumbnails, compute each center and distance, and track the closest.
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
    
    //Bail if no closest image found, otherwise read its src and set selection
    //Purpose: obtain the image source and update selectedThumbSrc.
    if (!closestImg) return;
    const src = (closestImg as HTMLImageElement).src;
    const overlayKey = (closestImg as HTMLImageElement).dataset['overlayKey'] || '';
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
    this.selectedImageSelectionKey = overlayKey || src;
    this.selectedImageTitle = this.getShortImageTitle(newTitle);
    // Update overlay title if present
    if (this._overlayTitleEl) this._overlayTitleEl.textContent = this.selectedImageTitle;
    // Refresh borders to reflect new selection
    if (this._overlayUpdateThumbs) this._overlayUpdateThumbs();

    console.log('[CameraPage2] Center thumbnail selected:', { title: newTitle, src });
  }

  private getSelectedOverlayImageData(): { dataUrl: string; originalName?: string } | null {
    const src = this.selectedThumbSrc || '';
    const selectionKey = this.selectedImageSelectionKey || '';
    if (!src) {
      return null;
    }

    const storedImage = this.storedImages.find(image => this.getImageSelectionKey(image) === selectionKey) || this.storedImages.find(image => image.original === src || image.withBoxes === src);
    if (storedImage) {
      return {
        dataUrl: storedImage.original,
        originalName: storedImage.fileImageName || storedImage.filename || this.selectedImageTitle || undefined
      };
    }

    const capturedIndex = selectionKey.startsWith('captured-') ? parseInt(selectionKey.replace('captured-', ''), 10) : this.capturedImages.indexOf(src);
    if (capturedIndex !== -1) {
      return {
        dataUrl: this.capturedImages[capturedIndex],
        originalName: this.selectedImageTitle || `Captured ${capturedIndex + 1}`
      };
    }

    return {
      dataUrl: src,
      originalName: this.selectedImageTitle || undefined
    };
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

    // find in storedImages first, delete logic
    // If the selected thumbnail maps to a stored/persisted 
    // image, remove it via the ImageStorageService using filename as key
    const storedIdx = this.storedImages.findIndex(p => p.original === src || p.withBoxes === src);
    if (storedIdx !== -1) {
      const imgEntry = this.storedImages[storedIdx];
      const filename = imgEntry.filename || '(unnamed)';
      const confirmMsg = `Delete stored image "${filename}"? This action cannot be undone.`;
      if (!confirm(confirmMsg)) return;

      try {
        // Use filename as the canonical key for deletion
        if (imgEntry.filename) {
          await this.imageStorage.deleteImage(imgEntry.filename);
        } else {
          console.warn('[CameraPage2] Image has no filename, cannot delete');
        }
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

  // Add this getter to filter original images automatically
get originalStoredImages(): any[] {
  return this.storedImages ? this.storedImages.filter((img: any) => img.type === 'original') : [];
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
      // Use filename as the only primary key
      if (img.filename) {
        this.imageStorage.selectImageByKey(img.filename);
      }
    } catch (e) {
      console.warn('onStoredThumbClick failed:', e);
    }
    this.selectedThumbSrc = img.withBoxes || img.original;
    this.selectedImageSelectionKey = this.getImageSelectionKey(img);
    this.selectedImageTitle = this.getShortImageTitle(img.filename ?? '');
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
          this.selectedImageTitle = this.getShortImageTitle(cur.filename ?? '');
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
    this.disableLevelGuide();
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
          this.router.navigate(['/home-page2']);
          return;
        }
        if (choice === 'stay' || choice === null) return;
      }

      if (this.selectedSessionId && this.sessionIsPristine === false && typeof (this.imageStorage as any).saveSessionSnapshotToBrowserStorage === 'function') {
        try { await (this.imageStorage as any).saveSessionSnapshotToBrowserStorage(this.selectedSessionId, 'local'); } catch (e) { /* ignore */ }
      }
      this.router.navigate(['/home-page2']);
    } catch (e) {
      console.warn('handleGoHome failed', e);
      this.router.navigate(['/home-page2']);
    }
  }


    /**
   * Show a lightweight overlay asking user either discard empty session or stay.
   * Returns 'discard', 'stay', or null (dismiss).
   */
  private showExitOverlay(): Promise<'discard' | 'stay' | null> {
    return new Promise(resolve => {
      //builds the full-screen semi-opaque backdrop element.
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
      
      //Create modal container — centered white card that holds content and actions.
      const modal = document.createElement('div');
      modal.style.background = '#fff';
      modal.style.borderRadius = '12px';
      modal.style.padding = '22px';
      modal.style.maxWidth = '90%';
      modal.style.width = '320px';
      modal.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
     
      //Create title and description — add heading and explanatory text inside the modal.
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
      
      //Create actions container and buttons
      //build "Stay" and "Delete & Home" buttons and wire clicks to cleanup.
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

      //Cleanup helper — removes the backdrop and resolves the Promise with the user's choice.
      discardBtn.onclick = () => { cleanup('discard'); };

      actions.appendChild(stayBtn);
      actions.appendChild(discardBtn);
      
      //Append to DOM and handle outside-click cancel
      //  add modal to backdrop, attach to document, and close if user clicks backdrop.
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

  /**
   * Shorten the image title by removing userID, sessionId, and img prefixes.
   * Example: "userID:abc123sessionId:xyz789img1crack1041120261109.jpg" → "crack1041120261109.jpg"
   * Handles cases where these prefixes don't exist.
   */
  getShortImageTitle(fullTitle: string): string {
    if (!fullTitle) return '';
    
    // Remove userID: prefix if it exists (format: userID:someIdValue)
    let shortened = fullTitle.replace(/^userID:[^s]*/i, '');
    
    // Remove sessionId: prefix if it exists (format: sessionId:someIdValue)
    shortened = shortened.replace(/^sessionId:[^i]*/i, '');
    
    // Remove img1, img2, etc. prefix if it exists (format: img{N})
    shortened = shortened.replace(/^img\d+/i, '');
    
    return shortened || fullTitle; // Return original if nothing was removed
  }

  // 1. Call Text Function
  getFastApiMessage() {
    this.http.get<{ message: string }>(`${this.baseUrl}/api/hello`).subscribe({
      next: (response) => {
        this.apiMessage = response.message;
        this.apiStatus = 4; // Green
        console.log("Api Message", this.apiMessage);
        console.log('Root connection success:', response);
        this.fastApiConnection = true;
        console.log("Fast API Connection", this.fastApiConnection);
      },
      error: (err) => console.error('Error fetching message:', err)
      
    });
  }

  onFileSelected(event: any) {
  // Access the native target files array safely
  const fileList: FileList = event.target.files;
  
  if (fileList && fileList.length > 0) {
    this.selectedFile = fileList[0];
    // Inspect this log in your device/emulator console
    console.log('Selected file object:', this.selectedFile); 
  } else {
    this.selectedFile = null;
  }
}
// 1. Pass the file directly as a parameter to avoid global state overlaps
// async uploadImage(fileToUpload: File): Promise<UploadResponse | null> {
  
//   if (!fileToUpload || !(fileToUpload instanceof Blob)) {
//     console.error('Upload aborted: provided file is not a valid Blob/File object.', fileToUpload);
//     return null; 
//   }

//   const formData = new FormData();
//   formData.append('file', fileToUpload, fileToUpload.name);

//   try {
//     // 2. Wrap the request in RxJS timeout to prevent infinite hanging
//     // You will need to import { timeout } from 'rxjs';
//     const request$ = this.http.post<UploadResponse>(`${this.baseUrl}/api/upload`, formData).pipe(
//       timeout(15_000) // 15 seconds max network wait time
//     );

//     const response = await firstValueFrom(request$);

//     console.log("Backend Upload Success:", response.message);
    
//     // 3. Return the response, but DO NOT mutate class state (this.boxes) here.
//     // Let processDataUrl handle the returned response to keep data synchronized.
//     return response; 

//   } catch (err: any) {
//     // 4. Catch specific errors to help you debug FastAPI issues
//     if (err.name === 'TimeoutError') {
//       console.error('Upload failed: The request timed out. File might be too large or network too slow.');
//     } else if (err.status === 413) {
//       console.error('Upload failed: HTTP 413 Payload Too Large. FastAPI rejected the image size.');
//     } else {
//       console.error('Error uploading image:', err);
//     }
    
//     return null; 
//   }
// }

async uploadImage(fileToUpload: File): Promise<UploadResponse | null> {
  if (!fileToUpload) return null;

  const formData = new FormData();
  formData.append('file', fileToUpload, fileToUpload.name);

  try {
    // Add a timeout if your HTTP client supports it
    const response = await firstValueFrom(
      this.http.post<UploadResponse>(`${this.baseUrl}/api/upload`, formData)
    );
    return response;
  } catch (err) {
    console.error('Upload failed:', err);
    return null;
  }
}

/**
 * Logs a snapshot of the current session state and queue status 
 * immediately following a processDataUrl lifecycle finish.
 */
public async logCurrentSessionStateAfterProcessDataUrl(): Promise<void> {
  console.log('📊 [CameraPage2] Post-Processing Session State Snapshot:');
  console.log(`   • Active Session ID: ${this.selectedSessionId || 'N/A'}`);
  console.log(`   • Session Status:    ${this.sessionIsPristine ? 'Pristine (Empty)' : 'Dirty (Modified)'}`);
  console.log(`   • Photos Taken:      ${this.photosTaken}`);
  console.log(`   • Photos Processed:  ${this.photosProcessed}`);
  console.log(`   • Uploads This Sess: ${this.imagesUploadedThisSession}`);
  console.log(`   • Total Boxes Drawn: ${this.totalBoundingBoxesCreated}`);
  console.log(`   • Remaining Queue:   ${this.imageQueue.length} item(s)`);

  // Log underlying database tracking states if storage is initialized
  if (this.selectedSessionId && typeof (this.imageStorage as any).getSessionImages === 'function') {
    try {
      const currentSessionItems = await (this.imageStorage as any).getSessionImages(this.selectedSessionId);
      console.log(`   • Authority Count:  ${currentSessionItems?.length || 0} records in storage`);
    } catch (e) {
      console.warn('[CameraPage2] Could not append authoritative storage logs', e);
    }
  }
}

// FIX: Converted uploadImage to uploadToServer to capture and send the value back
// async uploadToServer(fileToUpload: File | Blob, customName?: string): Promise<UploadResponse | null> {
//   console.log('[PIPELINE] uploadToServer: Attempting HTTP request...');
//   if (!fileToUpload) return null;

//   const formData = new FormData();
//   const filename = fileToUpload instanceof File ? fileToUpload.name : (customName || `upload-${Date.now()}.jpg`);
//   formData.append('file', fileToUpload, filename);

//   // Define the order of attempts
//   const endpoints = [this.baseUrl, this.baseUrl2, this.baseUrl];

//   // Loop through endpoints
//   for (const url of endpoints) {
//     try {
//       console.log(`[Upload] Attempting to connect to: ${url}`);
      
//       const response = await firstValueFrom(
//         this.http.post<UploadResponse>(`${url}/api/upload`, formData)
//       );
//       console.log(`[PIPELINE] uploadToServer: SUCCESS`);
//       console.log(`[Upload] Success using ${url}`);
//       console.log("Backend Response:", response);
//       return response; // Exit the function once successful
      
//     } catch (err) {
//       console.error('[PIPELINE] uploadToServer: FAILED to reach server. Error Details:', err);
//       console.error(`[Upload] Failed attempt to ${url}. Trying next...`, err);
//       // Continue to the next iteration in the loop
//     }
//   }

//   console.error('[Upload] All endpoints failed.');
//   return null;
// }

// async uploadToServer(fileToUpload: Blob, customName: string): Promise<UploadResponse | null> {
//   console.log('[PIPELINE] uploadToServer: Attempting HTTP request...');
  
//   // Strict check: Prevent the request from even firing if it's not a true Blob
//   if (!fileToUpload || !(fileToUpload instanceof Blob)) {
//     console.error('[Upload] Aborting: fileToUpload is not a valid Blob.', fileToUpload);
//     return null;
//   }

//   const formData = new FormData();
  
//   // The 3rd parameter safely sets the filename for the backend without needing a File object
//   formData.append('file', fileToUpload, customName); 

//   const endpoints = [this.baseUrl, this.baseUrl2, this.baseUrl];

//   for (const url of endpoints) {
//     try {
//       console.log(`[Upload] Attempting to connect to: ${url}`);
//       const response = await firstValueFrom(
//         this.http.post<UploadResponse>(`${url}/api/upload`, formData)
//       );
//       console.log(`[PIPELINE] uploadToServer: SUCCESS`);
//       return response;
      
//     } catch (err) {
//       console.error(`[Upload] Failed attempt to ${url}. Trying next...`, err);
//     }
//   }

//   console.error('[Upload] All endpoints failed.');
//   return null;
// }

// Don't forget to import timeout at the top of your file if you haven't!
// import { timeout } from 'rxjs/operators';

async uploadToServer(fileToUpload: Blob, customName: string): Promise<UploadResponse | null> {
  console.log('[PIPELINE] uploadToServer: Attempting HTTP request...');
  this.apiStatus = 2; // Orange
   console.log(`Api status`, this.apiStatus);
  
  if (!fileToUpload || !(fileToUpload instanceof Blob)) {
    console.error('[Upload] Aborting: fileToUpload is not a valid Blob.', fileToUpload);
    return null;
  }

  const formData = new FormData();
  formData.append('file', fileToUpload, customName);
  
  const endpoints = [this.baseUrl, this.baseUrl2, this.baseUrl];

  for (const url of endpoints) {
    try {
      console.log(`[Upload] Attempting to connect to: ${url}`);
      
      // ADDED: .pipe(timeout(15000)) forces the request to abort if it hangs for 15 seconds
      const request$ = this.http.post<UploadResponse>(`${url}/api/upload`, formData).pipe(
        timeout(15000) 
      );
      this.apiStatus = 3; // Yellow
       console.log(`Api status`, this.apiStatus);
      
      const response = await firstValueFrom(request$);
      
      console.log(`[PIPELINE] uploadToServer: SUCCESS`);
      return response;
      
    } catch (err: any) {
      // Now, if it hangs, it will be caught here and safely move to the next endpoint
      console.error(`[Upload] Failed attempt to ${url}. Reason:`, err?.name || err?.message);
    }
  }

  console.error('[Upload] All endpoints failed.');
  return null;
}

}
