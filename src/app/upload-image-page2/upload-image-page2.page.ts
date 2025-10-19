
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { Platform, AlertController, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';

// NOTE: these services exist in the project workspace; keep imports as they are in repo
import { CrackDetectionService } from '../services/crack-detection.service';
import { ImageStorageService, StoredImage } from '../services/image-storage.service';

// Capacitor/Camera/Filesystem imports (used conditionally in mobile flows)
// Capacitor camera imports removed — this page uses gallery view only

// Basic bounding box types used in drawing helper
interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

console.log('CameraPagePage component file loaded');

@Component({
  selector: 'app-upload-image-page2',
  templateUrl: './upload-image-page2.page.html',
  styleUrls: ['./upload-image-page2.page.scss'],
  standalone: false
})
export class UploadImagePage2Page implements AfterViewInit, OnDestroy {

  // video ref removed for gallery-only page
  // video/canvas removed — gallery-only page
  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLDivElement>;

  imagePreview: string | null = null;
  capturedImages: string[] = [];
  // camera-related state removed
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
  includeTestAssets = false; // prefer device uploads by default
  showUploadPrompt = false;
  // debug panel and selected prediction
  showDebugPanel = false;
  selectedPrediction: { type?: string; shape?: string; severity?: string } | null = null;
  selectedStatusMessage: string = '';
  // New: keep simple runtime upload logs for troubleshooting
  uploadLogs: string[] = [];

  scaledBoxes: ScaledBox[] = [];
  // UI state for top actions
  flashOn = false;
  showMoreMenu = false;

  get countdown() {
    return this.photosTaken - this.photosProcessed;
  }

  constructor(
    private platform: Platform,
    private router: Router,
    private sanitizer: DomSanitizer,
    private crackDetectionService: CrackDetectionService,
    private imageStorage: ImageStorageService
    ,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {
    // Page loads images only from user uploads. Optionally preload test assets for dev when enabled.
    if (this.includeTestAssets) this.loadTestAssets();
  }

  toggleFlash() {
    // Web cameras don't generally support programmatic flash control; toggle UI state for mobile
    this.flashOn = !this.flashOn;
    console.log('Flash toggled, now', this.flashOn);
  }

  openMoreMenu() {
    this.showMoreMenu = !this.showMoreMenu;
    console.log('More menu:', this.showMoreMenu);
  }

  /** Trigger file input click and upload selected images to session */
  uploadSelectedImages() {
    try {
      this.fileInputRef.nativeElement.click();
    } catch (e) {
      console.warn('uploadSelectedImages failed', e);
    }
  }

  finishSession() {
    // navigate to feedback page as the user requested
    this.goToFeedBackPage();
  }

  ngAfterViewInit() {
    this.platform.ready().then(() => {
      // Do not auto-load stored images; prompt user to upload if nothing is present
      this.showUploadPrompt = true;
    });
  }

  // Ionic lifecycle - reload stored images when the page becomes active
  ionViewWillEnter() {
    // Load persisted images so uploads from other pages (camera) appear here
    this.loadStoredImages();
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
    // toggleCamera removed — gallery-only page
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
    // removed
  }

  generateFilename(): string {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `P${this.photosTaken}${hh}${mm}.jpg`;
  }

  ngOnDestroy() {
    // no camera to stop in gallery-only page
  }

  /**
   * Load a few images from assets for quick testing of the gallery UI.
   * To disable, set includeTestAssets = false in the class or remove these entries.
   */
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
        withBoxes: s.original,
        fileName: s.filename,
        rawPrediction: s.prediction,
      })).concat(this.imagePaths);
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

  /** Template handler for back button */
  goBack() {
    try {
      // prefer router back navigation if available, otherwise fallback to history
      if ((this.router as any).navigateBack) {
        (this.router as any).navigateBack();
      } else {
        window.history.back();
      }
    } catch (e) {
      window.history.back();
    }
  }

  /** Template handler to open more/options UI */
  openMore() {
    this.openMoreMenu();
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
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'red';
        boxes.forEach(b => {
          ctx.strokeRect(b.x, b.y, b.w, b.h);
        });
        resolve(canvas.toDataURL('image/png'));
      };
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

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input) return;
    const files = input.files;
    if (!files || files.length === 0) return;

    // user picked files -> hide upload prompt
    this.showUploadPrompt = false;

    // Process multiple files sequentially to avoid overwhelming the device
    const fileArray = Array.from(files);

    // Update photosTaken immediately so the spinner shows right away
    this.photosTaken += fileArray.length;
    // Mark overall processing state so UI can show spinner immediately
    this.isProcessing = true;

    // yield back to the browser so the spinner/SVG can start rendering
    await new Promise(resolve => setTimeout(resolve, 20));

    for (const f of fileArray) {
      try {
        await this.processFile(f);
      } catch (e) {
        console.warn('Error processing file', e);
        // ensure we still mark as processed so spinner can clear
        this.photosProcessed++;
        // log failure
        this.pushLog(`File ${f.name} processing failed: ${e}`);
      }
    }

    // Clear the native file input so selecting the same files again triggers change
    try { input.value = ''; } catch (e) { /* ignore */ }

    // if all processed, clear overall flag (individual calls also clear it per-file)
    if (this.photosProcessed >= this.photosTaken) this.isProcessing = false;
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
    // Mobile photo picker removed for gallery-only page; use triggerFileInput instead
  }

  /** Process a File object: convert to dataURL, preprocess, run inference, store, and update gallery */
  async processFile(file: File) {
    const reader = new FileReader();
    const dataUrl: string = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    // Create a temporary id so we can show the preview immediately and later update it
    const tempId = `tmp_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    // Insert provisional gallery entry so user sees the uploaded image right away
    try {
      this.imagePaths.unshift({ original: dataUrl, withBoxes: dataUrl, fileName: file.name, rawPrediction: null, tempId, status: 'processing', inferenceError: false, inferenceErrorMessage: '' });
      // Hide initial upload prompt since we have at least one image
      this.showUploadPrompt = false;
      // Auto-scroll the gallery to show the newly added provisional image
      setTimeout(() => this.scrollToStart(), 80);
    } catch (e) {
      console.warn('Failed to insert provisional image entry', e);
    }

    await this.processDataUrl(dataUrl, file.name, tempId);
  }

  /** Helper to process a data URL (image) — runs inference and stores the image */
  async processDataUrl(dataUrl: string, filename: string, tempId?: string) {
    // Update UI
    this.imagePreview = dataUrl;
    this.capturedImages.unshift(dataUrl);
    this.isProcessing = true;

  let prediction: any = null;
    let inferenceCalled = false;
    let inferenceSucceeded = false;
  let inferenceErrorMessage: string | null = null;

    try {
      try {
        inferenceCalled = true;
        const tensor = await this.preprocessImage(dataUrl);

        // Run inference but guard against hangs/timeouts on some Android WebViews
        // Use a shorter timeout for upload flows (10s) to fail fast on device
        const inferenceTimeoutMs = 10_000; // 10s
        try {
          prediction = await Promise.race([
            this.crackDetectionService.runInference(tensor),
            new Promise((_, rej) => setTimeout(() => rej(new Error('inference-timeout')), inferenceTimeoutMs))
          ]);
          inferenceSucceeded = !!prediction;
        } catch (infErr) {
          console.warn('Inference error/timeout in processDataUrl:', infErr);
          inferenceErrorMessage = (infErr && (infErr as Error).message) ? (infErr as Error).message : String(infErr);
          prediction = null;
          inferenceSucceeded = false;
          // record a log entry and persist
          this.pushLog(`Inference failed for ${filename}: ${inferenceErrorMessage}`);
          // show a short toast to inform the user
          try { this.showToast(`Inference failed for ${filename}: ${inferenceErrorMessage}`, 4000); } catch (e) { /* ignore */ }
        }
      } catch (inner) {
        console.warn('Inference error in processDataUrl', inner);
      }

      const entry: StoredImage = {
        original: dataUrl,
        timestamp: new Date().toISOString(),
        filename,
        prediction: prediction || undefined,
        // store inference error info if any (ImageStorageService's StoredImage type may accept extra fields)
        // We'll attach a best-effort map to persist troubleshooting info
        ...(inferenceErrorMessage ? { inferenceError: true, inferenceErrorMessage } : {})
      };

      // Try to persist
      try {
        await this.imageStorage.addImage(entry);
      } catch (storeErr) {
        console.warn('Failed to persist uploaded image:', storeErr);
        // record persistence error
        this.pushLog(`Persist failed for ${filename}: ${storeErr}`);
      }

      // Update gallery view: replace provisional entry (if exists) or insert
      try {
        if (tempId) {
          const idx = this.imagePaths.findIndex(p => p.tempId === tempId);
          if (idx >= 0) {
            // replace the provisional entry with the final one
            this.imagePaths[idx] = { original: entry.original, withBoxes: entry.original, fileName: entry.filename, rawPrediction: entry.prediction, inferenceError: !!inferenceErrorMessage, inferenceErrorMessage };
          } else {
            this.imagePaths.unshift({ original: entry.original, withBoxes: entry.original, fileName: entry.filename, rawPrediction: entry.prediction, inferenceError: !!inferenceErrorMessage, inferenceErrorMessage });
          }
        } else {
          this.imagePaths.unshift({ original: entry.original, withBoxes: entry.original, fileName: entry.filename, rawPrediction: entry.prediction, inferenceError: !!inferenceErrorMessage, inferenceErrorMessage });
        }
        // we have at least one uploaded image — hide the initial prompt
        this.showUploadPrompt = false;
      } catch (e) {
        console.warn('Failed to update gallery after processing:', e);
      }
    } finally {
      this.isProcessing = false;
      this.photosProcessed++;
      // if the file had an error, surface a small alert (non-blocking) for the user to view logs
      if (inferenceErrorMessage) {
        try {
          console.warn('Upload inference error:', inferenceErrorMessage);
          // toast already shown earlier; ensure logs persisted
          this.persistLogs();
        } catch (err) { /* ignore */ }
      }
    }
  }

  /** Expose logs quickly in an alert for troubleshooting */
  async showUploadLogs() {
    // Present Ionic Alert with logs and an action to clear logs
    const logs = this.uploadLogs.slice(0, 200).join('\n') || 'No recent upload logs.';
    const alert = await this.alertCtrl.create({
      header: 'Upload Logs',
      message: `<pre style="white-space:pre-wrap;max-height:60vh;overflow:auto">${this.escapeHtml(logs)}</pre>`,
      buttons: [
        { text: 'Clear', role: 'destructive', handler: () => { this.clearLogs(); } },
        { text: 'Close', role: 'cancel' }
      ]
    });
    await alert.present();
  }

  /** Show detailed error info for a gallery item */
  async showImageErrorDetails(img: any) {
    if (!img || !img.inferenceError) {
      const alert = await this.alertCtrl.create({ header: 'No error', message: 'No error info for this image.', buttons: ['OK'] });
      await alert.present();
      return;
    }
    const msg = `File: ${img.fileName || 'unknown'}\nError: ${img.inferenceErrorMessage || 'Unknown'}`;
    const alert = await this.alertCtrl.create({ header: 'Image Error', message: this.escapeHtml(msg).replace(/\n/g, '<br/>'), buttons: ['OK'] });
    await alert.present();
  }

  private scrollToStart() {
    try {
      const el = this.scrollContainer?.nativeElement;
      if (el && typeof el.scrollTo === 'function') {
        el.scrollTo({ left: 0, behavior: 'smooth' } as any);
      }
    } catch (e) { /* ignore */ }
  }

  /** Push a message into uploadLogs and persist them */
  private pushLog(msg: string) {
    try {
      const ts = new Date().toISOString();
      this.uploadLogs.unshift(`[${ts}] ${msg}`);
      // keep logs at reasonable length
      if (this.uploadLogs.length > 1000) this.uploadLogs.length = 1000;
      this.persistLogs();
    } catch (e) { console.warn('pushLog failed', e); }
  }

  private persistLogs() {
    try { localStorage.setItem('uploadLogs', JSON.stringify(this.uploadLogs)); } catch (e) { /* ignore */ }
  }

  private loadPersistedLogs() {
    try {
      const raw = localStorage.getItem('uploadLogs');
      if (raw) this.uploadLogs = JSON.parse(raw) as string[];
    } catch (e) { /* ignore */ }
  }

  private escapeHtml(s: string) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  private async showToast(msg: string, duration = 3000) {
    try {
      const t = await this.toastCtrl.create({ message: msg, duration, position: 'bottom' });
      await t.present();
    } catch (e) { console.warn('showToast failed', e); }
  }

  private clearLogs() {
    this.uploadLogs = [];
    try { localStorage.removeItem('uploadLogs'); } catch (e) { /* ignore */ }
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
