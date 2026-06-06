
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, ChangeDetectorRef } from '@angular/core';
import { Platform } from '@ionic/angular';
import { Router } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';

// NOTE: these services exist in the project workspace; keep imports as they are in repo
import { CrackDetectionService } from '../services/crack-detection.service';
import { ImageStorageService, StoredImage } from '../services/image-storage.service';

// Capacitor/Camera/Filesystem imports (used conditionally in mobile flows)
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

// Basic bounding box types used in drawing helper
interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface QueueItem {
  dataUrl: string;
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
  fastApiConnection: boolean = false;
  photosTaken = 0;
  private _photosProcessed = 0;
  // transient flag to show a short glow when a photo finishes processing
  processedGlowActive: boolean = false;
  private _processedGlowTimer?: any;
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
  lastPrediction: { type: string; shape: string; severity: string } | null = null;

  // --- Gallery / testing helpers (from feedback-page) ---
  interfaceDisplayImageDummy = true; // harmless flag so source compiles when referencing DisplayImage

  // Small type inside the class to avoid import churn
  // DisplayImage: { original, withBoxes, fileName?, detectionMessage?, detectionResult?, rawPrediction?, statusMessage? }
  imagePaths: Array<any> = []; // populated from stored images or test assets
  showWithBoxes = false;
  selectedImage: string = '';
  selectedImageTitle: string = '';
  private selectedImageSelectionKey: string = '';
  includeTestAssets = true; // set to false after testing to remove placeholder assets
  // debug panel and selected prediction
  showDebugPanel = false;
  selectedPrediction: { type?: string; shape?: string; severity?: string } | null = null;
  selectedStatusMessage: string = '';

  scaledBoxes: ScaledBox[] = [];
  selectedThumbSrc: string | null = null;
  private _thumbScrollTimeout: any = null;

  get selectedImageKey(): string {
    return this.selectedImageSelectionKey || this.selectedThumbSrc || this.selectedImage || '';
  }

  getImageSelectionKey(img: any, index?: number): string {
    if (!img) return typeof index === 'number' ? `item-${index}` : '';
    if (img.filename) return img.filename;
    if (img.fileName) return img.fileName;
    if (img.key) return img.key;
    if (typeof index === 'number') {
      return img.original === img.withBoxes ? `item-${index}` : `item-${index}-${img.original || img.withBoxes || ''}`;
    }
    return img.original || img.withBoxes || '';
  }
  // sessions list for session selection UI
  sessions: any[] = [];
  selectedSessionId: string | null = null;
  sessionIsPristine: boolean = false; // Tracks if current session has had images added during this visit
  imagesUploadedThisSession: number = 0; // Track number of images uploaded during this page visit
  totalBoundingBoxesCreated: number = 0; // Counter for cumulative bounding boxes across all images
  private imageRecordCounter = 0;
  // Process Window state
  isProcessWindowOpen: boolean = false;
  private backButtonSub: any; // hardware back handler
private imageQueue: QueueItem[] = [];
private isQueueProcessing: boolean = false;
  apiMessage: string = 'Loading...';
  apiStatus: string = '';
  boxes: { w: number; h: number; x: number; y: number }[] = [];
private apiUrl = 'https://your-vscode-forwarded-url.app.github.dev/';
apiUrlWeb = 'http://127.0.0.1:8000/';
apiUrlWeb2 = 'http://127.0.0.1:8000/helloWorld';
// private baseUrl = 'http://127.0.0.1:8000'; 
private baseUrl = 'https://16z6llmg-8000.asse.devtunnels.ms';
  uploadedImageUrl: string = '';
  selectedFile: File | null = null;

  get countdown() {
    return this.photosTaken - this.photosProcessed;
  }

  private generateImageRecordId(prefix: 'original' | 'cropped'): string {
    this.imageRecordCounter += 1;
    return `${prefix}-${Date.now()}-${this.imageRecordCounter}`;
  }

  constructor(
    private platform: Platform,
    private router: Router,
    private sanitizer: DomSanitizer,
    private crackDetectionService: CrackDetectionService,
    private imageStorage: ImageStorageService,
    private cdr: ChangeDetectorRef,
    private http: HttpClient
  ) {
    try {
      this.imageStorage.getCurrentImage$().subscribe((img) => {
        if (img) {
          this.selectedThumbSrc = img.withBoxes || img.original || null;
          this.selectedImageSelectionKey = this.getImageSelectionKey(img);
          this.selectedImageTitle = this.getShortImageTitle(img.filename ? img.filename : (img.fileImageName ? img.fileImageName : ''));
        }
      });
    }
    catch (e) {
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
      const name = `Session ${new Date().toLocaleString()}`;
      
      // Retrieve the stored userID from storage
      let userId: string | undefined = undefined;
      try {
        const storage = await (this.imageStorage as any)._storage;
        if (storage) {
          userId = await storage.get('userID');
        }
      } catch (e) {
        console.warn('[UploadImagePage] Failed to retrieve userID from storage', e);
      }
      
      //Call the ImageStorageService to create a new session (empty image list) with userId. Fallback to null if API missing.
      const s = (this.imageStorage && typeof (this.imageStorage.createSession) === 'function') ? this.imageStorage.createSession(name, [], userId) : null;

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
            if (e) imgs.push({ original: e.original, withBoxes: (e as any).withBoxes || e.original, fileName: e.filename, rawPrediction: e.prediction });
          }
          this.imagePaths = imgs.concat([]);
        } else {
          this.imagePaths = [];
        }
      } else {
        //if no session, then load global image list
        const stored = await this.imageStorage.getAllImages();
        this.imagePaths = (Array.isArray(stored) ? stored.map((s: StoredImage) => ({ original: s.original, withBoxes: (s as any).withBoxes || s.original, fileName: s.filename, rawPrediction: s.prediction })) : []).concat([]);
      }
    } catch (e) {
      console.warn('[UploadImagePage] refreshDisplayedImages failed', e);
      try { const all = await this.imageStorage.getAllImages(); this.imagePaths = Array.isArray(all) ? all.map((s: StoredImage) => ({ original: s.original, withBoxes: (s as any).withBoxes || s.original, fileName: s.filename, rawPrediction: s.prediction })) : []; } catch { this.imagePaths = []; }
    }
  }

  /** Called when a stored-image thumbnail is clicked */
  onStoredThumbClick(img: any) {
    //attempt to notify the service of the selection, calls the service to mark 
    // the image as selected using filename as the primary key
    try {
      if (this.imageStorage && img.filename) {
        // Use filename as the only primary key
        this.imageStorage.selectImageByKey(img.filename);
      }
    } catch (e) {
      console.warn('onStoredThumbClick: selectImage failed', e);
    }
    // Respect the current toggle: show boxed version when toggled on, otherwise show original
    // update the selected thumbnail src and title with respect to the toggle, and auto-scroll to center
    this.selectedThumbSrc = this.showWithBoxes ? (img.withBoxes ?? img.original) : (img.original ?? img.withBoxes ?? '');
    this.selectedImageSelectionKey = this.getImageSelectionKey(img);
    this.selectedImageTitle = img.filename ?? img.fileName ?? '';
    
    // Auto-scroll to center the selected thumbnail or item (Android Recent Apps style).  
    // after a short delay let the DOM update then center the clicked thumbnail in the scroller.
    setTimeout(() => this.scrollThumbnailIntoView(), 100);
  }

  /** Resolve the currently selected stored image record for actions like reprocess */
  private resolveSelectedStoredImage(): StoredImage | null {
    try {
      const current = typeof (this.imageStorage as any).getCurrentImage === 'function'
        ? (this.imageStorage as any).getCurrentImage()
        : null;
      if (current) {
        return current as StoredImage;
      }

      const lookupKeys = [
        this.selectedImageSelectionKey,
        this.selectedThumbSrc,
        this.selectedImage,
        this.selectedImageTitle
      ];

      for (const key of lookupKeys) {
        if (!key) continue;

        const found = typeof (this.imageStorage as any).getEntryForImage === 'function'
          ? (this.imageStorage as any).getEntryForImage(key)
          : null;
        if (found) {
          return found as StoredImage;
        }

        const local = this.imagePaths.find((img: any) =>
          img && (
            img.fileName === key ||
            img.filename === key ||
            img.original === key ||
            img.withBoxes === key
          )
        );
        if (local) {
          return {
            original: local.original,
            withBoxes: local.withBoxes,
            timestamp: new Date().toISOString(),
            filename: local.fileName || local.filename || `selected-${Date.now()}.jpg`,
            prediction: local.rawPrediction,
          } as StoredImage;
        }
      }
    } catch (e) {
      console.warn('[UploadImagePage] resolveSelectedStoredImage failed', e);
    }

    return null;
  }

  /** Reprocess the currently selected image through the normal upload pipeline */
  async reprocessSelectedImage() {
    try {
      const selected = this.resolveSelectedStoredImage();
      if (!selected) {
        alert('No image selected to reprocess');
        return;
      }

      const dataUrl = selected.original || selected.withBoxes || this.selectedThumbSrc || '';
      if (!dataUrl) {
        alert('The selected image does not contain data that can be reprocessed');
        return;
      }

      const originalDeleteKey = selected.filename || selected.fileImageName || selected.original || selected.withBoxes || '';
      const reprocessFilename = `reprocess-${Date.now()}.jpg`;

      // Reprocess first so the replacement image is saved before removing the original.
      const reprocessedEntry = await this.processDataUrl(dataUrl, reprocessFilename, false, false, false);

      if (originalDeleteKey) {
        const removed = await this.imageStorage.deleteImage(originalDeleteKey);
        if (!removed && selected.original && selected.original !== originalDeleteKey) {
          await this.imageStorage.deleteImage(selected.original);
        }
      }

      await this.updatePhotoCounts();
      try {
        await this.loadStoredImages();
        await this.loadSessions();
        await this.refreshDisplayedImages();
      } catch (refreshErr) {
        console.warn('[UploadImagePage] reprocessSelectedImage refresh failed', refreshErr);
      }

      this.selectedThumbSrc = (reprocessedEntry as any)?.original || dataUrl;
      this.selectedImageSelectionKey = (reprocessedEntry as any)?.filename || reprocessFilename;
      this.selectedImageTitle = (reprocessedEntry as any)?.filename || reprocessFilename;
      setTimeout(() => this.detectCenterThumbnail(), 60);
    } catch (e) {
      console.warn('[UploadImagePage] reprocessSelectedImage failed', e);
      alert('Failed to reprocess the selected image. See console for details.');
    }
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
      const key = img.getAttribute('data-overlay-key') || '';
      if (key === this.selectedImageKey) {
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
    const photo = await Camera.getPhoto({
      quality: 80,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Photos
    });
    if (photo && photo.base64String) {
      // Create dataURL and filename
      const dataUrl = `data:image/jpeg;base64,${photo.base64String}`;
      const galleryFilename = `Gallery-${Date.now()}.jpg`;
      console.log(`📸 Picked image from gallery: ${galleryFilename}`);
      
      // Send directly to the queue pipeline
      this.processQueue(dataUrl, galleryFilename);
    } else {
      console.warn('pickImagesMobile: no photo returned');
    }
  } catch (e) {
    console.warn('pickImagesMobile failed', e);
  }
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

/**
 * Accepts a captured or selected image, appends it to the queue, 
 * and initiates processing if the queue processor is idle.
 */
async processQueue(dataUrl: string, filename: string): Promise<void> {
  const newItem: QueueItem = { dataUrl, filename };
  this.imageQueue.push(newItem);

  // Increment photosTaken immediately so UI spinners reflect the action instantly
  this.photosTaken += 1;

  // Print queue logs upon item addition
  this.printQueueStatus('added', newItem);

  // If the background processor isn't running, start it
  if (!this.isQueueProcessing) {
    await this.runQueueProcessor();
  }
}

/**
 * Sequentially shifts items out of the queue and processes them one by one.
 */
private async runQueueProcessor(): Promise<void> {
  if (this.imageQueue.length === 0) {
    this.isQueueProcessing = false;
    return;
  }

  this.isQueueProcessing = true;
  const nextItem = this.imageQueue.shift()!;

  // Print queue logs when an item is sent to processDataUrl
  this.printQueueStatus('sent_to_processing', nextItem);

  try {
    // Pass bumpCounters as false because we incremented photosTaken at the time of queueing
    await this.processDataUrl(nextItem.dataUrl, nextItem.filename, false);
  } catch (error) {
    console.error(`[Queue Error] Processing failed for ${nextItem.filename}:`, error);
  } finally {
    // Process the next image in line recursively
    await this.runQueueProcessor();
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

  /** Helper to process a data URL (image) — runs inference and stores the image */
 async processDataUrl(
   dataUrl: string,
   filename: string, // Standardized signature parameter name
   bumpCounters: boolean = true,
   addToCapturedImages: boolean = true,
   refreshCountsAfterSave: boolean = true
 ) {
   // Log the current image being processed
   console.log(`\ud83d\udcfc [CameraProcessor] Current image name is: ${filename}`);
 
   // 1. CRITICAL FIX: Turn on processing immediately so the UI spinner displays
   // for the entire duration (including backend upload + tensor calculations)
   this.isProcessing = true;
 
   // New UI side-effects: update preview panel and prepend to thumbnail array
   this.imagePreview = dataUrl;
   if (addToCapturedImages) {
     this.capturedImages.unshift(dataUrl);
   }
 
   // Detect center thumbnails after UI updates
   setTimeout(() => {
     if (typeof this.detectCenterThumbnail === 'function') {
       this.detectCenterThumbnail();
     }
   }, 60);
 
   // Yield execution to the browser thread so the spinner can animate fluidly before heavy work
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
 
   // Scope the backend result variable
   let backendUploadResult: UploadResponse | null = null;
 
   // 2. CRITICAL FIX: Wrap the rest of the function in a master try block to guarantee the finally block clears the spinner
   try {
     // --- BACKEND UPLOAD FLOW ---
     try {
       const response = await fetch(dataUrl);
       const blob = await response.blob();
       const generatedName = filename || `capture-${Date.now()}.png`;
       
       this.selectedFile = new File([blob], generatedName, { type: blob.type || 'image/png' });
 
       console.log(`[CameraProcessor] Triggering uploadImage for backend server: ${generatedName}`);
       backendUploadResult = await this.uploadImage();
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
         backendUploadResult = await this.uploadImage();
         const tensor = await this.preprocessImage(dataUrl);
         
         try {
           prediction = await this.crackDetectionService.runInference(tensor);
         } catch (infErr) {
           console.warn('Local client model inference timed out or faulted', infErr);
         }
       } catch (err) {
         console.warn('Client-side preview preprocessing failed', err);
       }
 
       // --- CRITICAL FIX: LINK BACKEND RESULTS TO bounding_boxes ENGINE ---
       // If local inference returned empty or missing results, inject the backend server's bounding boxes!
       if (!prediction) {
         prediction = { boxes: [] };
       }
       if (!prediction.boxes || prediction.boxes.length === 0) {
         if (backendUploadResult && Array.isArray(backendUploadResult.bounding_boxes) && backendUploadResult.bounding_boxes.length > 0) {
           console.log(`[CameraProcessor] Local model found 0 boxes. Feeding ${backendUploadResult.bounding_boxes.length} server boxes into drawing canvas engine.`);
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
 
       const entry: StoredImage = {
         original: safeOriginal,
         timestamp,
         filename: generatedFilename,
         fileImageName: filename || undefined,
         prediction: prediction || undefined,
         hasPrediction: !!(prediction.boxes && prediction.boxes.length > 0),
         statusMessage: (prediction.boxes && prediction.boxes.length > 0) ? 'Prediction succeeded' : (inferenceCalled ? 'Prediction failed' : 'No prediction'),
         userId: userId,
         sessionId: this.selectedSessionId || undefined,
         original_id: originalId,
         cropped_id: originalId
       };
 
       // Canvas Rendering & Cropping Queue Loop
       try {
         // We now rely solely on the backend results for drawing and cropping
         const rawBoxes2 = backendUploadResult?.bounding_boxes || []; 
         console.log("raw Boxes 2 ", rawBoxes2);
 
         if (rawBoxes2.length > 0) {
           
           const boxesToDraw2 = rawBoxes2.map((b: any) => ({
             x: b.x,
             y: b.y,
             w: b.w,
             h: b.h
           }));
 
           const maskW = prediction?.maskWidth || prediction?.maskW || 128;
           const maskH = prediction?.maskHeight || prediction?.maskH || 128;
           const croppedCracks: any[] = [];
 
           for (const box of boxesToDraw2) {
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
               console.warn('[CameraProcessor] Failed handling specific bounding box cropping frame', cropErr);
             }
           }
 
           console.log('[CROPS] Total bounding boxes cropped:', croppedCracks.length);
 
           // Render canvas overlays
           try {
             // Be sure your drawBoxesOnImage has the Promise fix we discussed earlier!
             const withBoxesDataUrl = await this.drawBoxesOnImage(dataUrl, boxesToDraw2, maskW, maskH);
             const safeWithBoxes = await this.shrinkDataUrlToBytes(withBoxesDataUrl, maxBytes, 4000);
             
             (entry as any).withBoxes = safeWithBoxes;
             (entry as any).boxes = boxesToDraw2;
             (entry as any).croppedCracks = croppedCracks;
             (entry as any).detectionMessage = `Rendered ${boxesToDraw2.length} detected crack box(es)`;
             this.totalBoundingBoxesCreated += boxesToDraw2.length;
             
           } catch (renderErr) {
             console.warn('[CameraProcessor] drawBoxesOnImage canvas drawing threw exception:', renderErr);
             (entry as any).withBoxes = safeOriginal;
             (entry as any).boxes = [];
             (entry as any).detectionMessage = 'Box rendering failed';
           }
         } else {
           // Fallback if rawBoxes2 is empty
           (entry as any).withBoxes = safeOriginal;
           (entry as any).boxes = [];
           (entry as any).detectionMessage = 'No boxes detected from server';
         }
       } catch (e) {
         console.warn('[CameraProcessor] Context breakdown while handling canvas configurations', e);
         (entry as any).withBoxes = safeOriginal;
         (entry as any).boxes = [];
         (entry as any).detectionMessage = 'Box rendering failed';
       }
 
       if (!claimFinalization()) {
         console.warn('[CameraProcessor] Skipping storage write because processing state is already completed');
         return entry;
       }
 
       // Authoritative Local Session Storing
       await this.imageStorage.addImage(entry, this.selectedSessionId || undefined);
       console.log("Session image added");
       try {
         if (this.selectedSessionId && typeof (this.imageStorage.addImageToSession) === 'function') {
           this.imageStorage.addImageToSession(this.selectedSessionId, entry.filename);
           this.sessionIsPristine = false;
         }
       } catch (e) {
         console.warn('[CameraProcessor] Failed linking image identifier to active session key', e);
       }
 
       // Harmonized sub-crack persistence strategy (supports old and new signatures)
       if (typeof (this as any).processAndStoreCroppedCracks === 'function') {
         await (this as any).processAndStoreCroppedCracks(entry, filename, userId, sessionImgIndex, originalId);
       } else if (Array.isArray((entry as any).croppedCracks) && (entry as any).croppedCracks.length > 0) {
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
       console.log("Refresh Displayed Images");
       try {
         await this.refreshDisplayedImages();
       } catch (e) {
         console.warn('[CameraProcessor] Layout refreshed failed', e);
       }
 
       // Appending paths to scroll arrays from New Version
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
 
       // Sync data changes directly to Firestore if User ID is mapped
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
 
       if (bumpCounters) {
         this.imagesUploadedThisSession += 1;
       }
       if (prediction && prediction.boxes && prediction.boxes.length > 0) {
         this.photosProcessed += 1;
       }
       if (refreshCountsAfterSave) {
         await this.updatePhotoCounts();
       }
       
       await this.logCurrentSessionImageObjects();
       console.log("Try detect center thumbnail");
       // UI Frame alignment correction delay
       setTimeout(() => {
         if (typeof this.detectCenterThumbnail === 'function') {
           this.detectCenterThumbnail();
         }
       }, 250);
 
       return entry;
     };
 
     // Increase this from 17_000 to something safe for heavy local inference
     const overallTimeoutMs = 45_000;
     try {
       await Promise.race([
         doWork(), 
         new Promise((_, rej) => setTimeout(() => rej(new Error('processing-timeout')), overallTimeoutMs))
       ]);
     } catch (err: any) {
       if (err && err.message === 'processing-timeout') {
         console.warn('[CameraProcessor] Pipeline race completed with an overall processing timeout status.');
 
         const maxBytes = 900_000;
         const safeOriginal = await this.shrinkDataUrlToBytes(dataUrl, maxBytes, 4000);
         const timestamp = new Date().toISOString();
         const fallbackFilename = this.buildSessionFilename(false, timestamp, filename, sessionImgIndex);
         
         const entry: StoredImage = {
           original: safeOriginal,
           timestamp,
           filename: fallbackFilename,
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
             await this.updatePhotoCounts();
           }
         } catch (fallbackErr) {
           console.warn('[CameraProcessor] Aborting database write operations during fallback handling', fallbackErr);
         }
       } else {
         console.warn('[CameraProcessor] processDataUrl encountered an runtime error:', err);
       }
     }
   } finally {
     // 3. CRITICAL FIX: The master finally block ensures that regardless of failures, 
     // timeouts, or cloud crashes, the loader indicator is always turned off safely!
 
     console.log("processing finished");
 
     this.isProcessing = false;
 
     if (typeof this.logCurrentSessionStateAfterProcessDataUrl === 'function') {
       await this.logCurrentSessionStateAfterProcessDataUrl();
     }
     if (typeof this.logBoundingBoxStats === 'function') {
       this.logBoundingBoxStats();
     }
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

        console.log(`📦 Bounding boxes drawn: ${boxes.length} | 📊 Total cumulative boxes: ${this.totalBoundingBoxesCreated}`);

        resolve(canvas.toDataURL('image/png'));
      };
      if (img.complete && img.naturalWidth) img.onload!(null as any);
    });
  }
 

  /** Print the current session's stored image objects after processing completes. */
  private async logCurrentSessionImageObjects() {
    try {
      if (!this.selectedSessionId) {
        console.log('[UploadImagePage] No active session to inspect');
        return;
      }

      const session = typeof (this.imageStorage as any).getSession === 'function'
        ? (this.imageStorage as any).getSession(this.selectedSessionId)
        : null;

      if (!session) {
        console.log('[UploadImagePage] Active session not found', this.selectedSessionId);
        return;
      }

      const sessionImageObjects = Array.isArray(session.imageKeys)
        ? session.imageKeys
            .map((imageKey: string) => typeof (this.imageStorage as any).getEntryForImage === 'function'
              ? (this.imageStorage as any).getEntryForImage(imageKey)
              : null)
            .filter((image: StoredImage | null) => !!image)
        : [];

      console.log('[UploadImagePage] Current session image objects:', {
        sessionId: session.id,
        sessionName: session.name,
        imageCount: sessionImageObjects.length,
        images: sessionImageObjects,
      });
    } catch (e) {
      console.warn('[UploadImagePage] Failed to log current session image objects', e);
    }
  }

  /** Always log active session + session images after processDataUrl finishes for id diagnostics. */
  // private async logCurrentSessionStateAfterProcessDataUrl(filename: string) {
  //   try {
  //     if (!this.selectedSessionId) {
  //       console.log('[UploadImagePage] processDataUrl finished without active session:', { filename });
  //       return;
  //     }

  //     const session = typeof (this.imageStorage as any).getSession === 'function'
  //       ? (this.imageStorage as any).getSession(this.selectedSessionId)
  //       : null;

  //     const sessionImageObjects = session && Array.isArray(session.imageKeys)
  //       ? session.imageKeys
  //           .map((imageKey: string) => typeof (this.imageStorage as any).getEntryForImage === 'function'
  //             ? (this.imageStorage as any).getEntryForImage(imageKey)
  //             : null)
  //           .filter((image: StoredImage | null) => !!image)
  //       : [];

  //     console.log('[UploadImagePage] processDataUrl finished - current session object:', {
  //       filename,
  //       sessionId: this.selectedSessionId,
  //       session,
  //     });

  //     console.log('[UploadImagePage] processDataUrl finished - current session image objects:', {
  //       filename,
  //       sessionId: this.selectedSessionId,
  //       imageCount: sessionImageObjects.length,
  //       images: sessionImageObjects,
  //     });

  //     console.log('[UploadImagePage] processDataUrl finished - id population snapshot:',
  //       sessionImageObjects.map((img: any, index: number) => ({
  //         index,
  //         filename: img?.filename,
  //         original_id: img?.original_id,
  //         cropped_id: img?.cropped_id,
  //       }))
  //     );
  //   } catch (e) {
  //     console.warn('[UploadImagePage] Failed post-processDataUrl session logging', e);
  //   }
  // }

  /** Check croppedCracks, store them, and log counts for the current entry. */
  private async processAndStoreCroppedCracks(
    entry: StoredImage,
    originalFilename: string,
    userId?: string,
    sessionImgIndex?: number,
    originalId?: string
  ): Promise<number> {
    const croppedCracks = Array.isArray((entry as any).croppedCracks) ? (entry as any).croppedCracks : [];
    const croppedCount = croppedCracks.length;

    console.log('[UploadImagePage] croppedCracks check:', {
      filename: entry.filename,
      croppedCracksCount: croppedCount,
    });

    if (croppedCount === 0) {
      console.log('[UploadImagePage] No croppedCracks found to process for:', entry.filename);
      return 0;
    }

    const storedCroppedCracks = await this.persistCroppedCracksAsSessionImages(
      croppedCracks,
      originalFilename,
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
      console.warn('[UploadImagePage] Failed to update stored parent entry with cropped cracks', setErr);
    }

    console.log('[UploadImagePage] croppedCracks processed:', {
      filename: entry.filename,
      croppedCracksCount: croppedCount,
      processedCount: storedCroppedCracks.length,
    });

    return storedCroppedCracks.length;
  }

  /** Persist cropped crack results as individual session image objects. */
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
      const croppedId = this.generateImageRecordId('cropped');
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
        cropped_id: croppedId,
      };

      let addedOk = false;
      try {
        await this.imageStorage.addImage(cropEntry, sessionId);
        addedOk = true;
      } catch (addErr) {
        console.warn('[UploadImagePage] Failed to add cropped crack image to storage', addErr);
      }

      if (addedOk) {
        try {
          if (sessionId && typeof (this.imageStorage as any).addImageToSession === 'function') {
            (this.imageStorage as any).addImageToSession(sessionId, cropEntry.filename);
          }
        } catch (sessErr) {
          console.warn('[UploadImagePage] Failed to add cropped image to session', sessErr);
        }

        if (userId) {
          try {
            await this.imageStorage.saveImageToUser(userId, cropEntry);
          } catch (saveErr) {
            console.warn('[UploadImagePage] Failed to save cropped crack to user storage', saveErr);
          }
        }

        storedCroppedCracks.push({
          croppedNumber,
          image: safeCrop,
          s3Key: null,
          s3Url: null,
          filename: cropEntry.filename,
          box: crop.box,
          type: crop.type,
          shape: crop.shape,
          severity: crop.severity,
          sessionImage: cropEntry,
        });
      } else {
        // push a best-effort record so the caller can still reference it
        storedCroppedCracks.push({
          croppedNumber,
          image: safeCrop,
          s3Key: null,
          s3Url: null,
          filename: generatedFilename,
          box: crop.box,
          type: crop.type,
          shape: crop.shape,
          severity: crop.severity,
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
        console.warn('[UploadImagePage] shrinkDataUrlToBytes image load failed or timed out:', loadResult);
        return dataUrl;
      }

      let scale = 1;
      let quality = 0.92;
      const minQuality = 0.5;
      const scaleStep = 0.85;
      const maxLoops = 8;

      for (let i = 0; i < maxLoops; i += 1) {
        if (Date.now() - loadStart > timeoutMs) {
          console.warn('[UploadImagePage] shrinkDataUrlToBytes timeout while resizing');
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
      console.warn('[UploadImagePage] shrinkDataUrlToBytes failed', e);
    }
    return dataUrl;
  }

  // Small helper to yield to the event loop so UI can repaint (spinner animations)
  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  closePreview() {
    this.imagePreview = null;
  }

  /** Briefly enable processed glow for `glowDurationMs` milliseconds */
  private triggerProcessedGlow(durationMs?: number) {
    const ms = typeof durationMs === 'number' ? durationMs : this.glowDurationMs;
    this.processedGlowActive = true;
    if (this._processedGlowTimer) {
      clearTimeout(this._processedGlowTimer);
    }
    try { this.cdr.detectChanges(); } catch (e) {}
    this._processedGlowTimer = setTimeout(() => {
      this.processedGlowActive = false;
      this._processedGlowTimer = undefined;
      try { this.cdr.detectChanges(); } catch (e) {}
    }, ms);
  }

  toggleCamera() {
    this.usingFrontCamera = !this.usingFrontCamera;
    this.initCamera();
  }

  filterThumbnails(type: string) {
    //Optional: filtering logic by image origin
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
          this.router.navigate(['/home-page2']);
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
        if (this.selectedSessionId && this.sessionIsPristine === false && typeof (this.imageStorage as any).saveSessionSnapshotToBrowserStorage === 'function') {
          try { await (this.imageStorage as any).saveSessionSnapshotToBrowserStorage(this.selectedSessionId, 'local'); } catch (e) { /* ignore */ }
        }
        this.router.navigate(['/home-page2']);
      }
    } catch (e) {
      console.warn('handleGoHome failed', e);
      this.router.navigate(['/home-page2']);
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

  private buildSessionFilename(hasCrack: boolean, timestamp?: string, fallbackName?: string, imgIndex?: number): string {
    const svc: any = this.imageStorage as any;
    if (svc && typeof svc.generateSessionFilename === 'function') {
      return svc.generateSessionFilename({
        sessionId: this.selectedSessionId || undefined,
        hasCrack,
        designatedPart: 'original',
        imageType: 'original',
        imgIndex,
        timestamp
      });
    }
    return fallbackName || this.generateFilename();
  }

  /**
   * Shorten the image title by removing userID, sessionId, and img1 prefixes.
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
        this.router.navigate(['/home-page2']);
        return;
      }
      if (choice === 'stay' || choice === null) return;
    }

    try {
      if (this.selectedSessionId && this.sessionIsPristine === false && typeof (this.imageStorage as any).saveSessionSnapshotToBrowserStorage === 'function') {
        try { await (this.imageStorage as any).saveSessionSnapshotToBrowserStorage(this.selectedSessionId, 'local'); } catch (e) { /* ignore */ }
      }
      this.router.navigateByUrl('/home-page2');
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
        { original: base + 'sample1.jpg', withBoxes: base + 'sample1.jpg', fileName: 'sample1.jpg' },
        { original: base + 'sample2.jpg', withBoxes: base + 'sample2.jpg', fileName: 'sample2.jpg' }
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
      const stored = await this.imageStorage.getAllImages();
      this.imagePaths = stored.map((s: StoredImage) => ({
        original: s.original,
        withBoxes: (s as any).withBoxes || s.original,
        fileName: s.filename,
        rawPrediction: s.prediction,
      })).concat(this.imagePaths);
      // refresh counters after loading stored images
      await this.updatePhotoCounts();
    } catch (e) {
      console.warn('loadStoredImages failed', e);
    }
  }

  toggleDebugPanel() {
    this.showDebugPanel = !this.showDebugPanel;
    if (this.showDebugPanel) {
      // populate debug panel with last prediction
      this.selectedPrediction = this.lastPrediction || null;
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
    this.selectedImageSelectionKey = (imgEl && imgEl.dataset && imgEl.dataset['overlayKey']) || src;
    
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
      const isProcessedStatus = (statusMessage?: string | null) => {
        const normalized = (statusMessage || '').toLowerCase();
        return normalized.includes('prediction succeeded') || normalized.includes('cropped crack');
      };

      // If a session is active, compute counts from that session's image keys
      if (this.selectedSessionId) {
        const freshSession = typeof (this.imageStorage as any).getSession === 'function'
          ? (this.imageStorage as any).getSession(this.selectedSessionId)
          : null;
        if (freshSession) {
          this.sessions = [freshSession];
        } else if (!this.sessions || this.sessions.length === 0) {
          try { await this.loadSessions(); } catch (e) { /* ignore */ }
        }

        const session = freshSession || this.sessions.find(s => s.id === this.selectedSessionId) || null;
        if (!session || !Array.isArray(session.imageKeys)) {
          this.photosTaken = 0;
          this.photosProcessed = 0;
          this.storedImages = [];
          this.imagePaths = [];
        } else {
          const keys = session.imageKeys.slice();
          let processed = 0;
          const imgs: StoredImage[] = [];
          let foundCount = 0;
          for (const k of keys) {
            let entry: any = undefined;
            if (typeof (this.imageStorage as any).getEntryForImage === 'function') {
              const maybe = (this.imageStorage as any).getEntryForImage(k);
              entry = (maybe && typeof (maybe.then) === 'function') ? await maybe : maybe;
            } else if (typeof (this.imageStorage as any).getAllEntries === 'function') {
              const all = await (this.imageStorage as any).getAllEntries();
              entry = all ? all[k] : undefined;
            }
            if (entry) {
              imgs.push(entry as StoredImage);
              foundCount++;
              if (isProcessedStatus(entry.statusMessage)) processed++;
            }
          }
          this.photosProcessed = processed;
          this.photosTaken = imgs.length; // total stored session image objects currently available
          this.storedImages = imgs;
          this.imagePaths = imgs.map((s: StoredImage) => ({ original: s.original, withBoxes: (s as any).withBoxes || s.original, fileName: s.filename, rawPrediction: s.prediction }));
        }
      } else {
        const all: StoredImage[] = await this.imageStorage.getAllImages();
        this.photosTaken = Array.isArray(all) ? all.length : 0;
        this.photosProcessed = Array.isArray(all) ? all.filter(i => isProcessedStatus(i.statusMessage)).length : 0;
        this.storedImages = Array.isArray(all) ? all.slice() : [];
        this.imagePaths = this.storedImages.map((s: StoredImage) => ({ original: s.original, withBoxes: (s as any).withBoxes || s.original, fileName: s.filename, rawPrediction: s.prediction }));
      }
      console.log('[UploadImagePage] updatePhotoCounts:', { photosTaken: this.photosTaken, photosProcessed: this.photosProcessed });
    } catch (e) {
      console.warn('updatePhotoCounts failed', e);
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
    // image, remove it via the ImageStorageService using filename as key
    const idx = this.imagePaths.findIndex((p: any) => {
      const imgKey = p.filename || p.fileName;
      return imgKey && (p.original === src || p.withBoxes === src);
    });
    const capturedIdx = this.capturedImages.indexOf(src);
    //compute human filename for prompt and ask user to confirm.
    //Resolve display filename and confirm deletion
    const filename = idx !== -1 ? (this.imagePaths[idx].filename || this.imagePaths[idx].fileName || '(unnamed)') : (capturedIdx !== -1 ? `Captured ${capturedIdx + 1}` : src);
    const confirmMsg = `Delete image "${filename}"? This action cannot be undone.`;
    if (!confirm(confirmMsg)) return;

    try {
      // Use filename as the canonical key for storage operations
      let canonicalKey = '';
      if (idx !== -1 && this.imagePaths[idx]) {
        canonicalKey = this.imagePaths[idx].filename || this.imagePaths[idx].fileName || '';
      }

      // attempt to remove from persistent storage using filename as key
      //call storage API to delete image (if available), in case of failures.
      let removed = false;
      if (canonicalKey) {
        try {
          removed = await this.imageStorage.deleteImage(canonicalKey);
        } catch (e) {
          console.warn('[UploadImagePage] persistent remove attempt failed', e);
          removed = false;
        }
      }

      // Always remove any matching local in memory references (guard against stale in-memory state)
      //Purpose: remove any matching entries from imagePaths and capturedImages and refresh arrays.
      try {
        this.imagePaths = this.imagePaths.filter((p: any) => {
          const pKey = p.filename || p.fileName;
          return !(pKey === canonicalKey || p.original === src || p.withBoxes === src);
        });
        this.capturedImages = this.capturedImages.filter(c => c !== src);
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
        this.selectedImageTitle = first.filename || first.fileName || '';
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

 

      /** Capture a frame, preprocess, run inference, and save result */
  async takePicture() {
    // Ensure UI shows processing state immediately
    this.isProcessing = true;
    // yield to the event loop so the spinner can render/animate before heavy work
    await this.sleep(50);
    try { this.cdr.detectChanges(); } catch (e) { /* ignore */ }
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

      const dataUrl = canvas.toDataURL('image/png');
      this.imagePreview = dataUrl;
  this.capturedImages.unshift(dataUrl);
  // allow DOM to update and then detect center thumbnail
  setTimeout(() => this.detectCenterThumbnail(), 60);

      // Wrap preprocess → inference → save into a cancellable-timeout-aware sequence
      const work = async () => {
        const imageTensor = await this.preprocessImage(dataUrl);
        // call the backend/model
        let prediction = null;
        try {
          inferenceCalled = true;
          prediction = await this.crackDetectionService.runInference(imageTensor);
          inferenceSucceeded = !!prediction;
        } catch (e) {
          console.error('Inference error', e);
        }

        const now = new Date().toISOString();
        const filename = this.buildSessionFilename(!!prediction, now);

        const entry: StoredImage = {
          original: dataUrl,
          timestamp: now,
          filename,
          prediction: prediction || undefined,
          hasPrediction: !!prediction,
          statusMessage: prediction ? 'Prediction succeeded' : (inferenceCalled ? 'Prediction failed' : 'No prediction')
        };
        await this.imageStorage.addImage(entry, this.selectedSessionId || undefined);
        // also add to active session if one exists
        try {
          if (this.selectedSessionId && typeof (this.imageStorage.addImageToSession) === 'function') {
            this.imageStorage.addImageToSession(this.selectedSessionId, entry.filename);
            this.sessionIsPristine = false; // Mark session as no longer pristine
          }
          await this.refreshDisplayedImages();
        } catch (e) {
          console.warn('[UploadImagePage] Failed to add taken picture to session', e);
        }
        // synchronize counters from storage so UI reflects actual stored count
        await this.updatePhotoCounts();
        this.savedImage = entry;
        this.lastPrediction = prediction;
        return entry;
      };

      try {
        // overall timeout: 10s
        await Promise.race([work(), new Promise((_, rej) => setTimeout(() => rej(new Error('processing-timeout')), 10_000))]);
      } catch (err: any) {
        if (err && err.message === 'processing-timeout') {
          console.warn('[UploadImagePage] takePicture processing timed out');
          // Persist fallback entry indicating timeout
          try {
            const filename = this.buildSessionFilename(false, new Date().toISOString());
            const entry: StoredImage = {
              original: dataUrl,
              timestamp: new Date().toISOString(),
              filename,
              prediction: undefined,
              hasPrediction: false,
              statusMessage: inferenceCalled ? 'Prediction failed' : 'No prediction'
            };
            await this.imageStorage.addImage(entry, this.selectedSessionId || undefined);
            await this.updatePhotoCounts();
          } catch (e) {
            console.warn('[UploadImagePage] Failed to persist fallback entry after timeout', e);
          }
        } else {
          console.error('Failed during takePicture work:', err);
        }
      }

  // Keep console.log before clearing isProcessing so callers/UI see processing until logging completes
  console.log('✅ Prediction stored:', this.lastPrediction);
      // Print all currently stored images to verify persistence
      try {
        const all = await this.imageStorage.getAllImages();
        console.log('Stored images count:', all.length);
      } catch (logErr) {
        console.warn('Could not list stored images', logErr);
      }

      // Set a user-facing message depending on whether inference ran/succeeded
      if (inferenceSucceeded) {
        this.selectedStatusMessage = 'Prediction succeeded';
      } else if (inferenceCalled) {
        this.selectedStatusMessage = 'Prediction failed';
      } else {
        this.selectedStatusMessage = 'No prediction performed';
      }
    } catch (err) {
      console.error('takePicture error', err);
    } finally {
      this.isProcessing = false;
      // Log cumulative bounding box stats after capture processing
      this.logBoundingBoxStats();
    }
  }

  
  // 1. Call Text Function
  getFastApiMessage() {
    this.http.get<{ message: string }>(`${this.baseUrl}/api/hello`).subscribe({
      next: (response) => {
        this.apiMessage = response.message;
        this.apiStatus = response.message;
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

//  onFileSelected(event: Event) {
//     const input = event.target as HTMLInputElement;
//     if (!input) return;
//     const files = input.files;
//     if (!files || files.length === 0) return;

//     // Process multiple files sequentially to avoid overwhelming the device
//     const fileArray = Array.from(files);
//     (async () => {
//       for (const f of fileArray) {
//         await this.processFile(f);
//       }
//     })();
//   }


// uploadImage() {
//   // Safety check: ensure something is selected and it behaves like a Blob/File
//   if (!this.selectedFile || !(this.selectedFile instanceof Blob)) {
//     console.error('Upload aborted: selectedFile is not a valid Blob/File object.', this.selectedFile);
//     return;
//   }

//   const formData = new FormData();
//   // Safe to append now that the instance type is verified
//   formData.append('file', this.selectedFile, this.selectedFile.name);

//   // 1. Update the expected response type to match your FastAPI return dictionary
//   interface UploadResponse {
//     message: string;
//     rawImagePath: string;
//     processedImagePath: string;
//     bounding_boxes: { w: number; h: number; x: number; y: number }[];
//   }


//   this.http.post<UploadResponse>(`${this.baseUrl}/api/upload`, formData)
//     .subscribe({
//       next: (response) => {
//         // this.uploadedImageUrl = `${this.baseUrl}${response.imagePath}`;

//         // 2. Capture the paths and prefix them with your base URL
//         this.uploadedImageUrl = `${this.baseUrl}${response.rawImagePath}`;
//         // this.processedImageUrl = `${this.baseUrl}${response.processedImagePath}`;
        
//         // 3. Capture the bounding boxes array
//         this.boxes = response.bounding_boxes;

//         console.log("Success:", response.message);
//         console.log("Found boxes:", this.boxes);

//       },
//       error: (err) => console.error('Error uploading image:', err)
//     });
// }

async uploadImage(): Promise<UploadResponse | null> {
  // 1. Safety check: must return 'null' explicitly. A blank 'return;' returns 'void'
  if (!this.selectedFile || !(this.selectedFile instanceof Blob)) {
    console.error('Upload aborted: selectedFile is not a valid Blob/File object.', this.selectedFile);
    return null; 
  }

  const formData = new FormData();
  formData.append('file', this.selectedFile, this.selectedFile.name);

  try {
    // Converts the post Observable into a Promise
    const response = await firstValueFrom(
      this.http.post<UploadResponse>(`${this.baseUrl}/api/upload`, formData)
    );

    this.uploadedImageUrl = `${this.baseUrl}${response.rawImagePath}`;
    this.boxes = response.bounding_boxes;

    console.log("Success:", response.message);
    
    // 2. Return the object to resolve the Promise with data
    return response; 

  } catch (err) {
    console.error('Error uploading image:', err);
    // 3. Explicitly return null on failure
    return null; 
  }
}


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

}


// Small helper type used in class
interface ScaledBox {
  x: number;
  y: number;
  w: number;
  h: number;
  original: BoundingBox;
}
