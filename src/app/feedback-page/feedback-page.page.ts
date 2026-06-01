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
  original_id?: string;
  cropped_id?: string;
  detectionMessage?: string;
  detectionResult?: string;
  // raw prediction and status copied from StoredImage for easy access
  rawPrediction?: { type?: string; shape?: string; severity?: string; boxes?: any[] };
  prediction?: { type?: string; shape?: string; severity?: string; boxes?: any[] };
  correctedPrediction?: { type?: string; shape?: string; severity?: string; boxes?: any[] };
  statusMessage?: string;
  boxes?: any[];
  hasPrediction?: boolean;
  engineerCheckedSession?: boolean;
  storagePath?: string;
  storageUrl?: string;
  // S3 key fields for mobile compatibility
  originalS3Key?: string;
  originalS3Url?: string;
}

interface SessionImageGroup {
  groupKey: string;
  groupIndex: number | null;
  images: DisplayImage[];
  representative: DisplayImage;
}

interface AggregateStats {
  type: Record<string, number>;
  severity: Record<string, number>;
  shape: Record<string, number>;
  totalCracks: number;
  totalImages: number;
}

interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
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
displayedImagePaths: DisplayImage[] = [];
availableSessionImages: DisplayImage[] = [];
groupedSessionImages: SessionImageGroup[] = [];
stats: AggregateStats = {
  type: {},
  severity: {},
  shape: {},
  totalCracks: 0,
  totalImages: 0,
};
galleryViewState: 'originalState' | 'croppedState' = 'originalState';
activeOriginalIndex: number | null = null;
showWithBoxes: boolean = false;
engineerLookedSessionChecked: boolean = false;
private backButtonSub: any; // hardware back handler
showSessionLoadingWindow: boolean = false;
sessionLoadingMessage: string = 'Fetching S3 images...';
sessionLoadingDetail: string = 'Preparing session images';
sessionLoadingCompleted: number = 0;
sessionLoadingTotal: number = 0;
sessionLoadingError: string = ''; // Error message if loading fails
sessionLoadingHasError: boolean = false; // Track if an error occurred
private sessionLoadingWindowTimer: any;
private sessionLoadingErrorTimer: any; // Timer for auto-returning on error
private backNavigationInProgress: boolean = false;
private lastBackTapAt: number = 0;
private lastImageTitleDebugAt: number = 0;

  // Zoom modal properties
  showZoomModal: boolean = false;
  zoomImageSrc: string = '';
  currentZoomLevel: number = 1;
  private pinchGesture: any;




  // routeSessionId holds session id passed via query param from Camera page
  routeSessionId?: string | null = null;
  routeNotes: string | null = '';
  routeengineerCheckedSession: boolean = false;

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
  selectedGraphType: 'type' | 'shape' | 'severity' | 'all' = 'type';
  private pieColors: string[] = ['#ff6b2d', '#ff9f43', '#ffbf7a', '#ffd9b8', '#ffeedd', '#ffd0a6'];

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
   * Draw bounding boxes onto an original dataURL and return a new dataURL (JPEG).
   * @param originalDataUrl - base64 data URL of the original image
   * @param boxes - array of boxes with {x,y,w,h} relative (0..1) or absolute pixel values
   */
  private async createWithBoxesDataUrl(originalDataUrl: string, boxes: BoundingBox[] | any[]): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(originalDataUrl);
            ctx.drawImage(img, 0, 0);
            ctx.lineWidth = Math.max(2, Math.round(Math.min(img.width, img.height) * 0.01));
            ctx.strokeStyle = 'rgba(255,0,0,0.9)';
            ctx.fillStyle = 'rgba(255,0,0,0.12)';
            (boxes || []).forEach((b: any) => {
              let x = b.x ?? b.left ?? 0;
              let y = b.y ?? b.top ?? 0;
              let w = b.w ?? b.width ?? b.wid ?? 0;
              let h = b.h ?? b.height ?? b.hei ?? 0;
              // If normalized coords (<=1) convert to pixels
              if (x <= 1 && y <= 1 && w <= 1 && h <= 1) {
                x = x * img.width;
                y = y * img.height;
                w = w * img.width;
                h = h * img.height;
              }
              ctx.strokeRect(x, y, w, h);
              ctx.fillRect(x, y, w, h);
            });
            const dataUrl = canvas.toDataURL('image/png');
            resolve(dataUrl);
          } catch (e) {
            console.warn('[FeedbackPage] canvas draw failed', e);
            resolve(originalDataUrl);
          }
        };
        img.onerror = () => resolve(originalDataUrl);
        img.src = originalDataUrl;
      } catch (e) {
        console.warn('[FeedbackPage] createWithBoxesDataUrl top-level error', e);
        resolve(originalDataUrl);
      }
    });
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
      try { 
        this.routeSessionId = this.route.snapshot.queryParamMap.get('sessionId'); 
        this.routeNotes = this.route.snapshot.queryParamMap.get('notes'); 
        this.routeengineerCheckedSession = this.route.snapshot.queryParamMap.get('engineerCheckedSession') === 'true';
      } catch (e) { this.routeSessionId = null; }
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
    console.log('Current Session:', this.sessions.length > 0 ? this.sessions[0] : 'None');
    console.log('Session images for selected session:', this.imagePaths && this.imagePaths.length > 0 ? this.imagePaths : '(no images loaded)');
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
      return needsOriginal;
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

      } catch (error) {
        console.warn('[FeedbackPage] Failed to hydrate session image from storage path', {
          filename: img.filename,
          storagePath: img.storagePath,
          originalS3Key: img.originalS3Key,
          error
        });
      }
    }
  }

  private getImageGroupIndex(filename: string): number | null {
    const base = this.getFilenameBase(filename);
    const match = base.match(/img(\d+)/i);
    return match ? Number(match[1]) : null;
  }

  private getImageVariantRank(filename: string): number {
    const base = this.getFilenameBase(filename);
    if (base.includes('original')) return 0;
    const croppedMatch = base.match(/cropped(\d+)?/i);
    if (croppedMatch) {
      return croppedMatch[1] ? Number(croppedMatch[1]) : 1;
    }
    return 2;
  }

  private getImageSortLabel(img: DisplayImage): string {
    return this.getImageKey(img) || img.filename || img.original || '';
  }

  private getPredictionSource(img: DisplayImage): { type?: string; shape?: string; severity?: string; boxes?: any[] } | undefined {
    return (img.correctedPrediction as any) ?? (img.rawPrediction as any) ?? (img.prediction as any) ?? undefined;
  }

  private buildSessionImageGroups(images: DisplayImage[]): SessionImageGroup[] {
    const groupMap = new Map<string, SessionImageGroup>();

    (images || []).forEach((img) => {
      const filename = img.filename || img.fileName || img.original || img.withBoxes || '';
      const groupIndex = this.getImageGroupIndex(filename);
      const groupKey = groupIndex !== null ? `img${groupIndex}` : (filename || 'ungrouped');
      const existing = groupMap.get(groupKey);
      if (existing) {
        existing.images.push(img);
        return;
      }

      groupMap.set(groupKey, {
        groupKey,
        groupIndex,
        images: [img],
        representative: img,
      });
    });

    const groups = Array.from(groupMap.values()).map((group) => {
      const sortedImages = [...group.images].sort((left, right) => {
        const leftLabel = this.getImageSortLabel(left);
        const rightLabel = this.getImageSortLabel(right);
        const leftRank = this.getImageVariantRank(leftLabel);
        const rightRank = this.getImageVariantRank(rightLabel);
        if (leftRank !== rightRank) return leftRank - rightRank;
        return leftLabel.localeCompare(rightLabel);
      });

      return {
        ...group,
        images: sortedImages,
        representative: sortedImages[0] || group.representative,
      };
    });

    groups.sort((left, right) => {
      if (left.groupIndex !== null && right.groupIndex !== null && left.groupIndex !== right.groupIndex) {
        return left.groupIndex - right.groupIndex;
      }
      if (left.groupIndex !== null) return -1;
      if (right.groupIndex !== null) return 1;
      return left.groupKey.localeCompare(right.groupKey);
    });

    console.group('[FeedbackPage] Grouped session images');
    groups.forEach((group) => {
      console.group(`${group.groupKey}`);
      console.log('Ordered filenames:', group.images.map((img) => img.filename || img.fileName || img.original || img.withBoxes || '(unnamed)'));
      console.log('Representative:', group.representative.filename || group.representative.fileName || group.representative.original || group.representative.withBoxes || '(unnamed)');
      console.groupEnd();
    });
    console.groupEnd();

    return groups;
  }

  private refreshGroupedSessionStats(): void {
    const summaryImages = this.getSummaryScopeImages();
    const type: Record<string, number> = {};
    const severity: Record<string, number> = {};
    const shape: Record<string, number> = {};
    let totalCracks = 0;

    summaryImages.forEach((image) => {
      const source = this.getPredictionSource(image);
      if (!source) {
        return;
      }

      const boxCount = Array.isArray(source.boxes) && source.boxes.length > 0 ? source.boxes.length : 1;
      totalCracks += boxCount;
      if (source.type) type[source.type] = (type[source.type] || 0) + 1;
      if (source.severity) severity[source.severity] = (severity[source.severity] || 0) + 1;
      if (source.shape) shape[source.shape] = (shape[source.shape] || 0) + 1;
    });

    this.stats = {
      type,
      severity,
      shape,
      totalCracks,
      totalImages: summaryImages.length,
    };
  }

  private getSummaryScopeImages(referenceImage?: DisplayImage): DisplayImage[] {
    const resolveCurrentImage = (): DisplayImage | undefined => {
      if (referenceImage) {
        return referenceImage;
      }

      const selectedSrc = this.selectedImage || '';
      if (!selectedSrc) {
        return undefined;
      }

      return this.displayedImagePaths.find((img) => img.original === selectedSrc || img.withBoxes === selectedSrc)
        ?? this.imagePaths.find((img) => img.original === selectedSrc || img.withBoxes === selectedSrc);
    };

    const currentImage = resolveCurrentImage();

    if (this.galleryViewState === 'croppedState' && this.activeOriginalIndex !== null) {
      const croppedImages = this.imagePaths.filter((img) => {
        const meta = this.parseImageGroup(this.getImageFilename(img));
        return meta.isCropped && meta.index === this.activeOriginalIndex;
      });

      if (croppedImages.length > 0) {
        return croppedImages;
      }
    }

    if (this.galleryViewState === 'originalState' && currentImage) {
      const meta = this.parseImageGroup(this.getImageFilename(currentImage));
      if (meta.index !== null) {
        const croppedImages = this.imagePaths.filter((img) => {
          const imageMeta = this.parseImageGroup(this.getImageFilename(img));
          return imageMeta.isCropped && imageMeta.index === meta.index;
        });

        if (croppedImages.length > 0) {
          return croppedImages;
        }
      }
    }

    if (this.galleryViewState === 'croppedState') {
      return this.displayedImagePaths.length > 0 ? this.displayedImagePaths : this.imagePaths;
    }

    return currentImage ? [currentImage] : this.displayedImagePaths.length > 0 ? this.displayedImagePaths : this.imagePaths;
  }

  getScopeText(): string {
    return this.selectedSessionId || this.routeSessionId ? 'This Session' : 'All Sessions';
  }

  get totalShapes(): number {
    return Object.values(this.stats.shape as Record<string, number> || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  }

  get totalTypes(): number {
    return Object.values(this.stats.type as Record<string, number> || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  }

  get totalSeverities(): number {
    return Object.values(this.stats.severity as Record<string, number> || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  }

  getFailedImagesProcessedCount(): number {
    const summaryImages = this.getSummaryScopeImages();
    return summaryImages.reduce((count, img) => {
      const lower = ((img as any)?.statusMessage || '').toString().toLowerCase();
      return lower.includes('prediction failed') || lower.includes('no prediction') ? count + 1 : count;
    }, 0);
  }

  selectGraphType(type: 'type' | 'shape' | 'severity' | 'all') {
    this.selectedGraphType = type;
    console.log(`[Graph Selection] Data Type selected: ${type}`);
  }

  getSelectedData(): { [k: string]: number } {
    if (this.selectedGraphType === 'all') {
      const out: { [k: string]: number } = {};
      Object.entries(this.stats.type as Record<string, number> || {}).forEach(([k, v]) => { out[`Type - ${k}`] = Number(v || 0); });
      Object.entries(this.stats.shape as Record<string, number> || {}).forEach(([k, v]) => { out[`Shape - ${k}`] = Number(v || 0); });
      Object.entries(this.stats.severity as Record<string, number> || {}).forEach(([k, v]) => { out[`Severity - ${k}`] = Number(v || 0); });
      return out;
    }

    switch (this.selectedGraphType) {
      case 'type':
        return this.stats.type || {};
      case 'shape':
        return this.stats.shape || {};
      case 'severity':
        return this.stats.severity || {};
      default:
        return this.stats.type || {};
    }
  }

  getGraphTitle(): string {
    switch (this.selectedGraphType) {
      case 'type':
        return 'Type';
      case 'shape':
        return 'Shape';
      case 'severity':
        return 'Severity';
      case 'all':
        return 'All Categories';
      default:
        return 'Type';
    }
  }

  get pieData(): Array<{ key: string; value: number; percent: number; color: string }> {
    const src = this.getSelectedData() || {};
    const entries = Object.entries(src);
    const total = entries.reduce((sum, [, value]) => sum + (typeof value === 'number' ? value : 0), 0) || 0;
    if (entries.length === 0) return [];
    let index = 0;
    return entries
      .map(([key, value]) => ({ key, value: value as number, percent: total ? Math.round(((value as number) / total) * 100) : 0, color: this.pieColors[index++ % this.pieColors.length] }))
      .sort((left, right) => right.value - left.value);
  }

  getPieGradient(): string {
    const data = this.pieData;
    if (!data || data.length === 0) return 'linear-gradient(#eee,#eee)';
    let cumulative = 0;
    const parts: string[] = [];
    data.forEach((slice) => {
      const start = cumulative;
      const end = cumulative + slice.percent;
      parts.push(`${slice.color} ${start}% ${end}%`);
      cumulative = end;
    });
    if (cumulative < 100) parts.push(`#eee ${cumulative}% 100%`);
    return `conic-gradient(${parts.join(', ')})`;
  }

  /**
   * Log user context for debugging (userId, sessionId, and related metadata).
   */
  private logUserContext() {
    this.displayUserAndSessionInfo();
  }

  private getImageFilenameRaw(img: DisplayImage): string {
    return (img.filename || img.fileName || '').trim();
  }

  getImageKey(img: DisplayImage): string {
    return img.filename || img.fileName || img.original || img.withBoxes || img.storagePath || img.originalS3Key || img.originalS3Url || img.storageUrl || '';
  }

  private getImageFilename(img: DisplayImage): string {
    return this.getImageFilenameRaw(img).toLowerCase();
  }

  private getFilenameBase(filename: string): string {
    const normalized = (filename || '').toLowerCase().replace(/\\/g, '/');
    const lastPathPart = normalized.split('/').pop() || normalized;
    const queryless = lastPathPart.split('?')[0];
    return queryless.replace(/\.[a-z0-9]+$/i, '');
  }

  private parseImageGroup(filename: string): { index: number | null; isOriginal: boolean; isCropped: boolean } {
    const base = this.getFilenameBase(filename);
    const croppedMatch = base.match(/img(\d+)cropped(\d+)?/);
    if (croppedMatch) {
      return { index: Number(croppedMatch[1]), isOriginal: false, isCropped: true };
    }

    const originalMatch = base.match(/img(\d+)original/);
    if (originalMatch) {
      return { index: Number(originalMatch[1]), isOriginal: true, isCropped: false };
    }

    return { index: null, isOriginal: false, isCropped: false };
  }

  private logGalleryState(context: string): void {
    const filenames = this.displayedImagePaths.map((img) => this.getImageFilenameRaw(img));
    console.group(`[FeedbackPage] Gallery State - ${context}`);
    console.log('selectedState:', this.galleryViewState);
    console.log('activeOriginalIndex:', this.activeOriginalIndex);
    console.log('displayedCount:', this.displayedImagePaths.length);
    console.log('displayedFilenames:', filenames);
    console.log('displayedSessionObjects:', this.displayedImagePaths);
    console.groupEnd();
  }

  private getGalleryImagesByState(): DisplayImage[] {
    const originals = this.imagePaths.filter((img) => {
      const meta = this.parseImageGroup(this.getImageFilename(img));
      return meta.isOriginal;
    });

    if (this.galleryViewState === 'croppedState' && this.activeOriginalIndex !== null) {
      const cropped = this.imagePaths.filter((img) => {
        const meta = this.parseImageGroup(this.getImageFilename(img));
        return meta.isCropped && meta.index === this.activeOriginalIndex;
      });

      if (cropped.length > 0) {
        return cropped;
      }

      this.galleryViewState = 'originalState';
      this.activeOriginalIndex = null;
    }

    return originals;
  }

  private refreshDisplayedImagesByState(keepSelection: boolean = true, context: string = 'refresh'): void {
    const previousSelectedSrc = this.selectedImage;
    this.displayedImagePaths = this.getGalleryImagesByState();

    if (this.displayedImagePaths.length === 0) {
      this.selectedImage = '';
      this.selectedImageTitle = '';
      this.logGalleryState(`${context} (empty)`);
      return;
    }

    let selected: DisplayImage | undefined;
    if (keepSelection && previousSelectedSrc) {
      selected = this.displayedImagePaths.find(
        (img) => img.original === previousSelectedSrc || img.withBoxes === previousSelectedSrc
      );
    }

    this.selectedImage = selected
      ? (this.showWithBoxes ? selected.withBoxes : selected.original)
      : (this.showWithBoxes ? this.displayedImagePaths[0].withBoxes : this.displayedImagePaths[0].original);

    this.logGalleryState(context);
  }

  showOriginalState(): void {
    this.galleryViewState = 'originalState';
    this.activeOriginalIndex = null;
    this.refreshDisplayedImagesByState(false, 'showOriginalState');
    setTimeout(() => this.detectCenterImage(), 50);
  }

  //handles a user clicking an image in the gallaery scroller, selects it and populates the UI
  //fields from stored prediction/status, updates formDataMap, logs a detailed debug log to console for debugging
  // and auto-centers the image.
  onImageClick(img: DisplayImage) {
    const meta = this.parseImageGroup(this.getImageFilename(img));
    if (this.galleryViewState === 'originalState' && meta.isOriginal && meta.index !== null) {
      this.activeOriginalIndex = meta.index;
      this.galleryViewState = 'croppedState';
      this.refreshDisplayedImagesByState(false, `onImageClick -> croppedState for img${meta.index}`);
      setTimeout(() => this.detectCenterImage(), 50);
      return;
    }

    // select image, chooses which image to show or display depending on 
    //showWithBoxes toggle the original or with boxes
    this.selectedImage = this.showWithBoxes ? img.withBoxes : img.original;
    this.selectedImageTitle = img.fileName ?? img.filename ?? '';

    // Copy the original session prediction into the preview fields.
    // The editable dropdowns are seeded separately from correctedPrediction.
    this.selectedPrediction = img.prediction ?? img.rawPrediction ?? {};
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


    // Seed the editable dropdowns from the saved correction when present,
    // otherwise fall back to the original session prediction.
    const editablePrediction = img.correctedPrediction ?? img.prediction ?? img.rawPrediction ?? {};
    this.dropdown1 = editablePrediction.type ?? this.selectedImageTitle ?? 'Type';
    this.dropdown2 = editablePrediction.shape ?? this.selectedImageTitle ?? 'Shape';
    this.dropdown3 = editablePrediction.severity ?? this.selectedImageTitle ?? 'Severity';

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
      const candidateSessionId = this.routeSessionId || this.selectedSessionId || null;
      if (!candidateSessionId) {
        this.sessions = [];
        this.selectedSessionId = null;
        console.warn('[FeedbackPage] loadSessions: no sessionId available; skipping session preload');
        return;
      }

      const currentSession = typeof svc.getSession === 'function'
        ? svc.getSession(candidateSessionId)
        : null;

      if (currentSession) {
        this.sessions = [currentSession];
        currentSession.notes = this.route.snapshot.queryParamMap.get('notes');
        currentSession.engineerCheckedSession = this.route.snapshot.queryParamMap.get('engineerCheckedSession') === 'true';
        this.selectedSessionId = currentSession.id;
        this.applySessionFormState(currentSession);
        console.log('[FeedbackPage] Loaded current session only:', currentSession);
      } else {
        this.sessions = [];
        this.selectedSessionId = null;
        console.warn('[FeedbackPage] loadSessions: current session not found', candidateSessionId);
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
    // Reset error state at the start of loading
    this.sessionLoadingHasError = false;
    this.sessionLoadingError = '';
    
    //Setup service reference and clear imagePaths, so it can only reflect the newly 
    // loaded images from the session. avoids duplicates on repeated calls if function is 
    // called more than ounce. allows the placeholder when empty to run without issue or predictably
    const svc: any = this.imageStorageService as any;
    this.imagePaths = [];
    try {
      // No route-passed session selected, so do not load unrelated images.
      if (!this.selectedSessionId) {
        this.refreshDisplayedImagesByState(false, 'refreshDisplayedImages no selectedSessionId');
        return;
      }
      
      //Find session and handle empty session (placeholder) or session has no images
      const sess = this.sessions.find(s => s.id === this.selectedSessionId) || null;
      if (sess) {
        this.applySessionFormState(sess);
      }
      if (!sess || !Array.isArray(sess.imageKeys) || sess.imageKeys.length === 0) {
        // nothing in session; keep placeholder
        if (this.imagePaths.length === 0) {
          this.imagePaths.push({ original: 'assets/108644884_p0.jpg', withBoxes: 'assets/112772382_p0.jpg' });
        }
        this.refreshDisplayedImagesByState(false, 'refreshDisplayedImages empty session');
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
            img?.originalS3Key === key ||
            img?.originalS3Url === key
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
              img?.originalS3Key === key ||
              img?.originalS3Url === key
            );
            if (entry) this.imagePaths.push(this.buildDisplayImage(entry));
          }
        }
      }

      const hasS3BackedImages = this.imagePaths.some((img: DisplayImage) =>
        !!img.originalS3Key || !!img.storagePath || !!img.originalS3Url
      );
      if (hasS3BackedImages) {
        await this.runSessionLoadingWindow(() => this.hydrateSessionImagesFromS3(), Math.max(1800, this.imagePaths.length * 450));
      } else {
        await this.hydrateSessionImagesFromS3();
      }

      this.availableSessionImages = [...this.imagePaths];

      // After hydration, check if there are any images with boxes that still need withBoxes generated
      // This is a fallback in case hydration didn't handle all cases
      const imagesToProcessForBoxes = this.imagePaths.filter((img: DisplayImage) => {
        const hasBoxes = img.boxes && Array.isArray(img.boxes) && img.boxes.length > 0;
        const hasValidWithBoxes = img.withBoxes && img.withBoxes !== img.original && img.withBoxes.startsWith('data:');
        const needsGeneration = hasBoxes && !hasValidWithBoxes;
        if (needsGeneration) {
          console.log(`[FeedbackPage] Image ${img.filename} still needs withBoxes generation after hydration`);
        }
        return needsGeneration;
      });

      if (imagesToProcessForBoxes.length > 0) {
        console.log(`[FeedbackPage] Running fallback withBoxes generation for ${imagesToProcessForBoxes.length} image(s)`);
        await this.runSessionLoadingWindow(
          () => this.generateWithBoxesForSession(imagesToProcessForBoxes),
          Math.max(2000, imagesToProcessForBoxes.length * 800)
        );
      }

      this.groupedSessionImages = this.buildSessionImageGroups(this.imagePaths);
      this.refreshGroupedSessionStats();

      // Log the current selected session and its image objects to console
      if (this.selectedSessionId) {
        const currentSession = this.sessions.find(s => s.id === this.selectedSessionId);
        console.group('[FeedbackPage] 📋 Current Session Loaded');
        console.log('Session ID:', this.selectedSessionId);
        if (currentSession) {
          console.log('Session Object:', currentSession);
          console.log('Session Name:', currentSession.name);
          console.log('Session Notes:', currentSession.notes || '(none)');
          console.log('Engineer Checked:', currentSession.engineerCheckedSession || false);
          console.log('Image Keys in Session:', currentSession.imageKeys || []);
        }
        console.log(`Total images loaded for session: ${this.imagePaths.length}`);
        console.log('Session Image Objects:', this.imagePaths);
        console.table(this.imagePaths.map((img: DisplayImage) => ({
          filename: img.filename,
          hasOriginal: !!img.original,
          hasWithBoxes: !!img.withBoxes,
          predictionType: img.rawPrediction?.type || 'N/A',
          predictionShape: img.rawPrediction?.shape || 'N/A',
          predictionSeverity: img.rawPrediction?.severity || 'N/A',
          hasS3Key: !!(img.originalS3Key || img.originalS3Url),
          boxCount: img.boxes?.length || 0
        })));
        console.groupEnd();
      }

      this.galleryViewState = 'originalState';
      this.activeOriginalIndex = null;
      this.refreshDisplayedImagesByState(false, 'refreshDisplayedImages complete');
      
      //Top-level error handling
    } catch (err) {
      console.error('[FeedbackPage] refreshDisplayedImages failed', err);
      this.sessionLoadingHasError = true;
      this.sessionLoadingError = 'Error loading session, Returning to session page';
      this.sessionLoadingMessage = 'Error';
      this.sessionLoadingDetail = this.sessionLoadingError;
      
      // Auto-return to session page after 2 seconds
      if (this.sessionLoadingErrorTimer) {
        clearTimeout(this.sessionLoadingErrorTimer);
      }
      this.sessionLoadingErrorTimer = setTimeout(() => {
        this.goBack();
      }, 2000);
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
    this.sessionLoadingHasError = false;
    this.sessionLoadingError = '';
    const startedAt = Date.now();

    try {
      await task();
    } catch (err) {
      // If task fails, set error state
      console.error('[FeedbackPage] Session loading task failed:', err);
      this.sessionLoadingHasError = true;
      this.sessionLoadingError = 'Error loading session, Returning to session page';
      this.sessionLoadingMessage = 'Error';
      this.sessionLoadingDetail = this.sessionLoadingError;
      
      // Wait at least 2 seconds before returning to allow user to see error
      const elapsed = Date.now() - startedAt;
      const waitTime = Math.max(2000, minimumDurationMs - elapsed);
      
      if (this.sessionLoadingErrorTimer) {
        clearTimeout(this.sessionLoadingErrorTimer);
      }
      this.sessionLoadingErrorTimer = setTimeout(() => {
        this.showSessionLoadingWindow = false;
        this.goBack();
      }, waitTime);
      return;
    }
    
    // Normal completion path (no error)
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

  /**
   * Hydrate loaded session images from S3 when stored paths or originalS3Key available.
   * Fetches original image from S3 and generates withBoxes on-demand if bounding boxes exist.
   * Generated withBoxes are stored in memory within the session image object.
   */
  private async hydrateSessionImagesFromS3(): Promise<void> {
    const svc: any = this.imageStorageService as any;
    if (!Array.isArray(this.imagePaths) || this.imagePaths.length === 0) {
      return;
    }

    // Filter images that need S3 hydration - prioritize originalS3Key when present
    const imagesToHydrate = this.imagePaths.filter((img: DisplayImage) => 
      img?.originalS3Key || img?.storagePath || img?.originalS3Url
    );
    if (imagesToHydrate.length === 0) {
      console.log('[FeedbackPage] No images with S3 keys found for hydration');
      return;
    }

    console.log(`[FeedbackPage] S3 hydration triggered for ${imagesToHydrate.length} image(s)`);
    this.sessionLoadingTotal = imagesToHydrate.length;
    this.sessionLoadingCompleted = 0;
    
    // Helper: try service fetch first, fall back to direct http(s) fetch->dataURL
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
      this.sessionLoadingDetail = `Loading image (${index + 1} of ${imagesToHydrate.length})`;

      // Build candidate list for original image - prioritize originalS3Key
      const originalCandidates = [
        img.originalS3Key,      // Prioritize S3 key for sessions loaded from Firestore
        img.storagePath,        // Fallback to storage path if available
        img.originalS3Url,      // Try S3 URL
        img.storageUrl          // Fallback to storage URL
      ];
      
      let originalFetched = false;
      let fetchedOriginalCandidate = '';
      
      for (const cand of originalCandidates) {
        if (!cand) continue;
        try {
          console.log(`[FeedbackPage] Attempting to fetch original for ${imageName} using candidate: ${cand.substring(0, 50)}...`);
          const data = await fetchCandidateAsDataUrl(cand as string);
          if (data) {
            img.original = data;
            originalFetched = true;
            fetchedOriginalCandidate = cand;
            console.log(`✅ Original image fetched for ${imageName} from ${cand.substring(0, 50)}...`);
            break;
          }
        } catch (e) {
          console.warn(`[FeedbackPage] Failed to fetch original for ${imageName} from candidate ${cand.substring(0, 50)}...`, e);
        }
      }

      // Only proceed with withBoxes generation if we successfully fetched the original image
      if (!originalFetched) {
        console.warn(`[FeedbackPage] Could not fetch original image for ${imageName}, using existing original if available`);
        // Set withBoxes to whatever original is available (placeholder or existing)
        if (!img.withBoxes || img.withBoxes === img.original) {
          img.withBoxes = img.original;
        }
        this.sessionLoadingCompleted = index + 1;
        continue;
      }

      // Generate withBoxes image on-demand if boxes exist
      // This ensures withBoxes are created from the fetched original image
      if (img.boxes && Array.isArray(img.boxes) && img.boxes.length > 0) {
        try {
          this.sessionLoadingDetail = `Generating boxes (${index + 1} of ${imagesToHydrate.length})`;
          console.log(`[FeedbackPage] Generating withBoxes for ${imageName} with ${img.boxes.length} bounding box(es)`);
          
          const withBoxesDataUrl = await this.drawBoxesOnImage(img.original, img.boxes, 128, 128);
          if (withBoxesDataUrl) {
            // Store generated withBoxes in memory - mapped to the session image object
            img.withBoxes = withBoxesDataUrl;
            console.log(`✅ WithBoxes image generated and stored for ${imageName} (no persistence)`);
          } else {
            // Fallback to original if box drawing fails
            img.withBoxes = img.original;
            console.warn(`[FeedbackPage] Failed to generate withBoxes for ${imageName}, falling back to original`);
          }
        } catch (e) {
          console.warn(`[FeedbackPage] Error generating withBoxes for ${imageName}:`, e);
          img.withBoxes = img.original; // Fallback to original on error
        }
      } else {
        // No boxes exist; set withBoxes to original
        img.withBoxes = img.original;
        console.log(`[FeedbackPage] No bounding boxes for ${imageName}; withBoxes set to original`);
      }

      this.sessionLoadingCompleted = index + 1;
    }

    console.log(`[FeedbackPage] S3 hydration complete: all ${imagesToHydrate.length} images processed and withBoxes generated`);
    this.sessionLoadingMessage = 'S3 images ready';
    this.sessionLoadingDetail = 'Session images hydrated and ready for display';
    
    // Store session objects to session storage for persistence across navigation
    this.storeSessionToSessionStorage();
  }

  /**
   * Store the current session and image objects to sessionStorage for debugging and persistence.
   * Called after S3 hydration to ensure all images are ready.
   */
  private storeSessionToSessionStorage(): void {
    try {
      const sessionData = {
        selectedSessionId: this.selectedSessionId,
        imagePaths: this.imagePaths,
        timestamp: new Date().toISOString(),
        imageCount: this.imagePaths.length
      };
      
      sessionStorage.setItem('feedbackPageSession', JSON.stringify(sessionData));
      
      console.group('[FeedbackPage] 💾 Session stored to sessionStorage');
      console.log('Session ID:', sessionData.selectedSessionId);
      console.log('Image count:', sessionData.imageCount);
      console.log('Timestamp:', sessionData.timestamp);
      console.log('Full session data:', sessionData);
      console.groupEnd();
    } catch (err) {
      console.warn('[FeedbackPage] Failed to store session to sessionStorage', err);
    }
  }

  // Normalize StoredImage-like object into DisplayImage 
   //Normalize a StoredImage-like object into DisplayImage used by the UI.
   //Derives detectionMessage/Result from status or prediction fields.
  buildDisplayImage(img: any): DisplayImage {
    //Extract original and corrected prediction objects for the UI
    const originalPrediction = img.prediction ?? img.rawPrediction ?? undefined;
    const correctedPrediction = img.correctedPrediction ?? undefined;
    const prediction = correctedPrediction ?? originalPrediction ?? undefined;

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

    const originalSrc = typeof img.original === 'string' && img.original.trim().length > 0 ? img.original : '';
    const withBoxesSrc = typeof img.withBoxes === 'string' && img.withBoxes.trim().length > 0
      ? img.withBoxes
      : originalSrc;

    //Build return object: choose withBoxes fallback, derive filename,
    // and include normalized prediction/status fields.
      return {
      original: originalSrc,
      withBoxes: withBoxesSrc,
      filename: img.filename || '',
      fileName: img.filename || '',
        original_id: img.original_id,
        cropped_id: img.cropped_id,
      boxes: Array.isArray(img.boxes) ? img.boxes : [],
      storagePath: img.storagePath,
      storageUrl: img.storageUrl,
      originalS3Key: img.originalS3Key,
      originalS3Url: img.originalS3Url,
      detectionMessage,
      detectionResult,
      rawPrediction: prediction ? { type: predType, shape: predShape, severity: predSeverity, boxes: Array.isArray(img.boxes) ? img.boxes : [] } : undefined,
      prediction: originalPrediction ? { type: originalPrediction?.type ?? '', shape: originalPrediction?.shape ?? '', severity: originalPrediction?.severity ?? '', boxes: Array.isArray(img.boxes) ? img.boxes : [] } : undefined,
      correctedPrediction: correctedPrediction ? { type: correctedPrediction?.type ?? '', shape: correctedPrediction?.shape ?? '', severity: correctedPrediction?.severity ?? '', boxes: Array.isArray(img.boxes) ? img.boxes : [] } : undefined,
      engineerCheckedSession: !!img.engineerCheckedSession,
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

  /** Copy session-level notes and review status into the form state. */
  private applySessionFormState(session: any): void {
    if (!session) {
      return;
    }

    this.notesText = session.notesText ?? session.notes ?? '';
    this.engineerLookedSessionChecked = !!session.engineerCheckedSession;
  }

  /** Dropdowns are read-only for users; editable for engineers. */
  get isUserReadOnly(): boolean {
    return (this.userRole || 'user').toLowerCase() === 'user';
  }

  onEngineerLookedToggle(checked: boolean): void {
    this.engineerLookedSessionChecked = checked;
    console.log('[FeedbackPage] Engineer has looked the session:', checked ? 'checked' : 'unchecked');
  }

  private buildCorrectedPrediction(): { type?: string; shape?: string; severity?: string } {
    return {
      type: this.dropdown1 ?? '',
      shape: this.dropdown2 ?? '',
      severity: this.dropdown3 ?? ''
    };
  }

  /**
   * Compatibility helper for save-time cropped image uploads.
   * The feedback page already stores image payloads in their current form,
   * so this returns the supplied data URL unchanged.
   */
  private async shrinkDataUrlToBytes(dataUrl: string): Promise<string> {
    return dataUrl;
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
  if (!this.scrollContainer?.nativeElement) {
    return;
  }

  //Read container, images, and compute horizontal center
  const container = this.scrollContainer.nativeElement as HTMLElement;
  const images = container.querySelectorAll('img');
  if (!images || images.length === 0) {
    return;
  }
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
    const matched = this.displayedImagePaths.find(img => img.original === src || img.withBoxes === src)
      ?? this.imagePaths.find(img => img.original === src || img.withBoxes === src);
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
  const now = Date.now();
  if (now - this.lastImageTitleDebugAt < 2500) {
    console.groupEnd();
    return;
  }
  this.lastImageTitleDebugAt = now;
  console.log('Full selectedImageTitle:', this.selectedImageTitle);
  console.log('Shortened title:', this.getShortImageTitle(this.selectedImageTitle));
  console.groupEnd();

  // Populate structured prediction and status for UI use
  // If engineerCheckedSession is true, prefer correctedPrediction; otherwise use rawPrediction
  this.selectedPrediction = (this.engineerLookedSessionChecked && matched.correctedPrediction) 
    ? matched.correctedPrediction 
    : (matched.rawPrediction ?? {});
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

    this.refreshGroupedSessionStats();
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
    const originalPrediction = matched.prediction ? { ...matched.prediction } : (matched.rawPrediction ? { ...matched.rawPrediction } : {});
    const correctedPrediction = this.buildCorrectedPrediction();

    // Preserve the original prediction and store the edited values separately
    if (originalPrediction) {
      matched.prediction = { ...originalPrediction };
    }
    matched.correctedPrediction = { ...correctedPrediction };
    matched.rawPrediction = { ...originalPrediction };

    // Update status/extra text
    matched.statusMessage = this.extraText || matched.statusMessage || '';

    // Recompute derived detection strings
    const currentPrediction = matched.rawPrediction ?? originalPrediction ?? {};

    matched.detectionMessage = matched.statusMessage && matched.statusMessage.length > 0
      ? matched.statusMessage
      : `${currentPrediction.type || ''}${currentPrediction.severity ? ' â€” ' + currentPrediction.severity : ''}`.trim();

    matched.detectionResult = matched.statusMessage && matched.statusMessage.length > 0
      ? matched.statusMessage
      : `${currentPrediction.shape || ''}${currentPrediction.severity ? ' â€” ' + currentPrediction.severity : ''}`.trim();

    // Sync selected* fields so UI reflects latest edits
    this.selectedPrediction = { ...originalPrediction };
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

    updatedStored.prediction = originalPrediction ?? updatedStored.prediction ?? null;
    updatedStored.correctedPrediction = { ...correctedPrediction };
    // Keep optional rawPrediction/status fields aligned with the original prediction.
    (updatedStored as any).rawPrediction = originalPrediction ?? updatedStored.rawPrediction ?? null;
    updatedStored.statusMessage = matched.statusMessage;
    updatedStored.detectionMessage = matched.detectionMessage;
    updatedStored.detectionResult = matched.detectionResult;
    updatedStored.engineerCheckedSession = this.userRole?.toLowerCase() === 'engineer' && this.engineerLookedSessionChecked;

    // ✅ Preserve S3 key fields from matched DisplayImage to ensure they're not lost
    if (matched.originalS3Key) updatedStored.originalS3Key = matched.originalS3Key;
    if (matched.originalS3Url) updatedStored.originalS3Url = matched.originalS3Url;
    if (matched.storagePath) updatedStored.storagePath = matched.storagePath;
    if (matched.storageUrl) updatedStored.storageUrl = matched.storageUrl;

    // Ensure original and withBoxes are persisted into the stored entry
    if (matched.original) updatedStored.original = matched.original;
    if (matched.withBoxes) updatedStored.withBoxes = matched.withBoxes;

    // Ensure a filename exists to use as the storage key
    if (!updatedStored.filename || updatedStored.filename === '') {
      updatedStored.filename = matched.fileName ?? matched.filename ?? key ?? '';
    }

    const storageKey = updatedStored.filename || key;
    if (typeof svc.setEntryForImage === 'function') {
      svc.setEntryForImage(storageKey, updatedStored);
    }

    // Also refresh selectedImage to the correct src based on toggle
    this.selectedImage = this.showWithBoxes ? matched.withBoxes : matched.original;
    this.refreshGroupedSessionStats();
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
      this.refreshDisplayedImagesByState(false);
      this.groupedSessionImages = this.buildSessionImageGroups(this.imagePaths);
      this.refreshGroupedSessionStats();

      if (this.imagePaths.length > 0) {
        const first = this.displayedImagePaths[0] || this.imagePaths[0];
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

    if (this.galleryViewState === 'croppedState') {
      this.showOriginalState();
      return;
    }

    if (this.galleryViewState !== 'originalState') {
      return;
    }

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
    
    // Debug: Print current session image objects for bug testing
    console.group('[FeedbackPage] 📋 Session Images On Enter');
    console.log('Session ID:', this.selectedSessionId || '(none)');
    console.log('Total images loaded:', this.imagePaths.length);
    if (this.imagePaths.length > 0) {
      console.log('Image objects:', this.imagePaths);
      console.table(this.imagePaths.map((img, idx) => ({
        index: idx,
        filename: img.filename || img.fileName || '(unnamed)',
        hasOriginal: !!img.original,
        hasWithBoxes: !!img.withBoxes,
        hasBoxes: img.boxes ? img.boxes.length : 0,
        boxesCount: img.boxes && Array.isArray(img.boxes) ? img.boxes.length : 0,
        hasPrediction: !!img.rawPrediction,
        originalS3Key: img.originalS3Key ? 'YES' : 'NO',
        statusMessage: img.statusMessage || '(none)'
      })));
    } else {
      console.warn('No images loaded');
    }
    console.groupEnd();
  }

  ionViewWillLeave() {
    this.removeBackButtonHandler();
    if (this.sessionLoadingWindowTimer) {
      clearTimeout(this.sessionLoadingWindowTimer);
      this.sessionLoadingWindowTimer = null;
    }
    if (this.sessionLoadingErrorTimer) {
      clearTimeout(this.sessionLoadingErrorTimer);
      this.sessionLoadingErrorTimer = null;
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
          if (this.galleryViewState === 'croppedState') {
            this.showOriginalState();
            return;
          }
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
    const sessionId = this.selectedSessionId || this.routeSessionId || null;

    //Navigate with session id
    if (sessionId) {
      this.router.navigate(['/results-dashboard'], { queryParams: { sessionId } });
    } else {

      //Navigate without session id
      this.router.navigate(['/results-dashboard']);
    }
  }

  /**
   * Check if internet connectivity is available.
   * Uses navigator.onLine as primary check and validates with a HEAD request to Google DNS.
   * @returns Promise<boolean> True if internet is available, false otherwise
   */
  private async isInternetAvailable(): Promise<boolean> {
    // Quick check using navigator.onLine
    if (!navigator.onLine) {
      return false;
    }

    // Validate with an actual network request to ensure connectivity
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('https://www.google.com/generate_204', {
        method: 'HEAD',
        mode: 'no-cors',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return true;
    } catch (error) {
      console.warn('[FeedbackPage] Internet connectivity check failed:', error);
      return false;
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
    const originalPrediction = entry.prediction ?? entry.originalPrediction ?? entry.rawPrediction ?? null;
    const fallbackIdBase = imageKey || entry.storagePath || entry.originalS3Key || entry.originalS3Url || entry.original || 'image';
    const fallbackOriginalId = entry.original_id || fallbackIdBase;
    const fallbackCroppedId = entry.cropped_id || fallbackOriginalId;
    const preservedBoxes = Array.isArray(entry.boxes)
      ? [...entry.boxes]
      : Array.isArray(originalPrediction?.boxes)
        ? [...originalPrediction.boxes]
        : Array.isArray(entry.correctedPrediction?.boxes)
          ? [...entry.correctedPrediction.boxes]
          : [];

    const type =
      entry?.correctedPrediction?.type ??
      form?.dropdown1 ??
      this.selectedPrediction?.type ??
      this.dropdown1 ??
      originalPrediction?.type ??
      '';

    const shape =
      entry?.correctedPrediction?.shape ??
      form?.dropdown2 ??
      this.selectedPrediction?.shape ??
      this.dropdown2 ??
      originalPrediction?.shape ??
      '';

    const severity =
      entry?.correctedPrediction?.severity ??
      form?.dropdown3 ??
      this.selectedPrediction?.severity ??
      this.dropdown3 ??
      originalPrediction?.severity ??
      '';

    const hasPrediction = !!(type || shape || severity);
    entry.prediction = originalPrediction ? { type: originalPrediction.type ?? '', shape: originalPrediction.shape ?? '', severity: originalPrediction.severity ?? '', boxes: preservedBoxes } : (entry.prediction ?? null);
    entry.correctedPrediction = hasPrediction ? { type, shape, severity, boxes: preservedBoxes } : (entry.correctedPrediction ?? null);
    entry.rawPrediction = entry.correctedPrediction || entry.prediction || entry.rawPrediction || undefined;
    if (entry.rawPrediction && typeof entry.rawPrediction === 'object') {
      entry.rawPrediction.boxes = preservedBoxes;
    }
    if (entry.prediction && typeof entry.prediction === 'object') {
      entry.prediction.boxes = preservedBoxes;
    }
    if (entry.correctedPrediction && typeof entry.correctedPrediction === 'object') {
      entry.correctedPrediction.boxes = preservedBoxes;
    }
    entry.hasPrediction = hasPrediction || !!entry.prediction;

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

    entry.original_id = fallbackOriginalId;
    entry.cropped_id = fallbackCroppedId;
    entry.engineerCheckedSession = entry.engineerCheckedSession ?? (this.userRole?.toLowerCase() === 'engineer' && this.engineerLookedSessionChecked);
    entry.correctedByEngineer = entry.correctedByEngineer ?? entry.engineerCheckedSession ?? (this.userRole?.toLowerCase() === 'engineer' && this.engineerLookedSessionChecked);

    return entry;
  }

  /**
   * Upload any croppedCracks that were captured earlier but not yet written to S3.
   * This is invoked from the save flow so cropped session-image objects are finalized
   * only when the user actually saves the session.
   */
  private async uploadPendingCroppedCracks(entry: any): Promise<void> {
    const service: any = this.imageStorageService as any;
    const sessionId = this.selectedSessionId || entry?.sessionId || this.routeSessionId || undefined;
    const croppedCracks = Array.isArray(entry?.croppedCracks) ? entry.croppedCracks : [];

    if (!sessionId || croppedCracks.length === 0 || typeof service?.uploadSessionImageCropped !== 'function') {
      return;
    }

    const parentOriginalId = entry?.original_id || croppedCracks[0]?.sessionImage?.original_id || croppedCracks[0]?.original_id || undefined;
    const parentCroppedId = entry?.cropped_id || croppedCracks[0]?.sessionImage?.cropped_id || croppedCracks[0]?.cropped_id || parentOriginalId;

    if (parentOriginalId) {
      entry.original_id = parentOriginalId;
    }
    if (parentCroppedId) {
      entry.cropped_id = parentCroppedId;
    }

    const updatedCracks: any[] = [];

    for (let index = 0; index < croppedCracks.length; index++) {
      const crop = croppedCracks[index] || {};
      const croppedNumber = typeof crop.croppedNumber === 'number' ? crop.croppedNumber : index + 1;
      const cropFilename = crop.filename || crop.sessionImage?.filename || entry?.filename || entry?.fileName || 'cropped';

      if (crop.s3Key || crop.s3Url || crop.sessionImage?.originalS3Key || crop.sessionImage?.storagePath) {
        updatedCracks.push(crop);
        continue;
      }

      const sourceDataUrl = crop.image || crop.sessionImage?.original || crop.sessionImage?.withBoxes || entry?.original || entry?.withBoxes || '';
      if (!sourceDataUrl) {
        updatedCracks.push(crop);
        continue;
      }

      try {
        const uploadResult = await service.uploadSessionImageCropped(sourceDataUrl, sessionId, cropFilename, croppedNumber, crop.imgIndex ?? entry?.sessionImgIndex);

        if (uploadResult) {
          const updatedSessionImage = crop.sessionImage ? {
            ...crop.sessionImage,
            original: sourceDataUrl,
            original_id: crop.sessionImage.original_id || parentOriginalId || uploadResult.s3Key,
            cropped_id: crop.sessionImage.cropped_id || parentCroppedId || uploadResult.s3Key,
            originalS3Key: uploadResult.s3Key,
            originalS3Url: uploadResult.url,
            storagePath: uploadResult.s3Key,
            storageUrl: uploadResult.url,
          } : crop.sessionImage;

          const updatedCrop = {
            ...crop,
            image: sourceDataUrl,
            s3Key: uploadResult.s3Key,
            s3Url: uploadResult.url,
            filename: crop.filename || uploadResult.s3Key,
            original_id: crop.original_id || parentOriginalId || uploadResult.s3Key,
            cropped_id: crop.cropped_id || uploadResult.s3Key,
            sessionImage: updatedSessionImage,
          };

          if (updatedSessionImage && updatedSessionImage.filename && typeof service.setEntryForImage === 'function') {
            try {
              service.setEntryForImage(updatedSessionImage.filename, updatedSessionImage);
            } catch (setErr) {
              console.warn('[FeedbackPage] Failed to update stored cropped session image', setErr);
            }
          }

          updatedCracks.push(updatedCrop);
        } else {
          updatedCracks.push(crop);
        }
      } catch (err) {
        console.warn('[FeedbackPage] Failed to upload pending cropped crack', err);
        updatedCracks.push(crop);
      }
    }

    entry.croppedCracks = updatedCracks;

    if (entry.filename && typeof service.setEntryForImage === 'function') {
      try {
        service.setEntryForImage(entry.filename, entry);
      } catch (err) {
        console.warn('[FeedbackPage] Failed to persist croppedCracks back to storage', err);
      }
    }
  }

  /**
   * Guard rail: Ensure original and withBoxes values are set to their S3 key counterparts.
   * This prevents stale or incorrect paths from being saved to Firestore.
   * Called right before Firestore save to validate all session images have S3 keys properly configured.
   * 
   * @param sessionImages - Array of StoredImage objects to validate and patch
   * @returns Updated array with original/withBoxes replaced by S3 keys where available
   */
  private applyS3KeyGuardRail(sessionImages: any[]): any[] {
    if (!sessionImages || sessionImages.length === 0) {
      console.warn('[FeedbackPage] Guard rail: No session images to validate');
      return sessionImages;
    }

    const patchedImages = sessionImages.map((img: any, index: number) => {
      const imgName = img.filename || `Image ${index + 1}`;

      // Keep the in-memory base64 payloads intact so navigation to the
      // dashboard and PDF page can still render the boxed image.
      // S3 key fields are already preserved separately on the object.
      if (img.storagePath || img.originalS3Key) {
        console.log(
          `[FeedbackPage] Guard Rail - Preserving image payloads for [${imgName}] while keeping S3 key references`
        );
      }

      return img;
    });

    console.log(
      `[FeedbackPage] Guard rail validation complete for ${patchedImages.length} image(s)`
    );
    return patchedImages;
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
      console.log('[FeedbackPage] saveCurrentStoredImageAndGoHome triggered', {
        selectedImage: this.selectedImage || null,
        selectedImageTitle: this.selectedImageTitle || null,
        selectedSessionId: this.selectedSessionId || null,
      });

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
          const correctedPrediction = this.buildCorrectedPrediction();
          const originalPrediction = found.prediction ?? found.rawPrediction ?? undefined;
          entry = {
            original: found.original,
            withBoxes: found.withBoxes,
            boxes: Array.isArray(found.boxes) ? [...found.boxes] : [],
            faceDetected: false,
            faceData: [],
            timestamp: new Date().toISOString(),
            detectionMessage: found.detectionMessage ?? '',
            filename: found.fileName,
            original_id: found.original_id,
            cropped_id: found.cropped_id,
            prediction: originalPrediction ? { ...originalPrediction } : undefined,
            rawPrediction: correctedPrediction,
            correctedPrediction,
            engineerCheckedSession: this.userRole?.toLowerCase() === 'engineer' && this.engineerLookedSessionChecked,
            statusMessage: 'Saved as session',
            // ✅ CRITICAL: Preserve S3 key fields so they're not lost when saving
            originalS3Key: found.originalS3Key,
            originalS3Url: found.originalS3Url,
            storagePath: found.storagePath,
            storageUrl: found.storageUrl
          };
        }
      }

      //If no entry found, show alert and abort
      if (!entry) {
        alert('No image selected to save. Please select an image first.');
        return;
      }

      // mark entry as saved session and persist to service
      await this.uploadPendingCroppedCracks(entry);
      entry = this.normalizePredictionFields(entry);
      entry.statusMessage = entry.statusMessage ?? 'Saved as session';
      entry.engineerCheckedSession = this.userRole?.toLowerCase() === 'engineer' && this.engineerLookedSessionChecked;

      console.group('[FeedbackPage] 💾 Final Session Image Object Before Save');
      console.log('Session image object:', entry);
      console.table({
        filename: entry.filename || '(unnamed)',
        original_id: entry.original_id || '(none)',
        cropped_id: entry.cropped_id || '(none)',
        boxCount: Array.isArray(entry.boxes) ? entry.boxes.length : 0,
        predictionBoxCount: Array.isArray(entry.prediction?.boxes) ? entry.prediction.boxes.length : 0,
        correctedPredictionBoxCount: Array.isArray(entry.correctedPrediction?.boxes) ? entry.correctedPrediction.boxes.length : 0,
        hasPrediction: !!entry.prediction || !!entry.rawPrediction,
        hasS3Key: !!(entry.originalS3Key || entry.originalS3Url)
      });
      console.groupEnd();

      if ((this.imageStorageService as any).setEntryForImage) {
        // Use filename as key, fallback to original for backward compatibility
        const imageKey = entry.filename || entry.original;
        (this.imageStorageService as any).setEntryForImage(imageKey, entry);
      } else if ((this.imageStorageService as any).createAndAdd) {
        await (this.imageStorageService as any).createAndAdd(entry);
      }

      // Log the session image object before saving
      console.group('[FeedbackPage] 💾 Saving Session Image Object');
      console.log('Session Image Entry:', entry);
      console.table({
        filename: entry.filename || '(unnamed)',
        original_id: entry.original_id || '(none)',
        cropped_id: entry.cropped_id || '(none)',
        hasPrediction: !!entry.prediction || !!entry.rawPrediction,
        predictionType: entry.prediction?.type || entry.rawPrediction?.type || 'N/A',
        predictionShape: entry.prediction?.shape || entry.rawPrediction?.shape || 'N/A',
        predictionSeverity: entry.prediction?.severity || entry.rawPrediction?.severity || 'N/A',
        correctedPrediction: entry.correctedPrediction || '(none)',
        statusMessage: entry.statusMessage || '(none)',
        engineerChecked: entry.engineerCheckedSession || false,
        hasS3Key: !!(entry.originalS3Key || entry.originalS3Url)
      });
      console.groupEnd();

      // Prompt user for session name and allow Save or Cancel via custom overlay
      try {
        console.log('[FeedbackPage] saveCurrentStoredImageAndGoHome calling showSaveSessionPrompt', {
          selectedSessionId: this.selectedSessionId || null,
          selectedImage: this.selectedImage || null,
          resolvedEntry: entry,
        });
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
      const currentSession = this.selectedSessionId
        ? (this.sessions.find((session) => session?.id === this.selectedSessionId) || null)
        : (this.sessions.length > 0 ? this.sessions[0] : null);
      const currentSessionName = typeof currentSession?.name === 'string' ? currentSession.name.trim() : '';
      const hasExistingSessionName = currentSessionName.length > 0;
      let correctedByEngineer = !!currentSession?.correctedByEngineer;
      let correctionState = this.getSaveSessionPromptCheckboxState(correctedByEngineer);

      const sessionImageObjects = currentSession && Array.isArray(currentSession.imageKeys)
        ? currentSession.imageKeys
            .map((imageKey: string) => typeof (this.imageStorageService as any).getEntryForImage === 'function'
              ? (this.imageStorageService as any).getEntryForImage(imageKey)
              : null)
            .filter((image: any) => !!image)
        : [];

      console.group('[FeedbackPage] showSaveSessionPrompt session context');
      console.log('Full session object:', currentSession);
      console.log('Session image objects:', sessionImageObjects);
      console.table((sessionImageObjects || []).map((img: any, index: number) => ({
        index: index + 1,
        filename: img?.filename || '(unnamed)',
        original_id: img?.original_id || '(none)',
        cropped_id: img?.cropped_id || '(none)',
        hasPrediction: !!img?.prediction || !!img?.rawPrediction,
        statusMessage: img?.statusMessage || '(none)',
      })));
      console.log('Entry passed to prompt:', entry);
      console.groupEnd();

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
      box.style.width = '95%';
      box.style.boxShadow = '0 6px 30px rgba(0,0,0,0.3)';

      //Title for inactive state
      const title = document.createElement('div');
      title.innerText = hasExistingSessionName
        ? 'Save changes and updated selected session'
        : 'Save current session with a';
      title.style.fontWeight = '700';
      title.style.marginBottom = '4px';
      title.style.fontSize = '16px';

      const promptMessage = document.createElement('div');
      promptMessage.innerText = 'Are you sure of the information on the images';
      promptMessage.style.marginBottom = '10px';
      promptMessage.style.fontSize = '14px';
      promptMessage.style.lineHeight = '1.4';

      const correctionRow = document.createElement('label');
      correctionRow.style.display = 'flex';
      correctionRow.style.alignItems = 'center';
      correctionRow.style.gap = '10px';
      correctionRow.style.marginBottom = '12px';
      correctionRow.style.fontSize = '14px';
      correctionRow.style.cursor = 'pointer';

      const correctionCheckbox = document.createElement('input');
      correctionCheckbox.type = 'checkbox';
      correctionCheckbox.checked = correctionState.checked;

      const correctionText = document.createElement('span');
      correctionText.innerText = correctionState.value;

      correctionCheckbox.addEventListener('change', () => {
        correctionState = this.getSaveSessionPromptCheckboxState(correctionCheckbox.checked);
        correctedByEngineer = correctionState.checked;
        correctionText.innerText = correctionState.value;
      });

      correctionRow.appendChild(correctionCheckbox);
      correctionRow.appendChild(correctionText);

      // const titleSubtext = document.createElement('div');
      // titleSubtext.innerText = hasExistingSessionName ? 'selected session name' : 'session name';
      // titleSubtext.style.fontWeight = '700';
      // titleSubtext.style.marginBottom = '12px';
      // titleSubtext.style.fontSize = '16px';

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = hasExistingSessionName ? currentSessionName : `Session ${new Date().toLocaleString()}`;
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
  saveBtn.innerText = hasExistingSessionName ? 'Update' : 'Save';
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
          entry.correctedByEngineer = correctionState.checked;
          entry.correctedByEngineerValue = correctionState.value;
          entry.engineerCheckedSession = correctionState.checked;

          updateProgress(5, 'Saving Session: 5%');

          // If a session is already selected (e.g., from Camera page), update it
          if (this.selectedSessionId && typeof svc.addImageToSession === 'function') {
            try {
              svc.addImageToSession(this.selectedSessionId, imageKey);
            } catch (e) {
              console.warn('[FeedbackPage] failed to add image to existing session', e);
            }
            const existingSession = typeof svc.getSession === 'function' ? svc.getSession(this.selectedSessionId) : null;
            if (existingSession) {
              existingSession.notes = this.notesText;
              existingSession.engineerCheckedSession = correctionState.checked;
              existingSession.correctedByEngineer = correctionState.checked;
              existingSession.correctedByEngineerValue = correctionState.value;
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
                s.engineerCheckedSession = correctionState.checked;
                s.correctedByEngineer = correctionState.checked;
                s.correctedByEngineerValue = correctionState.value;
                this.selectedSessionId = s.id;
                savedSessionId = s.id;
              }
            }
          }

          updateProgress(15, 'Saving Session: 15%');

          // **NEW**: Check internet connectivity
          let hasInternet = false;
          try {
            hasInternet = await this.isInternetAvailable();
            console.log('[FeedbackPage] Internet connectivity check result:', hasInternet);
          } catch (err) {
            console.warn('[FeedbackPage] Error checking internet connectivity:', err);
            hasInternet = false;
          }

          if (!hasInternet) {
            // **OFFLINE MODE**: Save full session and image objects to local storage
            updateProgress(50, 'Saving Session (Offline): 50%');
            console.log('[FeedbackPage] No internet available. Saving session to local storage only.');
            
            let sessionObject: any = null;
            let sessionImagesToStore: StoredImage[] = [];

            try {
              // Retrieve the complete session object that was created/updated

              if (savedSessionId && typeof svc.getSession === 'function') {
                sessionObject = svc.getSession(savedSessionId);
              }
              if (sessionObject) {
                sessionObject.correctedByEngineer = correctedByEngineer;
              }

              // Get all images in the session
              if (savedSessionId && typeof svc.getAllImages === 'function') {
                try {
                  const allImages = typeof svc.getAllImagesAsync === 'function' 
                    ? await svc.getAllImagesAsync() 
                    : svc.getAllImages();

                  if (sessionObject && Array.isArray(sessionObject.imageKeys) && sessionObject.imageKeys.length > 0) {
                    sessionImagesToStore = sessionObject.imageKeys
                      .map((k: string) => allImages.find((img: StoredImage) => img.filename === k || img.original === k || img.withBoxes === k))
                      .filter(Boolean) as StoredImage[];
                  } else {
                    sessionImagesToStore = allImages.filter((img: StoredImage) => {
                      const imgKey = img.filename || img.original || '';
                      return imgKey && this.formDataMap[imgKey] !== undefined;
                    });
                  }
                } catch (e) {
                  console.warn('[FeedbackPage] Failed to retrieve session images for offline storage:', e);
                  sessionImagesToStore = [entry]; // Fallback to current entry
                }
              } else {
                sessionImagesToStore = [entry];
              }

              // **EXPLICIT OFFLINE STORAGE**: Save complete session and image objects to localStorage
              const offlineStorageKey = `offlineSessions_${new Date().getTime()}`;
              const offlineData = {
                timestamp: new Date().toISOString(),
                sessionId: savedSessionId,
                sessionName: val,
                sessionObject: sessionObject || {
                  id: savedSessionId,
                  name: val,
                  imageKeys: sessionImagesToStore.map(img => img.filename || img.original),
                  notes: this.notesText,
                  engineerCheckedSession: correctionState.checked,
                  correctedByEngineer
                },
                sessionImages: sessionImagesToStore.map((img: StoredImage, index: number) => ({
                  index,
                  ...this.normalizePredictionFields(img),
                  // Ensure all prediction data is included
                  original: img.original,
                  withBoxes: img.withBoxes,
                  filename: img.filename,
                  boxes: Array.isArray(img.boxes) ? [...img.boxes] : [],
                  prediction: img.prediction ? { ...img.prediction } : undefined,
                  correctedPrediction: img.correctedPrediction ? { ...img.correctedPrediction } : undefined,
                  statusMessage: img.statusMessage,
                  engineerCheckedSession: correctionState.checked,
                  correctedByEngineer: correctionState.checked,
                  timestamp: img.timestamp,
                  detectionMessage: img.detectionMessage,
                  faceDetected: img.faceDetected,
                  faceData: img.faceData,
                  // Preserve S3 references if they exist
                  originalS3Key: img.originalS3Key,
                  originalS3Url: img.originalS3Url,
                  storagePath: img.storagePath,
                  storageUrl: img.storageUrl
                })),
                userRole: this.userRole,
                userId: this.userId,
                totalImages: sessionImagesToStore.length
              };

              // Save to localStorage
              localStorage.setItem(offlineStorageKey, JSON.stringify(offlineData));
              
              // Also maintain an index of all offline sessions for easy retrieval
              let offlineSessionsIndex: any[] = [];
              try {
                const indexStr = localStorage.getItem('offlineSessionsIndex');
                offlineSessionsIndex = indexStr ? JSON.parse(indexStr) : [];
              } catch (e) {
                offlineSessionsIndex = [];
              }

              offlineSessionsIndex.push({
                key: offlineStorageKey,
                sessionId: savedSessionId,
                sessionName: val,
                timestamp: new Date().toISOString(),
                imageCount: sessionImagesToStore.length
              });

              localStorage.setItem('offlineSessionsIndex', JSON.stringify(offlineSessionsIndex));

              console.group('[FeedbackPage] 💾 Offline Session Saved to localStorage');
              console.log('Storage Key:', offlineStorageKey);
              console.log('Session Object:', offlineData.sessionObject);
              console.log(`Total Images in Session: ${offlineData.totalImages}`);
              console.log('Session Images:', offlineData.sessionImages);
              console.table(offlineData.sessionImages.map((img: any) => ({
                index: img.index + 1,
                filename: img.filename || '(unnamed)',
                boxCount: Array.isArray(img.boxes) ? img.boxes.length : 0,
                predictionType: img.prediction?.type || 'N/A',
                predictionShape: img.prediction?.shape || 'N/A',
                predictionSeverity: img.prediction?.severity || 'N/A',
                hasCorrectedPrediction: !!img.correctedPrediction,
                statusMessage: img.statusMessage || '(none)'
              })));
              console.log('Offline Sessions Index:', offlineSessionsIndex);
              console.groupEnd();

            } catch (offlineErr) {
              console.error('[FeedbackPage] Error saving session to offline storage:', offlineErr);
              alert('⚠ Failed to save session to offline storage. Please check console for details.');
            }

            updateProgress(100, 'Saving Session: 100% (Local storage)');

            try { document.body.removeChild(overlay); } catch (e) {}

            alert(`⚠ Offline Mode: Session "${val}" saved to local storage only.\n\nSession Details:\n• Images: ${sessionImagesToStore.length}\n• Timestamp: ${new Date().toLocaleString()}\n\nOnce internet is available, the session will be synced to the cloud.`);
            this.router.navigate(['/home-page2']);
            resolve();
            return; // Exit early for offline scenario
          }

          // **ONLINE MODE**: Proceed with S3 uploads and Firestore save
          updateProgress(20, 'Saving Session: 20%');

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
                imgEntry.engineerCheckedSession = correctionState.checked;
                imgEntry.correctedByEngineer = correctionState.checked;
                imgEntry.correctedByEngineerValue = correctionState.value;
                
                console.log(`[FeedbackPage] Uploading image ${imgIndex + 1}/${sessionImages.length}: ${imgKey}`);
                
                currentProgress += 5;
                updateProgress(currentProgress, `Saving Session: ${Math.min(currentProgress, 85)}%`);

                // Capture the original dataURL so we can generate withBoxes even after uploading
                const originalDataForBoxes = imgEntry.original;

                // Upload original image
                if (typeof svc.uploadSessionImageOriginal === 'function' && imgEntry.original) {
                  try {
                    const originalS3Result = await svc.uploadSessionImageOriginal(imgEntry.original, savedSessionId, imgEntry.filename || imgKey);
                    if (originalS3Result) {
                      imgEntry.storagePath = originalS3Result.s3Key;
                      imgEntry.storageUrl = originalS3Result.url;
                      imgEntry.originalS3Key = originalS3Result.s3Key;
                      imgEntry.originalS3Url = originalS3Result.url;
                      console.log(`âœ… Original image ${imgIndex + 1} uploaded to S3 with key:`, originalS3Result?.s3Key);
                    }
                  } catch (error) {
                    console.warn(`[FeedbackPage] Failed to upload original image ${imgIndex + 1} to S3:`, error);
                  }
                }

                currentProgress += progressPerImage * 0.5;
                updateProgress(Math.min(currentProgress, 85), `Saving Session: ${Math.min(currentProgress, 85)}%`);

                // Generate withBoxes image (if boxes exist) and upload it to S3 so PDF/navigation can access it.
                try {
                    if (Array.isArray(imgEntry.boxes) && imgEntry.boxes.length > 0) {
                    // If withBoxes is not present create it using the captured original data (originalDataForBoxes)
                    if (!imgEntry.withBoxes && originalDataForBoxes) {
                      try {
                        const boxed = await this.createWithBoxesDataUrl(originalDataForBoxes, imgEntry.boxes || []);
                        if (boxed) {
                          imgEntry.withBoxes = boxed;
                        }
                      } catch (e) {
                        console.warn('[FeedbackPage] failed to create withBoxes image', e);
                      }
                    }

                    // Upload withBoxes to S3 if present and upload function exists
                    if (typeof svc.uploadSessionImageWithBoxes === 'function' && imgEntry.withBoxes) {
                      try {
                        const withBoxesResult = await svc.uploadSessionImageWithBoxes(imgEntry.withBoxes, savedSessionId, imgEntry.filename || imgKey);
                        if (withBoxesResult) {
                          // keep imgEntry.withBoxes as the dataURL so the UI still shows the processed image locally
                          console.log(`âœ… WithBoxes uploaded for ${imgKey}:`, withBoxesResult.s3Key);
                        }
                      } catch (err) {
                        console.warn('[FeedbackPage] uploadSessionImageWithBoxes failed for', imgKey, err);
                      }
                    }
                  }

                  // Persist the updated image entry (now with S3 refs) into the service
                  if (typeof svc.setEntryForImage === 'function') {
                    svc.setEntryForImage(imgKey, imgEntry);
                    console.log(`[FeedbackPage] Updated image entry persisted for image ${imgIndex + 1}: ${imgKey}`);
                  }
                } catch (e) {
                  console.warn('[FeedbackPage] Error while processing withBoxes for upload', e);
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

          // **GUARD RAIL**: Apply S3 key validation before Firestore save
          // Ensure original and withBoxes are set to S3 keys to prevent stale data
          const validatedSessionImages = this.applyS3KeyGuardRail(sessionImages);

          // Log the session object and all session images before Firestore save
          if (savedSessionId) {
            const sessionObjForLogging = typeof svc.getSession === 'function' ? svc.getSession(savedSessionId) : null;
            console.group('[FeedbackPage] 💾 Saving Session and Images to Firestore');
            console.log('Session ID:', savedSessionId);
            console.log('Session Object:', sessionObjForLogging);
            console.log(`Total images in session: ${sessionImages.length}`);
            console.log('Session Images:', sessionImages);
            console.table(sessionImages.map((img: StoredImage, index: number) => ({
              index: index + 1,
              filename: img.filename || '(unnamed)',
              predictionType: img.prediction?.type || 'N/A',
              predictionShape: img.prediction?.shape || 'N/A',
              predictionSeverity: img.prediction?.severity || 'N/A',
              correctedPrediction: !!img.correctedPrediction,
              statusMessage: img.statusMessage || 'N/A',
              hasS3Path: !!(img.storagePath || img.originalS3Key),
              engineerChecked: img.engineerCheckedSession || false
            })));
            console.groupEnd();
          }

          // Firestore save - includes S3 references from updated entry
          let firestoreSaved = false;
          if (savedSessionId && typeof svc.saveSessionWithImagesToFirestore === 'function') {
            try {
              updateProgress(90, 'Saving Session: 90%');
              // Include withBoxes S3 references in Firestore so other pages (PDF) can fetch them
              await svc.saveSessionWithImagesToFirestore(savedSessionId, undefined, false);
              firestoreSaved = true;
              console.log('✅ Firestore save completed with S3 references (withBoxes excluded)');
              
              // ✅ POST-SAVE VERIFICATION: Log session and image objects after Firestore save completes
              console.group('[FeedbackPage] ✅ Session Saved to Firestore - Verification');
              
              // Retrieve and log the saved session object
              const savedSession = typeof svc.getSession === 'function' ? svc.getSession(savedSessionId) : null;
              console.log('Saved Session Object:', savedSession);
              
              // Retrieve and log all images in the session
              let allSessionImages: StoredImage[] = [];
              try {
                const allImages = typeof svc.getAllImagesAsync === 'function' 
                  ? await svc.getAllImagesAsync() 
                  : (typeof svc.getAllImages === 'function' ? svc.getAllImages() : []);
                
                if (savedSession && Array.isArray(savedSession.imageKeys) && savedSession.imageKeys.length > 0) {
                  allSessionImages = savedSession.imageKeys
                    .map((k: string) => allImages.find((img: StoredImage) => img.filename === k || img.original === k))
                    .filter(Boolean) as StoredImage[];
                } else {
                  allSessionImages = allImages;
                }
              } catch (e) {
                console.warn('[FeedbackPage] Failed to retrieve session images for verification:', e);
                allSessionImages = sessionImages;
              }
              
              console.log(`Total Session Images: ${allSessionImages.length}`);
              console.log('All Session Image Objects:', allSessionImages);
              
              // Display detailed table of session images with boxes verification
              console.table(allSessionImages.map((img: StoredImage, idx: number) => {
                const predBoxes = (img.prediction as any)?.boxes;
                const corrBoxes = (img.correctedPrediction as any)?.boxes;
                return {
                  index: idx + 1,
                  filename: img.filename || '(unnamed)',
                  boxCount: Array.isArray(img.boxes) ? img.boxes.length : 0,
                  predictionBoxCount: Array.isArray(predBoxes) ? predBoxes.length : 'N/A',
                  correctedPredictionBoxCount: Array.isArray(corrBoxes) ? corrBoxes.length : 'N/A',
                  predictionType: img.prediction?.type || 'N/A',
                  predictionShape: img.prediction?.shape || 'N/A',
                  predictionSeverity: img.prediction?.severity || 'N/A',
                  hasCorrectedPrediction: !!img.correctedPrediction,
                  statusMessage: img.statusMessage || '(none)',
                  hasS3Key: !!(img.storagePath || img.originalS3Key),
                  engineerChecked: img.engineerCheckedSession || false
                };
              }));
              
              console.groupEnd();
              
              // Keep the in-memory base64 `withBoxes` payloads so downstream
              // pages can render the boxed image without rehydrating from S3.
              // We intentionally do not clear them here.
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
            console.log('[FeedbackPage] Save successful', {
              savedSessionId,
              imageCount: sessionImages?.length || 0,
            });
            await this.showFirestoreSavePrompt('Save successful');
          } else if (sessionImages && sessionImages.some((img: StoredImage) => img.storagePath)) {
            alert('Save successful');
          } else {
            alert('Save successful');
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
      box.appendChild(promptMessage);
      box.appendChild(correctionRow);
      // box.appendChild(titleSubtext);
      box.appendChild(input);
      box.appendChild(btnRow);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      
      // Focus input for inactive state
      setTimeout(() => input.focus(), 50);
    });
  }

  /** Return the checked state and a human-readable value for the save-session checkbox. */
  private getSaveSessionPromptCheckboxState(isChecked: boolean): { checked: boolean; value: string } {
    return {
      checked: isChecked,
      value: isChecked ? 'Corrected by engineer' : 'Not corrected by engineer'
    };
  }

  /** Backward-compatible alias used by older callers. */
  private getEngineerCorrectionState(isChecked: boolean): { checked: boolean; value: string } {
    return this.getSaveSessionPromptCheckboxState(isChecked);
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

      const body = document.createElement('div');
      body.innerText = message || 'Save successful';
      body.style.marginBottom = '16px';
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

      box.appendChild(body);
      box.appendChild(closeBtn);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });
  }

  /**
   * Generate withBoxes images for session images that have bounding boxes.
   * This is called during page load to create visual representations of detected cracks.
   * withBoxes images are generated on-demand and not stored permanently.
   * @param imagesToProcess Array of DisplayImage objects that have boxes but no withBoxes image
   */
  private async generateWithBoxesForSession(imagesToProcess: DisplayImage[]): Promise<void> {
    if (!Array.isArray(imagesToProcess) || imagesToProcess.length === 0) {
      return;
    }

    console.log(`[FeedbackPage] Processing withBoxes for ${imagesToProcess.length} image(s)`);
    
    let processed = 0;

    for (const img of imagesToProcess) {
      try {
        processed++;
        this.sessionLoadingCompleted = processed;
        this.sessionLoadingTotal = imagesToProcess.length;
        this.sessionLoadingMessage = 'Processing images...';
        this.sessionLoadingDetail = `Creating withBoxes image ${processed} of ${imagesToProcess.length}`;

        // Skip if already has withBoxes or no boxes to draw
        if (!img.boxes || !Array.isArray(img.boxes) || img.boxes.length === 0) {
          console.log(`[FeedbackPage] Image ${img.filename} has no boxes to process`);
          img.withBoxes = img.original; // Fallback to original if no boxes
          continue;
        }

        if (img.withBoxes && img.withBoxes !== img.original && img.withBoxes.startsWith('data:')) {
          console.log(`[FeedbackPage] Image ${img.filename} already has withBoxes image, skipping`);
          continue;
        }

        // Draw boxes on the original image to create withBoxes version
        console.log(`[FeedbackPage] Drawing ${img.boxes.length} boxes on image ${img.filename}`);
        const withBoxesDataUrl = await this.drawBoxesOnImage(img.original, img.boxes, 128, 128);
        
        if (withBoxesDataUrl) {
          img.withBoxes = withBoxesDataUrl;
          console.log(`✅ WithBoxes image generated for ${img.filename}`);
        } else {
          // Fallback to original if box drawing fails
          img.withBoxes = img.original;
          console.warn(`[FeedbackPage] Failed to generate withBoxes for ${img.filename}, using original`);
        }
      } catch (e) {
        console.warn(`[FeedbackPage] Error generating withBoxes for ${img.filename}:`, e);
        img.withBoxes = img.original; // Fallback to original on error
      }
    }

    console.log(`[FeedbackPage] WithBoxes generation complete: ${processed}/${imagesToProcess.length} images processed`);
  }

  /**
   * Draw bounding boxes on the supplied Base64 image and return a new Base64 image.
   * Boxes are expected in mask coordinates; maskW/maskH indicate mask resolution so boxes
   * can be scaled to the image natural size.
   * @param base64Image Base64 encoded image data URL
   * @param boxes Array of bounding boxes with x, y, w, h properties
   * @param maskW Width of the mask/model output (default 128)
   * @param maskH Height of the mask/model output (default 128)
   * @returns Promise<string> Base64 data URL with boxes drawn, or null on failure
   */
  private async drawBoxesOnImage(base64Image: string, boxes: BoundingBox[], maskW = 128, maskH = 128): Promise<string> {
    return new Promise((resolve) => {
      try {
        // Create image element and canvas to draw on
        const img = new Image();
        img.src = base64Image;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          console.error('[FeedbackPage] Failed to get canvas context');
          resolve(base64Image); // Return original on failure
          return;
        }

        img.onload = () => {
          try {
            // Determine image dimensions
            const imgW = img.naturalWidth || img.width || 1280;
            const imgH = img.naturalHeight || img.height || 720;
            canvas.width = imgW;
            canvas.height = imgH;

            // Draw the original image
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            // Configure stroke style for boxes
            ctx.lineWidth = Math.max(2, Math.round(Math.max(canvas.width, canvas.height) / 400));
            ctx.strokeStyle = 'red';

            // Calculate scaling factors from mask coordinates to image pixel coordinates
            const scaleX = maskW > 0 ? canvas.width / maskW : 1;
            const scaleY = maskH > 0 ? canvas.height / maskH : 1;

            // Draw each bounding box
            boxes.forEach((box: BoundingBox, index: number) => {
              try {
                const x = Math.round(box.x * scaleX);
                const y = Math.round(box.y * scaleY);
                const w = Math.round(box.w * scaleX);
                const h = Math.round(box.h * scaleY);
                ctx.strokeRect(x, y, w, h);
              } catch (boxErr) {
                console.warn(`[FeedbackPage] Error drawing box ${index}:`, boxErr);
              }
            });

            console.log(`[FeedbackPage] 📦 Bounding boxes drawn: ${boxes.length}`);
            resolve(canvas.toDataURL('image/png'));
          } catch (error) {
            console.error('[FeedbackPage] Error in image onload:', error);
            resolve(base64Image); // Return original on failure
          }
        };

        // Trigger onload if image is already cached
        if (img.complete && img.naturalWidth) {
          img.onload(null as any);
        }

        // Set error handler
        img.onerror = () => {
          console.error('[FeedbackPage] Failed to load image for box drawing');
          resolve(base64Image); // Return original on failure
        };
      } catch (error) {
        console.error('[FeedbackPage] Error in drawBoxesOnImage:', error);
        resolve(base64Image); // Return original on failure
      }
    });
  }

}


