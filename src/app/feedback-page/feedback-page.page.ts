import { Component, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { Router } from '@angular/router';
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




  constructor(private router: Router, private api: ApiService, private imageStorageService: ImageStorageService, private cameraPreview: CameraPreview) { }

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
  

  @ViewChild('scrollContainer', { static: false }) scrollContainer!: ElementRef;
 
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

  this.api.getHelloTest().subscribe((res: any) => {
    this.message = res.message;
  });

    setTimeout(() => {
    this.imagePaths = this.imageStorageService.getAllImages().map((img: StoredImage) => {
  // Build friendly display strings from stored prediction or statusMessage
  const prediction = img.prediction;
  const predType = prediction?.type ?? '';
  const predShape = prediction?.shape ?? '';
  const predSeverity = prediction?.severity ?? '';

  const detectionMessage = img.statusMessage && img.statusMessage.length > 0
    ? img.statusMessage
    : (predType || predSeverity) ? `${predType}${predSeverity ? ' — ' + predSeverity : ''}` : '';

  const detectionResult = img.statusMessage && img.statusMessage.length > 0
    ? img.statusMessage
    : (predShape || predSeverity) ? `${predShape}${predSeverity ? ' — ' + predSeverity : ''}` : '';

  return ({
    original: img.original,
    withBoxes: (img as any).withBoxes ?? img.original,  // fallback if undefined
    fileName: img.filename ?? img.original.split('/').pop() ?? '',
    // Prefer explicit statusMessage from processing; fall back to prediction fields
    detectionMessage,
    detectionResult,
    // Keep raw values handy for templates and dropdown defaults
    rawPrediction: prediction ? { type: predType, shape: predShape, severity: predSeverity } : undefined,
    statusMessage: img.statusMessage
  } as DisplayImage);

}); // ✅ only here

    if (this.imagePaths.length === 0) {
      this.imagePaths.push({
        original: 'assets/108644884_p0.jpg',
        withBoxes: 'assets/112772382_p0.jpg'
      });
    }

    this.detectCenterImage();
  // Print stored images + prediction-derived display strings for debugging
  this.debugLogStoredImages();
    this.dropdownOptions = [
      this.selectedPrediction.type ?? this.selectedImageTitle,
      'Negligible',
      'moderate',
      'severe',
      'very severe'
    ];
    this.dropdownOptionsDirection = [
      this.selectedPrediction.shape ?? this.selectedImageTitle,
      'Horizontal',
      'Vertical',
      'Diagonal'
    ];
    this.dropdownOptionsShape = [
      this.selectedPrediction.shape ?? this.selectedImageTitle,
      'Bulge',
      'Vertical',
      'Diagonal'
    ];
    this.dropdownOptionsSeverity = [
      this.selectedPrediction.severity ?? this.selectedImageTitle,
      'Negligible',
      'moderate',
      'severe',
      'very severe'
    ];
    this.dropdown1 = this.selectedPrediction.type ?? this.selectedImageTitle;
    this.dropdown2 = this.selectedPrediction.shape ?? this.selectedImageTitle;
    this.dropdown3 = this.selectedPrediction.severity ?? this.selectedImageTitle;
  }, 500);
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
        title: this.selectedImageTitle,
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

    this.dropdownOptions = [
      form.title,
      'Negligible',
      'moderate',
      'severe',
      'very severe'
    ];

    this.dropdownOptionsDirection = [
      form.title,
      'Horizontal',
      'Vertical',
      'Diagonal'
    ];

    this.dropdownOptionsShape = [
      form.title,
      'Bulge',
      'Vertical',
      'Diagonal'
    ];

    this.dropdownOptionsSeverity = [
      form.title,
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


  
}

