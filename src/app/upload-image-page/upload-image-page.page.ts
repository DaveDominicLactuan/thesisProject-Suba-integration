
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { Platform } from '@ionic/angular';
import { Router } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';

// NOTE: these services exist in the project workspace; keep imports as they are in repo
import { CrackDetectionService } from '../services/crack-detection.service';
import { ImageStorageService, StoredImage } from '../services/image-storage.service';

// Capacitor/Camera/Filesystem imports (used conditionally in mobile flows)
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

// Basic bounding box types used in drawing helper
interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
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
  isProcessing: boolean = true;
  photosTaken = 0;
  photosProcessed = 0;
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
  includeTestAssets = true; // set to false after testing to remove placeholder assets
  // debug panel and selected prediction
  showDebugPanel = false;
  selectedPrediction: { type?: string; shape?: string; severity?: string } | null = null;
  selectedStatusMessage: string = '';

  scaledBoxes: ScaledBox[] = [];
  selectedThumbSrc: string | null = null;
  private _thumbScrollTimeout: any = null;
  // sessions list for session selection UI
  sessions: any[] = [];
  selectedSessionId: string | null = null;

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
  
    try {
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
      const s = (this.imageStorage && typeof (this.imageStorage.getSessions) === 'function') ? this.imageStorage.getSessions() : [];
      this.sessions = Array.isArray(s) ? s.slice() : [];
    } catch (e) {
      console.warn('[UploadImagePage] loadSessions failed', e);
      this.sessions = [];
    }
  }

  /** Create a new session for this visit and set it active */
  async createSessionOnEnter() {
    try {
      const name = `Session ${new Date().toLocaleString()}`;
      const s = (this.imageStorage && typeof (this.imageStorage.createSession) === 'function') ? this.imageStorage.createSession(name, []) : null;
      if (s) {
        this.selectedSessionId = (s as any).id;
        try { (this.imageStorage as any).setLastCreatedSession((s as any).id, (s as any).name); } catch {}
        await this.loadSessions();
        await this.refreshDisplayedImages();
        try { await this.updatePhotoCounts(); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      console.warn('[UploadImagePage] createSessionOnEnter failed', e);
    }
  }

  /** Refresh the `imagePaths` array to match the active session (or show all if none) */
  async refreshDisplayedImages() {
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
        // show all stored images
        const stored = await this.imageStorage.getAllImages();
        this.imagePaths = (Array.isArray(stored) ? stored.map((s: StoredImage) => ({ original: s.original, withBoxes: (s as any).withBoxes || s.original, fileName: s.filename, rawPrediction: s.prediction })) : []).concat([]);
      }
    } catch (e) {
      console.warn('[UploadImagePage] refreshDisplayedImages failed', e);
      try { const all = await this.imageStorage.getAllImages(); this.imagePaths = Array.isArray(all) ? all.map((s: StoredImage) => ({ original: s.original, withBoxes: (s as any).withBoxes || s.original, fileName: s.filename, rawPrediction: s.prediction })) : []; } catch { this.imagePaths = []; }
    }
  }

  /** Create a new session from the current selection or all stored images */
  async createSessionFromSelection() {
    try {
      const name = prompt('Session name', 'New Session') || `Session ${Date.now()}`;
      // determine keys: prefer selected image, else all imagePaths
      let keys: string[] = [];
      if (this.selectedThumbSrc) {
        // find matching entry in imagePaths
        const found = this.imagePaths.find((p: any) => p.original === this.selectedThumbSrc || p.withBoxes === this.selectedThumbSrc);
        if (found) keys = [found.original];
      }
      if (keys.length === 0) {
        keys = this.imagePaths.map((p: any) => p.original).filter(Boolean);
      }
      const s = (this.imageStorage && typeof (this.imageStorage.createSession) === 'function') ? this.imageStorage.createSession(name, keys) : null;
      await this.loadSessions();
      alert(s ? `Session created: ${(s as any).id}` : 'Session created (fallback)');
    } catch (e) {
      console.warn('[UploadImagePage] createSessionFromSelection failed', e);
      alert('Failed to create session. See console.');
    }
  }

  /** Select an existing session and navigate to camera page with first image selected */
  async selectSessionAndGo(s: any) {
    try {
      if (!s) return;
      if (Array.isArray(s.imageKeys) && s.imageKeys.length > 0) {
        const key = s.imageKeys[0];
        if (this.imageStorage && typeof this.imageStorage.selectImageByOriginal === 'function') {
          this.imageStorage.selectImageByOriginal(key);
        }
      }
      this.router.navigate(['/camera-page2']);
    } catch (e) {
      console.warn('[UploadImagePage] selectSessionAndGo failed', e);
    }
  }

  async onSessionSelect(event: Event) {
    try {
      const val = (event.target as HTMLSelectElement).value;
      this.selectedSessionId = val || null;
      const s = this.sessions.find(x => x.id === val);
      if (s) {
        this.selectSessionAndGo(s);
        try { await this.refreshDisplayedImages(); } catch (e) { /* ignore */ }
      } else {
        try { await this.refreshDisplayedImages(); } catch (e) { /* ignore */ }
      }
      // recompute counters for selected session (or global when none)
      try { await this.updatePhotoCounts(); } catch (e) { /* ignore */ }
    } catch (e) {
      console.warn('[UploadImagePage] onSessionSelect failed', e);
    }
  }

  /** Called when a stored-image thumbnail is clicked */
  onStoredThumbClick(img: any) {
    try {
      if (this.imageStorage && typeof this.imageStorage.selectImageByOriginal === 'function') {
        this.imageStorage.selectImageByOriginal(img.original);
      }
    } catch (e) {
      console.warn('onStoredThumbClick: selectImage failed', e);
    }
    this.selectedThumbSrc = img.withBoxes ?? img.original;
    this.selectedImageTitle = img.fileName ?? '';
  }

  /** Initialize live camera feed */
  async initCamera() {
 
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

        // derive filename based on current stored images count so photosTaken reflects storage
        let storedCount = 0;
        try {
          const all = await this.imageStorage.getAllImages();
          storedCount = Array.isArray(all) ? all.length : 0;
        } catch (e) {
          // fallback to local counter if storage call fails
          storedCount = this.photosTaken || 0;
        }

        const filename = this.generateFilename(storedCount + 1);

        const entry: StoredImage = {
          original: dataUrl,
          timestamp: now,
          filename,
          prediction: prediction || undefined,
          hasPrediction: !!prediction,
          statusMessage: prediction ? 'Prediction succeeded' : (inferenceCalled ? 'Prediction failed' : 'No prediction')
        };
        await this.imageStorage.addImage(entry);
        // also add to active session if one exists
        try {
          if (this.selectedSessionId && typeof (this.imageStorage.addImageToSession) === 'function') {
            this.imageStorage.addImageToSession(this.selectedSessionId, entry.original);
          }
          await this.refreshDisplayedImages();
        } catch (e) {
          console.warn('[UploadImagePage] Failed to add taken picture to session', e);
        }
        // synchronize counters from storage so UI reflects actual stored count
        await this.updatePhotoCounts();
        this.savedImage = entry;
        this.lastPrediction = prediction;

        this.photosProcessed++;
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
            let storedCount = 0;
            try { const all = await this.imageStorage.getAllImages(); storedCount = Array.isArray(all) ? all.length : 0; } catch (e) { storedCount = this.photosTaken || 0; }
            const filename = this.generateFilename(storedCount + 1);
            const entry: StoredImage = {
              original: dataUrl,
              timestamp: new Date().toISOString(),
              filename,
              prediction: undefined,
              hasPrediction: false,
              statusMessage: inferenceCalled ? 'Prediction failed' : 'No prediction'
            };
            await this.imageStorage.addImage(entry);
            await this.updatePhotoCounts();
            this.photosProcessed++;
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
    this.router.navigate(['/home-page']);
    console.log('Navigating to Sign Up page');
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

  /** Pull images from ImageStorageService and map into the gallery format */
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
    try { clearTimeout(this._thumbScrollTimeout); } catch (e) {}
    this._thumbScrollTimeout = setTimeout(() => this.detectCenterThumbnail(), 100);
  }

  detectCenterThumbnail() {
    const container = this.thumbScrollRef?.nativeElement as HTMLElement | undefined;
    if (!container) return;
    const images = container.querySelectorAll('img');
    if (!images || images.length === 0) return;

    const containerRect = container.getBoundingClientRect();
    const centerX = containerRect.left + containerRect.width / 2;

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

    if (!closestImg) return;
    const imgEl: any = closestImg;
    const src = (imgEl && (imgEl.src || (imgEl.getAttribute && imgEl.getAttribute('src')))) || '';
    this.selectedThumbSrc = src;

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
   * Refresh photosTaken/photosProcessed counters from persistent storage.
   */
  async updatePhotoCounts() {
    try {
      // If a session is active, compute counts from that session's image keys
      if (this.selectedSessionId) {
        if (!this.sessions || this.sessions.length === 0) {
          try { await this.loadSessions(); } catch (e) { /* ignore */ }
        }
        const session = this.sessions.find(s => s.id === this.selectedSessionId) || null;
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
              if (entry.statusMessage === 'Prediction succeeded') processed++;
            }
          }
          this.photosProcessed = processed;
          this.photosTaken = foundCount; // only count existing entries
          this.storedImages = imgs;
          this.imagePaths = imgs.map((s: StoredImage) => ({ original: s.original, withBoxes: (s as any).withBoxes || s.original, fileName: s.filename, rawPrediction: s.prediction }));
        }
      } else {
        const all: StoredImage[] = await this.imageStorage.getAllImages();
        this.photosTaken = Array.isArray(all) ? all.length : 0;
        this.photosProcessed = Array.isArray(all) ? all.filter(i => (i.statusMessage === 'Prediction succeeded')).length : 0;
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
    const src = this.selectedThumbSrc || this.selectedImage || '';
    if (!src) {
      console.warn('[UploadImagePage] deleteSelectedImage: no image selected');
      alert('No image selected to delete');
      return;
    }

    // find in imagePaths (stored images) first
    const idx = this.imagePaths.findIndex((p: any) => p.original === src || p.withBoxes === src);
    const capturedIdx = this.capturedImages.indexOf(src);

    const filename = idx !== -1 ? (this.imagePaths[idx].fileName ?? '(unnamed)') : (capturedIdx !== -1 ? `Captured ${capturedIdx + 1}` : src);
    const confirmMsg = `Delete image "${filename}"? This action cannot be undone.`;
    if (!confirm(confirmMsg)) return;

    try {
      // attempt to remove from persistent storage (if present) via canonical API
      const svc: any = this.imageStorage as any;
      let removed = false;
      try {
        // Call the canonical delete API on the ImageStorageService
        removed = await (this.imageStorage as any).deleteImage(src);
      } catch (e) {
        console.warn('[UploadImagePage] persistent remove attempt failed', e);
      }

      // If persistent removal wasn't possible, remove locally from imagePaths
      if (!removed) {
        if (idx !== -1) this.imagePaths.splice(idx, 1);
        if (capturedIdx !== -1) this.capturedImages.splice(capturedIdx, 1);
      }

      // update counters after deletion and refresh authoritative storedImages/imagePaths
      await this.updatePhotoCounts();
      // sessions may have changed; reload sessions and refresh session-scoped display
      try { await this.loadSessions(); await this.refreshDisplayedImages(); } catch (e) { /* ignore */ }

      // reset selection to first available thumbnail
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

      console.log(`[UploadImagePage] deleteSelectedImage: removed ${filename}. Remaining capturedImages: ${this.capturedImages.length}, stored images: ${this.imagePaths.length}`);
    } catch (err) {
      console.error('[UploadImagePage] deleteSelectedImage failed', err);
      alert('Failed to delete image. See console for details.');
    }
  }

  onImageClick(img: any) {
    this.selectedImage = this.showWithBoxes ? img.withBoxes : img.original;
    this.selectedImageTitle = img.fileName || '';
    // If there's a prediction attached, show it in lastPrediction
    if (img.rawPrediction) this.lastPrediction = img.rawPrediction;
    console.log('[UploadImagePage] Image clicked:', img.fileName || img.original, img);
  }

  detectCenterImage() {
    // basic stub: ensure selectedImage is consistent with showWithBoxes
    if (!this.selectedImage && this.imagePaths.length > 0) {
      this.selectedImage = this.showWithBoxes ? this.imagePaths[0].withBoxes : this.imagePaths[0].original;
    }
  }

  onScroll(event: any) {
    // optional: highlight center image later; keep lightweight for now
    // console.log('gallery scrolled', event);
  }

  /**
   * Draw bounding boxes on the supplied Base64 image and return a new Base64 image.
   * Boxes are expected in mask coordinates; maskW/maskH indicate mask resolution so boxes
   * can be scaled to the image natural size.
   */
  async drawBoxesOnImage(Base64: string, boxes: BoundingBox[], maskW = 128, maskH = 128): Promise<string> {
    const img = new Image();
    img.src = Base64;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    return new Promise((resolve) => {
      img.onload = () => {
        const imgW = img.naturalWidth || img.width || 1280;
        const imgH = img.naturalHeight || img.height || 720;
        canvas.width = imgW;
        canvas.height = imgH;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.lineWidth = Math.max(2, Math.round(Math.max(canvas.width, canvas.height) / 400));
        ctx.strokeStyle = 'red';

        const scaleX = maskW > 0 ? canvas.width / maskW : 1;
        const scaleY = maskH > 0 ? canvas.height / maskH : 1;

        boxes.forEach(b => {
          const x = Math.round(b.x * scaleX);
          const y = Math.round(b.y * scaleY);
          const w = Math.round(b.w * scaleX);
          const h = Math.round(b.h * scaleY);
          ctx.strokeRect(x, y, w, h);
        });
        resolve(canvas.toDataURL('image/png'));
      };
      if (img.complete && img.naturalWidth) img.onload!(null as any);
    });
  }

  base64ToBlob(base64Data: string, contentType = ''): Blob {
    const byteCharacters = atob(base64Data);
    const byteArrays = [];

    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
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

  triggerFileInput() {
    try {
      this.fileInputRef.nativeElement.click();
    } catch (e) {
      console.warn('triggerFileInput failed', e);
    }
  }

  /** Mobile image picker — attempts Capacitor Photos API, falls back to camera pick single file */
  async pickImagesMobile() {
    try {
      const photo = await Camera.getPhoto({ quality: 80, allowEditing: false, resultType: CameraResultType.Base64, source: CameraSource.Photos });
      if (photo && photo.base64String) {
        const dataUrl = `data:image/jpeg;base64,${photo.base64String}`;
        try {
          await Promise.race([this.processDataUrl(dataUrl, `mobile-${Date.now()}.jpg`), new Promise((_, rej) => setTimeout(() => rej(new Error('processing-timeout')), 10_000))]);
        } catch (e) {
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

  /** Helper to process a data URL (image) — runs inference and stores the image */
  async processDataUrl(dataUrl: string, filename: string) {
    // Update UI
    this.imagePreview = dataUrl;
    this.capturedImages.unshift(dataUrl);
    // detect center thumbnail after UI update
    setTimeout(() => this.detectCenterThumbnail(), 60);
    this.isProcessing = true;

    let inferenceCalled = false;
    let inferenceSucceeded = false;

    const doWork = async () => {
      let prediction: any = null;
      try {
        inferenceCalled = true;
        const tensor = await this.preprocessImage(dataUrl);
        // internal guard for inference (optional longer guard)
        try {
          prediction = await this.crackDetectionService.runInference(tensor);
          inferenceSucceeded = !!prediction;
        } catch (infErr) {
          console.warn('Inference error in processDataUrl', infErr);
        }
      } catch (err) {
        console.warn('Preprocess failed in processDataUrl', err);
      }

      const entry: StoredImage = {
        original: dataUrl,
        timestamp: new Date().toISOString(),
        filename,
        prediction: prediction || undefined,
        hasPrediction: !!prediction,
        statusMessage: prediction ? 'Prediction succeeded' : (inferenceCalled ? 'Prediction failed' : 'No prediction')
      };

      // Create a withBoxes image if boxes are present
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
        console.warn('[UploadImagePage] Failed to render boxes', e);
        (entry as any).withBoxes = dataUrl;
        (entry as any).boxes = [];
        (entry as any).detectionMessage = 'Box rendering failed';
      }

      await this.imageStorage.addImage(entry);
      // also add to active session if one exists
      try {
        if (this.selectedSessionId && typeof (this.imageStorage.addImageToSession) === 'function') {
          this.imageStorage.addImageToSession(this.selectedSessionId, entry.original);
        }
        await this.refreshDisplayedImages();
      } catch (e) {
        console.warn('[UploadImagePage] Failed to add upload to session or refresh display', e);
      }
      this.imagePaths.unshift({ original: entry.original, withBoxes: (entry as any).withBoxes || entry.original, fileName: entry.filename, rawPrediction: entry.prediction });
      // keep counters in sync with persistent storage
      await this.updatePhotoCounts();
      this.photosProcessed++;
      return entry;
    };

    try {
      // overall timeout: 10s
      await Promise.race([doWork(), new Promise((_, rej) => setTimeout(() => rej(new Error('processing-timeout')), 10_000))]);
    } catch (err: any) {
      if (err && err.message === 'processing-timeout') {
        console.warn('[UploadImagePage] processDataUrl overall timeout');
        // Persist fallback entry indicating failure/no-prediction
        try {
          let storedCount = 0;
          try { const all = await this.imageStorage.getAllImages(); storedCount = Array.isArray(all) ? all.length : 0; } catch (e) { storedCount = this.photosTaken || 0; }
          const fallbackFilename = this.generateFilename(storedCount + 1);
          const entry: StoredImage = {
            original: dataUrl,
            timestamp: new Date().toISOString(),
            filename: fallbackFilename,
            prediction: undefined,
            hasPrediction: false,
            statusMessage: inferenceCalled ? 'Prediction failed' : 'No prediction'
          };
          await this.imageStorage.addImage(entry);
          try {
            if (this.selectedSessionId && typeof (this.imageStorage.addImageToSession) === 'function') {
              this.imageStorage.addImageToSession(this.selectedSessionId, entry.original);
            }
            await this.refreshDisplayedImages();
          } catch (e) {
            console.warn('[UploadImagePage] Failed to add fallback upload to session', e);
          }
          this.imagePaths.unshift({ original: entry.original, withBoxes: entry.original, fileName: entry.filename, rawPrediction: entry.prediction });
          await this.updatePhotoCounts();
          this.photosProcessed++;
        } catch (e) {
          console.warn('[UploadImagePage] Failed to persist fallback entry after timeout', e);
        }
      } else {
        console.warn('processDataUrl failed', err);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  onFileSelected2(event: Event) {
      const input = event.target as HTMLInputElement;
      if (input.files && input.files[0]) {
        this.testWithLocalImage(input.files[0]);
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
