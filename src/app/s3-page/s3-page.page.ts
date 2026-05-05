import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Auth3Service } from '../services/auth3.service';
import { ImageStorageService } from '../services/image-storage.service';



@Component({
  selector: 'app-s3-page',
  templateUrl: './s3-page.page.html',
  styleUrls: ['./s3-page.page.scss'],
  standalone: false
})
export class S3PagePage implements OnInit {
   isSidebarOpen: boolean = false;
   userName: string | null = null;
  firstName: string | null = null;
  lastName: string | null = null;
  email: string | null = null;
  userID: string | null = null; // Firebase UID - used to filter sessions by user
  syncStatusText: string = 'Not synced';
  syncStatusState: 'idle' | 'syncing' | 'completed' | 'error' = 'idle';
  isLoggedIn: boolean = false;
  fullScreenImageUrl: string | null = null;
  fullScreenImageKey: string | null = null; // Track the key!
  currentImageMetadata: any = null;
   showCopyDialog = false;
   showDeleteConfirm: boolean = false;

  // S3 search state
  searchKey: string = '';
  isSearching: boolean = false;
  fetchedImageData: any = null;

  constructor(private router: Router, private auth3: Auth3Service, private imageStorage: ImageStorageService) { }

  ngOnInit() {
    console.log("Hello")
  }

  // /** Search for specific S3 key and show modal with metadata */
  // async searchImage() {
  //   const key = (this.searchKey || '').trim();
  //   if (!key) return;

  //   this.isSearching = true;
  //   try {
  //     if (this.imageStorage && typeof (this.imageStorage as any).fetchSpecificImage === 'function') {
  //       this.fetchedImageData = await (this.imageStorage as any).fetchSpecificImage(key);
  //     } else if (this.imageStorage && typeof (this.imageStorage as any).getSignedUrl === 'function') {
  //       const url = await (this.imageStorage as any).getSignedUrl(key);
  //       this.fetchedImageData = { url, details: { key } };
  //     } else {
  //       // Fallback: construct public S3 URL (best-effort)
  //       const bucketBaseUrl = 'https://my-angular-test-bucket-12345.s3.ap-southeast-2.amazonaws.com/';
  //       this.fetchedImageData = { url: `${bucketBaseUrl}${key}`, details: { key } };
  //     }
  //   } catch (error) {
  //     console.error('[S3Page] searchImage failed', error);
  //     alert('Image not found. Please check the key and try again.');
  //     this.fetchedImageData = null;
  //   } finally {
  //     this.isSearching = false;
  //   }
  // }

  //  async searchImage() {
  //     const key = this.searchKey.trim();
  //     if (!key) return;
  
  //     this.isSearching = true;
  //     try {
  //       this.fetchedImageData = await this.imageStorage.fetchSpecificImage(key);
  //       console.log('✅ UI: Fetched image metadata:', this.fetchedImageData.details);
  //     } catch (error) {
  //       alert("Image not found. Please check the Key and try again.");
  //     } finally {
  //       this.isSearching = false;
  //     }
  //   }

  async searchImage() {
  const cleanKey = this.searchKey.trim(); // Remove accidental spaces at start/end
  
  // Use encodeURIComponent if you are building the URL manually, 
  // but if using the AWS SDK, just ensure the string is trimmed.
  try {
    this.isSearching = true;
    console.log(`📱 Mobile Search: Fetching ${cleanKey}`);
    
    // Call your existing search logic
    await this.fetchS3Object(cleanKey); 
    
  } catch (error) {
    console.error("Search failed on mobile", error);
  } finally {
    this.isSearching = false;
  }
}

// async fetchS3Object(key: string) {
//   // 1. CRITICAL FOR MOBILE: Remove leading/trailing spaces and keep original case
//   // Android keyboards often add a trailing space after pasting or typing.
//   const sanitizedKey = key ? key.trim() : '';

//   if (!sanitizedKey) {
//     console.warn("⚠️ UI: Search attempted with an empty key.");
//     return;
//   }

//   console.log(`🔍 UI [SEARCH]: Initiating fetch for: "${sanitizedKey}"`);
//   this.isSearching = true;

//   try {
//     // 2. Verify existence via the S3 Service (HeadObjectCommand)
//     // This prevents the UI from trying to load a broken image URL.
//     const exists = await this.imageStorage.checkIfFileExists(sanitizedKey);

//     if (exists) {
//       console.log("✅ UI: Image verified. Constructing viewer state...");

//       // 3. Define your bucket's base URL (must match your S3 region)
//       const bucketBaseUrl = 'https://my-angular-test-bucket-12345.s3.ap-southeast-2.amazonaws.com/';
//       const imageUrl = `${bucketBaseUrl}${sanitizedKey}`;

//       // 4. Update the View State (The same logic used in openImage)
//       this.fullScreenImageKey = sanitizedKey;
//       this.fullScreenImageUrl = imageUrl;
      
//       this.currentImageMetadata = {
//         originalS3Key: sanitizedKey,
//         storagePath: sanitizedKey,
//         originalS3Url: imageUrl,
//         storageUrl: imageUrl
//       };

//       // 5. Fetch deeper metadata for the info-panel logs
//       const extracted = this.extractImageData();

//       // Ensure the modal shows by populating `fetchedImageData` used by the template *ngIf
//       this.fetchedImageData = {
//         url: imageUrl,
//         details: extracted || { key: sanitizedKey }
//       };

//     } else {
//       // 6. Handle "Not Found" case
//       console.error(`❌ UI: S3 Key "${sanitizedKey}" not found.`);
//       alert(`Image not found: "${sanitizedKey}". \n\nNote: S3 keys are case-sensitive. Please ensure there are no accidental capital letters or spaces.`);
//     }

//   } catch (error: any) {
//     // 7. Handle Network or Permission (CORS) errors
//     console.error("❌ UI: Fetch operation failed", error);
    
//     if (error.name === 'AccessDenied' || error.status === 403) {
//       alert("Access Denied: Please check your S3 CORS settings for mobile origins (capacitor://localhost).");
//     } else {
//       alert("A network error occurred while searching S3. Check your internet connection.");
//     }
//   } finally {
//     this.isSearching = false;
//     console.log("🛑 UI: Search sequence complete.");
//   }
// }

// async fetchS3Object(key: string) {
//   const sanitizedKey = key ? key.trim() : '';

//   if (!sanitizedKey) return;

//   // 1. RESET ALL FLAGS to ensure the backdrop can show
//   this.showCopyDialog = false;
//   this.showDeleteConfirm = false;
//   this.fullScreenImageKey = null; // Clear previous to trigger refresh
  
//   this.isSearching = true;

//   try {
//     const exists = await this.imageStorage.checkIfFileExists(sanitizedKey);

//     if (exists) {
//       const bucketBaseUrl = 'https://my-angular-test-bucket-12345.s3.ap-southeast-2.amazonaws.com/';
//       const imageUrl = `${bucketBaseUrl}${sanitizedKey}`;

//       // 2. SET THE VIEWER STATE
//       // These three lines are what trigger the <div class="modal-backdrop"> in the HTML
//       this.fullScreenImageKey = sanitizedKey;
//       this.fullScreenImageUrl = imageUrl;
      
//       this.currentImageMetadata = {
//         originalS3Key: sanitizedKey,
//         storagePath: sanitizedKey,
//         originalS3Url: imageUrl,
//         storageUrl: imageUrl
//       };

//       console.log('✅ UI: Search successful, opening viewer for:', sanitizedKey);
      
//       // Fetch deeper metadata
//       await this.extractImageData();

//     } else {
//       console.error(`❌ UI: S3 Key "${sanitizedKey}" not found.`);
//       alert(`Image not found: "${sanitizedKey}"`);
//     }
//   } catch (error) {
//     console.error("❌ UI: Search operation failed", error);
//     alert("Error accessing S3. Please check your connection.");
//   } finally {
//     this.isSearching = false;
//   }
// }

// async fetchS3Object(key: string) {
//   const sanitizedKey = key ? key.trim() : '';
//   if (!sanitizedKey) return;

//   try {
//     // Get the metadata from S3 first to fill your 'details' section
//     const s3Data = await this.imageStorage.getMetadata(sanitizedKey); 

//     if (s3Data) {
//       const bucketBaseUrl = 'https://my-angular-test-bucket-12345.s3.ap-southeast-2.amazonaws.com/';
      
//       // THIS MUST MATCH YOUR HTML OBJECT STRUCTURE
//       this.fetchedImageData = {
//         url: `${bucketBaseUrl}${sanitizedKey}`,
//         details: {
//           key: sanitizedKey,
//           contentType: s3Data.ContentType,
//           sizeBytes: s3Data.ContentLength, // S3 calls this ContentLength
//           lastModified: s3Data.LastModified
//         }
//       };

//       console.log('✅ UI: Fetched data assigned to fetchedImageData', this.fetchedImageData);
//     }
//   } catch (error) {
//     console.error("❌ UI: Search failed", error);
//     this.fetchedImageData = null; // Ensure modal stays closed on error
//   }
// }

async fetchS3Object(key: string) {
  const sanitizedKey = key ? key.trim() : '';
  
  if (!sanitizedKey) {
    console.warn("⚠️ UI: Search attempted with an empty key.");
    return;
  }

  // 1. Reset UI flags to ensure a clean state before starting the fetch
  this.isSearching = true;
  this.fetchedImageData = null; 
  this.showCopyDialog = false;
  this.showDeleteConfirm = false;

  try {
    console.log(`🔍 UI [SEARCH]: Initiating fetch for: "${sanitizedKey}"`);

    // 2. Fetch metadata from S3
    const s3Data = await this.imageStorage.getMetadata(sanitizedKey); 

    if (s3Data) {
      const bucketBaseUrl = 'https://my-angular-test-bucket-12345.s3.ap-southeast-2.amazonaws.com/';
      
      /**
       * 3. CACHE-BUSTER LOGIC: 
       * We append a unique timestamp (?t=...) to the URL. 
       * This forces S3 to evaluate the CORS headers fresh instead of using a cached 'Blocked' result.
       */
      const cacheBuster = `?t=${new Date().getTime()}`;
      const imageUrl = `${bucketBaseUrl}${sanitizedKey}${cacheBuster}`;

      // 4. Populate the object for your HTML Modal
      this.fetchedImageData = {
        url: imageUrl,
        details: {
          key: sanitizedKey,
          contentType: s3Data.ContentType,
          sizeBytes: s3Data.ContentLength,
          lastModified: s3Data.LastModified
        }
      };

      console.log('✅ UI: Search successful. Data assigned:', this.fetchedImageData);
    }
  } catch (error: any) {
    console.error("❌ UI: Search failed", error);
    
    // Clear the data so the modal doesn't open with broken info
    this.fetchedImageData = null;

    // Provide specific feedback for CORS/Network errors
    if (error.name === 'TypeError' || error.message.includes('fetch')) {
      alert("CORS or Network Error: Please ensure S3 CORS allows 'http://localhost:8100' and 'Block Public Access' is OFF.");
    } else {
      alert(`Image not found: "${sanitizedKey}"`);
    }
  } finally {
    this.isSearching = false;
  }
}

// NEW METHOD: Get specific S3 metadata for the selected image
  extractImageData() {
    if (!this.fullScreenImageKey) {
      console.warn('⚠️ UI: No image currently selected.');
      return;
    }

    // Build the clean URL without AWS Pre-signed query parameters
    const bucketBaseUrl = 'https://my-angular-test-bucket-12345.s3.ap-southeast-2.amazonaws.com/';
    const cleanUrl = `${bucketBaseUrl}${this.fullScreenImageKey}`;

    // Map the values to your requested structure
    const extractedData = {
      originalS3Key: this.fullScreenImageKey,
      originalS3Url: cleanUrl,
      storagePath: this.fullScreenImageKey,
      storageUrl: cleanUrl
    };

    // Log it to the console so you can inspect it or pass it to Firestore
    console.log('✅ Extracted Image Data:', extractedData);
    
    // Optional: Alert the user to see it working on screen
    // alert(JSON.stringify(extractedData, null, 2));
    
    return extractedData; // Return it in case another function needs it
  }

  closeSearchModal() {
  this.fetchedImageData = null;
  this.searchKey = ''; // Optional: clear the search bar too
}

   closeSidebar() {
    this.isSidebarOpen = false;
  }

  openMenu(menuId: string) {
    this.isSidebarOpen = !this.isSidebarOpen;
  }

   /** Shared logout flow used by overlay button and menu item. */
  async logout(closeOverlay: boolean = false) {
    console.log('[SessionPage.logout] Logout initiated');
    
    // Close sidebar immediately to provide user feedback
    this.isSidebarOpen = false;
    
    // Get current user ID before we start clearing
    const currentUserId = this.userID || this.auth3.getCurrentUser()?.uid || '';
    
    // Clear all user-related data
    try {
      await this.clearAllUserData(currentUserId);
    } catch (error) {
      console.error('[SessionPage.logout] Error during data cleanup:', error);
    }

    // Clear sync state for user
    if (currentUserId) {
      this.clearSyncStateForUser(currentUserId);
    }
    
    this.syncStatusState = 'idle';
    this.syncStatusText = 'Not synced';
    
    try {
      await this.auth3.logout();
    } catch {}
    
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

    /** Navigate to sessions list page. */
  gochatPage() {
    // this.removeBackButtonHandler();
    this.router.navigate(['/chat-page']);
    console.log('chat page');
  }

   /** Navigate to chat page and open the 'people' tab. */
  gochatPagePeople() {
    // this.removeBackButtonHandler();
    this.router.navigate(['/chat-page'], { state: { activeTab: 'people' } });
    console.log('chat page (people)');
  }

  /** Navigate to chat page and open the 'location' tab. */
  gochatPageLocation() {
    // this.removeBackButtonHandler();
    this.router.navigate(['/chat-page'], { state: { activeTab: 'location' } });
    console.log('chat page (location)');
  }

   /** Navigate to chat page and open the 'location' tab. */
  goMarkerPage() {
    // this.removeBackButtonHandler();
    this.router.navigate(['/office-map-marker-page']);
    console.log('chat page (location)');
  }

    /** Navigate to enhanced camera page with sessions support. */
  goToHomePage() {
    this.router.navigate(['/home-page2']);
    console.log('camera page');
  }

  /** Navigate to profile page. */
  goToProfilePage() {
    this.router.navigate(['/profile-page']);
    console.log('Navigating to profile page');
  }

   private async clearAllUserData(userId: string): Promise<void> {
    console.log('[SessionPage.clearAllUserData] Beginning complete user data cleanup', { userId });

    // Clear localStorage keys
    const localStorageKeys = [
      'isLoggedIn',
      'userData',
      'userProfile',
      'currentSessionId',
      'currentUserId'
    ];

    for (const key of localStorageKeys) {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        console.warn(`[SessionPage.clearAllUserData] Failed to remove localStorage key: ${key}`, e);
      }
    }

    // Clear sessionStorage keys
    const sessionStorageKeys = [
      'userProfile',
      'isLoggedInSession'
    ];

    for (const key of sessionStorageKeys) {
      try {
        sessionStorage.removeItem(key);
      } catch (e) {
        console.warn(`[SessionPage.clearAllUserData] Failed to remove sessionStorage key: ${key}`, e);
      }
    }

    // Clear user-specific storage keys (dynamic keys based on userId)
    if (userId) {
      const userSpecificKeys = [
        `user_sync_status_${userId}`,
        `user_sync_bootstrap_done_${userId}`
      ];

      for (const key of userSpecificKeys) {
        try {
          localStorage.removeItem(key);
          sessionStorage.removeItem(key);
        } catch (e) {
          console.warn(`[SessionPage.clearAllUserData] Failed to remove user-specific key: ${key}`, e);
        }
      }
    }

    // Clear sessions and images from ImageStorageService
    try {
      if (this.imageStorage && typeof this.imageStorage.clear === 'function') {
        await this.imageStorage.clear();
        console.log('[SessionPage.clearAllUserData] Cleared all images from storage');
      }
    } catch (e) {
      console.warn('[SessionPage.clearAllUserData] Failed to clear images', e);
    }

    // Clear sessions from Ionic Storage
    try {
      if ((this.imageStorage as any)._storage) {
        await (this.imageStorage as any)._storage?.remove('stored_image_sessions');
        console.log('[SessionPage.clearAllUserData] Cleared all sessions from storage');
      }
    } catch (e) {
      console.warn('[SessionPage.clearAllUserData] Failed to clear sessions', e);
    }

    console.log('[SessionPage.clearAllUserData] Complete user data cleanup finished');
  }

   private clearSyncStateForUser(userId: string): void {
    if (!userId) return;
    try { localStorage.removeItem(this.getSyncStatusStorageKey(userId)); } catch {}
    try { sessionStorage.removeItem(this.getSyncBootstrapDoneKey(userId)); } catch {}
  }

   /** Remove the test overlay from DOM if present. */
  private removeTestOverlay() {
    try {
      const el = document.getElementById('test-overlay');
      if (el && el.parentElement) el.parentElement.removeChild(el);
    } catch {}
  }

  private getSyncStatusStorageKey(userId: string): string {
    return `user_sync_status_${userId}`;
  }

  private getSyncBootstrapDoneKey(userId: string): string {
    return `user_sync_bootstrap_done_${userId}`;
  }



}
