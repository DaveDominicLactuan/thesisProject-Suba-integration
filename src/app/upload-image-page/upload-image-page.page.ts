
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
    // this.requestCameraPermission();
    // // Preload test assets if requested
    // if (this.includeTestAssets) this.loadTestAssets();
  }

  ngAfterViewInit() {
    this.platform.ready().then(async () => {
      await this.initCamera();
      // initialize counters from storage
      await this.updatePhotoCounts();
    });
  }

  /** Initialize live camera feed */
  async initCamera() {
    // if (Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios') {
    //   const permissions = await Camera.requestPermissions();
    //   if (permissions.camera !== 'granted') {
    //     // user denied camera
    //     return;
    //   }
    // }

    // if (this.mediaStream) {
    //   this.mediaStream.getTracks().forEach(track => track.stop());
    //   this.mediaStream = null;
    // }

    // try {
    //   const constraints: MediaStreamConstraints = { video: { facingMode: 'environment' }, audio: false };
    //   this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    //   const videoEl = this.videoRef.nativeElement;
    //   videoEl.srcObject = this.mediaStream;
    //   await new Promise<void>(resolve => {
    //     videoEl.onloadedmetadata = () => {
    //       videoEl.play().catch(()=>{});
    //       resolve();
    //     };
    //   });
    //   console.log('✅ Live camera preview started');
    // } catch (error) {
    //   console.error('Camera access error:', error);
    //   alert('Failed to access camera. Please check permissions and device compatibility.');
    // }
  }

  /** Capture a frame, preprocess, run inference, and save result */
  async takePicture() {
    // Ensure UI shows processing state immediately
    this.isProcessing = true;
    this.photosTaken++;
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

      // Preprocess → inference → save
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
      const filename = this.generateFilename();

      const entry: StoredImage = {
        original: dataUrl,
        timestamp: now,
        filename,
        prediction: prediction || undefined
      };
      await this.imageStorage.addImage(entry); // persists via @ionic/storage
  this.savedImage = entry;
  this.lastPrediction = prediction;

      this.photosProcessed++;

      // Keep console.log before clearing isProcessing so callers/UI see processing until logging completes
      console.log('✅ Prediction stored:', prediction);
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
    // Only request Capacitor Camera permissions on native platforms.
    try {
      if (Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios') {
        await Camera.requestPermissions();
      }
    } catch (error) {
      console.warn('Camera permission request error', error);
    }
  }

  generateFilename(): string {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `P${this.photosTaken}${hh}${mm}.jpg`;
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
      const all: StoredImage[] = await this.imageStorage.getAllImages();
      this.photosTaken = Array.isArray(all) ? all.length : 0;
      // Count images that have a prediction or explicit hasPrediction flag
      this.photosProcessed = Array.isArray(all) ? all.filter(i => !!(i.prediction) || !!(i.hasPrediction)).length : 0;
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
      // attempt to remove from persistent storage (if present)
      try {
        const removed = await this.imageStorage.removeImageByOriginal(src as string);
        if (removed) console.log('[UploadImagePage] removed from storage');
      } catch (e) {
        console.warn('[UploadImagePage] removeImageByOriginal failed or not present', e);
      }

      // remove from in-memory lists
      if (idx !== -1) this.imagePaths.splice(idx, 1);
      if (capturedIdx !== -1) this.capturedImages.splice(capturedIdx, 1);

      // update counters after deletion
      await this.updatePhotoCounts();

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
        await this.processDataUrl(dataUrl, `mobile-${Date.now()}.jpg`);
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
      // keep counters in sync with persistent storage
      await this.updatePhotoCounts();
    } finally {
      this.isProcessing = false;
      this.photosProcessed++;
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
