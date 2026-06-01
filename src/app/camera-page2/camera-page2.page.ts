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
  private _photosProcessed = 0;
  // public transient flag used to show a short glow when a photo finishes processing
  processedGlowActive: boolean = false;
  private _processedGlowTimer?: any;
  // glow duration in milliseconds (default 2.5s)
  glowDurationMs: number = 2500;
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

  private generateImageRecordId(prefix: 'original' | 'cropped'): string {
    this.imageRecordCounter += 1;
    return `${prefix}-${Date.now()}-${this.imageRecordCounter}`;
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
    private cdr: ChangeDetectorRef
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

    // When the level guide is active, only allow capture while the phone is level.
    if (this.isLevelEnabled && !this.isPhoneLeveled) {
      console.log('[CameraPage2] takePicture blocked: phone is not level');
      return;
    }

    // Ensure UI shows processing state immediately
    this.isProcessing = true;
    // this.photosTaken += 1;

    // Start cooldown immediately and show a short visual flash
    this.isCooldown = true;
    this.showFlash = true;
    setTimeout(() => { this.showFlash = false; }, this.flashDurationMs);
    setTimeout(() => { this.isCooldown = false; }, this.cooldownMs);

    try {
      const video = this.videoRef.nativeElement;
      const canvas = this.canvasRef.nativeElement;
      const ctx = canvas.getContext('2d')!;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL('image/png');

      // Generate a descriptive filename for camera capture
      const cameraFilename = `Camera-${Date.now()}.jpg`;
      console.log(`📸 Captured image from camera: ${cameraFilename}` && console.log(dataUrl));
      // Delegate processing to processDataUrl
      await this.processDataUrl(dataUrl, cameraFilename);
    } catch (err) {
      console.error('Failed to take picture:', err);
      alert('Failed to capture/process image. See console for details.');
    } finally {
      this.isProcessing = false;
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
        const galleryFilename = `Gallery-${Date.now()}.jpg`;
        console.log(`📸 Picked image from gallery: ${galleryFilename}` && console.log(photo)  && console.log(dataUrl));
        // reuse existing processing pipeline with a 10s overall timeout
        try {
          await this.processDataUrl(dataUrl, galleryFilename);
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
  async processDataUrl(
    dataUrl: string,
    originalName?: string,
    bumpCounters: boolean = true,
    addToCapturedImages: boolean = true,
    refreshCountsAfterSave: boolean = true
  ) {
    // Log the current image being processed
    console.log(`🖼️ [CameraPage2] Current image name is: ${originalName || 'Unknown'}`);
    // mimic upload-image-page behaviour: preprocess, run inference, store
    if (addToCapturedImages) {
      this.capturedImages.unshift(dataUrl);
    }
    // bump counters early so spinner shows while processing unless caller already did so
    if (bumpCounters) this.photosTaken += 1;
    this.isProcessing = true;
    let finalizationClaimed = false;
    const claimFinalization = () => {
      if (finalizationClaimed) return false;
      finalizationClaimed = true;
      return true;
    };

    const maxBytes = 900_000;

    // Track whether inference was started so if timeout, we can choose the proper status message to store/show
    let inferenceAttempted = false;
    
    // Retrieve the stored userID from storage
    let userId: string | undefined = undefined;
    try {
      const storage = await (this.imageStorage as any)._storage;
      if (storage) {
        userId = await storage.get('userID');
      }
    } catch (e) {
      console.warn('[CameraPage2] processDataUrl: Failed to retrieve userID from storage', e);
    }

    const sessionImgIndex = typeof (this.imageStorage as any).getNextOriginalImageNumber === 'function'
      ? (this.imageStorage as any).getNextOriginalImageNumber(this.selectedSessionId || undefined)
      : undefined;
    const originalId = this.generateImageRecordId('original');
    
    //preprocess
    const doWork = async () => {
      let prediction: any = null;
      try {
        inferenceAttempted = true;
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
      const safeOriginal = await this.shrinkDataUrlToBytes(dataUrl, maxBytes, 4000);
      const timestamp = new Date().toISOString();
      const generatedFilename = this.buildSessionFilename(!!prediction, timestamp, originalName, sessionImgIndex);
      const entry: StoredImage = {
        original: safeOriginal,
        timestamp,
        filename: generatedFilename,
        fileImageName: originalName || undefined,
        prediction: prediction || undefined,
        hasPrediction: !!prediction,
        statusMessage: prediction ? 'Prediction succeeded' : (inferenceAttempted ? 'Prediction failed' : 'No prediction'),
        userId: userId,
        sessionId: this.selectedSessionId || undefined,
        original_id: originalId,
        cropped_id: originalId
      };

      // If the model returned bounding boxes, create a "withBoxes" image, attach boxes,
      // and persist cropped crack images for each detected box.
      try {
        if (prediction && Array.isArray(prediction.boxes) && prediction.boxes.length > 0) {
          const rawBoxes = prediction.boxes;

          const boxesToDraw = rawBoxes.map((b: any) => ({
            x: b.x,
            y: b.y,
            w: b.w,
            h: b.h
          }));

          const maskW = prediction.maskWidth || prediction.maskW || 128;
          const maskH = prediction.maskHeight || prediction.maskH || 128;

          const croppedCracks: any[] = [];

          for (const box of boxesToDraw) {
            const croppedNumber = croppedCracks.length + 1;
            try {
              const crop = await this.cropBoxFromImage(dataUrl, box, maskW, maskH);
              const cropTensor = await this.preprocessImage(crop);
              const cropPrediction = await this.crackDetectionService.runInference(cropTensor);

              croppedCracks.push({
                croppedNumber,
                image: crop,
                box,
                type: cropPrediction?.type ?? 'unknown',
                shape: cropPrediction?.shape ?? 'unknown',
                severity: cropPrediction?.severity ?? 'unknown'
              });
            } catch (cropErr) {
              console.warn('[CameraPage2] Failed processing one cropped crack, continuing', cropErr);
            }
          }

          console.log('[CROPS] Total crops:', croppedCracks.length);

         // try to create withBoxes image with drawn boxes based on the bouding box data
          try {
            const withBoxesDataUrl = await this.drawBoxesOnImage(dataUrl, boxesToDraw, maskW, maskH);
            const safeWithBoxes = await this.shrinkDataUrlToBytes(withBoxesDataUrl, maxBytes, 4000);
            (entry as any).withBoxes = safeWithBoxes;
            (entry as any).boxes = boxesToDraw;
            (entry as any).croppedCracks = croppedCracks;
            (entry as any).detectionMessage = `Rendered ${boxesToDraw.length} detected crack box(es)`;
            this.totalBoundingBoxesCreated += boxesToDraw.length;
            console.log('CROPPED CRACKS', croppedCracks);
          } catch (renderErr) {
            console.warn('[CameraPage2] drawBoxesOnImage failed', renderErr);
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
        console.warn('[CameraPage2] Failed to create withBoxes image', e);
        (entry as any).withBoxes = safeOriginal;
        (entry as any).boxes = [];
        (entry as any).detectionMessage = 'Box rendering failed';
      }
      //store image entry via image storage service, but only once per invocation
      if (!claimFinalization()) {
        console.warn('[CameraPage2] Skipping persist because processing was already finalized');
        return entry;
      }
      await this.imageStorage.addImage(entry, this.selectedSessionId || undefined);
      try {
        //add to current session in use and set sessioIsPristine to false, then refresh displayed images
        if (this.selectedSessionId && typeof (this.imageStorage.addImageToSession) === 'function') {
          this.imageStorage.addImageToSession(this.selectedSessionId, entry.filename);
          this.sessionIsPristine = false; // Mark session as no longer pristine
        }
      } catch (e) {
        console.warn('[CameraPage2] Failed to add parent image to session', e);
      }
      if (Array.isArray((entry as any).croppedCracks) && (entry as any).croppedCracks.length > 0) {
        const storedCroppedCracks = await this.persistCroppedCracksAsSessionImages((entry as any).croppedCracks, originalName || entry.fileImageName || entry.filename, entry.timestamp, userId, sessionImgIndex, originalId);
        (entry as any).croppedCracks = storedCroppedCracks;
        try {
          if (typeof (this.imageStorage as any).setEntryForImage === 'function') {
            (this.imageStorage as any).setEntryForImage(entry.filename, entry);
          }
        } catch (setErr) {
          console.warn('[CameraPage2] Failed to update stored parent entry with cropped cracks', setErr);
        }
      }
      // Debug: log the full entry after processing and storage
      console.log('[CameraPage2] processDataUrl saved entry:', entry);
      try {
        await this.refreshDisplayedImages();
      } catch (e) {
        console.warn('[CameraPage2] Failed to refresh display', e);
      }
      // Count only true new uploads/captures as session additions.
      if (bumpCounters) {
        this.imagesUploadedThisSession += 1;
      }
      // update UI counters from authoritative storage
      if (prediction) this.photosProcessed += 1;
      if (refreshCountsAfterSave) {
        await this.updatePhotoCounts();
      }
      await this.logCurrentSessionImageObjects();
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
        const safeOriginal = await this.shrinkDataUrlToBytes(dataUrl, maxBytes, 4000);
        const timestamp = new Date().toISOString();
        const generatedFilename = this.buildSessionFilename(false, timestamp, originalName, sessionImgIndex);
        const entry: StoredImage = {
          original: safeOriginal,
          timestamp,
          filename: generatedFilename,
          fileImageName: originalName || undefined,
          prediction: undefined,
          hasPrediction: false,
          statusMessage: inferenceAttempted ? 'Prediction failed' : 'No prediction',
          userId: userId,
          sessionId: this.selectedSessionId || undefined,
          original_id: originalId,
          cropped_id: originalId
        };
        try {
          if (!claimFinalization()) {
            console.warn('[CameraPage2] Skipping timeout fallback because processing was already finalized');
            return;
          }
          await this.imageStorage.addImage(entry, this.selectedSessionId || undefined);
          try {
            if (this.selectedSessionId && typeof (this.imageStorage.addImageToSession) === 'function') {
              this.imageStorage.addImageToSession(this.selectedSessionId, entry.filename);
              this.sessionIsPristine = false; // Mark session as no longer pristine
            }
            await this.refreshDisplayedImages();
          } catch (err) {
            console.warn('[CameraPage2] Failed to add timeout fallback image to session', err);
          }
          // Increment upload counter for this session
          this.imagesUploadedThisSession += 1;
          // update UI counters from authoritative storage
          await this.updatePhotoCounts();
          await this.logCurrentSessionImageObjects();
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

  private async persistCroppedCracksAsSessionImages(
    croppedCracks: Array<{ croppedNumber?: number; image: string; box: BoundingBox; type: string; shape: string; severity: string; }>,
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
      const croppedNumber = typeof crop.croppedNumber === 'number' ? crop.croppedNumber : index + 1;
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

      const safeCrop = await this.shrinkDataUrlToBytes(crop.image, 900_000, 4000);
      const cropEntry: StoredImage = {
        original: safeCrop,
        timestamp,
        filename: generatedFilename,
        fileImageName: `${baseName.replace(/\.[^.]+$/, '')}-crop-${croppedNumber}`,
        prediction: {
          type: crop.type,
          shape: crop.shape,
          severity: crop.severity,
        },
        hasPrediction: true,
        statusMessage: `Prediction succeeded - Cropped crack ${croppedNumber} prediction stored`,
        detectionMessage: `Stored cropped crack ${croppedNumber}`,
        boxes: [crop.box],
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

        storedCroppedCracks.push({
          ...crop,
          filename: cropEntry.filename,
          original_id: cropEntry.original_id,
          cropped_id: cropEntry.cropped_id,
          sessionImage: cropEntry,
        });
      } else {
        storedCroppedCracks.push({
          ...crop,
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

  async cropBoxFromImage(
    imageDataUrl: string,
    box: BoundingBox,
    maskW: number,
    maskH: number
  ): Promise<string> {
    const img = new Image();
    img.src = imageDataUrl;

    return new Promise(resolve => {
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

        // Add context around crack
        cropX = Math.max(0, cropX - padding);
        cropY = Math.max(0, cropY - padding);

        cropW = Math.min(imgW - cropX, cropW + padding * 2);
        cropH = Math.min(imgH - cropY, cropH + padding * 2);

        // Keep a 4:3 aspect ratio
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
    });
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
          this.photosProcessed = processed;
          this.photosTaken = imgs.length;
          this.storedImages = imgs;
        }
      } else {
        // No active session: fall back to global image list
        const all: StoredImage[] = await this.imageStorage.getAllImages();

        // Update counts based on all stored images
        this.photosTaken = Array.isArray(all) ? all.length : 0;
        this.photosProcessed = Array.isArray(all) ? all.filter(i => isProcessedStatus(i.statusMessage)).length : 0;
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
            const entry = this.storedImages && this.storedImages[si];
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

      const reprocessSelectedOverlayImage = async () => {
        const selectedImage = this.getSelectedOverlayImageData();
        if (!selectedImage) {
          console.warn('[CameraPage2] reprocessSelectedOverlayImage: no image selected');
          alert('No image selected to reprocess');
          return;
        }

        try {
          await this.processDataUrl(selectedImage.dataUrl, selectedImage.originalName);
        } catch (err) {
          console.warn('[CameraPage2] reprocessSelectedOverlayImage failed', err);
          alert('Failed to reprocess selected image. See console for details.');
        }
      };

      // Prefer storedImages (persisted) when available so we can toggle between original/withBoxes
      //checks if there is stored images and if so create thumbnails for each stored image
      // with onclick to select image. iterates over storedImages to create thumbnails
      if (this.storedImages && this.storedImages.length > 0) {
        this.storedImages.forEach((entry, idx) => {
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
            this.selectedImageTitle = this.getShortImageTitle(entry.filename || `Stored ${idx + 1}`);
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

      reprocessBtn.onclick = () => {
        void reprocessSelectedOverlayImage();
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

  async reprocessSelectedImage() {
    const selectedImage = this.getSelectedOverlayImageData();
    if (!selectedImage) {
      console.warn('[CameraPage2] reprocessSelectedImage: no image selected');
      alert('No image selected to reprocess');
      return;
    }

    try {
      const selectedKey = this.selectedImageSelectionKey || this.selectedThumbSrc || '';
      const originalEntry = this.storedImages.find(image => this.getImageSelectionKey(image) === selectedKey)
        || this.storedImages.find(image => image.original === selectedImage.dataUrl || image.withBoxes === selectedImage.dataUrl);
      const originalDeleteKey = originalEntry?.filename || originalEntry?.original || originalEntry?.withBoxes || selectedImage.dataUrl;
      const reprocessFilename = `reprocess-${Date.now()}.jpg`;

      // Reprocess first so the new image exists before deleting the original one.
      const reprocessedEntry = await this.processDataUrl(selectedImage.dataUrl, reprocessFilename, false, false, false);

      if (originalDeleteKey) {
        const removed = await this.imageStorage.deleteImage(originalDeleteKey);
        if (!removed && originalEntry?.original && originalEntry.original !== originalDeleteKey) {
          await this.imageStorage.deleteImage(originalEntry.original);
        }
      }

      await this.updatePhotoCounts();
      try {
        await this.loadStoredImages();
        await this.loadSessions();
        await this.refreshDisplayedImages();
      } catch (refreshErr) {
        console.warn('[CameraPage2] reprocessSelectedImage refresh failed', refreshErr);
      }

      this.selectedThumbSrc = (reprocessedEntry as any)?.original || selectedImage.dataUrl;
      this.selectedImageSelectionKey = (reprocessedEntry as any)?.filename || reprocessFilename;
      this.selectedImageTitle = (reprocessedEntry as any)?.filename || reprocessFilename;
    } catch (err) {
      console.warn('[CameraPage2] reprocessSelectedImage failed', err);
      alert('Failed to reprocess selected image. See console for details.');
    }
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


}
