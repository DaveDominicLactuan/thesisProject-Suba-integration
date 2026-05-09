import { Component, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { NavController, Platform, GestureController } from '@ionic/angular';
import { ApiService } from '../api.service';
import { ImageStorageService, StoredImage } from '../services/image-storage.service';
import { CameraPreview, CameraPreviewOptions } from '@awesome-cordova-plugins/camera-preview/ngx';

interface DisplayImage {
  original: string;
  withBoxes: string;
  filename?: string;
  fileName?: string;
  detectionMessage?: string;
  detectionResult?: string;
  // raw prediction and status copied from StoredImage for easy access
  rawPrediction?: { type?: string; shape?: string; severity?: string };
  prediction?: { type?: string; shape?: string; severity?: string };
  statusMessage?: string;
  boxes?: any[];
  hasPrediction?: boolean;
  storagePath?: string;
  withBoxesStoragePath?: string;
  storageUrl?: string;
  withBoxesStorageUrl?: string;
  // S3 key fields for mobile compatibility
  originalS3Key?: string;
  withBoxesS3Key?: string;
  originalS3Url?: string;
  withBoxesS3Url?: string;
}

@Component({
  selector: 'app-feedback-page',
  templateUrl: './feedback-page.page.html',
  styleUrls: ['./feedback-page.page.scss'],
  standalone: false
})
export class FeedbackPagePage implements OnInit {
  message: string = '';
  selectedImage: string = '';
selectedImageTitle: string = '';
  // Holds the structured prediction for the currently-selected/centered image
  selectedPrediction: { type?: string; shape?: string; severity?: string } = {};
  selectedStatusMessage: string = '';
formDataMap: {
  [image: string]: {
    title: string;
    dropdown1: string;
    dropdown2: string;
    dropdown3: string;
    extraText: string;
  };
} = {};

imagePaths: DisplayImage[] = [];
showWithBoxes: boolean = false;
engineerLookedSessionChecked: boolean = false;
private backButtonSub: any; // hardware back handler
showSessionLoadingWindow: boolean = false;
sessionLoadingMessage: string = 'Fetching S3 images...';
sessionLoadingDetail: string = 'Preparing session images';
sessionLoadingCompleted: number = 0;
sessionLoadingTotal: number = 0;
private sessionLoadingWindowTimer: any;
private backNavigationInProgress: boolean = false;
private lastBackTapAt: number = 0;

  // Zoom modal properties
  showZoomModal: boolean = false;
  zoomImageSrc: string = '';
  currentZoomLevel: number = 1;
  private pinchGesture: any;




  // routeSessionId holds session id passed via query param from Camera page
  routeSessionId?: string | null = null;

  @ViewChild('scrollContainer', { static: false }) scrollContainer!: ElementRef;
  @ViewChild('zoomImageElement', { static: false }) zoomImageElement?: ElementRef;
  // Session support
  sessions: any[] = [];
  selectedSessionId?: string | null = null;
 
    name: string = '';
    storedEntries: { image: string; title: string; dropdown1: string; dropdown2: string; dropdown3: string; extraText: string }[] = [];
    email: string = '';
    password: string = '';
    rememberMe: boolean = false;
    showPassword: boolean = false;
    username: string = '';
    firstName: string = '';
    lastName: string = '';
    dropdown1: string = '';
  dropdown2: string = '';
  dropdown3: string = '';
  extraText: string = '';
  // Notes field (collapsible) shown under dropdown3
  notesExpanded: boolean = false;
  notesText: string = '';
  notesMaxLength: number = 500;
  dropdownOptions: string[] = [];
  dropdownOptionsDirection: string[] = [];
  dropdownOptionsShape: string[] = [];
  dropdownOptionsSeverity: string[] = [];
  detectionMessage: string = '';
  detectionResult: string = '';
  userRole: string | null = null; // User role for access control
  userId: string | null = null; // Current user ID

  /**
   * Inject router, API, storage service, and CameraPreview (native).
   * CameraPreview is stopped on init to ensure camera UI is released.
   */
  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private api: ApiService,
    private imageStorageService: ImageStorageService,
    private cameraPreview: CameraPreview,
    private navCtrl: NavController,
    private platform: Platform,
    private gestureCtrl: GestureController
  ) { }

  /**
   * Lifecycle: stop camera preview (if native), fetch a quick API test,
   * and prepare to load sessions/images in ngAfterViewInit.
   */
  ngOnInit() {
    this.loadUserRole();
    this.loadUserId();
    try {
      // CameraPreview is a Cordova/native plugin â€” on web it will throw; ignore on web
      this.cameraPreview.stopCamera();
    } catch (e) {
      console.warn('CameraPreview.stopCamera ignored (not available on web):', e);
    }

    console.log(this.message)
  }

    /**
   * Lifecycle: stop camera preview (if available), then load sessions and
   * associated images. Kicks off a debug log and center detection.
   */
  ngAfterViewInit() {
  try {
    this.cameraPreview.stopCamera();
    try { if (this.backButtonSub && typeof this.backButtonSub.unsubscribe === 'function') this.backButtonSub.unsubscribe(); } catch {}
  } catch (e) {
    console.warn('CameraPreview.stopCamera ignored in ngAfterViewInit (not available on web):', e);
  }

   if (this.backButtonSub) {
      try {
        this.backButtonSub.unsubscribe();
        this.backButtonSub = null;
      } catch (e) {
        console.warn('[UploadImagePage] failed to unsubscribe back button handler', e);
      }
    }
  

    // Initialize sessions then refresh the displayed images from the active session
    setTimeout(() => {
      // If a session id was passed using query param use it
      try { this.routeSessionId = this.route.snapshot.queryParamMap.get('sessionId'); } catch (e) { this.routeSessionId = null; }
      this.loadSessions()
          .then(() => this.refreshDisplayedImages())
        .then(() => {
          // Print stored images + prediction-derived display strings for debugging
          this.debugLogStoredImages();
          // Try to detect the centered image (will update again when DOM ready)
          this.detectCenterImage();
          // Display user and session information
          this.displayUserAndSessionInfo();
        })
        .catch(err => console.warn('[FeedbackPage] failed to initialize sessions/images', err));
    }, 500);
      }


  // Load user role/name from localStorage to control dropdown editability. 
  //Attempts to parse localStorage 'userData', reads role/name fields 
  // and logs the loaded context.
  private loadUserRole() {
    try {
      //etch previously-stored user context named 
      //userData so the app can restore role/name without network calls.
      const cached = localStorage.getItem('userData');
      if (cached) {
        //Convert the stored JSON string into an object 
        //and read role/name fields, applying fallbacks if fields are missing.
        const data = JSON.parse(cached);
        this.userRole = (data.userRole || data.role || 'user') as string;
        this.firstName = data.firstName || '';
        this.lastName = data.lastName || '';
        //show a debug log with the loaded role and names 
        // to help trace app behavior during development.
        console.log('[FeedbackPage] loaded user context', { userRole: this.userRole, firstName: this.firstName, lastName: this.lastName });
      } else {
        //If nothing is in localStorage, 
        //default the userRole to 'user' so UI access control behaves predictably.
        this.userRole = 'user';
      }
    } catch (e) {
      console.warn('[FeedbackPage] loadUserRole failed, defaulting to user', e);
      this.userRole = 'user';
    }
  }

  /**
   * Log the current logged-in user's role whenever the page is entered.
   */
  private logCurrentUserRoleOnEnter() {
    try {
      const cached = localStorage.getItem('userData');
      if (cached) {
        const data = JSON.parse(cached);
        this.userRole = (data.userRole || data.role || this.userRole || 'user') as string;
      }

      console.log('[FeedbackPage] current logged-in user role:', this.userRole || 'user');
    } catch (e) {
      console.warn('[FeedbackPage] failed to read current user role on enter', e);
      console.log('[FeedbackPage] current logged-in user role:', this.userRole || 'user');
    }
  }

  /**
   * Load userId from localStorage (userData) or from sessionStorage.
   * Attempts to retrieve the current user ID for identification purposes.
   */
  private loadUserId() {
    try {
      // Try localStorage first
      const cached = localStorage.getItem('userData');
      if (cached) {
        const data = JSON.parse(cached);
        this.userId = data.userID || data.uid || null;
      }
    } catch (e) {
      console.warn('[FeedbackPage] loadUserId from localStorage failed', e);
    }

    // Fallback to sessionStorage if not found
    if (!this.userId) {
      try {
        const sessionData = sessionStorage.getItem('userProfile');
        if (sessionData) {
          const data = JSON.parse(sessionData);
          this.userId = data.userID || data.uid || null;
        }
      } catch (e) {
        console.warn('[FeedbackPage] loadUserId from sessionStorage failed', e);
      }
    }

    if (this.userId) {
      console.log('[FeedbackPage] loaded userId:', this.userId);
    } else {
      console.warn('[FeedbackPage] userId could not be loaded from storage');
    }
  }

  /**
   * Display the current user ID and session ID in the console and return them.
   * Useful for debugging and verifying user/session context.
   */
  displayUserAndSessionInfo(): { userId: string | null; sessionId: string | null } {
    const info = {
      userId: this.userId,
      sessionId: this.selectedSessionId || null
    };

    console.group('[FeedbackPage] ðŸ‘¤ User and Session Information');
    console.log('User ID:', info.userId || '(not loaded)');
    console.log('Session ID:', info.sessionId || '(no session selected)');
    console.log('Current Session:', this.selectedSessionId ? this.sessions.find(s => s.id === this.selectedSessionId) : 'None');
    // Print image objects currently loaded for the active session (if any)
    console.log('Session images for selected session:', this.imagePaths && this.imagePaths.length > 0 ? this.imagePaths : '(no images loaded)');
    // (Previously attempted to fetch full session image objects here; removed.)
    console.log('All loaded sessions:', this.sessions.length > 0 ? this.sessions : '(no sessions loaded)');
    console.groupEnd();

    return info;
  }

  /**
   * Print the currently selected session images after S3 hydration completes.
   */
  private printSelectedSessionImages(): void {
    console.log('[FeedbackPage] Session images for selected session after hydration:',
      this.imagePaths && this.imagePaths.length > 0 ? this.imagePaths : '(no images loaded)');
  }

  /**
   * Hydrate displayed session images from storagePath fields when they point to S3 objects.
   * Only runs for entries that still need data URL content.
   */
  private async hydrateSessionImagesFromStoragePaths(): Promise<void> {
    const imagesToHydrate = (this.imagePaths || []).filter((img: DisplayImage) => {
      // Check for storagePath OR S3 keys
      const needsOriginal = (!!img.storagePath || !!img.originalS3Key) && !img.original?.startsWith('data:');
      const needsWithBoxes = (!!img.withBoxesStoragePath || !!img.withBoxesS3Key) && !img.withBoxes?.startsWith('data:');
      return needsOriginal || needsWithBoxes;
    });

    if (imagesToHydrate.length === 0) {
      return;
    }

    console.log('[FeedbackPage] S3 storage-path hydration triggered', {
      sessionId: this.selectedSessionId || null,
      imageCount: imagesToHydrate.length
    });

    for (const img of imagesToHydrate) {
      try {
        // Fetch original image - try storagePath first, then S3 key as fallback
        if (!img.original?.startsWith('data:')) {
          if (img.storagePath) {
            console.log('[FeedbackPage] Hydrating original from storagePath:', img.storagePath);
            const originalData = await this.imageStorageService.fetchS3ObjectAsDataUrl(img.storagePath);
            if (originalData) {
              img.original = originalData;
            }
          } else if (img.originalS3Key) {
            // Fallback to S3 key if storagePath not available (mobile compatibility)
            console.log('[FeedbackPage] Hydrating original from S3 key:', img.originalS3Key);
            const originalData = await this.imageStorageService.fetchS3ObjectAsDataUrl(img.originalS3Key);
            if (originalData) {
              img.original = originalData;
            }
          }
        }

        // Fetch withBoxes image - try withBoxesStoragePath first, then S3 key as fallback
        if (!img.withBoxes?.startsWith('data:')) {
          if (img.withBoxesStoragePath) {
            console.log('[FeedbackPage] Hydrating withBoxes from withBoxesStoragePath:', img.withBoxesStoragePath);
            const withBoxesData = await this.imageStorageService.fetchS3ObjectAsDataUrl(img.withBoxesStoragePath);
            if (withBoxesData) {
              img.withBoxes = withBoxesData;
            }
          } else if (img.withBoxesS3Key) {
            // Fallback to S3 key if withBoxesStoragePath not available (mobile compatibility)
            console.log('[FeedbackPage] Hydrating withBoxes from S3 key:', img.withBoxesS3Key);
            const withBoxesData = await this.imageStorageService.fetchS3ObjectAsDataUrl(img.withBoxesS3Key);
            if (withBoxesData) {
              img.withBoxes = withBoxesData;
            }
          }
        }
      } catch (error) {
        console.warn('[FeedbackPage] Failed to hydrate session image from storage path', {
          filename: img.filename,
          storagePath: img.storagePath,
          withBoxesStoragePath: img.withBoxesStoragePath,
          originalS3Key: img.originalS3Key,
          withBoxesS3Key: img.withBoxesS3Key,
          error
        });
      }
    }
  }

  /**
   * Log user context for debugging (userId, sessionId, and related metadata).
   */
  private logUserContext() {
    this.displayUserAndSessionInfo();
  }

  //handles a user clicking an image in the gallaery scroller, selects it and populates the UI
  //fields from stored prediction/status, updates formDataMap, logs a detailed debug log to console for debugging
  // and auto-centers the image.
  onImageClick(img: DisplayImage) {
    // select image, chooses which image to show or display depending on 
    //showWithBoxes toggle the original or with boxes
    this.selectedImage = this.showWithBoxes ? img.withBoxes : img.original;

    //copys the image raw prediction and statusmessage into the field and updates the structured prediction/status
    this.selectedPrediction = img.rawPrediction ?? {};
    this.selectedStatusMessage = img.statusMessage ?? '';

    // apply the necessary data detection fields and dropdowns
    //Updates the visible detection text and the current dropdown 
    //selections from the image's status/prediction so the UI immediately 
    // reflects the clicked image
    if (this.selectedStatusMessage && this.selectedStatusMessage.length > 0) {
      this.detectionMessage = this.selectedStatusMessage;
      this.detectionResult = this.selectedStatusMessage;
    } else if (this.selectedPrediction) {
      const p = this.selectedPrediction;
      this.detectionMessage = p.type ? `${p.type}${p.severity ? ' â€” ' + p.severity : ''}` : 'âš ï¸ No info available';
      this.detectionResult = p.shape ? `${p.shape}${p.severity ? ' â€” ' + p.severity : ''}` : (p.severity ?? 'âš ï¸ No info available');
    }


    //update the 3 dropdown prediction values when available, otherwise fall back to image title
    this.dropdown1 = this.selectedPrediction.type ?? this.selectedImageTitle ?? 'Type';
    this.dropdown2 = this.selectedPrediction.shape ?? this.selectedImageTitle ?? 'Shape';
    this.dropdown3 = this.selectedPrediction.severity ?? this.selectedImageTitle ?? 'Severity';

    // update form map for this image
    //Ensure a persistant per-image entry in formDataMap (defaults from current UI/prediction)
    //This is used to store selections for later retrieval, saving, or export:
    // Use filename as the only primary key
    const key = img.filename || '';
    if (!key) {
      console.warn('[FeedbackPage] onImageClick: image has no filename!');
      return;
    }
    this.formDataMap[key] = this.formDataMap[key] ?? {
      title: img.filename ?? this.selectedImageTitle,
      dropdown1: this.dropdown1,
      dropdown2: this.dropdown2,
      dropdown3: this.dropdown3,
      extraText: this.selectedStatusMessage ?? ''
    };

    // Auto-center the clicked image (Android Recent Apps style)
    setTimeout(() => this.scrollSelectedImageIntoView(), 80);

    // debug output for immediate inspection
    console.log('[FeedbackPage] onImageClick debug', {
      filename: img.filename,
      selectedImageTitle: this.selectedImageTitle,
      shortImageTitle: this.getShortImageTitle(this.selectedImageTitle),
      rawPrediction: img.rawPrediction,
      statusMessage: img.statusMessage,
      selectedPrediction: this.selectedPrediction,
      detectionMessage: this.detectionMessage,
      detectionResult: this.detectionResult,
      dropdown1: this.dropdown1,
      dropdown2: this.dropdown2,
      dropdown3: this.dropdown3,
      formEntry: this.formDataMap[key]
    });

    // Persist current state so dropdown edits are saved immediately
    this.updateSelectedImageFromDropdowns();
  }

  //Smoothly center the selected image in the horizontal scroller
  //Smooth-scroll the scroller so the selected image is horizontally centered.
   
  private scrollSelectedImageIntoView(targetSrc?: string) {
    //Read the scrollContainer native element and bail if missing.
    const container = this.scrollContainer?.nativeElement as HTMLElement | undefined;
    if (!container) return;

   //Query all thumbnail img.image-item elements and bail if none found.
   //collect the thumbnail image elements inside the scroller and stop 
   //if none exist to avoid further work or runtime errors.
    const images = Array.from(container.querySelectorAll('img.image-item')) as HTMLImageElement[];
    if (!images || images.length === 0) return;

  //locate the img whose src attribute equals to the srcToFind. Bail if not found.
  //locate the img related to the selected img in the scroller based on the provided targetSrc or 
  // currently selectedImage
    const srcToFind = targetSrc || this.selectedImage || '';
    if (!srcToFind) return;

    //Locate the img whose src attribute equals the resolved srcToFind. Bail if not found.
    const selectedImg = images.find((img: HTMLImageElement) => {
      const src = img.getAttribute('src') || img.src;
      return src === srcToFind;
    }) || null;

    if (!selectedImg) return;
    
    //Measure container and image rectangles, compute center offsets, 
    //and calculate scrollNeeded so the image center matches the container center.
    const containerRect = container.getBoundingClientRect();
    const imgRect = selectedImg.getBoundingClientRect();

    const containerCenter = containerRect.width / 2;
    const imgCenter = imgRect.width / 2;
    const imgOffsetFromStart = imgRect.left - containerRect.left;
    const scrollNeeded = container.scrollLeft + imgOffsetFromStart + imgCenter - containerCenter;

    //Call container.scrollTo with computed left and behavior: 'smooth' to scroll to center the img
    container.scrollTo({
      left: scrollNeeded,
      behavior: 'smooth'
    } as ScrollToOptions);
  }
  

  /** Load sessions from the storage service and pick an active session */
  /**
   * Load sessions from ImageStorageService using several compatible APIs.
    * Only the router-provided sessionId is selected for display.
   */
  async loadSessions(): Promise<void> {
    //Get service reference
    const svc: any = this.imageStorageService as any;
    try {
      //Initialize sessions variable and try multiple service APIs to load sessions
      let sessions: any[] = [];
      if (typeof svc.getSessions === 'function') {
        sessions = await svc.getSessions();
      } else if (typeof svc.getAllSessions === 'function') {
        sessions = await svc.getAllSessions();
      } else if (Array.isArray((svc as any).sessions)) {
        sessions = (svc as any).sessions;
      } else if (typeof svc.getAll === 'function') {
        // Some implementations return an object containing sessions
        const all = await svc.getAll();
        sessions = all.sessions || all.SESSIONS || [];
      }
      this.sessions = sessions || [];

      // If the router passed a session id explicitly, use only that session.
      if (this.routeSessionId) {
        const found = this.sessions.find(s => s.id === this.routeSessionId);
        this.selectedSessionId = found ? this.routeSessionId : null;
      } else {
        this.selectedSessionId = null;
      }
    } catch (err) {
      console.warn('[FeedbackPage] loadSessions: unable to read sessions from service', err);
      this.sessions = [];
      this.selectedSessionId = null;
    }
  }

  /** Build this.imagePaths from the currently-selected session */
  /**
    * Build imagePaths array for the active session only.
   * Converts storage entries to DisplayImage for UI.
   */
  async refreshDisplayedImages(): Promise<void> {
    //Setup service reference and clear imagePaths, so it can only reflect the newly 
    // loaded images from the session. avoids duplicates on repeated calls if function is 
    // called more than ounce. allows the placeholder when empty to run without issue or predictably
    const svc: any = this.imageStorageService as any;
    this.imagePaths = [];
    try {
      // No route-passed session selected, so do not load unrelated images.
      if (!this.selectedSessionId) {
        return;
      }
      
      //Find session and handle empty session (placeholder) or session has no images
      const sess = this.sessions.find(s => s.id === this.selectedSessionId) || null;
      if (!sess || !Array.isArray(sess.imageKeys) || sess.imageKeys.length === 0) {
        // nothing in session; keep placeholder
        if (this.imagePaths.length === 0) {
          this.imagePaths.push({ original: 'assets/108644884_p0.jpg', withBoxes: 'assets/112772382_p0.jpg' });
        }
        return;
      }

      const resolveAllImages = async (): Promise<any[]> => {
        try {
          if (typeof svc.getAllImagesAsync === 'function') return await svc.getAllImagesAsync();
          if (typeof svc.getAllImages === 'function') return svc.getAllImages();
        } catch (e) {
          console.warn('[FeedbackPage] resolveAllImages failed', e);
        }
        return [];
      };

     //Load each image entry for session.imageKeys using multiple service APIs
      let allImagesCache = await resolveAllImages();
      for (const key of sess.imageKeys) {
        let entry: any = undefined;
        if (typeof svc.getEntryForImage === 'function') {
          entry = await svc.getEntryForImage(key);
        } else if (typeof svc.getEntry === 'function') {
          entry = await svc.getEntry(key);
        } else if (typeof svc.getAllEntries === 'function') {
          const all = await svc.getAllEntries();
          entry = all ? all[key] : undefined;
        }
        if (!entry && Array.isArray(allImagesCache) && allImagesCache.length > 0) {
          // Support sessions that may store non-filename keys.
          entry = allImagesCache.find((img: any) =>
            img?.filename === key ||
            img?.original === key ||
            img?.withBoxes === key ||
            img?.storagePath === key ||
            img?.withBoxesStoragePath === key ||
            img?.originalS3Key === key ||
            img?.withBoxesS3Key === key
          );
        }
        if (entry) this.imagePaths.push(this.buildDisplayImage(entry));
      }

      // If no entries resolved locally, force fetch from Firestore/S3 and retry mapping.
      if (this.imagePaths.length === 0 && this.selectedSessionId && typeof svc.fetchSessionImagesFromS3 === 'function') {
        const uid = this.userId || sess.userId || '';
        if (uid) {
          await this.runSessionLoadingWindow(async () => {
            this.sessionLoadingMessage = 'Fetching S3 images...';
            this.sessionLoadingDetail = 'Loading session images from Firestore';
            await svc.fetchSessionImagesFromS3(
              this.selectedSessionId,
              uid,
              (current: number, total: number) => {
                this.sessionLoadingTotal = total;
                this.sessionLoadingCompleted = current;
                this.sessionLoadingDetail = `Loading image ${current} of ${total}`;
              }
            );
          }, Math.max(1800, (sess.imageKeys?.length || 1) * 450));

          allImagesCache = await resolveAllImages();
          for (const key of sess.imageKeys) {
            const entry = allImagesCache.find((img: any) =>
              img?.filename === key ||
              img?.original === key ||
              img?.withBoxes === key ||
              img?.storagePath === key ||
              img?.withBoxesStoragePath === key ||
              img?.originalS3Key === key ||
              img?.withBoxesS3Key === key
            );
            if (entry) this.imagePaths.push(this.buildDisplayImage(entry));
          }
        }
      }

      const hasS3BackedImages = this.imagePaths.some((img: DisplayImage) =>
        !!img.storagePath || !!img.withBoxesStoragePath || !!img.originalS3Key || !!img.withBoxesS3Key
      );
      if (hasS3BackedImages) {
        await this.runSessionLoadingWindow(() => this.hydrateSessionImagesFromS3(), Math.max(1800, this.imagePaths.length * 450));
      } else {
        await this.hydrateSessionImagesFromS3();
      }
      //Top-level error handling
    } catch (err) {
      console.warn('[FeedbackPage] refreshDisplayedImages failed', err);
    }
  }

  private async runSessionLoadingWindow(task: () => Promise<void>, minimumDurationMs: number = 4000): Promise<void> {
    if (this.sessionLoadingWindowTimer) {
      clearTimeout(this.sessionLoadingWindowTimer);
      this.sessionLoadingWindowTimer = null;
    }

    this.showSessionLoadingWindow = true;
    this.sessionLoadingMessage = 'Fetching S3 images...';
    this.sessionLoadingDetail = 'Preparing session images';
    this.sessionLoadingCompleted = 0;
    this.sessionLoadingTotal = Math.max(this.imagePaths.length, 1);
    const startedAt = Date.now();

    try {
      await task();
    } finally {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, minimumDurationMs - elapsed);

      this.sessionLoadingWindowTimer = setTimeout(() => {
        this.showSessionLoadingWindow = false;
        this.sessionLoadingMessage = 'Fetching S3 images...';
        this.sessionLoadingDetail = 'Preparing session images';
        this.sessionLoadingCompleted = 0;
        this.sessionLoadingTotal = 0;
        this.sessionLoadingWindowTimer = null;
      }, remaining);
    }
  }

  /**
   * Hydrate loaded session images from S3 when stored paths are available.
   * Only runs for images that already have storagePath fields.
   */
  private async hydrateSessionImagesFromS3(): Promise<void> {
    const svc: any = this.imageStorageService as any;
    if (!Array.isArray(this.imagePaths) || this.imagePaths.length === 0) {
      return;
    }

    const imagesToHydrate = this.imagePaths.filter((img: DisplayImage) => 
      img?.storagePath || img?.withBoxesStoragePath || img?.originalS3Key || img?.withBoxesS3Key
    );
    if (imagesToHydrate.length === 0) {
      return;
    }

    console.log(`[FeedbackPage] S3 hydration triggered for ${imagesToHydrate.length} image(s)`);
    this.sessionLoadingTotal = imagesToHydrate.length;
    this.sessionLoadingCompleted = 0;
    // helper: try service fetch first, fall back to direct http(s) fetch->dataURL
    const fetchCandidateAsDataUrl = async (candidate: string | undefined): Promise<string | undefined> => {
      if (!candidate) return undefined;

      // If the service exposes a fetch function, try it first
      try {
        if (typeof svc.fetchS3ObjectAsDataUrl === 'function') {
          const result = await svc.fetchS3ObjectAsDataUrl(candidate);
          if (result) return result;
        }
      } catch (e) {
        console.warn('[FeedbackPage] service.fetchS3ObjectAsDataUrl failed for', candidate, e);
      }

      // If candidate looks like a URL, fetch it directly
      try {
        if (/^https?:\/\//i.test(candidate)) {
          const resp = await fetch(candidate);
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const blob = await resp.blob();
          return await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result as string);
            fr.onerror = () => reject(new Error('Failed to read blob'));
            fr.readAsDataURL(blob);
          });
        }
      } catch (e) {
        console.warn('[FeedbackPage] direct fetch failed for', candidate, e);
      }

      return undefined;
    };

    for (let index = 0; index < imagesToHydrate.length; index++) {
      const img = imagesToHydrate[index];
      const imageName = img.filename || img.fileName || '(unnamed)';
      this.sessionLoadingDetail = `Loading ${imageName} (${index + 1} of ${imagesToHydrate.length})`;

      // Build candidate list for original image
      const originalCandidates = [img.storagePath, img.storageUrl, img.originalS3Url, img.originalS3Key];
      for (const cand of originalCandidates) {
        try {
          const data = await fetchCandidateAsDataUrl(cand as string | undefined);
          if (data) {
            img.original = data;
            break;
          }
        } catch (e) {
          console.warn('[FeedbackPage] original candidate failed', { imageName, cand, e });
        }
      }

      // Build candidate list for withBoxes image
      const withBoxesCandidates = [img.withBoxesStoragePath, img.withBoxesStorageUrl, img.withBoxesS3Url, img.withBoxesS3Key];
      for (const cand of withBoxesCandidates) {
        try {
          const data = await fetchCandidateAsDataUrl(cand as string | undefined);
          if (data) {
            img.withBoxes = data;
            break;
          }
        } catch (e) {
          console.warn('[FeedbackPage] withBoxes candidate failed', { imageName, cand, e });
        }
      }

      this.printSelectedSessionImages();
      this.sessionLoadingCompleted = index + 1;
    }

    this.sessionLoadingMessage = 'S3 images ready';
    this.sessionLoadingDetail = 'Displaying hydrated session images';
  }

  // Normalize StoredImage-like object into DisplayImage 
   //Normalize a StoredImage-like object into DisplayImage used by the UI.
   //Derives detectionMessage/Result from status or prediction fields.
  buildDisplayImage(img: any): DisplayImage {
    //Extract prediction object supports different field names for the UI
    const prediction = img.prediction ?? img.rawPrediction ?? undefined;

    //Normalize individual prediction fields and build detectionMessage/detectionResult strings
    //this extracts the fields safely avoid undefeinded by assigning each string with an empty string fallback, 
    //they are then used to build human readable detection strings for later use and
    //its to help in the flow to display the data or values for later
    const predType = prediction?.type ?? '';
    const predShape = prediction?.shape ?? '';
    const predSeverity = prediction?.severity ?? '';

    //get the detectionMessage prefer human-readable statusMessage, else type+severity
    const detectionMessage = img.statusMessage && img.statusMessage.length > 0
      ? img.statusMessage
      : (predType || predSeverity) ? `${predType}${predSeverity ? ' â€” ' + predSeverity : ''}` : '';

    //Compute detectionResult prefer to get statusMessage, else shape+severity
    const detectionResult = img.statusMessage && img.statusMessage.length > 0
      ? img.statusMessage
      : (predShape || predSeverity) ? `${predShape}${predSeverity ? ' â€” ' + predSeverity : ''}` : '';

    //Build return object: choose withBoxes fallback, derive filename, 
    // include normalized prediction/status, and include S3 keys for mobile compatibility
      return {
      original: img.original,
      withBoxes: img.withBoxes ?? img.original,
      filename: img.filename || '',
      fileName: img.filename || '',
        storagePath: img.storagePath,
        withBoxesStoragePath: img.withBoxesStoragePath,
        storageUrl: img.storageUrl,
        withBoxesStorageUrl: img.withBoxesStorageUrl,
        originalS3Key: img.originalS3Key,
        withBoxesS3Key: img.withBoxesS3Key,
        originalS3Url: img.originalS3Url,
        withBoxesS3Url: img.withBoxesS3Url,
      detectionMessage,
      detectionResult,
      rawPrediction: prediction ? { type: predType, shape: predShape, severity: predSeverity } : undefined,
      statusMessage: img.statusMessage
    } as DisplayImage;
  }



  /**
   * Debounced scroll handler; re-detect the centered image after scrolling.
   */
  onScroll(event: any) {
    //clear previous timeout  , cancels any pending debounce timer to 
    // avoid multiple trigger during scrolling continuously
  clearTimeout((event as any)._timeout);

  // schedule a single callbar when scrolling stops to avoid excessive calls or triggers, 
  //timer is stored on the event object so repeatede events can clear or restart it
  (event as any)._timeout = setTimeout(() => {
    //call detectCenterImage function to update the selected image or thumbnail is centered 
    // based on new scroll position and refresh UI state
    this.detectCenterImage();
  }, 100);
}

  /**
   * Centering helper to apply classes for single/double items in the scroller.
   */
  /**
   * Helper to style the scroller differently for 1 or 2 items.
   */
  getScrollClasses(count: number) {
    return {
      'single-thumb': count === 1,
      'double-thumb': count === 2,
    };
  }

  /** Dropdowns are read-only for users; editable for engineers. */
  get isUserReadOnly(): boolean {
    return (this.userRole || 'user').toLowerCase() === 'user';
  }

  onEngineerLookedToggle(checked: boolean): void {
    this.engineerLookedSessionChecked = checked;
    console.log('[FeedbackPage] Engineer has looked the session:', checked ? 'checked' : 'unchecked');
  }

  /**
   * Log the notes text to console.
   */
  logNotesToConsole(): void {
    console.log('[FeedbackPage] Notes Text:', this.notesText);
  }

/**
 * Determine the image closest to the horizontal center and update UI bindings
 * (selected image, prediction/status, dropdown option lists, and formDataMap).
 */
detectCenterImage() {
  //Read container, images, and compute horizontal center
  const container = this.scrollContainer.nativeElement as HTMLElement;
  const images = container.querySelectorAll('img');
  const containerRect = container.getBoundingClientRect();
  const centerX = containerRect.left + containerRect.width / 2;
  
  //Find the image whose center is closest to the container center
  let closestImg: HTMLImageElement | null = null;
  let closestDistance = Infinity;

  images.forEach(img => {
    const rect = img.getBoundingClientRect();
    const imgCenter = rect.left + rect.width / 2;
    const distance = Math.abs(centerX - imgCenter);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestImg = img;
    }
  });
    
  //Resolve the matched DisplayImage entry from the school for the closest DOM <img>
  if (closestImg) {
    const src = (closestImg as HTMLImageElement).getAttribute('src') ?? '';
    const matched = this.imagePaths.find(img => img.original === src || img.withBoxes === src);
    if (!matched) return;

    //Update selectedImage from the scroll and get 
    //detectionMessage prefer statusMessage, else prediction.type
  this.selectedImage = this.showWithBoxes ? matched.withBoxes : matched.original;
  // Prefer stored statusMessage; otherwise build readable strings from prediction
  if (matched.statusMessage && matched.statusMessage.length > 0) {
    this.detectionMessage = matched.statusMessage;
  } else if (matched.rawPrediction) {
    const p = matched.rawPrediction;
    this.detectionMessage = p.type ? `${p.type}${p.severity ? ' â€” ' + p.severity : ''}` : 'âš ï¸ No info available';
  } else {
    this.detectionMessage = 'âš ï¸ No info available';
  }

  
  //get detectionResult prefer prediction.shape+severity, else statusMessage
  if (matched.rawPrediction) {
    const p = matched.rawPrediction;
    this.detectionResult = p.shape ? `${p.shape}${p.severity ? ' â€” ' + p.severity : ''}` : (p.severity ?? 'âš ï¸ No info available');
  } else if (matched.statusMessage && matched.statusMessage.length > 0) {
    this.detectionResult = matched.statusMessage;
  } else {
    this.detectionResult = 'âš ï¸ No info available';
  }

  //Set selectedImageTitle, selectedPrediction, and selectedStatusMessage

  // Set the title from the stored filename if available
  this.selectedImageTitle = matched.fileName ?? '';

  // Debug: Log both full and shortened titles
  console.group('[FeedbackPage] ðŸ“‹ Image Title Debug');
  console.log('Full selectedImageTitle:', this.selectedImageTitle);
  console.log('Shortened title:', this.getShortImageTitle(this.selectedImageTitle));
  console.groupEnd();

  // Populate structured prediction and status for UI use
  this.selectedPrediction = matched.rawPrediction ?? {};
  this.selectedStatusMessage = matched.statusMessage ?? '';

  // Immediately prefer prediction values for dropdowns so the UI reflects
  // the selected image's prediction right away (overrides filename fallback).
  // and initialize dropdowns and extraText from prediction/title
  this.dropdown1 = this.selectedPrediction.type ?? this.selectedImageTitle;
  this.dropdown2 = this.selectedPrediction.shape ?? this.selectedImageTitle;
  this.dropdown3 = this.selectedPrediction.severity ?? this.selectedImageTitle;
  this.extraText = this.selectedStatusMessage ?? '';

  // Ensure a per-image entry exists in formDataMap and update it with current UI values.
  // Initialize defaults if missing; otherwise patch dropdowns/extraText to persist 
  // from the selections.
  if (!this.formDataMap[src]) {
    this.formDataMap[src] = {
      title: this.selectedImageTitle,
      dropdown1: this.dropdown1,
      dropdown2: this.dropdown2,
      dropdown3: this.dropdown3,
      extraText: this.extraText
    };
  } else {
    this.formDataMap[src].dropdown1 = this.dropdown1;
    this.formDataMap[src].dropdown2 = this.dropdown2;
    this.formDataMap[src].dropdown3 = this.dropdown3;
    this.formDataMap[src].extraText = this.extraText;
  }
    

  
    //fore testing purposes
    // const titleMap: { [key: string]: string } = {
    //   'img1': 'Sunset View',
    //   'img2': 'Mountain Range',
    //   'img3': 'Ocean Breeze',
    //   '108644884_p0': 'Crack Type A',
    //   '112772382_p0': 'Crack Type B',
    //   '113341201_p0': 'Crack Type C',
    //   'test2': 'Test Image',
    //   'tower': 'Tower Damage'
    // };

    
    //Ensure and update per-image formDataMap entry
    if (!this.formDataMap[src]) {
      // Initialize the form defaults using prediction values when available
      this.formDataMap[src] = {
        title: this.selectedPrediction.type ?? this.selectedImageTitle ?? 'Image',
        dropdown1: this.selectedPrediction.type ?? this.selectedImageTitle,
        dropdown2: this.selectedPrediction.shape ?? this.selectedImageTitle,
        dropdown3: this.selectedPrediction.severity ?? this.selectedImageTitle,
        extraText: this.selectedStatusMessage ?? ''
      };
    }

    //Apply stored form values to current dropdowns and build option lists
    const form = this.formDataMap[src];
    this.dropdown1 = form.dropdown1;
    this.dropdown2 = form.dropdown2;
    this.dropdown3 = form.dropdown3;
    this.extraText = form.extraText;

    const optType = (this.selectedPrediction.type && this.selectedPrediction.type.trim()) || this.selectedImageTitle || 'Type';
    const optShape = (this.selectedPrediction.shape && this.selectedPrediction.shape.trim()) || this.selectedImageTitle || 'Shape';
    const optSeverity = (this.selectedPrediction.severity && this.selectedPrediction.severity.trim()) || this.selectedImageTitle || 'Severity';

    this.dropdownOptions = [
      optType,
      'Negligible',
      'moderate',
      'severe',
      'very severe'
    ];

    this.dropdownOptionsDirection = [
      optType,
      'Horizontal',
      'Vertical',
      'Diagonal',
      'Straight'
    ];

    this.dropdownOptionsShape = [
      optShape,
      'Bulge',
      'Vertical',
      'Diagonal'
    ];

    this.dropdownOptionsSeverity = [
      optSeverity,
      'hairline',
      'Negligible',
      'moderate',
      'severe',
      'very severe'
    ];
  }
}

  /**
   * Debug helper: fetch stored images from the ImageStorageService and print
   * their raw prediction/status and the computed detectionMessage/detectionResult.
   * This attempts several possible retrieval APIs to stay compatible with
   * different ImageStorageService implementations in the project.
   */
  /**
   * Debug: print a table of stored images with prediction/status derived strings.
   * Attempts several service APIs to stay compatible across implementations.
   */
  debugLogStoredImages() {
    //Service reference and initialize image list
    const svc: any = this.imageStorageService as any;
    let imgs: any[] = [];

    //Read images from storage using multiple compatible APIs (try in-order)
    try {
      if (typeof svc.getAllImages === 'function') {
        imgs = svc.getAllImages();
      } else if (typeof svc.getImages === 'function') {
        imgs = svc.getImages();
      } else if (typeof svc.getAllEntries === 'function') {
        const entries = svc.getAllEntries();
        imgs = Object.values(entries || {});
      } else if (typeof svc.getAll === 'function') {
        imgs = svc.getAll();
      }
    } catch (err) {
      console.warn('[FeedbackPage] debugLogStoredImages: failed to read images from service', err);
      return;
    }

    //Log summary count
    console.log(`[FeedbackPage] debugLogStoredImages - found ${imgs.length} images`);

    //Map stored images to readable rows (extract prediction/status and derive display strings) 
    const rows = imgs.map((img: any) => {
      const prediction = img.prediction ?? img.rawPrediction ?? undefined;
      const status = img.statusMessage ?? img.detectionMessage ?? '';

      let detectionMessage = '';
      if (status && status.length > 0) {
        detectionMessage = status;
      } else if (prediction) {
        detectionMessage = prediction.type ? `${prediction.type}${prediction.severity ? ' â€” ' + prediction.severity : ''}` : 'âš ï¸ No info available';
      } else {
        detectionMessage = 'âš ï¸ No info available';
      }

      let detectionResult = '';
      if (prediction) {
        detectionResult = prediction.shape ? `${prediction.shape}${prediction.severity ? ' â€” ' + prediction.severity : ''}` : (prediction.severity ?? 'âš ï¸ No info available');
      } else if (status && status.length > 0) {
        detectionResult = status;
      } else {
        detectionResult = 'âš ï¸ No info available';
      }

      return {
        filename: img.filename ?? img.fileName ?? (img.original && img.original.split ? img.original.split('/').pop() : ''),
        original: img.original,
        detectionMessage,
        detectionResult,
        rawPrediction: prediction,
        statusMessage: status
      };
    });
    
    //Print table and detailed grouped logs for debugging
    console.table(rows);
    console.group('[FeedbackPage] storedImages detail');
    rows.forEach(r => console.log(r.filename || '(unnamed)', r));
    console.groupEnd();
  }


  /**
   * Flatten the formDataMap into an array and navigate to PDF page prototype.
   */
  getAllEntries() {
    //Flatten formDataMap into an array
  const allEntries = Object.entries(this.formDataMap).map(([image, data]) => ({
    image,
    ...data
  }));
  //Log the flattened entries for debugging
  console.log('All Entries:', allEntries);
  //Navigate to the PDF page (side-effect: route change)
  // this.router.navigate(['/pdfpage01']);
    console.log('Navigating to Sign Up page');
    //Return the array of entries to the caller
  return allEntries;
}

  

/**
 * Persist current dropdown/text selections into formDataMap for selected image.
 */
addEntry() {
  //Guard: ensure an image is selected (early return)
  if (!this.selectedImage) return;

  //Persist current UI values into formDataMap for the selected image
  this.updateSelectedImageFromDropdowns();
  //Debug & log confirmation
  console.log(`Form saved for ${this.selectedImageTitle}`);
}

  /**
   * Update the in-memory image entry + formDataMap with the current dropdown/text values.
   * This keeps prediction/type/shape/severity in sync after user edits.
   */
  updateSelectedImageFromDropdowns() {
    // Find the selected DisplayImage (match either original or withBoxes src)
    const matched = this.imagePaths.find(img => img.original === this.selectedImage || img.withBoxes === this.selectedImage);
    if (!matched) return;

    // Use filename as primary key, fallback to original for backward compatibility
    const key = matched.fileName || matched.filename || matched.original;

    // Update prediction fields from dropdowns
    matched.rawPrediction = matched.rawPrediction || {};
    matched.rawPrediction.type = this.dropdown1;
    matched.rawPrediction.shape = this.dropdown2;
    matched.rawPrediction.severity = this.dropdown3;

    // Update status/extra text
    matched.statusMessage = this.extraText || matched.statusMessage || '';

    // Recompute derived detection strings
    matched.detectionMessage = matched.statusMessage && matched.statusMessage.length > 0
      ? matched.statusMessage
      : `${matched.rawPrediction.type || ''}${matched.rawPrediction.severity ? ' â€” ' + matched.rawPrediction.severity : ''}`.trim();

    matched.detectionResult = matched.statusMessage && matched.statusMessage.length > 0
      ? matched.statusMessage
      : `${matched.rawPrediction.shape || ''}${matched.rawPrediction.severity ? ' â€” ' + matched.rawPrediction.severity : ''}`.trim();

    // Sync selected* fields so UI reflects latest edits
    this.selectedPrediction = { ...matched.rawPrediction };
    this.selectedStatusMessage = matched.statusMessage;
    this.detectionMessage = matched.detectionMessage;
    this.detectionResult = matched.detectionResult;

    // Persist form data map entry using the original key
    this.formDataMap[key] = {
      title: matched.fileName ?? this.selectedImageTitle,
      dropdown1: this.dropdown1,
      dropdown2: this.dropdown2,
      dropdown3: this.dropdown3,
      extraText: this.extraText
    };

    // Persist back to storage so Results Dashboard sees the updated prediction
    const svc: any = this.imageStorageService as any;
    const existingEntry = typeof svc.getEntryForImage === 'function' ? svc.getEntryForImage(key) : undefined;
    const updatedStored: any = existingEntry ? { ...existingEntry } : {
      original: key,
      withBoxes: matched.withBoxes,
      filename: matched.fileName ?? this.selectedImageTitle,
      timestamp: new Date().toISOString()
    };

    updatedStored.prediction = {
      type: this.dropdown1,
      shape: this.dropdown2,
      severity: this.dropdown3
    };
    // Keep optional rawPrediction/status fields aligned for consumers that read them
    (updatedStored as any).rawPrediction = updatedStored.prediction;
    updatedStored.statusMessage = matched.statusMessage;
    updatedStored.detectionMessage = matched.detectionMessage;
    updatedStored.detectionResult = matched.detectionResult;

    if (typeof svc.setEntryForImage === 'function') {
      svc.setEntryForImage(key, updatedStored);
    }

    // Also refresh selectedImage to the correct src based on toggle
    this.selectedImage = this.showWithBoxes ? matched.withBoxes : matched.original;
  }



  /**
   * Delete the currently-selected image from storage and update the UI.
   * Uses the ImageStorageService.removeImageByOriginal method (added to service).
   */
  /**
   * Delete the currently-selected image from ImageStorageService and update UI.
   * If list becomes empty, clears selection and associated fields.
   */
  async deleteSelectedImage() {
    //Guard: ensure an image is selected
    if (!this.selectedImage) {
      console.warn('[FeedbackPage] deleteSelectedImage: no image selected');
      return;
    }

    // find the matching image entry in the display list (match either original or withBoxes)
    const idx = this.imagePaths.findIndex(img => img.original === this.selectedImage || img.withBoxes === this.selectedImage);
    if (idx === -1) {
      console.warn('[FeedbackPage] deleteSelectedImage: selected image not found in imagePaths');
      return;
    }
    
    //Prepare metadata and ask for user confirmation
    const matched = this.imagePaths[idx];
    const filename = matched.filename || '(unnamed)';

    const confirmMsg = `Delete image "${filename}"? This action cannot be undone.`;
    if (!confirm(confirmMsg)) return;

    //Delete from storage service using filename as key
    try {
      if (!matched.filename) {
        console.warn('[FeedbackPage] Image has no filename, cannot delete');
        return;
      }
      
      const removed = await this.imageStorageService.deleteImage(matched.filename);
      if (!removed) {
        console.warn('[FeedbackPage] deleteSelectedImage: deleteImage reported nothing removed');
      }

      // remove from in-memory display list and update selection
      this.imagePaths.splice(idx, 1);

      if (this.imagePaths.length > 0) {
        const first = this.imagePaths[0];
        this.selectedImage = this.showWithBoxes ? first.withBoxes : first.original;
        this.selectedPrediction = first.rawPrediction ?? {};
        this.selectedStatusMessage = first.statusMessage ?? '';
        this.selectedImageTitle = first.filename ?? '';

        // Debug: Log both full and shortened titles after deletion
        console.group('[FeedbackPage] ðŸ“‹ Image Title Debug (After Deletion)');
        console.log('Full selectedImageTitle:', this.selectedImageTitle);
        console.log('Shortened title:', this.getShortImageTitle(this.selectedImageTitle));
        console.log('Remaining images:', this.imagePaths.length);
        console.groupEnd();

        // update dropdowns and detection strings
        if (this.selectedStatusMessage && this.selectedStatusMessage.length > 0) {
          this.detectionMessage = this.selectedStatusMessage;
          this.detectionResult = this.selectedStatusMessage;
        } else if (this.selectedPrediction) {
          const p = this.selectedPrediction;
          this.detectionMessage = p.type ? `${p.type}${p.severity ? ' â€” ' + p.severity : ''}` : 'âš ï¸ No info available';
          this.detectionResult = p.shape ? `${p.shape}${p.severity ? ' â€” ' + p.severity : ''}` : (p.severity ?? 'âš ï¸ No info available');
        }

        this.dropdown1 = this.selectedPrediction.type ?? this.selectedImageTitle;
        this.dropdown2 = this.selectedPrediction.shape ?? this.selectedImageTitle;
        this.dropdown3 = this.selectedPrediction.severity ?? this.selectedImageTitle;
      } else {
        // cleared all images â€” reset UI
        //Reset UI when all images removed, if only all 
        // images are removed or no images in the session currently
        this.selectedImage = '';
        this.selectedPrediction = {};
        this.selectedStatusMessage = '';
        this.selectedImageTitle = '';
        this.detectionMessage = '';
        this.detectionResult = '';

        // Debug: Log when all images cleared
        console.group('[FeedbackPage] ðŸ“‹ Image Title Debug (All Cleared)');
        console.log('All images deleted - selectedImageTitle reset to empty');
        console.log('Full selectedImageTitle:', this.selectedImageTitle);
        console.log('Shortened title:', this.getShortImageTitle(this.selectedImageTitle));
        console.groupEnd();
        this.dropdown1 = '';
        this.dropdown2 = '';
        this.dropdown3 = '';
      }

      // Helpful debug output after deletion and refresh logs after deletion
      console.log(`[FeedbackPage] deleteSelectedImage: removed ${filename}. Remaining images: ${this.imagePaths.length}`);
      this.debugLogStoredImages();
    } catch (err) {
      console.error('[FeedbackPage] deleteSelectedImage failed', err);
    }
  }


  
  
  /** Navigate back to Home Page, fallback to history.back on failure. */
  async goBack() {
    try {
      const sessionId = this.routeSessionId || this.selectedSessionId || null;
      if (sessionId && (this.imageStorageService as any).saveSessionWithImagesToFirestore) {
        try { await (this.imageStorageService as any).saveSessionWithImagesToFirestore(sessionId); } catch (e) { /* ignore */ }
      }

      // Try to navigate back in app history (preferred) or app level back navigation if from camera , upload or home
      try { this.navCtrl.back(); return; } catch (e) { /* ignore and fallback */ }

      // Fallback to browser history.back when navController isn't effective, 
      // checks the browser history for fallback
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
    
      // Final fallback: navigate to home page
      this.router.navigateByUrl('/home-page2');
    } catch (e) {
      try { window.history.back(); } catch (err) { /* no-op */ }
    }
  }

  /** Template shim for hardware/back-button wiring. */
  onBack() {
    this.goBack();
  }

  /**
   * Fast back-button handler for touch and mouse input.
   * Pointer-down starts navigation immediately; the click fallback is ignored
   * if it follows the pointer event within a short debounce window.
   */
  handleBackTap(event: Event) {
    event.preventDefault();
    event.stopPropagation();

    const now = Date.now();
    if (this.backNavigationInProgress || now - this.lastBackTapAt < 400) {
      return;
    }

    this.backNavigationInProgress = true;
    this.lastBackTapAt = now;

    void this.goBack().finally(() => {
      setTimeout(() => {
        this.backNavigationInProgress = false;
      }, 250);
    });
  }

  ionViewDidEnter() {
    this.logCurrentUserRoleOnEnter();
    this.registerBackButtonHandler();
  }

  ionViewWillLeave() {
    this.removeBackButtonHandler();
    if (this.sessionLoadingWindowTimer) {
      clearTimeout(this.sessionLoadingWindowTimer);
      this.sessionLoadingWindowTimer = null;
    }
    this.showSessionLoadingWindow = false;
  }

  private registerBackButtonHandler() {
    try {

      //Ensures any prior or past hardware back button subscription is removed 
      // before adding a new one.
      this.removeBackButtonHandler();

      //subscribe the platform or hardware back button with a priority handler 
      // and saves it to override the default nav, so it can be removed later
      this.backButtonSub = this.platform.backButton.subscribeWithPriority(100, () => {
        try {
          this.goBack();
        } catch (e) {
          try { window.history.back(); } catch (err) { this.router.navigateByUrl('/home-page2'); }
        }
      });
    } catch (e) {
      //Catches and logs any errors thrown while wiring the handler.
      console.warn('[FeedbackPage] registerBackButtonHandler failed', e);
    }
  }


  private removeBackButtonHandler() {
    try {
      //If subscription supports unsubscribe(), first try that to remove the handler
      if (this.backButtonSub && typeof this.backButtonSub.unsubscribe === 'function') {
        try { this.backButtonSub.unsubscribe(); } catch (e) {}
        //if subscription exposes remove(), second for insurance or ensure removal
      } else if (this.backButtonSub && typeof this.backButtonSub.remove === 'function') {
        try { this.backButtonSub.remove(); } catch (e) {}
      }
    } catch (e) {}
    //clear the reference so handler is considered removed
    this.backButtonSub = null;
  }


  /** Navigate to results dashboard page, preserving sessionId when present. */
  viewResults() {
    // Navigate to results page with current sessionId if available
    const sessionId = this.routeSessionId || null;

    //Navigate with session id
    if (sessionId) {
      this.router.navigate(['/results-dashboard'], { queryParams: { sessionId } });
    } else {

      //Navigate without session id
      this.router.navigate(['/results-dashboard']);
    }
  }

  /**
   * Debug function: Test and verify S3 fetch status.
   * Logs detailed information about loaded images and their S3 data.
   */
  testS3Fetch() {
    console.group('[FeedbackPage] Debug S3 Fetch Test');
    
    console.log('Total images loaded:', this.imagePaths.length);
    console.log('Current session ID:', this.selectedSessionId || '(none)');
    console.log('Route session ID:', this.routeSessionId || '(none)');
    
    if (this.imagePaths.length === 0) {
      console.warn('No images loaded');
    } else {
      console.table(this.imagePaths.map((img, idx) => ({
        index: idx,
        filename: img.filename || img.fileName || '(unnamed)',
        hasOriginal: !!img.original && img.original.length > 0,
        originalLength: img.original?.length || 0,
        isOriginalDataUrl: img.original?.startsWith('data:') ? 'YES' : 'NO',
        hasWithBoxes: !!img.withBoxes && img.withBoxes.length > 0,
        withBoxesLength: img.withBoxes?.length || 0,
        isWithBoxesDataUrl: img.withBoxes?.startsWith('data:') ? 'YES' : 'NO',
        storagePath: img.storagePath || '(none)',
        originalS3Key: img.originalS3Key || '(none)',
        hasPrediction: !!img.rawPrediction,
        statusMessage: img.statusMessage || '(none)'
      })));

      const s3Status = this.imagePaths.map((img, idx) => {
        const hasDataUrl = (img.original?.startsWith('data:') || false) && (img.withBoxes?.startsWith('data:') || false);
        const hasSizableData = (img.original?.length || 0) > 1000 && (img.withBoxes?.length || 0) > 1000;
        return {
          index: idx,
          name: img.filename || '(unnamed)',
          loaded: hasDataUrl ? 'LOADED' : 'PENDING',
          sizable: hasSizableData ? 'OK' : 'SMALL',
          status: hasDataUrl && hasSizableData ? 'READY' : 'PENDING/FAILED'
        };
      });

      console.log('\nS3 Hydration Status:');
      console.table(s3Status);
    }

    console.log('\nLoading window state:');
    console.log('showSessionLoadingWindow:', this.showSessionLoadingWindow);
    console.log('sessionLoadingMessage:', this.sessionLoadingMessage);
    console.log('sessionLoadingDetail:', this.sessionLoadingDetail);
    console.log('sessionLoadingCompleted:', this.sessionLoadingCompleted);
    console.log('sessionLoadingTotal:', this.sessionLoadingTotal);

    console.groupEnd();

    const readyCount = this.imagePaths.filter(img => 
      img.original?.startsWith('data:') && img.withBoxes?.startsWith('data:')
    ).length;
    alert(`S3 Fetch Status:\nReady: ${readyCount}/${this.imagePaths.length} images\n\nCheck console for full details.`);
  }

  /**
   * Shorten the image title by removing userID, sessionId, and img1 prefixes.
   * Example: "userID:abc123sessionId:xyz789img1crack1041120261109.jpg" â†’ "crack1041120261109.jpg"
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

  /**
   * Ensure an image entry has canonical prediction fields before persistence.
   * Some flows only set rawPrediction; Firestore save reads prediction.
   */
  private normalizePredictionFields(entry: any): any {
    if (!entry) return entry;

    const imageKey = entry.filename || entry.fileName || entry.original || '';
    const form = (imageKey && this.formDataMap[imageKey]) ? this.formDataMap[imageKey] : undefined;

    const type =
      entry?.prediction?.type ??
      entry?.rawPrediction?.type ??
      form?.dropdown1 ??
      this.selectedPrediction?.type ??
      this.dropdown1 ??
      '';

    const shape =
      entry?.prediction?.shape ??
      entry?.rawPrediction?.shape ??
      form?.dropdown2 ??
      this.selectedPrediction?.shape ??
      this.dropdown2 ??
      '';

    const severity =
      entry?.prediction?.severity ??
      entry?.rawPrediction?.severity ??
      form?.dropdown3 ??
      this.selectedPrediction?.severity ??
      this.dropdown3 ??
      '';

    const hasPrediction = !!(type || shape || severity);
    if (hasPrediction) {
      entry.prediction = { type, shape, severity };
      entry.rawPrediction = { type, shape, severity };
      entry.hasPrediction = true;
    } else {
      entry.prediction = entry.prediction ?? null;
      entry.rawPrediction = entry.rawPrediction ?? undefined;
      entry.hasPrediction = false;
    }

    if (!entry.detectionMessage || entry.detectionMessage.length === 0) {
      entry.detectionMessage = entry.statusMessage && entry.statusMessage.length > 0
        ? entry.statusMessage
        : `${type || ''}${severity ? ' â€” ' + severity : ''}`.trim();
    }

    if (!entry.detectionResult || entry.detectionResult.length === 0) {
      entry.detectionResult = entry.statusMessage && entry.statusMessage.length > 0
        ? entry.statusMessage
        : `${shape || ''}${severity ? ' â€” ' + severity : ''}`.trim();
    }

    return entry;
  }

/**
   * Save the currently-selected StoredImage (or the service current image) as a session,
   * update the storage entry, show a confirmation popup and navigate to home.
   */
  /**
   * Save current image into a session (create or update), prompt for a name,
   * and navigate back to Home upon confirmation.
   */
  async saveCurrentStoredImageAndGoHome() {
    try {
      // Try service current image first
      //Try to get the service "current image"
      let entry: any = undefined;
      try {
        entry = (this.imageStorageService as any).getCurrentImage ? (this.imageStorageService as any).getCurrentImage() : undefined;
      } catch (e) {
        // ignore
      }

      // Fallback: try to locate via selectedImage path in the display list
      //find the selected image in the current display list and build a storage en
      if (!entry && this.selectedImage) {
        const found = this.imagePaths.find(p => p.original === this.selectedImage || p.withBoxes === this.selectedImage);
        if (found) {
          entry = {
            original: found.original,
            withBoxes: found.withBoxes,
            boxes: [],
            faceDetected: false,
            faceData: [],
            timestamp: new Date().toISOString(),
            detectionMessage: found.detectionMessage ?? '',
            filename: found.fileName,
            rawPrediction: found.rawPrediction,
            statusMessage: 'Saved as session'
          };
        }
      }

      //If no entry found, show alert and abort
      if (!entry) {
        alert('No image selected to save. Please select an image first.');
        return;
      }

      // mark entry as saved session and persist to service
      entry = this.normalizePredictionFields(entry);
      entry.statusMessage = entry.statusMessage ?? 'Saved as session';
      if ((this.imageStorageService as any).setEntryForImage) {
        // Use filename as key, fallback to original for backward compatibility
        const imageKey = entry.filename || entry.original;
        (this.imageStorageService as any).setEntryForImage(imageKey, entry);
      } else if ((this.imageStorageService as any).createAndAdd) {
        await (this.imageStorageService as any).createAndAdd(entry);
      }

      // Prompt user for session name and allow Save or Cancel via custom overlay
      try {
        await this.showSaveSessionPrompt(entry);
      } catch (e) {
        console.warn('Session prompt failed', e);
      }
    } catch (err) {
      console.error('Failed to save session', err);
      alert('Failed to save session. See console for details.');
    }
  }


  /** Show an overlay to name and save the session or cancel */
   // Show an inline overlay to name the session and persist via storage service.
   //Resolves after user clicks Save or Cancel; navigates Home on save.
  //create a Promise that resolves after user action (Save/Cancel)
  async showSaveSessionPrompt(entry: any): Promise<void> {
    return new Promise((resolve) => {

      // Create full-screen overlay element and style it
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.left = '0';
      overlay.style.top = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.background = 'rgba(0,0,0,0.45)';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.zIndex = '9999';
     
      //Create dialog box (card) and style
      const box = document.createElement('div');
      box.style.border = '1px solid transparent';
      box.style.background = 'linear-gradient(#fff, #fff) padding-box, linear-gradient(to right, #ff512f, #f09819) border-box';
      box.style.padding = '18px';
      box.style.borderRadius = '8px';
      box.style.minWidth = '300px';
      box.style.boxShadow = '0 6px 30px rgba(0,0,0,0.3)';

      //Title for inactive state
      const title = document.createElement('div');
      title.innerText = 'Save current session with a';
      title.style.fontWeight = '700';
      title.style.marginBottom = '4px';
      title.style.fontSize = '16px';

      const titleSubtext = document.createElement('div');
      titleSubtext.innerText = 'session name';
      titleSubtext.style.fontWeight = '700';
      titleSubtext.style.marginBottom = '12px';
      titleSubtext.style.fontSize = '16px';

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = `Session ${new Date().toLocaleString()}`;
      input.style.width = '100%';
      input.style.padding = '8px';
      input.style.marginBottom = '12px';
      input.style.border = '1px solid #ccc';
      input.style.borderRadius = '4px';
      input.style.boxSizing = 'border-box';

      //Create the bottom row for the Cancel and Save buttons and style them
      const btnRow = document.createElement('div');
      btnRow.style.display = 'flex';
      btnRow.style.justifyContent = 'center';
      btnRow.style.gap = '12px';

      const cancelBtn = document.createElement('button');
      cancelBtn.innerText = 'Cancel';
      cancelBtn.style.padding = '8px 16px';
      cancelBtn.style.width = '120px';
      cancelBtn.style.height = '40px';
      cancelBtn.style.border = 'none';
      cancelBtn.style.background = 'linear-gradient(90deg,#ff512f,#f09819)';
      cancelBtn.style.color = '#fff';
      cancelBtn.style.borderRadius = '6px';
      cancelBtn.style.cursor = 'pointer';
      cancelBtn.style.fontWeight = '600';

      const saveBtn = document.createElement('button');
      saveBtn.innerText = 'Save';
      saveBtn.style.padding = '8px 16px';
      saveBtn.style.width = '120px';
      saveBtn.style.height = '40px';
      saveBtn.style.border = 'none';
      saveBtn.style.background = 'linear-gradient(90deg,#ff512f,#f09819)';
      saveBtn.style.color = '#fff';
      saveBtn.style.borderRadius = '6px';
      saveBtn.style.cursor = 'pointer';
      saveBtn.style.fontWeight = '600';
       
      // Cancel handler for inactive state
      cancelBtn.addEventListener('click', () => {
        try { document.body.removeChild(overlay); } catch (e) {}
        resolve();
      });

      // Save handler - transitions to active state with progress bar
      saveBtn.addEventListener('click', async () => {
        try {
          // Transition to ACTIVE STATE - Clear the inactive state UI
          while (box.firstChild) {
            box.removeChild(box.firstChild);
          }

          // Create active state UI with progress bar
          const activeTitle = document.createElement('div');
          activeTitle.innerText = 'Saving current session:';
          activeTitle.style.fontWeight = '700';
          activeTitle.style.marginBottom = '16px';
          activeTitle.style.fontSize = '16px';

          // Progress percentage text
          const progressLabel = document.createElement('div');
          progressLabel.innerText = 'Saving Session: 0%';
          progressLabel.style.marginBottom = '8px';
          progressLabel.style.fontSize = '14px';
          progressLabel.style.fontWeight = '600';
          progressLabel.style.color = '#333';

          // Progress bar container
          const progressBarContainer = document.createElement('div');
          progressBarContainer.style.width = '100%';
          progressBarContainer.style.height = '12px';
          progressBarContainer.style.background = '#e0e0e0';
          progressBarContainer.style.borderRadius = '6px';
          progressBarContainer.style.overflow = 'hidden';
          progressBarContainer.style.marginBottom = '16px';

          // Progress bar fill with gradient
          const progressBarFill = document.createElement('div');
          progressBarFill.style.width = '0%';
          progressBarFill.style.height = '100%';
          progressBarFill.style.background = 'linear-gradient(90deg, #00ff00, #ffff00, #ff6600, #ff0000)';
          progressBarFill.style.transition = 'width 0.3s ease';

          progressBarContainer.appendChild(progressBarFill);

          // Helper function to update progress
          const updateProgress = (percentage: number, label: string) => {
            const clampedPercentage = Math.min(Math.max(percentage, 0), 100);
            progressBarFill.style.width = clampedPercentage + '%';
            progressLabel.innerText = label;
          };

          box.appendChild(activeTitle);
          box.appendChild(progressLabel);
          box.appendChild(progressBarContainer);

          // Disable buttons during save
          saveBtn.disabled = true;
          cancelBtn.disabled = true;

          const val = input.value && input.value.trim().length > 0 ? input.value.trim() : `Session ${new Date().toLocaleString()}`;
          const svc: any = this.imageStorageService as any;
          const imageKey = entry.filename || entry.original;
          let savedSessionId: string | null = null;

          updateProgress(5, 'Saving Session: 5%');

          // If a session is already selected (e.g., from Camera page), update it
          if (this.selectedSessionId && typeof svc.addImageToSession === 'function') {
            try {
              svc.addImageToSession(this.selectedSessionId, imageKey);
            } catch (e) {
              console.warn('[FeedbackPage] failed to add image to existing session', e);
            }
            if (typeof svc.updateSessionName === 'function') {
              try { svc.updateSessionName(this.selectedSessionId, val); } catch (e) { /* ignore */ }
            }
            // update notes on existing session if supported
            if (typeof svc.updateSessionNotes === 'function') {
              try { svc.updateSessionNotes(this.selectedSessionId, this.notesText); } catch (e) { /* ignore */ }
            }
            savedSessionId = this.selectedSessionId;
          } else {
            if (typeof svc.createSession === 'function') {
              const s = svc.createSession(val, [imageKey], undefined, this.notesText);
              if (s && typeof svc.setLastCreatedSession === 'function') {
                try { svc.setLastCreatedSession(s.id, s.name); } catch (e) { /* ignore */ }
              }
              if (s && s.id) {
                this.selectedSessionId = s.id;
                savedSessionId = s.id;
              }
            }
          }

          updateProgress(15, 'Saving Session: 15%');

          // Get all images in the session to upload to S3
          let sessionImages: StoredImage[] = [];
              if (savedSessionId && typeof svc.getAllImages === 'function') {
                try {
                  const allImages = await svc.getAllImagesAsync ? await svc.getAllImagesAsync() : svc.getAllImages();

                  // Prefer using the session's recorded imageKeys to determine which images belong to the session.
                  // This avoids relying on transient formDataMap or sessionId flags that may not be set for all images.
                  let sessionObj: any = null;
                  try {
                    sessionObj = typeof svc.getSession === 'function' ? svc.getSession(savedSessionId) : null;
                  } catch (e) {
                    sessionObj = null;
                  }

                  if (sessionObj && Array.isArray(sessionObj.imageKeys) && sessionObj.imageKeys.length > 0) {
                    sessionImages = sessionObj.imageKeys.map((k: string) => allImages.find((img: StoredImage) => (img.filename === k || img.original === k || img.withBoxes === k))).filter(Boolean) as StoredImage[];
                  } else {
                    // Fallback: include images that explicitly reference sessionId, whose filename contains the sessionId,
                    // or that exist in the formDataMap. This covers cases where session imageKeys were not populated yet.
                    sessionImages = allImages.filter((img: StoredImage) => {
                      const imgKey = img.filename || img.original || '';
                      const filenameContainsSession = typeof imgKey === 'string' && savedSessionId ? imgKey.includes(savedSessionId) : false;
                      return imgKey && (
                        this.formDataMap[imgKey] !== undefined ||
                        img.sessionId === savedSessionId ||
                        filenameContainsSession
                      );
                    });
                  }

                  // Ensure the current entry is included at minimum
                  if (entry && sessionImages.length === 0) {
                    sessionImages = [entry];
                  }
                } catch (e) {
                  console.warn('[FeedbackPage] Failed to retrieve session images:', e);
                  sessionImages = [entry]; // Fallback to just the current entry
                }
              } else {
                sessionImages = [entry];
              }

          console.log(`[FeedbackPage] Processing ${sessionImages.length} image(s) for S3 upload in session ${savedSessionId}`);

          // Upload all images to S3 for the session
          if (savedSessionId && sessionImages.length > 0) {
            try {
              const progressPerImage = 70 / Math.max(sessionImages.length, 1); // Distribute 70% across images
              let currentProgress = 25;

              for (let imgIndex = 0; imgIndex < sessionImages.length; imgIndex++) {
                const imgEntry = this.normalizePredictionFields(sessionImages[imgIndex]);
                const imgKey = imgEntry.filename || imgEntry.original;
                
                console.log(`[FeedbackPage] Uploading image ${imgIndex + 1}/${sessionImages.length}: ${imgKey}`);
                
                currentProgress += 5;
                updateProgress(currentProgress, `Saving Session: ${Math.min(currentProgress, 85)}%`);

                // Upload original image
                if (typeof svc.uploadSessionImageOriginal === 'function' && imgEntry.original) {
                  try {
                    const originalS3Result = await svc.uploadSessionImageOriginal(imgEntry.original, savedSessionId, imgEntry.filename || imgKey);
                    if (originalS3Result) {
                      imgEntry.storagePath = originalS3Result.s3Key;
                      imgEntry.storageUrl = originalS3Result.url;
                      imgEntry.original = originalS3Result.s3Key;
                      console.log(`âœ… Original image ${imgIndex + 1} uploaded to S3 with key:`, originalS3Result?.s3Key);
                    }
                  } catch (error) {
                    console.warn(`[FeedbackPage] Failed to upload original image ${imgIndex + 1} to S3:`, error);
                  }
                }

                currentProgress += progressPerImage * 0.5;
                updateProgress(Math.min(currentProgress, 85), `Saving Session: ${Math.min(currentProgress, 85)}%`);

                // Upload withBoxes image if available
                if (typeof svc.uploadSessionImageWithBoxes === 'function' && imgEntry.withBoxes) {
                  try {
                    const withBoxesS3Result = await svc.uploadSessionImageWithBoxes(imgEntry.withBoxes, savedSessionId, imgEntry.filename || imgKey);
                    if (withBoxesS3Result) {
                      imgEntry.withBoxesStoragePath = withBoxesS3Result.s3Key;
                      imgEntry.withBoxesStorageUrl = withBoxesS3Result.url;
                      imgEntry.withBoxes = withBoxesS3Result.s3Key;
                      console.log(`âœ… WithBoxes image ${imgIndex + 1} uploaded to S3 with key:`, withBoxesS3Result?.s3Key);
                    }
                  } catch (error) {
                    console.warn(`[FeedbackPage] Failed to upload withBoxes image ${imgIndex + 1} to S3:`, error);
                  }
                }

                // Update the image entry in service with S3 references
                if (typeof svc.setEntryForImage === 'function') {
                  svc.setEntryForImage(imgKey, imgEntry);
                  console.log(`[FeedbackPage] S3 references persisted for image ${imgIndex + 1}: ${imgKey}`);
                }

                currentProgress += progressPerImage * 0.5;
                updateProgress(Math.min(currentProgress, 85), `Saving Session: ${Math.min(currentProgress, 85)}%`);
              }

              updateProgress(85, 'Saving Session: 85%');
            } catch (err) {
              console.warn('[FeedbackPage] Error during S3 upload batch:', err);
              updateProgress(85, 'Saving Session: 85%');
            }
          }

          // Firestore save - includes S3 references from updated entry
          let firestoreSaved = false;
          if (savedSessionId && typeof svc.saveSessionWithImagesToFirestore === 'function') {
            try {
              updateProgress(90, 'Saving Session: 90%');
              await svc.saveSessionWithImagesToFirestore(savedSessionId);
              firestoreSaved = true;
              console.log('âœ… Firestore save completed with S3 references');
              
              if (typeof svc.logSaveWorkflowStatus === 'function') {
                try {
                  await svc.logSaveWorkflowStatus(savedSessionId);
                } catch (logError) {
                  console.warn('âš ï¸ Failed to log workflow status:', logError);
                }
              }
            } catch (e) {
              console.warn('âš ï¸ Failed to save to Firestore:', e);
            }
          }

          updateProgress(100, 'Saving Session: 100%');

          try { document.body.removeChild(overlay); } catch (e) {}

          if (firestoreSaved && savedSessionId) {
            // Build summary from all uploaded images in the session
            const s3Summary: string[] = [];
            if (sessionImages && sessionImages.length > 0) {
              sessionImages.forEach((img: StoredImage, index: number) => {
                const imgName = img.filename || `Image ${index + 1}`;
                if (img.storagePath) {
                  s3Summary.push(`âœ… Original [${imgName}]: ${img.storagePath}`);
                }
                if (img.withBoxesStoragePath) {
                  s3Summary.push(`âœ… Processed [${imgName}]: ${img.withBoxesStoragePath}`);
                }
              });
            }
            
            const firestoreMessage = `âœ… Session saved to Firestore: ${savedSessionId}\n${s3Summary.length > 0 ? 'ðŸ“ S3 Files:\n' + s3Summary.join('\n') : 'No S3 uploads found'}`;
            console.log(firestoreMessage);
            await this.showFirestoreSavePrompt(firestoreMessage);
          } else if (sessionImages && sessionImages.some((img: StoredImage) => img.storagePath || img.withBoxesStoragePath)) {
            // Build summary from images with S3 references
            const s3Summary: string[] = [];
            sessionImages.forEach((img: StoredImage, index: number) => {
              const imgName = img.filename || `Image ${index + 1}`;
              if (img.storagePath) {
                s3Summary.push(`âœ… Original [${imgName}]: ${img.storagePath}`);
              }
              if (img.withBoxesStoragePath) {
                s3Summary.push(`âœ… Processed [${imgName}]: ${img.withBoxesStoragePath}`);
              }
            });
            
            const successMessage = `âœ… Images uploaded to S3\nðŸ“ S3 Files:\n${s3Summary.join('\n')}`;
            alert(successMessage);
          } else {
            alert('Session saved successfully');
          }

          this.router.navigate(['/home-page2']);
        } catch (ee) {
          console.warn('Failed to save session via prompt', ee);
          alert('Failed to create session. See console.');
          try { document.body.removeChild(overlay); } catch (e) {}
        }
        resolve();
      });
      
      //Append elements to compose the INACTIVE STATE dialog
      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(saveBtn);

      box.appendChild(title);
      box.appendChild(titleSubtext);
      box.appendChild(input);
      box.appendChild(btnRow);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      
      // Focus input for inactive state
      setTimeout(() => input.focus(), 50);
    });
  }

  /**
   * Open the zoom modal with the selected image.
   * Initializes pinch gesture detection.
   */
  openZoomModal(imageSrc: string): void {
    this.zoomImageSrc = imageSrc;
    this.currentZoomLevel = 1;
    this.showZoomModal = true;
    
    // Register pinch gesture for zoom on the zoom image element after a short delay
    // to ensure the DOM element is rendered
    setTimeout(() => this.registerPinchGesture(), 100);
  }

  /**
   * Close the zoom modal and cleanup gesture handlers.
   */
  closeZoomModal(): void {
    this.showZoomModal = false;
    this.currentZoomLevel = 1;
    
    // Cleanup pinch gesture
    if (this.pinchGesture) {
      this.pinchGesture.destroy();
      this.pinchGesture = null;
    }
  }

  /**
   * Register pinch gesture for zoom functionality on the zoomed image.
   * Allows users to pinch-to-zoom in the modal.
   */
  private registerPinchGesture(): void {
    if (!this.zoomImageElement?.nativeElement) {
      return;
    }

    // Cleanup previous gesture if it exists
    if (this.pinchGesture) {
      this.pinchGesture.destroy();
    }

    const element = this.zoomImageElement.nativeElement;

    // Create pinch gesture
    this.pinchGesture = this.gestureCtrl.create({
      el: element,
      gestureName: 'pinch',
      onStart: () => {
        // Optional: add visual feedback on pinch start
      },
      onMove: (detail: any) => {
        // Update zoom level based on pinch scale
        if (detail.scale) {
          this.currentZoomLevel = Math.max(1, Math.min(detail.scale * 3, 5)); // Limit zoom between 1x and 5x
          element.style.transform = `scale(${this.currentZoomLevel})`;
        }
      },
      onEnd: () => {
        // Optional: add visual feedback on pinch end
      }
    });

    this.pinchGesture.enable(true);
  }

  /**
   * Handle zoom button clicks to increase/decrease zoom level.
   * Provides manual zoom control in addition to pinch gestures.
   */
  zoomIn(): void {
    this.currentZoomLevel = Math.min(this.currentZoomLevel + 0.5, 5);
    this.updateZoomTransform();
  }

  /**
   * Decrease zoom level on zoom-out button click.
   */
  zoomOut(): void {
    this.currentZoomLevel = Math.max(this.currentZoomLevel - 0.5, 1);
    this.updateZoomTransform();
  }

  /**
   * Reset zoom to 1x on reset button click.
   */
  resetZoom(): void {
    this.currentZoomLevel = 1;
    this.updateZoomTransform();
  }

  /**
   * Update the zoom transform for the zoomed image element.
   */
  private updateZoomTransform(): void {
    if (this.zoomImageElement?.nativeElement) {
      this.zoomImageElement.nativeElement.style.transform = `scale(${this.currentZoomLevel})`;
    }
  }

  /**
   * Handle click outside the zoom modal to close it.
   * Only closes if clicking directly on the overlay, not on the image.
   */
  onZoomOverlayClick(event: MouseEvent): void {
    // Only close if the click target is the overlay itself, not the image
    if (event.target === event.currentTarget) {
      this.closeZoomModal();
    }
  }

  /** Show a Firestore save confirmation prompt with a close button. */
  async showFirestoreSavePrompt(message: string): Promise<void> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.left = '0';
      overlay.style.top = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.background = 'rgba(0,0,0,0.45)';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.zIndex = '9999';

      const box = document.createElement('div');
      box.style.border = '1px solid transparent';
      box.style.background = 'linear-gradient(#fff, #fff) padding-box, linear-gradient(to right, #ff512f, #f09819) border-box';
      box.style.padding = '18px';
      box.style.borderRadius = '8px';
      box.style.minWidth = '320px';
      box.style.maxWidth = '500px';
      box.style.boxShadow = '0 6px 30px rgba(0,0,0,0.3)';

      const title = document.createElement('div');
      title.innerText = 'Session Saved';
      title.style.fontWeight = '700';
      title.style.marginBottom = '8px';

      const body = document.createElement('div');
      body.innerText = message;
      body.style.marginBottom = '12px';
      body.style.wordBreak = 'break-word';

      const closeBtn = document.createElement('button');
      closeBtn.innerText = 'Close';
      closeBtn.style.padding = '8px 10px';
      closeBtn.style.width = '110px';
      closeBtn.style.height = '40px';
      closeBtn.style.border = 'none';
      closeBtn.style.background = 'linear-gradient(90deg,#ff512f,#f09819)';
      closeBtn.style.color = '#fff';
      closeBtn.style.borderRadius = '6px';
      closeBtn.style.cursor = 'pointer';

      closeBtn.addEventListener('click', () => {
        try { document.body.removeChild(overlay); } catch (e) {}
        resolve();
      });

      box.appendChild(title);
      // box.appendChild(body);
      box.appendChild(closeBtn);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });
  }

}


