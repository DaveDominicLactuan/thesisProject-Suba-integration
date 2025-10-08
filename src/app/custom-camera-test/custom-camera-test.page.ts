import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import { Camera, CameraResultType } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { Platform } from '@ionic/angular';

@Component({
  selector: 'app-custom-camera-test',
  templateUrl: './custom-camera-test.page.html',
  styleUrls: ['./custom-camera-test.page.scss'],
  standalone: false
})
export class CustomCameraTestPage implements AfterViewInit {
  @ViewChild('video') videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  imagePreview: string | null = null;
  capturedImages: string[] = [];
  usingFrontCamera = false;
  mediaStream: MediaStream | null = null;

  faceDetected = false; // you already use this
  scaledBoxes = [];     // you already use this

  ngAfterViewInit() {
    // this.initCamera();
    this.platform.ready().then(() => {
    this.initCamera();
  });
  }

  constructor(private platform: Platform) {

  }

  // async initCamera() {
  //   if (this.mediaStream) {
  //     this.mediaStream.getTracks().forEach(track => track.stop());
  //   }

  //   const constraints = {
  //     video: {
  //       facingMode: this.usingFrontCamera ? 'user' : 'environment'
  //     }
  //   };

  //   try {
  //     this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
  //     this.videoRef.nativeElement.srcObject = this.mediaStream;
  //   } catch (error) {
  //     console.error('Camera initialization error:', error);
  //   }
  // }

//   async initCamera() {
//   // 1. Stop existing stream
//   if (this.mediaStream) {
//     this.mediaStream.getTracks().forEach(track => track.stop());
//   }

//   // 2. Define constraints
//   const constraints: MediaStreamConstraints = {
//     video: {
//       facingMode: this.usingFrontCamera ? 'user' : 'environment',
//       width: { ideal: 1280 },
//       height: { ideal: 720 }
//     },
//     audio: false // disable audio unless needed
//   };

//   try {
//     // 3. Request camera stream
//     this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

//     const videoElement = this.videoRef.nativeElement;

//     // 4. Attach stream to video element
//     videoElement.srcObject = this.mediaStream;

//     // 5. Wait until video is ready
//     await new Promise<void>((resolve) => {
//       videoElement.onloadedmetadata = () => {
//         videoElement.play();
//         resolve();
//       };
//     });

//     console.log('✅ Camera initialized');
//   } catch (error: any) {
//     console.error('❌ Camera initialization error:', error);

//     if (error.name === 'NotAllowedError') {
//       alert('Camera access was denied. Please allow it in your settings.');
//     } else if (error.name === 'NotFoundError') {
//       alert('No camera found on this device.');
//     } else {
//       alert('An unknown error occurred while accessing the camera.');
//     }
//   }
// }

// async initCamera() {
//   // 🔐 Step 1: Request camera permission at runtime
//   const permissionStatus = await Permissions.request({ name: 'camera' });

//   if (permissionStatus.state !== 'granted') {
//     alert('Camera permission denied. Please allow it in your settings.');
//     return;
//   }

//   // 🛑 Stop any existing media stream
//   if (this.mediaStream) {
//     this.mediaStream.getTracks().forEach(track => track.stop());
//   }

//   const constraints: MediaStreamConstraints = {
//     video: {
//       facingMode: this.usingFrontCamera ? 'user' : 'environment',
//       width: { ideal: 1280 },
//       height: { ideal: 720 }
//     },
//     audio: false
//   };

//   try {
//     // 🎥 Request camera stream
//     this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

//     const videoElement = this.videoRef.nativeElement;
//     videoElement.srcObject = this.mediaStream;

//     // 📼 Wait for metadata before playing
//     await new Promise<void>((resolve) => {
//       videoElement.onloadedmetadata = () => {
//         videoElement.play();
//         resolve();
//       };
//     });

//     console.log('✅ Camera initialized');
//   } catch (error: any) {
//     console.error('❌ Camera initialization error:', error);

//     if (error.name === 'NotAllowedError') {
//       alert('Camera access was denied. Please allow it in your settings.');
//     } else if (error.name === 'NotFoundError') {
//       alert('No camera found on this device.');
//     } else {
//       alert('An unknown error occurred while accessing the camera.');
//     }
//   }
// }

// async initCamera() {
//   // ✅ 1. Request camera permission (via Camera plugin)
//   const permission = await Camera.requestPermissions();

//   if (permission.camera !== 'granted') {
//     alert('Camera permission denied. Please enable it in system settings.');
//     return;
//   }

//   // ✅ 2. Stop existing stream if needed
//   if (this.mediaStream) {
//     this.mediaStream.getTracks().forEach(track => track.stop());
//   }

//   // ✅ 3. Initialize stream
//   try {
//     const constraints = {
//       video: {
//         facingMode: this.usingFrontCamera ? 'user' : 'environment'
//       },
//       audio: false
//     };

//     this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
//     const videoEl = this.videoRef.nativeElement;

//     videoEl.srcObject = this.mediaStream;
//     await new Promise<void>((resolve) => {
//       videoEl.onloadedmetadata = () => {
//         videoEl.play();
//         resolve();
//       };
//     });

//     console.log('✅ Camera started');
//   } catch (err) {
//     console.error('Camera error:', err);
//     alert('Could not access the camera.');
//   }
// }

async initCamera() {
  // ✅ Step 1: Request camera permission using Capacitor Camera plugin
  if (Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios') {
    const permissions = await Camera.requestPermissions();

    if (permissions.camera !== 'granted') {
      alert('Camera permission denied. Please enable it in system settings.');
      return;
    }
  }

  // ✅ Step 2: Stop existing media stream
  if (this.mediaStream) {
    this.mediaStream.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
  }

  // ✅ Step 3: Define constraints and get user media
  try {
    const constraints: MediaStreamConstraints = {
      video: {
        facingMode: this.usingFrontCamera ? 'user' : 'environment',
      },
      audio: false
    };

    this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    const videoEl: HTMLVideoElement = this.videoRef.nativeElement;

    videoEl.srcObject = this.mediaStream;

    // Wait for video metadata before playing
    await new Promise<void>((resolve) => {
      videoEl.onloadedmetadata = () => {
        videoEl.play();
        resolve();
      };
    });

    console.log('✅ Live camera preview started');
  } catch (error) {
    console.error('Camera access error:', error);
    alert('Failed to access camera. Please check permissions and device compatibility.');
  }
}

  takeManualPicture() {
    const video = this.videoRef.nativeElement;
    const canvas = this.canvasRef.nativeElement;
    const context = canvas.getContext('2d');

    const width = video.videoWidth;
    const height = video.videoHeight;

    canvas.width = width;
    canvas.height = height;

    context?.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/png');

    this.imagePreview = dataUrl;
    this.capturedImages.unshift(dataUrl); // add to thumbnails
  }

  closePreview() {
    this.imagePreview = null;
  }

  toggleCamera() {
    this.usingFrontCamera = !this.usingFrontCamera;
    this.initCamera(); // restart with new facing mode
  }

  filterThumbnails(type: string) {
    // Optional: Filtering logic by image origin
  }

  goToFeedBackPage() {
    // Your routing logic
  }

  onBoxClick(box: any) {
    // Your bounding box logic
  }

  ngOnDestroy(): void {
    this.mediaStream?.getTracks().forEach(track => track.stop());
  }

  async requestCameraPermission() {
  try {
    const permission = await Camera.requestPermissions();

    if (permission.camera === 'granted') {
      console.log('✅ Camera permission granted');
      this.initCamera(); // Call your custom camera init
    } else {
      alert('❌ Camera permission denied. Please allow it in system settings.');
    }
  } catch (error) {
    console.error('Permission request failed:', error);
  }
}

}