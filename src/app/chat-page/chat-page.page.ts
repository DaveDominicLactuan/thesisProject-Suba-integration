import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { NavController, Platform } from '@ionic/angular';
import { User } from 'firebase/auth';
import { Auth3Service } from '../services/auth3.service';
import { Firestore, collection, query, where, getDocs } from '@angular/fire/firestore';
import { ImageStorageService } from '../services/image-storage.service';
import { App } from '@capacitor/app';
@Component({
  selector: 'app-chat-page',
  templateUrl: './chat-page.page.html',
  styleUrls: ['./chat-page.page.scss'],
  standalone: false
})

export class ChatPagePage implements OnInit, OnDestroy {
  private static userSyncTasks: Map<string, Promise<void>> = new Map();
  userName: string | null = null;
  firstName: string | null = null;
  lastName: string | null = null;
  email: string | null = null;
  engineeringID: string | null = null;
  userID: string | null = null;
  sessions: any[] = [];
  lastSessionDisplayName: string | null = null;
  private backButtonSub: any; // hardware back handler
  isLoggedIn: boolean = false;
  userRole: string | null = null;
  isSidebarOpen: boolean = false;
  syncStatusText: string = 'Not synced';
  syncStatusState: 'idle' | 'syncing' | 'completed' | 'error' = 'idle';
  // UI: toggles between preview list and active chat conversation
  isChatOpen: boolean = false;
  activeChat: any = null;
  isSearching = false;
  searchQuery = '';

  // Placeholder search conversation results (simulate as in pasted image)
  searchConversationResults = [
    {
      id: 'u1',
      name: 'Alison Gilchrist',
      lastMessage: '@andrewJ do you like this imgur picture?',
      time: '2:14 PM',
      avatar: null,
      initials: 'AG',
      isOnline: true
    },
    {
      id: 'u2',
      name: 'Ben Holt',
      lastMessage: 'File: Imgur_proposal.pdf',
      time: 'Yesterday',
      avatar: null,
      initials: 'BH',
      isOnline: false
    },
    {
      id: 'u3',
      name: 'Imgur memes',
      lastMessage: 'https://imgur.com/t/funny/ncI25Tb',
      time: '12/22/20',
      avatar: null,
      initials: 'IM',
      isOnline: false
    }
  ];

  // Old mock search results (for other search views)
  mockSearchResults = [
    { id: 'u1', name: 'Demola Andreas', subtitle: 'Online', avatar: 'assets/engIcon.png' },
    { id: 'u2', name: 'Fitted – Tech & Design', subtitle: 'Group chat', avatar: null, initials: 'FTD' },
    { id: 'u3', name: 'Thecla', subtitle: 'Last seen today', avatar: 'assets/engIcon.png' }
  ];

  // dynamic list of users with role 'engineer' from Firestore
  engineers: any[] = [];

  // chat list rendered in the UI (initially seeded with same two sample chats)
  chats: any[] = [
    { id: 'ftd', name: 'Fitted - Tech & Design', avatar: 'assets/engIcon.png', lastMessage: 'Thecla: @Ovo How is it going?', time: '11:11 am', unread: true },
    { id: 'demola', name: 'Demola Andreas', avatar: 'assets/engIcon.png', lastMessage: 'Job Description.docx', time: 'Yesterday', badge: 1 }
  ];

  /** Inject auth, router, and image storage services for navigation and data. */
  constructor(private formBuilder: FormBuilder, private router: Router, private authService: AuthService, private navCtrl: NavController, private auth3: Auth3Service, private imageStorage: ImageStorageService, private platform: Platform, private firestore: Firestore) {

  }

ngOnInit(): void {
  console.log('[HomePage2.ngOnInit] ===== PAGE INIT START (ngOnInit called) =====');
  console.log('[HomePage2.ngOnInit] Auth currentUser on ngOnInit:', this.auth3.getCurrentUser()?.uid || 'null');
  
  //initializes the data needed for the page such as user data, profile and session
  this.initialize();
}

/** Perform async initialization tasks (profile + sessions). */
private async initialize(): Promise<void> {
  
}


  // Additional methods can be added here

  /** Navigate to legacy camera page route. */
  goToHomePage() {
    this.router.navigate(['/home-page2']);
    console.log('camera page');
  }


  onSearchFocus() {
    if (!this.isChatOpen) {
      this.isSearching = true;
      // fetch engineers from Firestore when entering search mode
      this.fetchEngineers().catch(err => console.error('fetchEngineers failed', err));
    }
  }

  onSearchInput(ev: any) {
    this.searchQuery = ev.target.value;
    this.isSearching = this.searchQuery.length > 0;
    // Optionally filter searchConversationResults here if you want dynamic filtering
    // For now, keep static placeholder results as in the pasted image
  }

  clearSearch() {
    this.searchQuery = '';
    this.isSearching = false;
  }

  closeSearch() {
    this.isSearching = false;
    // Optionally clear searchQuery as well:
    // this.searchQuery = '';
  }

  /** Query Firestore for users where role == 'engineer' and populate `engineers` */
  async fetchEngineers(): Promise<void> {
    try {
      const usersCol = collection(this.firestore, 'users');
      const q = query(usersCol, where('role', '==', 'engineer'));
      const snap = await getDocs(q);
      const arr: any[] = [];
      snap.forEach(doc => {
        const data = { id: (doc as any).id, ...(doc.data() as any) };
        arr.push(data);
      });
      this.engineers = arr;
      console.log('[ChatPage] Engineers fetched from Firestore:', this.engineers);
    } catch (err) {
      console.error('[ChatPage] Error fetching engineers:', err);
      this.engineers = [];
    }
  }

  /** Handle selecting an engineer from search results: log and add to chat list */
  selectEngineer(user: any) {
    console.log('[ChatPage] Engineer selected:', user);
    // ensure we don't duplicate in chats list
    const exists = this.chats.find(c => c.id === user.id || c.name === user.name);
    if (!exists) {
      this.chats.unshift({ id: user.id, name: user.firstName ? `${user.firstName} ${user.lastName}` : user.name || user.email, avatar: user.photoURL || null, lastMessage: '', time: '', addedFromSearch: true });
    }
    // open conversation view for selected user
    this.openChat({ id: user.id, name: user.firstName ? `${user.firstName} ${user.lastName}` : user.name || user.email, avatar: user.photoURL || null });
    // also log current chats for debugging
    console.log('[ChatPage] Current chats:', this.chats);
  }
  
  /** Return initials for a display name to use in avatar fallback. */
  getInitials(name?: string | null): string {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/).filter(p => p.length > 0);
    const initials = parts.slice(0, 2).map(p => p[0].toUpperCase()).join('');
    return initials || 'U';
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

  goNetworkPage() {
    this.router.navigate(['/network-page2']);
    console.log('network page 2');
  }

  /** Navigate to profile page. */
  goToProfilePage() {
    this.router.navigate(['/profile-page']);
    console.log('Navigating to profile page');
  }

  /** Shared logout flow used by overlay button and menu item. */
  async logout(closeOverlay: boolean = false) {
    const currentUid = this.userID || this.auth3.getCurrentUser()?.uid || '';
    if (currentUid) this.clearSyncStateForUser(currentUid);
    this.syncStatusState = 'idle';
    this.syncStatusText = 'Not synced';
    try {
      await this.auth3.logout();
    } catch {}
    try { localStorage.setItem('isLoggedIn', 'false'); } catch {}
    try { localStorage.removeItem('userData'); } catch {}
    this.isLoggedIn = false;
    if (closeOverlay) {
    }
    // Navigate to landing page replacing history so next back exits
    try {
      this.router.navigateByUrl('/landing-page', { replaceUrl: true });
    } catch {
      this.router.navigate(['/landing-page']);
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



  
  openMenu(menuId: string) {
    this.isSidebarOpen = !this.isSidebarOpen;
  }

    private clearSyncStateForUser(userId: string): void {
    if (!userId) return;
    try { localStorage.removeItem(this.getSyncStatusStorageKey(userId)); } catch {}
    try { sessionStorage.removeItem(this.getSyncBootstrapDoneKey(userId)); } catch {}
  }

  private getSyncStatusStorageKey(userId: string): string {
    return `user_sync_status_${userId}`;
  }

  private getSyncBootstrapDoneKey(userId: string): string {
    return `user_sync_bootstrap_done_${userId}`;
  }

  private hasBootstrapSyncCompleted(userId: string): boolean {
    if (!userId) return false;
    try {
      return sessionStorage.getItem(this.getSyncBootstrapDoneKey(userId)) === 'true';
    } catch {
      return false;
    }
  }


  closeSidebar() {
    this.isSidebarOpen = false;
  }

  /** Open the conversation view for a selected chat */
  openChat(chat: any) {
    this.activeChat = chat || { name: 'Chat' };
    this.isChatOpen = true;
    // optional: lock page scroll or add class
    try { document.body.classList.add('chat-open'); } catch {}
  }

  /** Close the conversation view and return to the chat list preview */
  closeChat() {
    this.isChatOpen = false;
    this.activeChat = null;
    try { document.body.classList.remove('chat-open'); } catch {}
  }

  openNewChat() {
    this.router.navigate(['/camera-page2']);
  }

  ngOnDestroy(): void {
    
  }
}

