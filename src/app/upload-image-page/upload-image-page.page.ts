
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { Platform } from '@ionic/angular';
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
  selector: 'app-upload-image-page',
  templateUrl: './upload-image-page.page.html',
  styleUrls: ['./upload-image-page.page.scss'],
  standalone: false,
})
export class UploadImagePagePage implements AfterViewInit, OnDestroy {

  // video ref removed for gallery-only page
  // video/canvas removed — gallery-only page
  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;

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

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input) return;
    const files = input.files;
    if (!files || files.length === 0) return;

    // user picked files -> hide upload prompt
    this.showUploadPrompt = false;

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
    await this.processDataUrl(dataUrl, file.name);
  }

  /** Helper to process a data URL (image) — runs inference and stores the image */
  async processDataUrl(dataUrl: string, filename: string) {
    // Update UI
    this.imagePreview = dataUrl;
    this.capturedImages.unshift(dataUrl);
    this.photosTaken++;
    this.isProcessing = true;

    let prediction: any = null;
    let inferenceCalled = false;
    let inferenceSucceeded = false;

    try {
      try {
        inferenceCalled = true;
        const tensor = await this.preprocessImage(dataUrl);
        prediction = await this.crackDetectionService.runInference(tensor);
        inferenceSucceeded = !!prediction;
      } catch (inner) {
        console.warn('Inference error in processDataUrl', inner);
      }

      const entry: StoredImage = {
        original: dataUrl,
        timestamp: new Date().toISOString(),
        filename,
        prediction: prediction || undefined
      };
      await this.imageStorage.addImage(entry);
      this.imagePaths.unshift({ original: entry.original, withBoxes: entry.original, fileName: entry.filename, rawPrediction: entry.prediction });
      // we have at least one uploaded image — hide the initial prompt
      this.showUploadPrompt = false;
    } finally {
      this.isProcessing = false;
      this.photosProcessed++;
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
