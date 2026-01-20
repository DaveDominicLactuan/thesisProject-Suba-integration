import { Component, OnDestroy, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { Platform } from '@ionic/angular';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { CrackDetectionService } from '../services/crack-detection.service';
import { ImageStorageService, StoredImage } from '../services/image-storage.service';
import { BoxPrediction } from '../types';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

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
  selector: 'app-camera-page',
  templateUrl: './camera-page.page.html',
  styleUrls: ['./camera-page.page.scss'],
  standalone: false,
})
export class CameraPagePage implements AfterViewInit {
  @ViewChild('video') videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('uploadInput') uploadInputRef!: ElementRef<HTMLInputElement>;

  imagePreview: string | null = null;
  capturedImages: string[] = [];
  storedImages: StoredImage[] = [];
  usingFrontCamera = false;
  mediaStream: MediaStream | null = null;
  extraText: string | null = null;
  isProcessing: boolean = true;
  photosTaken = 0;
  photosProcessed = 0;
  savedImage: StoredImage | null = null;
  lastPrediction: { type: string; shape: string; severity: string } | null = null;
  private backButtonSub: any; // hardware back handler

  scaledBoxes = [];

  get countdown() {
    return this.photosTaken - this.photosProcessed;
  }

  triggerFileInput() {
    try {
      this.uploadInputRef.nativeElement.click();
    } catch (e) {
      console.warn('triggerFileInput failed', e);
    }
  }

  async processFile(file: File) {
    const reader = new FileReader();
    const dataUrl: string = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await this.processDataUrl(dataUrl, file.name);
  }

  async pickImagesMobile() {
    try {
      const photo = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Photos
      });

      if (photo && photo.base64String) {
        const dataUrl = `data:image/jpeg;base64,${photo.base64String}`;
        const filename = this.generateFilename();
        await this.processDataUrl(dataUrl, filename);
      } else {
        console.warn('pickImagesMobile: no photo returned');
      }
    } catch (e) {
      console.warn('pickImagesMobile failed', e);
    }
  }

  async processDataUrl(dataUrl: string, filename: string) {
    this.capturedImages.unshift(dataUrl);
    this.isProcessing = true;

    let result: any = null;
    try {
      const tensor = await this.preprocessImage(dataUrl);
      const inferenceTimeoutMs = 20_000; // 20s
      try {
        result = await Promise.race([
          this.crackDetectionService.runInference(tensor, 128, 128),
          new Promise((_, rej) => setTimeout(() => rej(new Error('inference-timeout')), inferenceTimeoutMs))
        ]);
      } catch (infErr) {
        console.warn('Inference error/timeout during upload processing', infErr);
        result = null;
      }
    } catch (e) {
      console.warn('Inference failed during upload processing', e);
    }

    const entry: StoredImage = {
      original: dataUrl,
      timestamp: new Date().toISOString(),
      filename,
      prediction: result || undefined
    };
    await this.imageStorage.addImage(entry);

    if (result && Array.isArray(result.boxes) && result.boxes.length > 0) {
      this.lastPrediction = null; // optional: you can summarize all later if needed
      this.extraText = `✅ Detected ${result.boxes.length} boxes`;
      result.boxes.forEach((b: BoxPrediction, idx: number) => {
        console.log(`Box ${idx + 1}: type=${b.type}, shape=${b.shape}, severity=${b.severity}`);
      });
    } else {
      this.lastPrediction = null;
      this.extraText = '✅ No boxes detected';
    }

    try { await this.updatePhotoCounts(); } catch (e) { /* ignore */ }
    this.isProcessing = false;
  }

  toggleFlash() { console.log('toggleFlash pressed (stub)'); }
  openMore() { console.log('openMore pressed (stub)'); }

  constructor(
    private platform: Platform,
    private router: Router,
    private sanitizer: DomSanitizer,
    private crackDetectionService: CrackDetectionService,
    private imageStorage: ImageStorageService
  ) {
    this.requestCameraPermission();
  }

  ngAfterViewInit() {
    if (this.backButtonSub) {
      try {
        this.backButtonSub.unsubscribe();
        this.backButtonSub = null;
      } catch (e) {
        console.warn('[UploadImagePage] failed to unsubscribe back button handler', e);
      }
    }
    this.platform.ready().then(() => this.initCamera());
  }

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
      await new Promise<void>(resolve => { videoEl.onloadedmetadata = () => { videoEl.play(); resolve(); }; });
      console.log('✅ Live camera preview started');
    } catch (error) {
      console.error('Camera access error:', error);
      alert('Failed to access camera. Please check permissions and device compatibility.');
    }
  }

  async takePicture() {
    this.isProcessing = true;
    this.photosTaken += 1;
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
      this.capturedImages.unshift(dataUrl);

      const imageTensor = await this.preprocessImage(dataUrl);
      let result: any = null;
      try {
        result = await this.crackDetectionService.runInference(imageTensor, canvas.width, canvas.height);
        inferenceCalled = true;
        inferenceSucceeded = true;
      } catch (e) {
        console.warn('Inference failed:', e);
        inferenceCalled = true;
        inferenceSucceeded = false;
      }

      const now = new Date().toISOString();
      const filename = this.generateFilename();
      const entry: StoredImage = {
        original: dataUrl,
        timestamp: now,
        filename,
        prediction: result || undefined,
        hasPrediction: !!result,
        statusMessage: inferenceSucceeded ? 'Prediction succeeded' : (inferenceCalled ? 'Prediction failed' : 'No prediction')
      };
      await this.imageStorage.addImage(entry);
      this.savedImage = entry;

      if (result && Array.isArray(result.boxes) && result.boxes.length > 0) {
        this.lastPrediction = null; // optional: you can summarize all later if needed
        this.extraText = `✅ Detected ${result.boxes.length} boxes`;
        result.boxes.forEach((b: BoxPrediction, idx: number) => {
          console.log(`Box ${idx + 1}: type=${b.type}, shape=${b.shape}, severity=${b.severity}`);
        });
      } else {
        this.lastPrediction = null;
        this.extraText = inferenceSucceeded ? '✅ No boxes detected' : '⚠️ Inference failed';
      }

      try { await this.updatePhotoCounts(); } catch (e) { /* ignore */ }
      console.log('✅ Prediction stored:', result);

    } catch (err) {
      console.error('Failed to take picture / run inference:', err);
      this.extraText = '❌ Capture or inference failed.';
      alert('Failed to capture/process image. See console for details.');
    } finally {
      if (inferenceSucceeded) this.photosProcessed += 1;
      this.isProcessing = false;
    }
  }

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
      data[i] = (imageData.data[i * 4] / 255 - 0.5) / 0.5;
      data[i + 128 * 128] = (imageData.data[i * 4 + 1] / 255 - 0.5) / 0.5;
      data[i + 2 * 128 * 128] = (imageData.data[i * 4 + 2] / 255 - 0.5) / 0.5;
    }
    return data;
  }

  async updatePhotoCounts() {
    try {
      const all: StoredImage[] = await this.imageStorage.getAllImages();
      this.photosTaken = Array.isArray(all) ? all.length : 0;
      this.photosProcessed = Array.isArray(all) ? all.filter(i => (i.statusMessage === 'Prediction succeeded')).length : 0;
      this.storedImages = Array.isArray(all) ? all.slice() : [];
      console.log('[CameraPage] updatePhotoCounts:', { photosTaken: this.photosTaken, photosProcessed: this.photosProcessed });
    } catch (e) {
      console.warn('[CameraPage] updatePhotoCounts failed', e);
    }
  }

  closePreview() { }
  toggleCamera() { this.usingFrontCamera = !this.usingFrontCamera; this.initCamera(); }
  filterThumbnails(type: string) { }
  goToFeedBackPage() { this.router.navigate(['/feedback-page']); console.log('Navigating to Feedback page'); }
  goToHomePage() { this.router.navigate(['/home-page']); console.log('Navigating to Sign Up page'); }
  onBoxClick(box: any) { }

  async requestCameraPermission() {
    try {
      const platform = Capacitor.getPlatform();
      if (platform === 'android' || platform === 'ios') {
        const permission = await Camera.requestPermissions();
        if (permission.camera === 'granted') this.initCamera();
        else alert('❌ Camera permission denied. Please allow it in system settings.');
      } else this.initCamera();
    } catch (error) {
      console.warn('Permission request failed (continuing):', error);
      try { await this.initCamera(); } catch (e) { }
    }
  }

  generateFilename(): string {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `P${this.photosTaken}${hh}${mm}.jpg`;
  }

  ngOnDestroy() { this.mediaStream?.getTracks().forEach(track => track.stop()); }
  goBack() { try { this.router.navigateByUrl('/home-page'); } catch (e) { window.history.back(); } }
  onBack() { this.goBack(); }

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
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 3;
        boxes.forEach(box => ctx.strokeRect(box.x, box.y, box.w, box.h));
        resolve(canvas.toDataURL('image/jpeg'));
      };
    });
  }

  base64ToBlob(base64Data: string, contentType = ''): Blob {
    const byteCharacters = atob(base64Data);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512);
      const byteNumbers = Array.from(slice).map(c => c.charCodeAt(0));
      byteArrays.push(new Uint8Array(byteNumbers));
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
    const result = await this.crackDetectionService.runInference(imageTensor, 128, 128);
    console.log("🧪 Test Prediction:", result);

    if (result && Array.isArray(result.boxes) && result.boxes.length > 0) {
      this.lastPrediction = null;
      this.extraText = `✅ Detected ${result.boxes.length} boxes`;
      result.boxes.forEach((b, idx) => {
        console.log(`Box ${idx + 1}: type=${b.type}, shape=${b.shape}, severity=${b.severity}`);
      });
    } else {
      this.lastPrediction = null;
      this.extraText = '✅ No boxes detected';
    }
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input || !input.files || input.files.length === 0) return;

    const fileArray = Array.from(input.files);
    this.photosTaken += fileArray.length;
    this.isProcessing = true;
    await new Promise(resolve => setTimeout(resolve, 20));

    for (const f of fileArray) {
      try { await this.processFile(f); } catch (e) { console.warn('Error processing selected file', e); this.photosProcessed++; }
    }

    try { input.value = ''; } catch (e) { }
    if (this.photosProcessed >= this.photosTaken) this.isProcessing = false;
  }
}