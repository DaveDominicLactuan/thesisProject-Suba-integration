import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { NavController } from '@ionic/angular';
import { User } from 'firebase/auth';
import { Auth3Service } from '../services/auth3.service';
import { ImageStorageService, StoredImage, ImageSession } from '../services/image-storage.service';

@Component({
  selector: 'app-session-page',
  templateUrl: './session-page.page.html',
  styleUrls: ['./session-page.page.scss'],
  standalone: false
})
export class SessionPagePage implements OnInit {
  userName: string | null = null;
  firstName: string | null = null;
  lastName: string | null = null;
  // authoritative list of StoredImage items
  storedImages: StoredImage[] = [];
  // session list and selected session
  sessions: ImageSession[] = [];
  selectedSession: ImageSession | null = null;

  constructor(private formBuilder: FormBuilder, private router: Router, private authService: AuthService, private navCtrl: NavController, private auth3: Auth3Service, private imageStorage: ImageStorageService) {

  }

  /** Return number of detected objects (boxes) if present on the StoredImage */
  getObjectsCount(img: StoredImage): number {
    try {
      const boxes = (img as any).boxes;
      if (Array.isArray(boxes)) return boxes.length;
    } catch (e) { /* ignore */ }
    return 0;
  }

//   ngOnInit() {
//     // Initialization logic can go here
//     const user = this.auth3.getCurrentUser();
   
//     // this.firstName = user?.firstName ?? null;
//     // this.lastName = user?.lastName ?? null;
// this.userName = user?.email ?? null;
//     try {
//       const profile = await this.auth3.getUserProfile();
//    this.firstName = profile['firstName'];
// this.lastName = profile['lastName'];

       
//     } catch (error) {
//       console.error(error);
//     }
  

//     // subscribe to auth changes (optional)
//     // this.authService.onAuthChange((u: User | null) => {
//     //   this.userName = u?.email ?? null;
//     //   if (!u) this.navCtrl.navigateRoot('/login');
//     // });
//   }

async ngOnInit() {
  try {
    const profile = await this.auth3.getUserProfile();
   this.firstName = profile['firstName'];
this.lastName = profile['lastName'];
      // load stored images for the session page
      await this.loadSessions();
      await this.loadStoredImages();
  } catch (error) {
    console.error(error);
  }
}

  goBack() {
    try {
      this.router.navigateByUrl('/home-page');
    } catch (e) {
      window.history.back();
    }
  }
  /** Load images from the ImageStorageService and keep newest-first ordering */
  async loadStoredImages() {
    try {
      const all = await this.imageStorage.getAllImages();
      // If a session is selected, filter stored images to only those in the session
      if (this.selectedSession && Array.isArray(this.selectedSession.imageKeys) && this.selectedSession.imageKeys.length > 0) {
        this.storedImages = Array.isArray(all) ? all.filter(img => this.selectedSession!.imageKeys.includes(img.original)) : [];
      } else {
        // ImageStorageService stores newest-first (unshift), but ensure a copy
        this.storedImages = Array.isArray(all) ? all.slice() : [];
      }
      // already newest-first; if you need to sort explicitly by timestamp:
      // this.storedImages.sort((a,b) => b.timestamp.localeCompare(a.timestamp));
    } catch (e) {
      console.warn('[SessionPage] loadStoredImages failed', e);
      this.storedImages = [];
    }
  }

  /** Load sessions from the ImageStorageService */
  async loadSessions() {
    try {
      const s = (this.imageStorage && typeof (this.imageStorage.getSessions) === 'function') ? this.imageStorage.getSessions() : [];
      this.sessions = Array.isArray(s) ? s.slice() : [];
    } catch (e) {
      console.warn('[SessionPage] loadSessions failed', e);
      this.sessions = [];
    }
  }

  /** Select a session and refresh displayed images to match it */
  async selectSession(session: ImageSession) {
    try {
      this.selectedSession = session;
      await this.loadStoredImages();
    } catch (e) {
      console.warn('[SessionPage] selectSession failed', e);
    }
  }

  /** Delete one stored image and refresh the list */
  async deleteStoredImage(img: StoredImage) {
    try {
      const ok = confirm(`Delete stored image from ${img.timestamp}? This cannot be undone.`);
      if (!ok) return;
      const removed = await (this.imageStorage as any).deleteImage(img.original);
      if (removed) {
        await this.loadStoredImages();
        alert('Image deleted');
      } else {
        alert('Image not found');
      }
    } catch (e) {
      console.error('[SessionPage] deleteStoredImage failed', e);
      alert('Failed to delete image. See console.');
    }
  }

  /** Select a stored image and navigate to the feedback page to view/edit it. Pass the image via router state. */
  selectStoredImage(img: StoredImage) {
    try {
      // Navigate to feedback page with the selected image original in navigation state
      this.router.navigate(['/feedback-page'], { state: { selectedImageOriginal: img.original, selectedFilename: img.filename } });
    } catch (e) {
      console.warn('[SessionPage] selectStoredImage navigation failed', e);
    }
  }

  recommendedCourses = [
    {
      title: 'Morning textbook',
      rating: 8.6,
      favorited: true,
    },
    {
      title: 'English reading',
      rating: 8.0,
      favorited: false,
    },
    {
      title: 'Illustration',
      rating: 7.5,
      favorited: false,
    },
  ];

  goToHomePage() {
    this.router.navigate(['/camera-page']);
    console.log('camera page');
  }
  
  goToCameraPahge2() {
    this.router.navigate(['/camera-page2']);
    console.log('camera page');
  }

  goTestCameraPage() {
    this.router.navigate(['/custom-camera-test']);
    console.log('custom camera');
  }

  gopdfPage() {
    this.router.navigate(['/pdf-page-test']);
    console.log('pdf page');
  }

  gopdfPage2() {
    this.router.navigate(['/camera-page2']);
    console.log('pdf 2 page');
  }


  goToUploadImage() {
    this.router.navigate(['/upload-image-page']);
    console.log('pdf 3 page');
  }

  /** Navigate to a session: select its first image (if any) and open camera-page2 */
  async goToSession(session: any) {
    try {
      if (session && session.imageKeys && session.imageKeys.length > 0) {
        const key = session.imageKeys[0];
        if (this.imageStorage && typeof this.imageStorage.selectImageByOriginal === 'function') {
          this.imageStorage.selectImageByOriginal(key);
        }
      }
    } catch (e) {
      console.warn('goToSession warning', e);
    }
    this.router.navigate(['/camera-page2']);
  }

  /** Delete a session and refresh list */
  async deleteSession(session: any, ev?: Event) {
    try {
      if (ev) ev.stopPropagation();
      if (!session || !session.id) return;
      if (typeof (this.imageStorage as any).removeSession === 'function') {
        const ok = confirm('Delete session "' + (session.name || session.id) + '"? This cannot be undone.');
        if (!ok) return;
        (this.imageStorage as any).removeSession(session.id);
        await this.loadSessions();
        await this.loadStoredImages();
      }
    } catch (e) {
      console.warn('deleteSession failed', e);
    }
  }

  /**
   * Clear all stored images after a confirmation prompt.
   */
  async clearImageStorage() {
    const ok = confirm('Clear all stored images? This cannot be undone.');
    if (!ok) return;
    try {
      if (typeof (this.imageStorage as any).clearImages === 'function') {
        await (this.imageStorage as any).clearImages();
      } else if (typeof (this.imageStorage as any).clear === 'function') {
        await (this.imageStorage as any).clear();
      }
      console.log('All stored images cleared');
      alert('All stored images cleared');
    } catch (err) {
      console.error('Failed to clear image storage', err);
      alert('Failed to clear image storage. See console for details.');
    }
  }

  /**
   * Append a simple overlay/modal to the page with a button that sends a notification.
   * The overlay is self-cleaning after the button is pressed or the backdrop is clicked.
   */
  showTestOverlay() {
    // Prevent multiple overlays
    if (document.getElementById('test-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'test-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'rgba(0,0,0,0.45)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '9999';

    const box = document.createElement('div');
    box.style.background = '#fff';
    box.style.padding = '20px';
    box.style.borderRadius = '8px';
    box.style.minWidth = '260px';
    box.style.boxShadow = '0 4px 20px rgba(0,0,0,0.3)';
    box.style.textAlign = 'center';

    const msg = document.createElement('div');
    msg.innerText = 'Test overlay';
    msg.style.marginBottom = '12px';
    msg.style.fontSize = '16px';
    msg.style.fontWeight = '600';

    const btn = document.createElement('button');
    btn.innerText = 'Send Notification';
    btn.style.padding = '10px 14px';
    btn.style.border = 'none';
    btn.style.borderRadius = '6px';
    btn.style.background = '#3880ff';
    btn.style.color = '#fff';
    btn.style.cursor = 'pointer';

    const btn2 = document.createElement('button');
    btn2.innerText = 'Delete Image Storage';
    btn2.style.padding = '10px 14px';
    btn2.style.border = 'none';
    btn2.style.borderRadius = '6px';
    btn2.style.background = '#3880ff';
    btn2.style.color = '#fff';
    btn2.style.cursor = 'pointer';

    // Close button
    const close = document.createElement('button');
    close.innerText = 'Close';
    close.style.marginLeft = '10px';
    close.style.padding = '10px 12px';
    close.style.border = 'none';
    close.style.borderRadius = '6px';
    close.style.background = '#aaa';
    close.style.color = '#fff';
    close.style.cursor = 'pointer';

    btn.addEventListener('click', () => {
      // simple notification: alert (could be replaced with Ionic Toast/Notification)
      alert('Hello it worked');
      document.body.removeChild(overlay);
    });

    // Delete-storage handler should be attached to btn2 (Delete Image Storage)
    btn2.addEventListener('click', () => {
      this.clearImageStorage();
      if (document.getElementById('test-overlay')) document.body.removeChild(overlay);
    });

    close.addEventListener('click', () => {
      if (document.getElementById('test-overlay')) document.body.removeChild(overlay);
    });

    // clicking backdrop closes overlay
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) {
        if (document.getElementById('test-overlay')) document.body.removeChild(overlay);
      }
    });

    box.appendChild(msg);
    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.justifyContent = 'center';
    btnRow.appendChild(btn);
    btnRow.appendChild(btn2);
    btnRow.appendChild(close);
    box.appendChild(btnRow);
    overlay.appendChild(box);

    document.body.appendChild(overlay);
  }



  
  

  // Additional methods can be added here


}
