import { Component, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { ApiService } from '../api.service';
import { ImageStorageService, StoredImage } from '../services/image-storage.service';
import { CameraPreview, CameraPreviewOptions } from '@awesome-cordova-plugins/camera-preview/ngx';

interface DisplayImage {
  original: string;
  withBoxes: string;
  fileName?: string;
  detectionMessage?: string;
  detectionResult?: string;
  // raw prediction and status copied from StoredImage for easy access
  rawPrediction?: { type?: string; shape?: string; severity?: string };
  statusMessage?: string;
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




  // routeSessionId holds session id passed via query param from Camera page
  routeSessionId?: string | null = null;

  constructor(private router: Router, private route: ActivatedRoute, private api: ApiService, private imageStorageService: ImageStorageService, private cameraPreview: CameraPreview) { }

  ngOnInit() {
    this.api.getHelloTest().subscribe((res: any) => {
  console.log('Response:', res);
});

    try {
      // CameraPreview is a Cordova/native plugin — on web it will throw; ignore on web
      this.cameraPreview.stopCamera();
    } catch (e) {
      console.warn('CameraPreview.stopCamera ignored (not available on web):', e);
    }

  

    console.log(this.message)
  }

  /**
   * Handle explicit image click: select image, apply its prediction to UI,
   * update formDataMap and log a detailed debug object to console.
   */
  onImageClick(img: DisplayImage) {
    // select image
    this.selectedImage = this.showWithBoxes ? img.withBoxes : img.original;

    // update structured prediction/status
    this.selectedPrediction = img.rawPrediction ?? {};
    this.selectedStatusMessage = img.statusMessage ?? '';

    // apply to detection fields and dropdowns
    if (this.selectedStatusMessage && this.selectedStatusMessage.length > 0) {
      this.detectionMessage = this.selectedStatusMessage;
      this.detectionResult = this.selectedStatusMessage;
    } else if (this.selectedPrediction) {
      const p = this.selectedPrediction;
      this.detectionMessage = p.type ? `${p.type}${p.severity ? ' — ' + p.severity : ''}` : '⚠️ No info available';
      this.detectionResult = p.shape ? `${p.shape}${p.severity ? ' — ' + p.severity : ''}` : (p.severity ?? '⚠️ No info available');
    }

    this.dropdown1 = this.selectedPrediction.type ?? this.selectedImageTitle ?? 'Type';
    this.dropdown2 = this.selectedPrediction.shape ?? this.selectedImageTitle ?? 'Shape';
    this.dropdown3 = this.selectedPrediction.severity ?? this.selectedImageTitle ?? 'Severity';

    // update form map for this image
    const key = img.original;
    this.formDataMap[key] = this.formDataMap[key] ?? {
      title: img.fileName ?? this.selectedImageTitle,
      dropdown1: this.dropdown1,
      dropdown2: this.dropdown2,
      dropdown3: this.dropdown3,
      extraText: this.selectedStatusMessage ?? ''
    };

    // debug output for immediate inspection
    console.log('[FeedbackPage] onImageClick debug', {
      filename: img.fileName,
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
  }
  

  @ViewChild('scrollContainer', { static: false }) scrollContainer!: ElementRef;
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
  dropdownOptions: string[] = [];
  dropdownOptionsDirection: string[] = [];
  dropdownOptionsShape: string[] = [];
  dropdownOptionsSeverity: string[] = [];
  detectionMessage: string = '';
  detectionResult: string = '';

    
   

  ngAfterViewInit() {
  try {
    this.cameraPreview.stopCamera();
  } catch (e) {
    console.warn('CameraPreview.stopCamera ignored in ngAfterViewInit (not available on web):', e);
  }

    // Initialize sessions then refresh the displayed images from the active session
    setTimeout(() => {
      // If a session id was passed via query param from Camera, prefer it
      try { this.routeSessionId = this.route.snapshot.queryParamMap.get('sessionId'); } catch (e) { this.routeSessionId = null; }
      this.loadSessions()
        .then(() => this.refreshDisplayedImages())
        .then(() => {
          // Print stored images + prediction-derived display strings for debugging
          this.debugLogStoredImages();
          // Try to detect the centered image (will update again when DOM ready)
          this.detectCenterImage();
        })
        .catch(err => console.warn('[FeedbackPage] failed to initialize sessions/images', err));
    }, 500);
      }


  /** Load sessions from the storage service and pick an active session */
  async loadSessions(): Promise<void> {
    const svc: any = this.imageStorageService as any;
    try {
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
      // Prefer an active session created by the Camera page if available.
      // Try several common APIs/fields to remain compatible with different service implementations.
      let lastSessionId: string | null = null;
      try {
        if (typeof svc.getLastCreatedSession === 'function') {
          const v = await svc.getLastCreatedSession();
          if (v && typeof v === 'object') lastSessionId = v.id || null;
          else if (typeof v === 'string') lastSessionId = v;
        }
        if (!lastSessionId && typeof svc.getCurrentSessionId === 'function') {
          const v2 = await svc.getCurrentSessionId();
          if (v2 && typeof v2 === 'object') lastSessionId = v2.id || null;
          else if (typeof v2 === 'string') lastSessionId = v2;
        }
        // fallbacks to common public properties
        if (!lastSessionId && (svc.lastCreatedSessionId || svc.selectedSessionId)) {
          lastSessionId = svc.lastCreatedSessionId || svc.selectedSessionId || null;
        }
      } catch (err) {
        console.warn('[FeedbackPage] loadSessions: error while checking last/current session', err);
      }

      if (lastSessionId) {
        this.selectedSessionId = lastSessionId;
      }

      // If the router passed a session id explicitly, prefer that when present
      if (this.routeSessionId) {
        const found = this.sessions.find(s => s.id === this.routeSessionId);
        if (found) this.selectedSessionId = this.routeSessionId;
      }

      // If there's still no selected session, pick the first available one
      if (!this.selectedSessionId && this.sessions.length > 0) {
        this.selectedSessionId = this.sessions[0].id;
      }
    } catch (err) {
      console.warn('[FeedbackPage] loadSessions: unable to read sessions from service', err);
      this.sessions = [];
      this.selectedSessionId = null;
    }
  }

  /** Build this.imagePaths from the currently-selected session */
  async refreshDisplayedImages(): Promise<void> {
    const svc: any = this.imageStorageService as any;
    this.imagePaths = [];
    try {
      if (!this.selectedSessionId) {
        // fallback: load all images if no session selected
        const allImgs: any[] = (typeof svc.getAllImages === 'function') ? svc.getAllImages() : (typeof svc.getAll === 'function' ? Object.values(await svc.getAll()) : []);
        this.imagePaths = (allImgs || []).map((img: any) => this.buildDisplayImage(img));
        return;
      }

      const sess = this.sessions.find(s => s.id === this.selectedSessionId) || null;
      if (!sess || !Array.isArray(sess.imageKeys) || sess.imageKeys.length === 0) {
        // nothing in session; keep placeholder
        if (this.imagePaths.length === 0) {
          this.imagePaths.push({ original: 'assets/108644884_p0.jpg', withBoxes: 'assets/112772382_p0.jpg' });
        }
        return;
      }

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
        if (entry) this.imagePaths.push(this.buildDisplayImage(entry));
      }
    } catch (err) {
      console.warn('[FeedbackPage] refreshDisplayedImages failed', err);
    }
  }

  /** Normalize StoredImage-like object into DisplayImage */
  buildDisplayImage(img: any): DisplayImage {
    const prediction = img.prediction ?? img.rawPrediction ?? undefined;
    const predType = prediction?.type ?? '';
    const predShape = prediction?.shape ?? '';
    const predSeverity = prediction?.severity ?? '';
    const detectionMessage = img.statusMessage && img.statusMessage.length > 0
      ? img.statusMessage
      : (predType || predSeverity) ? `${predType}${predSeverity ? ' — ' + predSeverity : ''}` : '';
    const detectionResult = img.statusMessage && img.statusMessage.length > 0
      ? img.statusMessage
      : (predShape || predSeverity) ? `${predShape}${predSeverity ? ' — ' + predSeverity : ''}` : '';
    return {
      original: img.original,
      withBoxes: img.withBoxes ?? img.original,
      fileName: img.filename ?? img.fileName ?? (img.original && img.original.split ? img.original.split('/').pop() : ''),
      detectionMessage,
      detectionResult,
      rawPrediction: prediction ? { type: predType, shape: predShape, severity: predSeverity } : undefined,
      statusMessage: img.statusMessage
    } as DisplayImage;
  }



  onScroll(event: any) {
  clearTimeout((event as any)._timeout);
  (event as any)._timeout = setTimeout(() => {
    this.detectCenterImage();
  }, 100);
}

detectCenterImage() {
  const container = this.scrollContainer.nativeElement as HTMLElement;
  const images = container.querySelectorAll('img');
  const containerRect = container.getBoundingClientRect();
  const centerX = containerRect.left + containerRect.width / 2;

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

  if (closestImg) {
    const src = (closestImg as HTMLImageElement).getAttribute('src') ?? '';
    const matched = this.imagePaths.find(img => img.original === src || img.withBoxes === src);
    if (!matched) return;
  this.selectedImage = this.showWithBoxes ? matched.withBoxes : matched.original;
  // Prefer stored statusMessage; otherwise build readable strings from prediction
  if (matched.statusMessage && matched.statusMessage.length > 0) {
    this.detectionMessage = matched.statusMessage;
  } else if (matched.rawPrediction) {
    const p = matched.rawPrediction;
    this.detectionMessage = p.type ? `${p.type}${p.severity ? ' — ' + p.severity : ''}` : '⚠️ No info available';
  } else {
    this.detectionMessage = '⚠️ No info available';
  }

  

  if (matched.rawPrediction) {
    const p = matched.rawPrediction;
    this.detectionResult = p.shape ? `${p.shape}${p.severity ? ' — ' + p.severity : ''}` : (p.severity ?? '⚠️ No info available');
  } else if (matched.statusMessage && matched.statusMessage.length > 0) {
    this.detectionResult = matched.statusMessage;
  } else {
    this.detectionResult = '⚠️ No info available';
  }

  // Set the title from the stored filename if available
  this.selectedImageTitle = matched.fileName ?? '';

  // Populate structured prediction and status for UI use
  this.selectedPrediction = matched.rawPrediction ?? {};
  this.selectedStatusMessage = matched.statusMessage ?? '';

  // Immediately prefer prediction values for dropdowns so the UI reflects
  // the selected image's prediction right away (overrides filename fallback).
  this.dropdown1 = this.selectedPrediction.type ?? this.selectedImageTitle;
  this.dropdown2 = this.selectedPrediction.shape ?? this.selectedImageTitle;
  this.dropdown3 = this.selectedPrediction.severity ?? this.selectedImageTitle;
  this.extraText = this.selectedStatusMessage ?? '';

  // Ensure formDataMap entry exists and is updated with these values
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
    


//     const parts = matched.original.split('/');
//     const filename = parts[parts.length - 1];
//     const baseName = filename.split('.')[0];
// this.selectedImageTitle = this.imagePaths.find(img => img.fileName);

    const titleMap: { [key: string]: string } = {
      'img1': 'Sunset View',
      'img2': 'Mountain Range',
      'img3': 'Ocean Breeze',
      '108644884_p0': 'Crack Type A',
      '112772382_p0': 'Crack Type B',
      '113341201_p0': 'Crack Type C',
      'test2': 'Test Image',
      'tower': 'Tower Damage'
    };

    

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
      'Diagonal'
    ];

    this.dropdownOptionsShape = [
      optShape,
      'Bulge',
      'Vertical',
      'Diagonal'
    ];

    this.dropdownOptionsSeverity = [
      optSeverity,
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
  debugLogStoredImages() {
    const svc: any = this.imageStorageService as any;
    let imgs: any[] = [];
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

    console.log(`[FeedbackPage] debugLogStoredImages - found ${imgs.length} images`);
    const rows = imgs.map((img: any) => {
      const prediction = img.prediction ?? img.rawPrediction ?? undefined;
      const status = img.statusMessage ?? img.detectionMessage ?? '';

      let detectionMessage = '';
      if (status && status.length > 0) {
        detectionMessage = status;
      } else if (prediction) {
        detectionMessage = prediction.type ? `${prediction.type}${prediction.severity ? ' — ' + prediction.severity : ''}` : '⚠️ No info available';
      } else {
        detectionMessage = '⚠️ No info available';
      }

      let detectionResult = '';
      if (prediction) {
        detectionResult = prediction.shape ? `${prediction.shape}${prediction.severity ? ' — ' + prediction.severity : ''}` : (prediction.severity ?? '⚠️ No info available');
      } else if (status && status.length > 0) {
        detectionResult = status;
      } else {
        detectionResult = '⚠️ No info available';
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

    console.table(rows);
    console.group('[FeedbackPage] storedImages detail');
    rows.forEach(r => console.log(r.filename || '(unnamed)', r));
    console.groupEnd();
  }


  getAllEntries() {
  const allEntries = Object.entries(this.formDataMap).map(([image, data]) => ({
    image,
    ...data
  }));
  console.log('All Entries:', allEntries);
  this.router.navigate(['/pdfpage01']);
    console.log('Navigating to Sign Up page');
  return allEntries;
}

  

addEntry() {
  if (!this.selectedImage) return;

  this.formDataMap[this.selectedImage] = {
    title: this.selectedImageTitle,
    dropdown1: this.dropdown1,
    dropdown2: this.dropdown2,
    dropdown3: this.dropdown3,
    extraText: this.extraText
  };

  console.log(`Form saved for ${this.selectedImageTitle}`);
}

testApi() {

  this.api.getHelloTest().subscribe((res: any) => {
      this.message = res.message;
    });

    console.log(this.message)

}


goToSecondPage() {
    this.router.navigate(['/pdfpage01']);
    console.log('Navigating to Sign Up page');
  }

  gotoPDFPage() {
    this.router.navigate(['/pdf-page']);
    console.log('Navigating to Sign Up page');
  }

   gopdfPage() {
      this.router.navigate(['/pdf-page-test']);
      console.log('camera page');
    }

  /**
   * Delete the currently-selected image from storage and update the UI.
   * Uses the ImageStorageService.removeImageByOriginal method (added to service).
   */
  async deleteSelectedImage() {
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

    const matched = this.imagePaths[idx];
    const original = matched.original;
    const filename = matched.fileName ?? '(unnamed)';

    const confirmMsg = `Delete image "${filename}"? This action cannot be undone.`;
    if (!confirm(confirmMsg)) return;

    try {
      const removed = await (this.imageStorageService as any).deleteImage(original);
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
        this.selectedImageTitle = first.fileName ?? '';

        // update dropdowns and detection strings
        if (this.selectedStatusMessage && this.selectedStatusMessage.length > 0) {
          this.detectionMessage = this.selectedStatusMessage;
          this.detectionResult = this.selectedStatusMessage;
        } else if (this.selectedPrediction) {
          const p = this.selectedPrediction;
          this.detectionMessage = p.type ? `${p.type}${p.severity ? ' — ' + p.severity : ''}` : '⚠️ No info available';
          this.detectionResult = p.shape ? `${p.shape}${p.severity ? ' — ' + p.severity : ''}` : (p.severity ?? '⚠️ No info available');
        }

        this.dropdown1 = this.selectedPrediction.type ?? this.selectedImageTitle;
        this.dropdown2 = this.selectedPrediction.shape ?? this.selectedImageTitle;
        this.dropdown3 = this.selectedPrediction.severity ?? this.selectedImageTitle;
      } else {
        // cleared all images — reset UI
        this.selectedImage = '';
        this.selectedPrediction = {};
        this.selectedStatusMessage = '';
        this.selectedImageTitle = '';
        this.detectionMessage = '';
        this.detectionResult = '';
        this.dropdown1 = '';
        this.dropdown2 = '';
        this.dropdown3 = '';
      }

      // Helpful debug output
      console.log(`[FeedbackPage] deleteSelectedImage: removed ${filename}. Remaining images: ${this.imagePaths.length}`);
      this.debugLogStoredImages();
    } catch (err) {
      console.error('[FeedbackPage] deleteSelectedImage failed', err);
    }
  }


  
  
  goBack() {
    try {
      this.router.navigateByUrl('/home-page');
    } catch (e) {
      window.history.back();
    }
  }

  onBack() {
    this.goBack();
  }

  /**
   * Navigate to results page showing crack analysis charts
   */
  viewResults() {
    // Navigate to results page with current sessionId if available
    const sessionId = this.routeSessionId || null;
    if (sessionId) {
      this.router.navigate(['/results-page'], { queryParams: { sessionId } });
    } else {
      this.router.navigate(['/results-page']);
    }
  }

  /**
   * Save the currently-selected StoredImage (or the service current image) as a session,
   * update the storage entry, show a confirmation popup and navigate to home.
   */
  async saveCurrentStoredImageAndGoHome() {
    try {
      // Try service current image first
      let entry: any = undefined;
      try {
        entry = (this.imageStorageService as any).getCurrentImage ? (this.imageStorageService as any).getCurrentImage() : undefined;
      } catch (e) {
        // ignore
      }

      // Fallback: try to locate via selectedImage path in the display list
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

      if (!entry) {
        alert('No image selected to save. Please select an image first.');
        return;
      }

      // mark entry as saved session and persist to service
      entry.statusMessage = entry.statusMessage ?? 'Saved as session';
      if ((this.imageStorageService as any).setEntryForImage) {
        (this.imageStorageService as any).setEntryForImage(entry.original, entry);
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
  async showSaveSessionPrompt(entry: any): Promise<void> {
    return new Promise((resolve) => {
      // create overlay
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
      box.style.background = '#fff';
      box.style.padding = '18px';
      box.style.borderRadius = '8px';
      box.style.minWidth = '300px';
      box.style.boxShadow = '0 6px 30px rgba(0,0,0,0.3)';

      const title = document.createElement('div');
      title.innerText = 'Save Session';
      title.style.fontWeight = '700';
      title.style.marginBottom = '8px';

      const label = document.createElement('label');
      label.innerText = 'Session name:';
      label.style.display = 'block';
      label.style.marginBottom = '6px';

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = `Session ${new Date().toLocaleString()}`;
      input.style.width = '100%';
      input.style.padding = '8px';
      input.style.marginBottom = '12px';
      input.style.border = '1px solid #ccc';
      input.style.borderRadius = '4px';

      const btnRow = document.createElement('div');
      btnRow.style.display = 'flex';
      btnRow.style.justifyContent = 'flex-end';
      btnRow.style.gap = '8px';

      const cancelBtn = document.createElement('button');
      cancelBtn.innerText = 'Cancel';
      cancelBtn.style.padding = '8px 10px';
      cancelBtn.style.width = '110px';
      cancelBtn.style.height = '40px';
      cancelBtn.style.border = 'none';
      cancelBtn.style.background = '#aaa';
      cancelBtn.style.color = '#fff';
      cancelBtn.style.borderRadius = '6px';
      cancelBtn.style.cursor = 'pointer';

      const saveBtn = document.createElement('button');
      saveBtn.innerText = 'Save';
      saveBtn.style.padding = '8px 10px';
      saveBtn.style.width = '110px';
      saveBtn.style.height = '40px';
      saveBtn.style.border = 'none';
      saveBtn.style.background = '#3880ff';
      saveBtn.style.color = '#fff';
      saveBtn.style.borderRadius = '6px';
      saveBtn.style.cursor = 'pointer';

      cancelBtn.addEventListener('click', () => {
        try { document.body.removeChild(overlay); } catch (e) {}
        resolve();
      });

      saveBtn.addEventListener('click', async () => {
        try {
          const val = input.value && input.value.trim().length > 0 ? input.value.trim() : `Session ${new Date().toLocaleString()}`;
          const svc: any = this.imageStorageService as any;
          // If a session is already selected (e.g., from Camera page), update it
          if (this.selectedSessionId && typeof svc.addImageToSession === 'function') {
            try {
              svc.addImageToSession(this.selectedSessionId, entry.original);
            } catch (e) {
              console.warn('[FeedbackPage] failed to add image to existing session', e);
            }
            // Try to rename session if service supports it
            if (typeof svc.updateSessionName === 'function') {
              try { svc.updateSessionName(this.selectedSessionId, val); } catch (e) { /* ignore */ }
            }
          } else {
            // create session via service and set last created name
            if (typeof svc.createSession === 'function') {
              const s = svc.createSession(val, [entry.original]);
              if (s && typeof svc.setLastCreatedSession === 'function') {
                try { svc.setLastCreatedSession(s.id, s.name); } catch (e) { /* ignore */ }
              }
            }
          }

          try { document.body.removeChild(overlay); } catch (e) {}
          alert('Session saved successfully');
          this.router.navigate(['/home-page']);
        } catch (ee) {
          console.warn('Failed to save session via prompt', ee);
          alert('Failed to create session. See console.');
        }
        resolve();
      });

      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(saveBtn);

      box.appendChild(title);
      // box.appendChild(label);
      box.appendChild(input);
      box.appendChild(btnRow);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      // focus input
      setTimeout(() => input.focus(), 50);
    });
  }

}

