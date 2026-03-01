import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { NavController, Platform } from '@ionic/angular';
import { User } from 'firebase/auth';
import { Auth3Service } from '../services/auth3.service';
import { Firestore, collection, query, where, getDocs } from '@angular/fire/firestore';
import { ImageStorageService } from '../services/image-storage.service';
import { ChatService, Message } from '../services/chat.service';
import { PresenceService } from '../services/presence.service';
import { Subscription } from 'rxjs';
import { App } from '@capacitor/app';
import { Geolocation } from '@capacitor/geolocation';
// Leaflet map library
import * as L from 'leaflet';
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
  // current chat id and messages
  currentChatId: string | null = null;
  messages: Message[] = [];
  messageText: string = '';
  private messagesSub?: Subscription;
  isSearching = false;
  searchQuery = '';
  // active bottom navigation tab: 'person' | 'people' | 'location' | 'settings'
  activeTab: 'person' | 'people' | 'location' | 'settings' = 'people';
  private map?: L.Map | null = null;
  private userLocationMarker?: L.Marker;

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
  constructor(private formBuilder: FormBuilder, private router: Router, private authService: AuthService, private navCtrl: NavController, public auth3: Auth3Service, private imageStorage: ImageStorageService, private platform: Platform, private firestore: Firestore, private chatService: ChatService, private presenceService: PresenceService) {

  }

ngOnInit(): void {
  console.log('[HomePage2.ngOnInit] ===== PAGE INIT START (ngOnInit called) =====');
  console.log('[HomePage2.ngOnInit] Auth currentUser on ngOnInit:', this.auth3.getCurrentUser()?.uid || 'null');
  
  //initializes the data needed for the page such as user data, profile and session
  this.initialize();
}

/** Perform async initialization tasks (profile + sessions). */
private async initialize(): Promise<void> {
  try {
    // Load profile (if available) and ensure userID
    const profile = await this.auth3.getUserProfile().catch(() => null);
    this.firstName = profile?.firstName || this.firstName;
    this.lastName = profile?.lastName || this.lastName;
    this.email = profile?.email || this.email;
    this.userID = this.auth3.getCurrentUser()?.uid || this.userID || (profile && (profile.userID || profile.uid));

    // Start presence service (RTDB -> Firestore sync)
    try { this.presenceService.start(); } catch (e) { console.warn('PresenceService.start failed', e); }
  } catch (err) {
    console.warn('[ChatPage] initialize error', err);
  }
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

  /** Handle selecting an engineer from search results: create chat and subscribe messages */
  async selectEngineer(user: any) {
    console.log('[ChatPage] Engineer selected:', user);
    const currentUid = this.auth3.getCurrentUser()?.uid || this.userID || '';
    if (!currentUid) {
      console.warn('[ChatPage] No current user; cannot create chat');
      return;
    }

    // ensure we don't duplicate in chats list (UI list)
    const exists = this.chats.find(c => c.id === user.id || c.name === user.name);
    if (!exists) {
      this.chats.unshift({ id: user.id, name: user.firstName ? `${user.firstName} ${user.lastName}` : user.name || user.email, avatar: user.photoURL || null, lastMessage: '', time: '', addedFromSearch: true });
    }

    // ensure chat document exists and get deterministic chatId
    const chat = await this.chatService.createOrEnsureChat(currentUid, user.id);
    this.currentChatId = chat.chatId;

    // open conversation view
    this.activeChat = { id: user.id, name: user.firstName ? `${user.firstName} ${user.lastName}` : user.name || user.email, avatar: user.photoURL || null, chatId: chat.chatId };
    this.isChatOpen = true;

    // unsubscribe previous
    try { this.messagesSub?.unsubscribe(); } catch {}

    // subscribe to messages and mark unread incoming messages as read
    this.messagesSub = this.chatService.getMessages(chat.chatId).subscribe(async (msgs) => {
      this.messages = msgs || [];
      const unread = this.messages.filter(m => !m.isRead && m.senderId !== currentUid && m.id);
      for (const m of unread) {
        try { await this.chatService.markMessageAsRead(chat.chatId, m.id!); } catch (e) { console.warn('markMessageAsRead failed', e); }
      }
    });

    console.log('[ChatPage] Opened chat', chat.chatId);
  }

  /** Send a message in the current chat */
  async sendMessage() {
    if (!this.currentChatId) return;
    const senderId = this.auth3.getCurrentUser()?.uid || this.userID || '';
    if (!senderId) return;
    const text = (this.messageText || '').trim();
    if (!text) return;
    try {
      await this.chatService.sendMessage(this.currentChatId, { senderId, text });
      this.messageText = '';
    } catch (e) {
      console.error('sendMessage failed', e);
    }
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

  /** Switch bottom navigation tab and update view state. */
  setNav(tab: 'person' | 'people' | 'location' | 'settings') {
    this.activeTab = tab;
    // ensure the main chat preview is shown when selecting person or people
    if (tab === 'person' || tab === 'people') {
      this.isChatOpen = false;
      this.isSearching = false;
    }
    // selecting location will show the Map view (ensure no chat overlay is open)
    if (tab === 'location') {
      this.isChatOpen = false;
      this.isSearching = false;
      // initialize map once DOM has updated
      setTimeout(() => { void this.initMap(); }, 50);
    }
  }

  private async getCurrentCoordinates(): Promise<{ latitude: number; longitude: number } | null> {
    try {
      const permission = await Geolocation.checkPermissions();
      if (permission.location !== 'granted') {
        await Geolocation.requestPermissions();
      }

      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000
      });

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };
    } catch (capacitorError) {
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve(pos),
            (err) => reject(err),
            { enableHighAccuracy: true, timeout: 15000 }
          );
        });

        return {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };
      } catch (browserError) {
        console.warn('Unable to get current coordinates', capacitorError, browserError);
        return null;
      }
    }
  }

  /** Initialize Leaflet map in the `map` element. Safe to call multiple times. */
  private async initMap(): Promise<void> {
    try {
      const coordinates = await this.getCurrentCoordinates();
      const center: [number, number] = coordinates
        ? [coordinates.latitude, coordinates.longitude]
        : [51.505, -0.09];

      if (this.map) {
        // already initialized: invalidate size in case container changed
        this.map.invalidateSize();
        this.map.setView(center, 15);
        await this.markUserLocation(this.map, coordinates);
        return;
      }

      const mapEl = document.getElementById('map');
      if (!mapEl) return;

      this.map = L.map(mapEl).setView(center, coordinates ? 15 : 13);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(this.map);

      await this.markUserLocation(this.map, coordinates);
    } catch (err) {
      console.warn('initMap failed', err);
    }
  }

  async markUserLocation(map: L.Map, coordinates?: { latitude: number; longitude: number } | null) {
      try {
        const resolvedCoordinates = coordinates ?? await this.getCurrentCoordinates();
        if (!resolvedCoordinates) return;

        const { latitude, longitude } = resolvedCoordinates;

        if (this.userLocationMarker) {
          this.userLocationMarker.setLatLng([latitude, longitude]);
        } else {
          this.userLocationMarker = L.marker([latitude, longitude])
            .addTo(map)
            .bindPopup('You are here!')
            .openPopup();
        }

        map.setView([latitude, longitude], 15);
      } catch (error) {
        console.error('Failed to mark user location:', error);
      }
    }

  ngOnDestroy(): void {
    try { this.messagesSub?.unsubscribe(); } catch {}
    this.messagesSub = undefined;
    // optional: set offline on destroy if desired
  }
}

