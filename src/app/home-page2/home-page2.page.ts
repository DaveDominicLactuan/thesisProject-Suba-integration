import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { NavController, Platform } from '@ionic/angular';
import { User } from 'firebase/auth';
import { Auth3Service } from '../services/auth3.service';
import { ImageStorageService } from '../services/image-storage.service';
import { App } from '@capacitor/app';
import { jsPDF } from 'jspdf';

@Component({
  selector: 'app-home-page2',
  templateUrl: './home-page2.page.html',
  styleUrls: ['./home-page2.page.scss'],
  standalone: false
})
export class HomePage2Page implements OnInit, OnDestroy {
  userName: string | null = null;
  firstName: string | null = null;
  lastName: string | null = null;
  email: string | null = null;
  engineeringID: string | null = null;
  sessions: any[] = [];
  lastSessionDisplayName: string | null = null;
  private backButtonSub: any; // hardware back handler
  isLoggedIn: boolean = false;
  userRole: string | null = null;
  isSidebarOpen: boolean = false;

  /** Inject auth, router, and image storage services for navigation and data. */
  constructor(private formBuilder: FormBuilder, private router: Router, private authService: AuthService, private navCtrl: NavController, private auth3: Auth3Service, private imageStorage: ImageStorageService, private platform: Platform) {

  }

ngOnInit(): void {
  
  //initializes the data needed for the page such as user data, profile and session
  this.initialize();
}

/** Perform async initialization tasks (profile + sessions). */
private async initialize(): Promise<void> {
  try {
    // Ensure Firebase auth state is ready before fetching profile
    // wait for up to 8 seconds for auth from firebase and current user profile from firestore
    if (!this.auth3.getCurrentUser()) {
      console.log('[HomePage2] waiting for auth state…');
      await this.waitForUserAuth(8000);
    }
   // stores current user profile data in profile variables 
    const profile = await this.auth3.getUserProfile();
    this.firstName = profile['firstName'];
    this.lastName = profile['lastName'];
    this.engineeringID = profile['engineeringID'] || '';
    this.email = profile['email'] || '';
    // Read role from Firestore profile (authoritative source)
    this.userRole = profile['role'] || (this.engineeringID ? 'engineer' : 'user');
    //gets username from firatName and lastName
    this.userName = (this.firstName && this.lastName) ? `${this.firstName} ${this.lastName}` : (this.email || null);
    //prints the current user profile to console
    console.log('[HomePage2] user profile loaded', {
      firstName: this.firstName,
      lastName: this.lastName,
      email: this.email,
      engineeringID: this.engineeringID,
      userRole: this.userRole,
      userName: this.userName
    });
    // Persist/refresh local user data for downstream use, and for long term offline use
    try {
      localStorage.setItem('userData', JSON.stringify({
        username: this.userName || '',
        userRole: this.userRole || 'user',
        firstName: this.firstName || '',
        lastName: this.lastName || '',
        engineeringID: this.engineeringID || '',
        email: this.email || ''
      }));
      localStorage.setItem('isLoggedIn', 'true');
    } catch {}
     // Also persist user profile in sessionStorage for current session, short lived and cleared when closed
     try {
       sessionStorage.setItem('userProfile', JSON.stringify({
         username: this.userName || '',
         userRole: this.userRole || 'user',
         firstName: this.firstName || '',
         lastName: this.lastName || '',
         engineeringID: this.engineeringID || '',
         email: this.email || ''
       }));
       sessionStorage.setItem('isLoggedInSession', 'true');
     } catch {}
  } catch (error) {
    console.error(error);
    // Fallback: try to load previously saved user data
    try {
      const cached = localStorage.getItem('userData');
      if (cached) {
        const data = JSON.parse(cached);
        this.firstName = data.firstName || null;
        this.lastName = data.lastName || null;
        this.userName = data.username || null;
        this.userRole = data.userRole || 'user';
        this.email = data.email || null;
        this.engineeringID = data.engineeringID || null;
        console.log('[HomePage2] loaded user profile from cache', data);
      }
    } catch {}
  }
}

  // Wait for Firebase auth to emit a user or timeout
  private waitForUserAuth(timeoutMs: number = 8000): Promise<User | null> {
    //A new Promise is created to handle the asynchronous waiting process.
    //The settled flag ensures that the promise is resolved only once, 
    //even if multiple events occur (e.g., user detected and timeout).
    return new Promise((resolve) => {
      let settled = false as boolean;
      //This helper function resolves the promise with the provided user 
      // u) only if the promise has not already been resolved (settled is false).
      const maybeResolve = (u: User | null) => {
        if (!settled) { settled = true; resolve(u); }
      };
      //The onAuthChange method from auth3 is used to listen for changes 
      // in the authentication state. user (u) is detected, the promise 
      // is resolved with the user, and the listener (unsub) is unsubscribed to 
      // prevent further calls.
      let unsub: any = null;
      try {
        unsub = this.auth3.onAuthChange((u) => {
          if (u) {
            try { if (unsub) unsub(); } catch {}
            maybeResolve(u);
          }
        });
      } catch {}
      //A setTimeout is used to enforce the maximum wait time (timeoutMs). 
      //If the timeout is reached, the listener is unsubscribed, and the promise 
      // is resolved with the current user (if available) or null.
      setTimeout(() => {
        try { if (unsub) unsub(); } catch {}
        maybeResolve(this.auth3.getCurrentUser() || null);
      }, timeoutMs);
    });
  }

  // Called by Ionic when page becomes active — refresh and loads sessions/counts/
  /** Ionic hook: refresh sessions each time page becomes active. */
  ionViewWillEnter() {
    this.loadSessions();
  }

  /** Register hardware back handler only while this view is active, 
   * allowing for hardware back button navigation */
  ionViewDidEnter() {
    this.registerBackButtonHandler();
  }

  /** Remove hardware back handler when navigating away so other pages work normally, 
   * so as to keep logic for exiting the app inside home-page and not affect other pages*/
  ionViewWillLeave() {
    this.removeBackButtonHandler();
  }

  /** Load sessions from ImageStorageService and compute image counts. */
  async loadSessions() {
    try {
      //Safely read sessions from ImageStorageService, create a copy and stores it.
      const s = (this.imageStorage.getSessions && typeof this.imageStorage.getSessions === 'function') ? this.imageStorage.getSessions() : [];
      const sessionsRaw = Array.isArray(s) ? s.slice() : [];

      // compute image counts by comparing session imageKeys with stored images with 
      // geAllImages or getImages if fails into a arrayt allImages from the imageStorage not in sessions
      let allImages: any[] = [];
      try {
        // Prefer async or sync `getAllImages` when available
        if (typeof (this.imageStorage as any).getAllImages === 'function') {
          const res = (this.imageStorage as any).getAllImages();
          allImages = (res && typeof (res as Promise<any>).then === 'function') ? await res : res;
        } else if (typeof (this.imageStorage as any).getImages === 'function') {
          const res = (this.imageStorage as any).getImages();
          allImages = (res && typeof (res as Promise<any>).then === 'function') ? await res : res;
        } else {
          allImages = [];
        }
        // if it failed and returned a non array, or null or something else replace it with an empty array
        if (!Array.isArray(allImages)) allImages = [];
      } catch (e) {
        // fallback to synchronous call if async attempt failed
        try { allImages = (this.imageStorage as any).getImages ? (this.imageStorage as any).getImages() : []; } catch (ee) { allImages = []; }
        if (!Array.isArray(allImages)) allImages = [];
      }

      // counts how many imageKeys or images in the sessions are present in allImages
      this.sessions = sessionsRaw.map((sess: any) => {
        const keys = Array.isArray(sess.imageKeys) ? sess.imageKeys : [];
        const imageCount = keys.reduce((acc: number, k: string) => acc + (allImages.findIndex(ai => ai.original === k) !== -1 ? 1 : 0), 0);
        return { ...sess, imageCount };
      });
      // if Image Storage Service recorded a last created session or last used/created session,
      //  show its name at top of the summary list
      try {
        const lastName = (this.imageStorage as any).getLastCreatedSessionName ? (this.imageStorage as any).getLastCreatedSessionName() : null;
        if (lastName && lastName.length > 0) {
          this.lastSessionDisplayName = lastName;
        } else if (this.sessions && this.sessions.length > 0) {
          // placeholder: Session N where N is number of sessions
          this.lastSessionDisplayName = `Session ${this.sessions.length}`;
        } else {
          this.lastSessionDisplayName = null;
        }
      } catch (e) {
        this.lastSessionDisplayName = null;
      }
    } catch (e) {
      console.warn('Failed to load sessions', e);
      this.sessions = [];
    }
  }

  // Additional methods can be added here

  /** Navigate to legacy camera page route. */
  goToHomePage() {
    this.router.navigate(['/home-page2']);
    console.log('camera page');
  }
  
  /** Navigate to enhanced camera page with sessions support. */
  goToCameraPage2() {
    this.router.navigate(['/camera-page2']);
    console.log('camera page');
  }

  /** Navigate to custom camera test page. */
  goTestCameraPage() {
    this.router.navigate(['/custom-camera-test']);
    console.log('custom camera');
  }

  /** Navigate to PDF test page. */
  gopdfPage() {
    this.router.navigate(['/pdf-page-test']);
    console.log('pdf page');
  }

  /** Navigate to camera page 2 (alt entry). */
  gopdfPage2() {
    this.router.navigate(['/camera-page2']);
    console.log('pdf 2 page');
  }

  /** Navigate to sessions list page. */
  goSessionPage() {
    this.router.navigate(['/session-page']);
    console.log('pdf 2 page');
  }

  /** Shared logout flow used by overlay button and menu item. */
  async logout(closeOverlay: boolean = false) {
    try {
      await this.auth3.logout();
    } catch {}
    try { localStorage.setItem('isLoggedIn', 'false'); } catch {}
    try { localStorage.removeItem('userData'); } catch {}
    this.isLoggedIn = false;
    if (closeOverlay) {
      this.removeTestOverlay();
    }
    // Navigate to landing page replacing history so next back exits
    try {
      this.router.navigateByUrl('/landing-page', { replaceUrl: true });
    } catch {
      this.router.navigate(['/landing-page']);
    }
  }

  /**
   * Open the Feedback page pre-selecting a session. Select its first image in
   * ImageStorageService so detail UIs can initialize accordingly.
   */
  async goToSession(session: any) {
    // pick the first image in session and prepare the destination(feedback-page) to load it and 
    // display that first image when the session is selected
     try {
      if (session && session.imageKeys && session.imageKeys.length > 0) {
        const key = session.imageKeys[0];
        if (this.imageStorage && typeof this.imageStorage.selectImageByOriginal === 'function') {
          this.imageStorage.selectImageByOriginal(key);
        }
      }
    } catch (e) { console.warn('goToSession warning', e); }
    try {
      // Ensure HomePage back handler is removed before naviagting 
      // to feedback-page to keep the logic and behavior of back button is kept inside the home-page
      try { this.removeBackButtonHandler(); } catch (e) { /* ignore */ }

      //build the parameters for the current session to be selected and displayed 
      // in feedback-page with the session.id
      const params: any = {};
      if (session && session.id) params.sessionId = session.id;
      // Navigate to feedback page and include sessionId so feedback page can load the session
      this.router.navigate(['/feedback-page'], { queryParams: params });
    } catch (e) {
      console.warn('Navigation to feedback page failed, falling back', e);
      this.router.navigate(['/feedback-page']);
    }
  }

  /** Delete a session and refresh list */
  /** Delete a session via ImageStorageService and refresh list. */
  async deleteSession(session: any, ev?: Event) {
    // Step 1: Stop event propagation if an event is provided
    try {
      if (ev) ev.stopPropagation();

      // Step 2: Validate the session object and its ID
      if (!session || !session.id) return;

      // Step 3: Confirm deletion with the user
      if (typeof (this.imageStorage as any).removeSession === 'function') {
        const ok = confirm('Delete session "' + (session.name || session.id) + '"? This cannot be undone.');
        if (!ok) return;

        // Step 4: Remove the session using ImageStorageService
        (this.imageStorage as any).removeSession(session.id);

        // Step 5: Refresh the session list
        await this.loadSessions();
      }
    } catch (e) {
      // Step 6: Handle any errors that occur during the process
      console.warn('deleteSession failed', e);
    }
  }


  /** Navigate to image upload page. */
  goToUploadImage() {
    this.router.navigate(['/upload-image-page']);
    console.log('pdf 3 page');
  }
  


  /**
   * Clear all stored images after a confirmation prompt.
   */
  /**
   * Confirm and clear all stored images via ImageStorageService.
   * Shows a success/failure toast via alert.
   */
  async clearImageStorage() {
    const ok = confirm('Clear all stored images? This cannot be undone.');
    if (!ok) return;
    try {
      // ImageStorageService in this workspace exposes `clearImages()`; use that if present.
      if (typeof (this.imageStorage as any).clearImages === 'function') {
        await (this.imageStorage as any).clearImages();
      } else if (typeof (this.imageStorage as any).clear === 'function') {
        // fallback for implementations that use `clear()`
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
  /**
   * Simple in-app overlay to test notifications and storage/session helpers.
   */

  //show a overlay to show user profile and logout buttons
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
    const fullName = (this.firstName && this.lastName) ? `${this.firstName} ${this.lastName}` : (this.userName || 'N/A');
    
    // Create a more organized user info display
    msg.innerHTML = `
      <div style="font-weight:600;margin-bottom:12px;font-size:18px;color:#333;">User Profile</div>
      <div style="background:#f5f5f5;padding:12px;border-radius:6px;text-align:left;">
        <div style="margin-bottom:8px;">
          <span style="font-weight:600;color:#555;">Name:</span> 
          <span style="color:#333;">${fullName || 'N/A'}</span>
        </div>
        ${this.firstName ? `<div style="margin-bottom:8px;">
          <span style="font-weight:600;color:#555;">First Name:</span> 
          <span style="color:#333;">${this.firstName}</span>
        </div>` : ''}
        ${this.lastName ? `<div style="margin-bottom:8px;">
          <span style="font-weight:600;color:#555;">Last Name:</span> 
          <span style="color:#333;">${this.lastName}</span>
        </div>` : ''}
        <div style="margin-bottom:8px;">
          <span style="font-weight:600;color:#555;">Role:</span> 
          <span style="color:#333;text-transform:capitalize;">${this.userRole || 'N/A'}</span>
        </div>
        <div style="margin-bottom:0;">
          <span style="font-weight:600;color:#555;">Status:</span> 
          <span style="color:#28a745;font-weight:600;">${this.isLoggedIn ? 'Logged In' : 'Logged Out'}</span>
        </div>
      </div>
    `;
    msg.style.marginBottom = '16px';
    msg.style.fontSize = '14px';

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

    // Open PDF Viewer with a sample PDF generated via jsPDF
    const openPdfViewerBtn = document.createElement('button');
    openPdfViewerBtn.innerText = 'Open PDF Viewer (Sample)';
    openPdfViewerBtn.style.padding = '10px 14px';
    openPdfViewerBtn.style.border = 'none';
    openPdfViewerBtn.style.borderRadius = '6px';
    openPdfViewerBtn.style.background = '#3880ff';
    openPdfViewerBtn.style.color = '#fff';
    openPdfViewerBtn.style.cursor = 'pointer';

    // Open PDF Preview page with testing interface
    const openPdfPreviewBtn = document.createElement('button');
    openPdfPreviewBtn.innerText = 'PDF Preview & Testing';
    openPdfPreviewBtn.style.padding = '10px 14px';
    openPdfPreviewBtn.style.border = 'none';
    openPdfPreviewBtn.style.borderRadius = '6px';
    openPdfPreviewBtn.style.background = '#6366f1';
    openPdfPreviewBtn.style.color = '#fff';
    openPdfPreviewBtn.style.cursor = 'pointer';

    // Open PDF Generator page (pdf-lib + native opener)
    const openPdfGeneratorBtn = document.createElement('button');
    openPdfGeneratorBtn.innerText = 'PDF Generator (pdf-lib)';
    openPdfGeneratorBtn.style.padding = '10px 14px';
    openPdfGeneratorBtn.style.border = 'none';
    openPdfGeneratorBtn.style.borderRadius = '6px';
    openPdfGeneratorBtn.style.background = '#10b981';
    openPdfGeneratorBtn.style.color = '#fff';
    openPdfGeneratorBtn.style.cursor = 'pointer';

    // PDF Page Test buttons
    const pdfPageBtn = document.createElement('button');
    pdfPageBtn.innerText = 'PDF Page';
    pdfPageBtn.style.padding = '10px 14px';
    pdfPageBtn.style.border = 'none';
    pdfPageBtn.style.borderRadius = '6px';
    pdfPageBtn.style.background = '#8b5cf6';
    pdfPageBtn.style.color = '#fff';
    pdfPageBtn.style.cursor = 'pointer';

    const pdfPageTestBtn = document.createElement('button');
    pdfPageTestBtn.innerText = 'PDF Page Test';
    pdfPageTestBtn.style.padding = '10px 14px';
    pdfPageTestBtn.style.border = 'none';
    pdfPageTestBtn.style.borderRadius = '6px';
    pdfPageTestBtn.style.background = '#f59e0b';
    pdfPageTestBtn.style.color = '#fff';
    pdfPageTestBtn.style.cursor = 'pointer';

    const pdfPageTest02Btn = document.createElement('button');
    pdfPageTest02Btn.innerText = 'PDF Page Test 02';
    pdfPageTest02Btn.style.padding = '10px 14px';
    pdfPageTest02Btn.style.border = 'none';
    pdfPageTest02Btn.style.borderRadius = '6px';
    pdfPageTest02Btn.style.background = '#ec4899';
    pdfPageTest02Btn.style.color = '#fff';
    pdfPageTest02Btn.style.cursor = 'pointer';

    const pdfPageTest03Btn = document.createElement('button');
    pdfPageTest03Btn.innerText = 'PDF Page Test 03';
    pdfPageTest03Btn.style.padding = '10px 14px';
    pdfPageTest03Btn.style.border = 'none';
    pdfPageTest03Btn.style.borderRadius = '6px';
    pdfPageTest03Btn.style.background = '#14b8a6';
    pdfPageTest03Btn.style.color = '#fff';
    pdfPageTest03Btn.style.cursor = 'pointer';

    // Logout button (acts as Log Out via showTestOverlay)
    const logoutBtn = document.createElement('button');
    logoutBtn.innerText = 'Log Out';
    logoutBtn.style.padding = '10px 14px';
    logoutBtn.style.border = 'none';
    logoutBtn.style.borderRadius = '6px';
    logoutBtn.style.background = '#eb445a';
    logoutBtn.style.color = '#fff';
    logoutBtn.style.cursor = 'pointer';

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
      cleanupOverlay();
    });

    // Delete storage button
    btn2.addEventListener('click', () => {
      this.clearImageStorage();
      cleanupOverlay();
    });

    // Open viewer with a generated sample PDF
    openPdfViewerBtn.addEventListener('click', () => {
      try {
        const doc = new jsPDF();
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(16);
        doc.text('Hello from PdfViewerPage! ✅', 20, 30);
        doc.text('This is a sample PDF generated with jsPDF.', 20, 45);
        // Use data URL (base64) to pass via route
        const dataUri = doc.output('datauristring');
        // Navigate to the viewer with the generated source
        this.router.navigate(['/pdf-viewer-page'], { queryParams: { src: dataUri } });
        cleanupOverlay();
      } catch (e) {
        console.warn('Failed to generate sample PDF', e);
        alert('Failed to generate sample PDF.');
      }
    });

    // Open PDF Preview page with testing interface
    openPdfPreviewBtn.addEventListener('click', () => {
      this.router.navigate(['/pdf-preview-page']);
      cleanupOverlay();
    });

    // Open PDF Generator page with pdf-lib
    openPdfGeneratorBtn.addEventListener('click', () => {
      this.router.navigate(['/pdf-generator-page']);
      cleanupOverlay();
    });

    // PDF Page Test navigation handlers
    pdfPageBtn.addEventListener('click', () => {
      this.router.navigate(['/pdf-page']);
      cleanupOverlay();
    });

    pdfPageTestBtn.addEventListener('click', () => {
      this.router.navigate(['/pdf-page-test']);
      cleanupOverlay();
    });

    pdfPageTest02Btn.addEventListener('click', () => {
      this.router.navigate(['/pdf-page-test02']);
      cleanupOverlay();
    });

    pdfPageTest03Btn.addEventListener('click', () => {
      this.router.navigate(['/pdf-page-test03']);
      cleanupOverlay();
    });

    // Logout flow
    logoutBtn.addEventListener('click', async () => {
      await this.logout(true);
    });

    // Test create session button: create a session populated with stored images and refresh list
    const createSessionBtn = document.createElement('button');
    createSessionBtn.innerText = 'Create Test Session';
    createSessionBtn.style.padding = '10px 14px';
    createSessionBtn.style.border = 'none';
    createSessionBtn.style.borderRadius = '6px';
    createSessionBtn.style.background = '#28a745';
    createSessionBtn.style.color = '#fff';
    createSessionBtn.style.cursor = 'pointer';
    createSessionBtn.addEventListener('click', async () => {
      try {
        if (this.imageStorage && typeof (this.imageStorage as any).createTestSession === 'function') {
          const s = (this.imageStorage as any).createTestSession('Test Session', true, 6);
          // refresh local session view
          try { await this.loadSessions(); } catch (e) {}
          alert('Test session created: ' + s.id);
        } else {
          // Fallback: older ImageStorageService implementations may not provide
          // createTestSession. Use available APIs to create a session from stored
          // images (up to 6) so the UI button still works.
          try {
            let stored: any[] = [];
            if (typeof (this.imageStorage as any).getAllImages === 'function') {
              stored = await (this.imageStorage as any).getAllImages();
            } else if (typeof (this.imageStorage as any).getImages === 'function') {
              stored = (this.imageStorage as any).getImages();
            } else {
              stored = [];
            }
            const keys = Array.isArray(stored) ? stored.slice(0, 6).map((item: any) => item.original) : [];
            const s = (typeof this.imageStorage.createSession === 'function') ? this.imageStorage.createSession('Test Session', keys) : null;
            try { await this.loadSessions(); } catch (e) {}
            alert(s ? ('Test session created: ' + (s as any).id) : 'Test session created (fallback)');
          } catch (e) {
            console.warn('fallback createTestSession failed', e);
            alert('createTestSession not available on ImageStorageService');
          }
        }
      } catch (err) {
        console.warn('createTestSession failed', err);
        alert('Failed to create test session. See console.');
      }
    });

    close.addEventListener('click', () => {
      cleanupOverlay();
    });

    // clicking backdrop closes overlay
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) {
        cleanupOverlay();
      }
    });

    box.appendChild(msg);
    
    // Main buttons container (3 buttons in a column)
    const mainBtnsContainer = document.createElement('div');
    mainBtnsContainer.style.display = 'flex';
    mainBtnsContainer.style.flexDirection = 'column';
    mainBtnsContainer.style.gap = '10px';
    mainBtnsContainer.style.marginBottom = '16px';
    
    // Style buttons to be full width
    btn.style.width = '100%';
    btn2.style.width = '100%';
    createSessionBtn.style.width = '100%';
    openPdfViewerBtn.style.width = '100%';
    openPdfPreviewBtn.style.width = '100%';
    openPdfGeneratorBtn.style.width = '100%';
    pdfPageBtn.style.width = '100%';
    pdfPageTestBtn.style.width = '100%';
    pdfPageTest02Btn.style.width = '100%';
    pdfPageTest03Btn.style.width = '100%';
    
    // mainBtnsContainer.appendChild(btn);
    // mainBtnsContainer.appendChild(btn2);
    // mainBtnsContainer.appendChild(createSessionBtn);
    // mainBtnsContainer.appendChild(openPdfViewerBtn);
    // mainBtnsContainer.appendChild(openPdfPreviewBtn);
    // mainBtnsContainer.appendChild(openPdfGeneratorBtn);
    // mainBtnsContainer.appendChild(pdfPageBtn);
    // mainBtnsContainer.appendChild(pdfPageTestBtn);
    // mainBtnsContainer.appendChild(pdfPageTest02Btn);
    // mainBtnsContainer.appendChild(pdfPageTest03Btn);
    box.appendChild(mainBtnsContainer);
    
    // Bottom row with logout and close buttons
    const bottomRow = document.createElement('div');
    bottomRow.style.display = 'flex';
    bottomRow.style.gap = '10px';
    bottomRow.style.marginTop = '8px';
    bottomRow.style.paddingTop = '12px';
    bottomRow.style.borderTop = '1px solid #ddd';
    
    logoutBtn.style.flex = '1';
    close.style.flex = '1';
    close.style.marginLeft = '0';
    
    bottomRow.appendChild(logoutBtn);
    bottomRow.appendChild(close);
    box.appendChild(bottomRow);
    
    overlay.appendChild(box);

    // local cleanup helper removes overlay element
    const cleanupOverlay = () => {
      this.removeTestOverlay();
    };

    document.body.appendChild(overlay);
    // No local back subscription: page-level handler will close the overlay when present
  }

  /** Register a one-page-only back button that exits the app from home. 
   * and if test-overlay is currently append close the overlay before exit app logic from home */
  private registerBackButtonHandler() {
    try {
      this.removeBackButtonHandler();
      // priority 10: high enough to intercept overlay/back behavior on this page
      this.backButtonSub = this.platform.backButton.subscribeWithPriority(10, () => {
        try {
          const overlay = document.getElementById('test-overlay');
          if (overlay) {
            try { this.removeTestOverlay(); } catch (e) {}
            return;
          }
        } catch (e) {}
        try { App.exitApp(); } catch (e) { console.warn('App.exitApp failed', e); }
      });
    } catch (e) {
      console.warn('[HomePage2] registerBackButtonHandler failed', e);
    }
  }

  /** Remove the test overlay from DOM if present. */
  private removeTestOverlay() {
    try {
      const el = document.getElementById('test-overlay');
      if (el && el.parentElement) el.parentElement.removeChild(el);
    } catch {}
  }

  /** Remove the home-page back handler so other pages can handle back navigation normally, 
   * without exit app logic and behavior */
  private removeBackButtonHandler() {
    try {
      if (this.backButtonSub && typeof this.backButtonSub.remove === 'function') {
        this.backButtonSub.remove();
      } else if (this.backButtonSub && typeof this.backButtonSub.unsubscribe === 'function') {
        this.backButtonSub.unsubscribe();
      }
    } catch {}
    this.backButtonSub = null;
  }


  ngOnDestroy(): void {
    this.removeBackButtonHandler();
  }
  
  openMenu(menuId: string) {
    this.isSidebarOpen = !this.isSidebarOpen;
  }

  closeSidebar() {
    this.isSidebarOpen = false;
  }
}
