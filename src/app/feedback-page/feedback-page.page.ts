import { Component, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../api.service';
import { ImageStorageService } from '../image-storage.service';
import { CameraPreview, CameraPreviewOptions } from '@awesome-cordova-plugins/camera-preview/ngx';

interface DisplayImage {
  original: string;
  withBoxes: string;
  fileName?: string;
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
formDataMap: {
  [image: string]: {
    title: string;
    dropdown1: string;
    dropdown2: string;
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

this.cameraPreview.stopCamera();

  

    console.log(this.message)
  }
  

  @ViewChild('scrollContainer', { static: false }) scrollContainer!: ElementRef;
 
    name: string = '';
    storedEntries: { image: string; title: string; dropdown1: string; dropdown2: string; extraText: string }[] = [];
    email: string = '';
    password: string = '';
    rememberMe: boolean = false;
    showPassword: boolean = false;
    username: string = '';
    firstName: string = '';
    lastName: string = '';
    dropdown1: string = '';
  dropdown2: string = '';
  extraText: string = '';
  dropdownOptions: string[] = [];
  dropdownOptionsDirection: string[] = [];
  detectionMessage: string = '';

    
   

  ngAfterViewInit() {
  this.cameraPreview.stopCamera();

  this.api.getHelloTest().subscribe((res: any) => {
    this.message = res.message;
  });

  setTimeout(() => {
    this.imagePaths = this.imageStorageService.getImages().map((img) => ({
  original: img.original,
  withBoxes: img.withBoxes ?? img.original,  // fallback if undefined
  fileName: img.filename ?? img.original.split('/').pop() ?? ''

})); // ✅ only here

    if (this.imagePaths.length === 0) {
      this.imagePaths.push({
        original: 'assets/108644884_p0.jpg',
        withBoxes: 'assets/112772382_p0.jpg'
      });
    }

    this.detectCenterImage();
    this.dropdownOptions = [
      this.selectedImageTitle,
      'Negligible',
      'moderate',
      'severe',
      'very severe'
    ];
    this.dropdownOptionsDirection = [
      this.selectedImageTitle,
      'Horizontal',
      'Vertical',
      'Diagonal'
    ];
    this.dropdown1 = this.selectedImageTitle;
    this.dropdown2 = this.selectedImageTitle;
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
    this.detectionMessage = (matched as any).detectionMessage || '⚠️ No info available';

    this.selectedImageTitle = matched.fileName ?? '';
    


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
      this.formDataMap[src] = {
        title: this.selectedImageTitle,
        dropdown1: this.selectedImageTitle,
        dropdown2: this.selectedImageTitle,
        extraText: ''
      };
    }

    const form = this.formDataMap[src];
    this.dropdown1 = form.dropdown1;
    this.dropdown2 = form.dropdown2;
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
  }
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

