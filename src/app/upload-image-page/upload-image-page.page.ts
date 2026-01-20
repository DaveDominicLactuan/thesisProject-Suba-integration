import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, ChangeDetectorRef } from '@angular/core';
import { Platform } from '@ionic/angular';
import { Router } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';

// NOTE: these services exist in the project workspace; keep imports as they are in repo
import { CrackDetectionService } from '../services/crack-detection.service';
import { ImageStorageService, StoredImage } from '../services/image-storage.service';
import { BoundingBox, BoxPrediction } from '../types';

// Capacitor/Camera/Filesystem imports (used conditionally in mobile flows)
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

export interface ScaledBox {
  x: number;
  y: number;
  w: number;
  h: number;
  original: BoundingBox;
}

console.log('CameraPagePage component file loaded');

@Component({
  selector: 'app-upload-image-page',
  templateUrl: './upload-image-page.page.html',
  styleUrls: ['./upload-image-page.page.scss'],
  standalone: false,
})
export class UploadImagePagePage implements AfterViewInit, OnDestroy {

  @ViewChild('video') videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('thumbScroll') thumbScrollRef!: ElementRef<HTMLElement>;

  imagePreview: string | null = null;
  capturedImages: string[] = [];
  // authoritative list of stored images pulled from ImageStorageService
  storedImages: StoredImage[] = [];
  usingFrontCamera = false;
  mediaStream: MediaStream | null = null;
  extraText: string | null = null;
  isProcessing: boolean = false;
  photosTaken = 0;
  photosProcessed = 0;
  savedImage: StoredImage | null = null;
  lastPrediction: BoxPrediction[] | null = null;

  // --- Gallery / testing helpers (from feedback-page) ---
  interfaceDisplayImageDummy = true; // harmless flag so source compiles when referencing DisplayImage

  // Small type inside the class to avoid import churn
  // DisplayImage: { original, withBoxes, fileName?, detectionMessage?, detectionResult?, rawPrediction?, statusMessage? }
  imagePaths: { original: string; withBoxes: string; fileName: string; rawPrediction: BoxPrediction[] }[] = [];
  showWithBoxes = false;
  selectedImage: string = '';
  selectedImageTitle: string = '';
  includeTestAssets = true; // set to false after testing to remove placeholder assets
  // debug panel and selected prediction
  showDebugPanel = false;
  selectedPrediction: BoxPrediction[] | null = null;
  selectedStatusMessage: string = '';

  scaledBoxes: ScaledBox[] = [];
  selectedThumbSrc: string | null = null;
  private _thumbScrollTimeout: any = null;
  // sessions list for session selection UI
  sessions: any[] = [];
  selectedSessionId: string | null = null;
  sessionIsPristine: boolean = false; // Tracks if current session has had images added during this visit
  imagesUploadedThisSession: number = 0; // Track number of images uploaded during this page visit
  totalBoundingBoxesCreated: number = 0; // Counter for cumulative bounding boxes across all images
  private backButtonSub: any; // hardware back handler

  get countdown() {
    return this.photosTaken - this.photosProcessed;
  }

  constructor(
    private platform: Platform,
    private router: Router,
    private sanitizer: DomSanitizer,
    private crackDetectionService: CrackDetectionService,
    private imageStorage: ImageStorageService,
    private cdr: ChangeDetectorRef
  ) {
  
    try {
      //whenever it detects an image selection change, update selected thumbnail src and other variables
      this.imageStorage.getCurrentImage$().subscribe(img => {
        if (img) {
          this.selectedThumbSrc = img.withBoxes ?? img.original;
          this.selectedImageTitle = img.filename ?? '';
        }
      });
    } catch (e) {
      // ignore if observable not present
    }
  }

  ngAfterViewInit() {
    this.platform.ready().then(() => {
       // Handle Android hardware back: prompt before discarding empty session

    //      if (this.backButtonSub) {
    //   try {
    //     this.backButtonSub.unsubscribe();
    //     this.backButtonSub = null;
    //   } catch (e) {
    //     console.warn('[UploadImagePage] failed to unsubscribe back button handler', e);
    //   }
    // }

       try {
        this.backButtonSub = this.platform.backButton.subscribeWithPriority(10, async () => {
          await this.handleExitToHome();
        });
      } catch (e) {
        console.warn('[UploadImagePage] failed to register hardware back handler', e);
      }

    
      // initialize page: load images, sessions and create a new session for this visit
      this.loadStoredImages()
        .then(() => this.loadSessions())
        .then(() => this.createSessionOnEnter())
        .catch(e => console.warn('[UploadImagePage] initialization failed', e));
    });
  }

  /** Load sessions from ImageStorageService (sync API) */
  async loadSessions() {
    try {
      // retrive the session and normalize to array
      const s = (this.imageStorage && typeof (this.imageStorage.getSessions) === 'function') ? this.imageStorage.getSessions() : [];
      this.sessions = Array.isArray(s) ? s.slice() : [];
    } catch (e) {
      //on any failure, log and ensure the sessions array is empty
      console.warn('[UploadImagePage] loadSessions failed', e);
      this.sessions = [];
    }
  }

  /** Create a new session for this visit and set it active */
  async createSessionOnEnter() {
    try {
      //Generate a human-friendly session name with current date/time.
      //Call the ImageStorageService to create a new session (empty image list). Fallback to null if API missing.
      const name = `Session ${new Date().toLocaleString()}`;
      const s = (this.imageStorage && typeof (this.imageStorage.createSession) === 'function') ? this.imageStorage.createSession(name, []) : null;

     //select session as current session, mark as pristine(new session or no images inside session), 
        //reset counter for uploaded images, abd refresh displayed images and records the newly 
        // created session with its id/name in the the serve as last created session
      if (s) {
        this.selectedSessionId = (s as any).id;
        this.sessionIsPristine = true; // Mark session as pristine (nothing added yet)

        //Try to call an optional setLastCreatedSession on the service to remember last 
        //session id/name; swallow errors if method missing or fails. 
        try { (this.imageStorage as any).setLastCreatedSession((s as any).id, (s as any).name); } catch {}
        
        //Refresh the local sessions array from storage so UI (session selector) includes the newly created session.
        await this.loadSessions();
        await this.refreshDisplayedImages();
        try { await this.updatePhotoCounts(); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      console.warn('[UploadImagePage] createSessionOnEnter failed', e);
    }
  }

  async refreshDisplayedImages() {
    //find session and load its image entries, and match imagePaths to the active session
    // session.imagekeys to storedimages using image storage and populate the storedImages
    // entry for image also allow for refresh the displayed 
    // images after new images are added or deleted
    try {
      if (this.selectedSessionId) {
        const session = this.sessions.find(s => s.id === this.selectedSessionId);
        if (session && Array.isArray(session.imageKeys) && session.imageKeys.length > 0) {
          const imgs: any[] = [];
          for (const k of session.imageKeys) {
            const e = (this.imageStorage as any).getEntryForImage ? (this.imageStorage as any).getEntryForImage(k) : undefined;
            if (e) imgs.push({ original: e.original, withBoxes: (e as any).withBoxes || e.original, fileName: e.filename, rawPrediction: e.predictions || [] });
          }
          this.imagePaths = imgs.concat([]);
        } else {
          this.imagePaths = [];
        }
      } else {
        const stored : StoredImage[] = await this.imageStorage.getAllImages();

        this.imagePaths = (Array.isArray(stored)
          ? stored.map((s: StoredImage) => ({
              original: s.original,
              withBoxes: (s as any).withBoxes || s.original,
              fileName: s.filename,
              rawPrediction: s.predictions || []
            }))
          : []
        ).concat([]);
      }
    } catch (e) {
      console.warn('[UploadImagePage] refreshDisplayedImages failed', e);
      try {
        const all = await this.imageStorage.getAllImages();
        this.imagePaths = Array.isArray(all)
          ? all.map((s: StoredImage) => ({
              original: s.original,
              withBoxes: (s as any).withBoxes || s.original,
              fileName: s.filename,
              rawPrediction: Array.isArray(s.prediction)
                ? s.prediction.map((p: any) => ({
                    x: p.x || 0,
                    y: p.y || 0,
                    w: p.w || 0,
                    h: p.h || 0,
                    type: p.type || '',
                    shape: p.shape || '',
                    severity: p.severity || '',
                    prediction: p.prediction || null
                  }))
                : []
            }))
          : [];
      } catch {
        this.imagePaths = [];
      }
    }
  }

  /** Called when a stored-image thumbnail is clicked */
  onStoredThumbClick(img: any) {
    //attempt to notify the servuce of the selectionm, calls the service to mark 
    // the image as selected, if API exist and error handling
    try {
      if (this.imageStorage && typeof this.imageStorage.selectImageByOriginal === 'function') {
        this.imageStorage.selectImageByOriginal(img.original);
      }
    } catch (e) {
      console.warn('onStoredThumbClick: selectImage failed', e);
    }
    // Respect the current toggle: show boxed version when toggled on, otherwise show original
    // update the selected thumbnail src and title with respect to the toggle, and auto-scroll to center
    this.selectedThumbSrc = this.showWithBoxes ? (img.withBoxes ?? img.original) : (img.original ?? img.withBoxes ?? '');
    this.selectedImageTitle = img.fileName ?? '';
    
    // Auto-scroll to center the selected thumbnail or item (Android Recent Apps style).  
    // after a short delay let the DOM update then center the clicked thumbnail in the scroller.
    setTimeout(() => this.scrollThumbnailIntoView(), 100);
  }

  /** Scroll the thumbnail carousel to center the selected item */
  private scrollThumbnailIntoView() {
    //get the container element for the thumbnail scroller(horizontal scroll area, bail if missing)
    const container = this.thumbScrollRef?.nativeElement as HTMLElement | undefined;
    if (!container) return;
    //Query thumbnail images (bail if none)
    const images = container.querySelectorAll('img');
    if (!images || images.length === 0) return;

    // Find the selected image element
    let selectedImg: HTMLImageElement | null = null;
    images.forEach(img => {
      const src = img.src || img.getAttribute('src');
      if (src === this.selectedThumbSrc) {
        selectedImg = img as HTMLImageElement;
      }
    });
    //bail if selected imgage not found
    if (!selectedImg) return;

    // Calculate scroll position to center the selected item
    const containerRect = container.getBoundingClientRect();
    const imgRect = (selectedImg as HTMLImageElement).getBoundingClientRect();
    
    // Current scroll position + offset to center
    const containerCenter = containerRect.width / 2;
    const imgCenter = imgRect.width / 2;
    const imgOffsetFromStart = imgRect.left - containerRect.left;
    const scrollNeeded = container.scrollLeft + imgOffsetFromStart + imgCenter - containerCenter;

    // Perform smooth scrolling animation to center the thumbnail
    container.scrollTo({
      left: scrollNeeded,
      behavior: 'smooth'
    } as ScrollToOptions);
  }

  /** Initialize live camera feed */
  async initCamera() {
    try {
      // Stop existing stream if any
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
      }

      // Request camera permissions first
      await this.requestCameraPermission();

      // Get camera constraints
      const constraints = {
        video: {
          facingMode: this.usingFrontCamera ? 'user' : 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };

      // Get media stream
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Attach to video element
      const video = this.videoRef?.nativeElement;
      if (video) {
        video.srcObject = this.mediaStream;
        await video.play();
        console.log('Camera initialized successfully');
      }
    } catch (error) {
      console.error('Failed to initialize camera:', error);
      alert('Camera access denied or not available. Please check permissions.');
    }
  }

  
  /** Mobile image picker — attempts Capacitor Photos API, 
   * falls back to camera pick single file */
  async pickImagesMobile() {
    try {
      //open the device photo picker and return a Base64 image.
      const photo = await Camera.getPhoto({ quality: 80, allowEditing: false, resultType: CameraResultType.Base64, source: CameraSource.Photos });
      //build a standard data:image/jpeg;base64,... URL the rest of the code can consume.
      if (photo && photo.base64String) {
        const dataUrl = `data:image/jpeg;base64,${photo.base64String}`;
        //call processDataUrl to run inference/store 
        //the image but race it against a 10s timeout to avoid hanging.
        try {
          await Promise.race([this.processDataUrl(dataUrl, `mobile-${Date.now()}.jpg`), new Promise((_, rej) => setTimeout(() => rej(new Error('processing-timeout')), 10_000))]);
        } catch (e) {
          //catch and log failures from the Camera API or any unexpected errors.
          console.warn('[UploadImagePage] pickImagesMobile: processing failed or timed out', e);
        }
      }
    } catch (e) {
      console.warn('pickImagesMobile failed', e);
    }
  }

  /** Process a File object: convert to dataURL, preprocess, run inference, store, and update gallery */
  async processFile(file: File) {
    const reader = new FileReader();
    const dataUrl: string = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await this.processDataUrl(dataUrl, file.name);
  }

  private async cropImage(imageDataUrl: string, box: BoundingBox): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = box.w;
        canvas.height = box.h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
          resolve(canvas.toDataURL());
        } else {
          resolve(imageDataUrl);
        }
      };
      img.src = imageDataUrl;
    });
  }

  private getImageDimensions(dataUrl: string): Promise<{width: number, height: number}> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  /** Helper to process a data URL (image) — runs inference and stores the image */
  async processDataUrl(dataUrl: string, filename: string, bumpCounters: boolean = true) {
    this.capturedImages.unshift(dataUrl);
    if (bumpCounters) this.photosTaken += 1;
    this.isProcessing = true;

    let inferenceAttempted = false;

    const boxPredictions: BoxPrediction[] = [];

    // Create the StoredImage entry first (TS happy)
    const entry: StoredImage & { predictions: BoxPrediction[] } = {
      original: dataUrl,
      timestamp: new Date().toISOString(),
      filename,
      hasPrediction: false,
      statusMessage: 'No prediction',
      predictions: boxPredictions
    };

    const doWork = async () => {
      let prediction: any = null;

      try {
        const tensor = await this.preprocessImage(dataUrl);
        const { width, height } = await this.getImageDimensions(dataUrl);
        const inferenceTimeoutMs = 20_000;

        try {
          inferenceAttempted = true;
          prediction = await Promise.race([
            this.crackDetectionService.runInference(tensor, width, height),
            new Promise((_, rej) =>
              setTimeout(() => rej(new Error('inference-timeout')), inferenceTimeoutMs)
            )
          ]);
        } catch (infErr) {
          console.warn('[CameraPage2] Inference error/timeout', infErr);
          prediction = null;
        }
      } catch (e) {
        console.warn('[CameraPage2] Preprocessing/inference failed', e);
      }

      entry.hasPrediction = !!prediction;
      entry.statusMessage = prediction
        ? 'Prediction succeeded'
        : inferenceAttempted
        ? 'Prediction failed'
        : 'No prediction';

      if (prediction && Array.isArray(prediction.boxes) && prediction.boxes.length > 0) {
        // Ensure all boxes are typed correctly
        const boxes: BoundingBox[] = prediction.boxes.map((b: any) => ({
          x: Number(b.x) || 0,
          y: Number(b.y) || 0,
          w: Number(b.w) || 0,
          h: Number(b.h) || 0,
          type: b.type || 'unknown',
          shape: b.shape || 'unknown',
          severity: b.severity || 'unknown'
        }));

        for (const box of boxes) {
          try {
            const croppedDataUrl = await this.cropImage(dataUrl, box);
            const boxTensor = await this.preprocessImage(croppedDataUrl);
            const rawBoxPred = await this.crackDetectionService.runInference(boxTensor, box.w, box.h);
            const safePred = rawBoxPred
              ? {
                  type: (rawBoxPred as any).type || '',
                  shape: (rawBoxPred as any).shape || '',
                  severity: (rawBoxPred as any).severity || ''
                }
              : null;

            boxPredictions.push({
              x: box.x,
              y: box.y,
              w: box.w,
              h: box.h,
              type: box.type || '',
              shape: box.shape || '',
              severity: box.severity || '',
              prediction: safePred
            });

          } catch (err) {
            console.warn('[UploadImagePage] Box classification failed', err);
            boxPredictions.push({
              x: box.x,
              y: box.y,
              w: box.w,
              h: box.h,
              type: box.type || '',
              shape: box.shape || '',
              severity: box.severity || '',
              prediction: null
            });
          }
        }

        try {
          const withBoxesDataUrl = await this.drawBoxesOnImage(dataUrl, boxes);
          (entry as any).withBoxes = withBoxesDataUrl;
          (entry as any).boxes = boxes;
          (entry as any).detectionMessage = `Rendered ${boxes.length} prediction box(es)`;
          this.totalBoundingBoxesCreated += boxes.length;
        } catch (renderErr) {
          console.warn('[CameraPage2] drawBoxesOnImage failed', renderErr);
          (entry as any).withBoxes = dataUrl;
          (entry as any).boxes = boxes;
          (entry as any).detectionMessage = 'Box rendering failed';
        }

        this.extraText = boxPredictions
          .map((b: BoxPrediction, idx: number) => `Box ${idx + 1}: ${b.type}, ${b.shape}, ${b.severity}`)
          .join(' | ');

        this.lastPrediction = boxPredictions.length > 0 ? boxPredictions : null;
      } else {
        (entry as any).withBoxes = dataUrl;
        (entry as any).boxes = [];
        (entry as any).detectionMessage = 'No boxes detected';
        this.extraText = '✅ No boxes detected';
        this.lastPrediction = null;
      }

      await this.imageStorage.addImage(entry);

      try {
        if (this.selectedSessionId && typeof this.imageStorage.addImageToSession === 'function') {
          this.imageStorage.addImageToSession(this.selectedSessionId, entry.original);
          this.sessionIsPristine = false;
        }
        await this.refreshDisplayedImages();
      } catch (e) {
        console.warn('[CameraPage2] Failed to add image to session or refresh display', e);
      }

      this.imagesUploadedThisSession += 1;
      if (prediction) this.photosProcessed += 1;
      await this.updatePhotoCounts();
    };

    const overallTimeoutMs = 10_000;
    try {
      await Promise.race([
        doWork(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('processing-timeout')), overallTimeoutMs))
      ]);
    } catch (err: any) {
      console.warn('[CameraPage2] processDataUrl timed out or failed', err);
    } finally {
      this.isProcessing = false;
      this.logBoundingBoxStats();
    }
  }
  
  /**
   * Draw bounding boxes on the supplied Base64 image and return a new Base64 image.
   * Boxes are expected in mask coordinates; maskW/maskH indicate mask resolution so boxes
   * can be scaled to the image natural size.
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
        ctx.lineWidth = Math.max(2, Math.round(Math.max(canvas.width, canvas.height) / 400));
        ctx.strokeStyle = 'red';
         //computes the scaling model mask coordinates to image pixel coordinates
        const scaleX = maskW > 0 ? canvas.width / maskW : 1;
        const scaleY = maskH > 0 ? canvas.height / maskH : 1;
        //draw each box on the canvas
        boxes.forEach(b => {
          const x = Math.round(b.x * scaleX);
          const y = Math.round(b.y * scaleY);
          const w = Math.round(b.w * scaleX);
          const h = Math.round(b.h * scaleY);
          ctx.strokeRect(x, y, w, h);
        });

        // Increment total bounding box counter and log
        this.totalBoundingBoxesCreated += boxes.length;
        console.log(`📦 Bounding boxes drawn: ${boxes.length} | 📊 Total cumulative boxes: ${this.totalBoundingBoxesCreated}`);

        resolve(canvas.toDataURL('image/png'));
      };
      if (img.complete && img.naturalWidth) img.onload!(null as any);
    });
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
   * Produce Float32 tensor [1,3,128,128] normalized to [-1,1] from a dataUrl.
   * Used by upload flows prior to inference.
   */
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
      const r = imageData.data[i * 4 + 0] / 255.0;
      const g = imageData.data[i * 4 + 1] / 255.0;
      const b = imageData.data[i * 4 + 2] / 255.0;
      // CHW order
      data[i] = r;
      data[128 * 128 + i] = g;
      data[2 * 128 * 128 + i] = b;
    }

    return data;
  }

  // Small helper to yield to the event loop so UI can repaint (spinner animations)
  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
    try {
      const params: any = {};
      if (this.selectedSessionId) params.sessionId = this.selectedSessionId;
      this.router.navigate(['/feedback-page'], { queryParams: params });
      console.log('Navigating to Feedback page', params);
    } catch (e) {
      console.warn('goToFeedBackPage navigation failed', e);
      this.router.navigate(['/feedback-page']);
    }
  }

  goToHomePage() {
    this.handleGoHome();
  }

  private async handleGoHome() {
    try {
      // Check if active session exists and no images were uploaded during this visit
      if (this.selectedSessionId && this.imagesUploadedThisSession === 0) {
        const shouldDelete = await this.showSessionEmptyPopup();
        if (shouldDelete === 'delete') {
          // Delete the empty session and navigate home
          if (typeof (this.imageStorage.removeSession) === 'function') {
            this.imageStorage.removeSession(this.selectedSessionId);
          }
          this.router.navigate(['/home-page']);
        } else if (shouldDelete === 'stay') {
          // User wants to stay, do nothing
          console.log('User chose to stay in upload-image page');
          return;
        } else if (shouldDelete === null) {
          // User clicked outside - cancel and stay on page
          console.log('User cancelled popup - staying on page');
          return;
        }
      } else {
        // Session has images or no active session, navigate normally
        this.router.navigate(['/home-page']);
      }
    } catch (e) {
      console.warn('handleGoHome failed', e);
      this.router.navigate(['/home-page']);
    }
  }

  private showSessionEmptyPopup(): Promise<'delete' | 'stay' | null> {
    return new Promise((resolve) => {
      const html = `
        <div style="
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0,0,0,0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
        ">
          <div style="
            background: #fff;
            border-radius: 12px;
            padding: 24px;
            max-width: 90%;
            width: 320px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.2);
          ">
            <div style="
              font-size: 18px;
              font-weight: 600;
              color: #000;
              margin-bottom: 12px;
              text-align: center;
            ">Empty Session</div>
            <div style="
              font-size: 14px;
              color: #666;
              margin-bottom: 20px;
              text-align: center;
            ">
              This session has no images. Would you like to delete it and go back to home?
            </div>
            <div style="
              display: flex;
              gap: 12px;
              justify-content: center;
            ">
              <button style="
                flex: 1;
                padding: 10px;
                border: 1px solid #ddd;
                border-radius: 8px;
                background: #f5f5f5;
                color: #000;
                font-size: 14px;
                cursor: pointer;
              " onclick="window.__popupResult('stay')">
                Continue Session
              </button>
              <button style="
                flex: 1;
                padding: 10px;
                border: none;
                border-radius: 8px;
                background: linear-gradient(to right, #ff512f, #f09819);
                color: #fff;
                font-size: 14px;
                cursor: pointer;
              " onclick="window.__popupResult('delete')">
                Delete & Go Home
              </button>
            </div>
          </div>
        </div>
      `;

      const container = document.createElement('div');
      container.innerHTML = html;
      document.body.appendChild(container);

      (window as any).__popupResult = (result: 'delete' | 'stay') => {
        document.body.removeChild(container);
        resolve(result);
      };

      // Auto-cancel if user clicks outside (on the backdrop)
      setTimeout(() => {
        const backdrop = container.firstElementChild as HTMLElement;
        if (backdrop) {
          backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
              document.body.removeChild(container);
              resolve(null);
            }
          });
        }
      }, 0);
    });
  }

  onBoxClick(box: any) {
    // Your bounding box logic
  }

  async requestCameraPermission() {
    // Only request Capacitor Camera permissions on native platforms.
    try {
      if (Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios') {
        await Camera.requestPermissions();
      }
    } catch (error) {
      console.warn('Camera permission request error', error);
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
    
    // Unsubscribe from hardware back button to disconnect custom behavior
    if (this.backButtonSub) {
      try {
        this.backButtonSub.unsubscribe();
        this.backButtonSub = null;
      } catch (e) {
        console.warn('[UploadImagePage] failed to unsubscribe back button handler', e);
      }
    }
  }

  async goBack() {
    await this.handleExitToHome();
  }

  // shim so templates can call onBack()
  onBack() {
    this.goBack();
  }

  
  /** Navigate home; if active session is empty, offer discard-or-stay overlay */
  private async handleExitToHome() {
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

    try {
      this.router.navigateByUrl('/home-page');
    } catch (e) {
      window.history.back();
    }
  }

  
  /** Simple overlay appended to DOM offering discard-or-stay when session is empty */
  private showExitOverlay(): Promise<'discard' | 'stay' | null> {
    return new Promise(resolve => {
      //builds the full-screen semi-opaque backdrop element.
      const backdrop = document.createElement('div');
      backdrop.style.position = 'fixed';
      backdrop.style.top = '0';
      backdrop.style.left = '0';
      backdrop.style.width = '100%';
      backdrop.style.height = '100%';
      backdrop.style.background = 'rgba(0,0,0,0.55)';
      backdrop.style.display = 'flex';
      backdrop.style.alignItems = 'center';
      backdrop.style.justifyContent = 'center';
      backdrop.style.zIndex = '9999';

      //Create modal container — centered white card that holds content and actions.
      const modal = document.createElement('div');
      modal.style.background = '#fff';
      modal.style.borderRadius = '12px';
      modal.style.padding = '20px';
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
      desc.textContent = 'This session has no images. Delete it and return home or stay here to continue.';
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
      // stayBtn.style.background = '#f5f5f5';
      stayBtn.style.background = 'linear-gradient(90deg,#ff512f,#f09819)';
      stayBtn.style.color = '#fff';
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

   //load test assets for testing
  loadTestAssets() {
    try {
      const base = 'assets/icon/';
      const items = [
        {
          original: base + 'sample1.jpg',
          withBoxes: base + 'sample1.jpg',
          fileName: 'sample1.jpg',
          rawPrediction: [] as BoxPrediction[]
        },
        {
          original: base + 'sample2.jpg',
          withBoxes: base + 'sample2.jpg',
          fileName: 'sample2.jpg',
          rawPrediction: [] as BoxPrediction[]
        }
      ];

      this.imagePaths = items.concat(this.imagePaths);
    } catch (e) {
      console.warn('Could not load test assets', e);
    }
  }

  
  /** Load all StoredImage entries from the ImageStorageService and update local list */
  /**
   * Load all stored images from ImageStorageService; keep UI selection in sync.
   */
  async loadStoredImages() {
    try {
      const stored: StoredImage[] = await this.imageStorage.getAllImages();

      this.imagePaths = stored.map(s => {
        const rawPrediction: BoxPrediction[] = s.prediction
          ? [{
              x: 0,
              y: 0,
              w: 1,
              h: 1,
              type: s.prediction.type,
              shape: s.prediction.shape,
              severity: s.prediction.severity,
              prediction: {
                type: s.prediction.type,
                shape: s.prediction.shape,
                severity: s.prediction.severity
              }
            }]
          : [];

        return {
          original: s.original,
          withBoxes: s.withBoxes ?? s.original,
          fileName: s.filename,
          rawPrediction
        };
      }).concat(this.imagePaths);

      await this.updatePhotoCounts();
    } catch (e) {
      console.warn('[UploadImagePage] loadStoredImages failed', e);
    }
  }

  toggleDebugPanel() {
    this.showDebugPanel = !this.showDebugPanel;
    if (this.showDebugPanel) {
      // populate debug panel with last prediction
      this.selectedPrediction = this.lastPrediction;
    }
  }

  onThumbnailScroll(event: any) {
    // debounce so the UI isn't overloaded while scrolling
    //Cancel previous debounce and stop any pending 
    // timeout so rapid scroll events don't queue multiple handlers.
    try { clearTimeout(this._thumbScrollTimeout); } catch (e) {}
    //Schedule center-detection after scrolling (debounce)
    //set a short delay and call detectCenterThumbnail once scrolling settles.
    this._thumbScrollTimeout = setTimeout(() => this.detectCenterThumbnail(), 100);
  }

  
  detectCenterThumbnail() {
    //Get container element and image nodes
    //Purpose: locate the thumbnail container and the img elements; bail out if missing.
    const container = this.thumbScrollRef?.nativeElement as HTMLElement | undefined;
    if (!container) return;
    const images = container.querySelectorAll('img');
    if (!images || images.length === 0) return;

   //Compute center X of the container
   //Purpose: get the horizontal center coordinate to compare image centers against.
    const containerRect = container.getBoundingClientRect();
    const centerX = containerRect.left + containerRect.width / 2;

   //Find the image whose center is closest to container center
   //Purpose: iterate thumbnails, compute each center and distance, and track the closest.
    let closestImg: HTMLImageElement | null = null;
    let closestDistance = Infinity;

    images.forEach(i => {
      const rect = i.getBoundingClientRect();
      const imgCenter = rect.left + rect.width / 2;
      const distance = Math.abs(centerX - imgCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestImg = i as HTMLImageElement;
      }
    });

    //Bail if no closest image found, otherwise read its src and set selection
    //Purpose: obtain the image source and update selectedThumbSrc.
    if (!closestImg) return;
    const imgEl: any = closestImg;
    const src = (imgEl && (imgEl.src || (imgEl.getAttribute && imgEl.getAttribute('src')))) || '';
    this.selectedThumbSrc = src;
    
    //Resolve a title from stored images or captured images
    //Purpose: map the src to a friendly filename/title, fallback to captured index or src.
    // Try to find a title from imagePaths (stored images) else fallback to a captured index
    const matched = this.imagePaths.find((p: any) => p.original === src || p.withBoxes === src);
    let title = '';
    if (matched) {
      title = matched.fileName ?? '';
    } else {
      const idx = this.capturedImages.indexOf(src);
      title = idx >= 0 ? `Captured ${idx + 1}` : src;
    }

    this.selectedImageTitle = title;
    console.log('[UploadImagePage] Center thumbnail selected:', { title, src });
  }

  /**
    Helper to apply centering classes to the thumbnail scroller based on item count.
    - single-thumb: center a lone item
    - double-thumb: add symmetric padding so two items sit in center viewport
   */
  getThumbClasses(count: number) {
    return {
      'single-thumb': count === 1,
      'double-thumb': count === 2,
    };
  }

  /**
   * Refresh photosTaken/photosProcessed counters from persistent storage.
   */
  async updatePhotoCounts() {
    try {
      let allImages: StoredImage[] = [];

      if (this.selectedSessionId) {
        // Compute from session image keys if session exists
        if (!this.sessions || this.sessions.length === 0) {
          try { await this.loadSessions(); } catch {}
        }

        const session = this.sessions.find(s => s.id === this.selectedSessionId) ?? null;

        if (!session || !Array.isArray(session.imageKeys)) {
          this.photosTaken = 0;
          this.photosProcessed = 0;
          this.storedImages = [];
          this.imagePaths = [];
        } else {
          const imgs: StoredImage[] = [];
          let processedCount = 0;

          for (const key of session.imageKeys) {
            let entry: StoredImage | undefined;

            // Try getting image from storage service
            if (typeof this.imageStorage.getEntryForImage === 'function') {
              const maybe = this.imageStorage.getEntryForImage(key);
              entry = maybe instanceof Promise ? await maybe : maybe;
            } else {
              const all = await this.imageStorage.getAllImages();
              entry = all.find(img => img.original === key || img.withBoxes === key);
            }

            if (entry) {
              // Ensure hasPrediction is boolean
              entry.hasPrediction = !!entry.hasPrediction;
              // Ensure predictions is array
              entry.predictions = Array.isArray(entry.predictions) ? entry.predictions : [];
              entry.prediction = entry.predictions?.[0]?.prediction || undefined;
              imgs.push(entry);
              if (entry.statusMessage === 'Prediction succeeded') processedCount++;
            }
          }

          this.photosTaken = imgs.length;
          this.photosProcessed = processedCount;
          this.storedImages = imgs;
          allImages = imgs;
        }
      } else {
        // No session, get all images from storage
        const all: StoredImage[] = await this.imageStorage.getAllImages();
        allImages = Array.isArray(all) ? all : [];
        this.photosTaken = allImages.length;
        this.photosProcessed = allImages.filter(img => img.statusMessage === 'Prediction succeeded').length;
        this.storedImages = allImages.slice();
      }

      // Map to UI-friendly array
      this.imagePaths = allImages.map((s: StoredImage) => ({
        original: s.original,
        withBoxes: s.withBoxes ?? s.original,
        fileName: s.filename,
        rawPrediction: s.prediction
          ? (Array.isArray(s.prediction) ? s.prediction : [s.prediction]).map(p => ({
              x: (p as any).x ?? 0,
              y: (p as any).y ?? 0,
              w: (p as any).w ?? 0,
              h: (p as any).h ?? 0,
              type: p.type ?? '',
              shape: p.shape ?? '',
              severity: p.severity ?? '',
              prediction: (p as any).prediction ?? null,
            }))
          : [],
      }));

      console.log('[UploadImagePage] updatePhotoCounts:', {
        photosTaken: this.photosTaken,
        photosProcessed: this.photosProcessed
      });
    } catch (e) {
      console.warn('[UploadImagePage] updatePhotoCounts failed', e);
    }
  }

  /**
   * Delete the currently-selected thumbnail/image from storage and UI.
   */
  async deleteSelectedImage() {
    //ensure an image is selected
    const src = this.selectedThumbSrc || this.selectedImage || '';
    if (!src) {
      console.warn('[UploadImagePage] deleteSelectedImage: no image selected');
      alert('No image selected to delete');
      return;
    }

    // find in imagePaths (stored images) first, delete logic
    // If the selected thumbnail maps to a stored/persisted 
    // image, remove it via the ImageStorageService
    const idx = this.imagePaths.findIndex((p: any) => p.original === src || p.withBoxes === src);
    const capturedIdx = this.capturedImages.indexOf(src);
    //compute human filename for prompt and ask user to confirm.
    //Resolve display filename and confirm deletion
    const filename = idx !== -1 ? (this.imagePaths[idx].fileName ?? '(unnamed)') : (capturedIdx !== -1 ? `Captured ${capturedIdx + 1}` : src);
    const confirmMsg = `Delete image "${filename}"? This action cannot be undone.`;
    if (!confirm(confirmMsg)) return;

    try {
      // determine a canonical original key to pass to storage (handle withBoxes URLs)
      //Determine canonical original key for storage operations
      let canonical = src;
      if (idx !== -1 && this.imagePaths[idx] && this.imagePaths[idx].original) {
        canonical = this.imagePaths[idx].original;
      } else {
        const found = this.imagePaths.find((p: any) => p.withBoxes === src || p.original === src);
        if (found && found.original) canonical = found.original;
      }

      // attempt to remove from persistent storage (if present) via canonical API
      //call storage API to delete image (if available), in case of failures.
      let removed = false;
      try {
        removed = await (this.imageStorage as any).deleteImage(canonical);
      } catch (e) {
        console.warn('[UploadImagePage] persistent remove attempt failed', e);
        removed = false;
      }

      // Always remove any matching local in memory references (guard against stale in-memory state)
      //Purpose: remove any matching entries from imagePaths and capturedImages and refresh arrays.
      try {
        this.imagePaths = this.imagePaths.filter((p: any) => !(p.original === canonical || p.withBoxes === canonical || p.original === src || p.withBoxes === src));
        this.capturedImages = this.capturedImages.filter(c => !(c === canonical || c === src));
        // ensure change detection picks up the new arrays
        this.imagePaths = this.imagePaths.concat([]);
        this.capturedImages = this.capturedImages.concat([]);
      } catch (e) {
        console.warn('[UploadImagePage] local cleanup after delete failed', e);
      }

      // update counters after deletion and refresh authoritative storedImages/imagePaths
      //refresh photo counts and reload sessions/images after deletion.
      await this.updatePhotoCounts();
      // sessions may have changed; reload sessions and refresh session-scoped display
      try { await this.loadSessions(); await this.refreshDisplayedImages(); } catch (e) { /* ignore */ }

      // reset selection to first available thumbnail
      //pick a new selected thumbnail or clear selection if nothing left.
      //Reset selection to a remaining thumbnail (or clear)
      if (this.capturedImages.length > 0) {
        // pick center or first
        setTimeout(() => this.detectCenterThumbnail(), 60);
      } else if (this.imagePaths.length > 0) {
        const first = this.imagePaths[0];
        this.selectedThumbSrc = this.showWithBoxes ? first.withBoxes : first.original;
        this.selectedImageTitle = first.fileName ?? '';
      } else {
        // nothing left
        this.selectedThumbSrc = null;
        this.selectedImageTitle = '';
      }
      //emit success log; catch block notifies user and logs failure.
      console.log(`[UploadImagePage] deleteSelectedImage: removed ${filename}. Remaining capturedImages: ${this.capturedImages.length}, stored images: ${this.imagePaths.length}`);
    } catch (err) {
      console.error('[UploadImagePage] deleteSelectedImage failed', err);
      alert('Failed to delete image. See console for details.');
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input) return;
    const files = input.files;
    if (!files || files.length === 0) return;

    // Process multiple files sequentially to avoid overwhelming the device
    const fileArray = Array.from(files);
    (async () => {
      for (const f of fileArray) {
        await this.processFile(f);
      }
    })();
  }

  async takePicture() {
    this.isProcessing = true;
    await this.sleep(50); // allow spinner render
    try { this.cdr.detectChanges(); } catch {}

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
      setTimeout(() => this.detectCenterThumbnail(), 60);

      const work = async () => {
        const now = new Date().toISOString();
        let storedCount = 0;
        try {
          const all = await this.imageStorage.getAllImages();
          storedCount = Array.isArray(all) ? all.length : 0;
        } catch { storedCount = this.photosTaken || 0; }

        const filename = this.generateFilename(storedCount + 1);

        const entry: StoredImage = {
          original: dataUrl,
          timestamp: now,
          filename,
          hasPrediction: false,
          statusMessage: '',
          predictions: []
        };

        let fullPrediction: BoundingBox[] = [];
        try {
          inferenceCalled = true;
          const imageTensor = await this.preprocessImage(dataUrl);
          const { width, height } = await this.getImageDimensions(dataUrl);
          const result = await this.crackDetectionService.runInference(imageTensor, width, height);

          if (result?.boxes && result.boxes.length > 0) {
            fullPrediction = result.boxes.map((b: any) => ({
              x: Number(b.x) || 0,
              y: Number(b.y) || 0,
              w: Number(b.w) || 0,
              h: Number(b.h) || 0,
              type: b.type || '',
              shape: b.shape || '',
              severity: b.severity || ''
            }));
          }
        } catch (e) {
          console.warn('[UploadImagePage] Full image inference failed', e);
        }

        for (let box of fullPrediction) {
          try {
            const croppedDataUrl = await this.cropImage(dataUrl, box);
            const boxTensor = await this.preprocessImage(croppedDataUrl);
            const boxResult = await this.crackDetectionService.runInference(boxTensor, box.w, box.h);
            const boxPred = boxResult.boxes[0]?.prediction || null;

            const boxPrediction: BoxPrediction = {
              ...box,
              prediction: boxPred
            };
            entry.predictions!.push(boxPrediction);
          } catch (err) {
            console.warn('[UploadImagePage] Box classification failed', err);
            entry.predictions!.push({
              ...box,
              prediction: null
            });
          }
        }

        inferenceSucceeded = entry.predictions!.some((p: BoxPrediction) => !!p.prediction);

        entry.prediction = entry.predictions!.find(p => p.prediction)?.prediction || undefined;

        try {
          const maskW = canvas.width;
          const maskH = canvas.height;
          entry.withBoxes = fullPrediction.length > 0
            ? await this.drawBoxesOnImage(dataUrl, fullPrediction, maskW, maskH)
            : dataUrl;
        } catch (drawErr) {
          console.warn('[UploadImagePage] drawBoxesOnImage failed', drawErr);
          entry.withBoxes = dataUrl;
        }

        entry.hasPrediction = inferenceSucceeded;
        entry.statusMessage = inferenceSucceeded
          ? 'Prediction succeeded'
          : (inferenceCalled ? 'Prediction failed' : 'No prediction');

        await this.imageStorage.addImage(entry);

        if (this.selectedSessionId && typeof this.imageStorage.addImageToSession === 'function') {
          this.imageStorage.addImageToSession(this.selectedSessionId, entry.original);
          this.sessionIsPristine = false;
        }

        await this.refreshDisplayedImages();
        await this.updatePhotoCounts();

        this.savedImage = entry;
        this.lastPrediction = entry.predictions && entry.predictions.length ? entry.predictions : null;

        return entry;
      };

      try {
        await Promise.race([
          work(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('processing-timeout')), 10_000))
        ]);
      } catch (err: any) {
        if (err.message === 'processing-timeout') {
          console.warn('[UploadImagePage] takePicture timed out');
          const fallbackFilename = this.generateFilename((this.photosTaken || 0) + 1);
          const fallbackEntry: StoredImage = {
            original: dataUrl,
            timestamp: new Date().toISOString(),
            filename: fallbackFilename,
            hasPrediction: false,
            statusMessage: 'Timeout',
            predictions: []
          };
          await this.imageStorage.addImage(fallbackEntry);
          await this.updatePhotoCounts();
        } else {
          console.error('takePicture error:', err);
        }
      }

      this.selectedStatusMessage = inferenceSucceeded
        ? 'Prediction succeeded'
        : (inferenceCalled ? 'Prediction failed' : 'No prediction performed');

      console.log('Predictions stored:', this.lastPrediction);

    } catch (err) {
      console.error('takePicture error', err);
    } finally {
      this.isProcessing = false;
      this.logBoundingBoxStats();
    }
  }
}

// Small helper type used in class
// interface ScaledBox {
//   x: number;
//   y: number;
//   w: number;
//   h: number;
//   original: BoundingBox;
// }
