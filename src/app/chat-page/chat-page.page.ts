import { Component, OnInit, OnDestroy, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { NavController, Platform } from '@ionic/angular';
import { User } from 'firebase/auth';
import { Auth3Service } from '../services/auth3.service';
import { Firestore, collection, doc, getDoc, query, where, getDocs, setDoc } from '@angular/fire/firestore';
import { ImageStorageService } from '../services/image-storage.service';
import { Chat, ChatService, Message, TypingState } from '../services/chat.service';
import { PresenceService } from '../services/presence.service';
import { UserPrefetchCacheService } from '../services/user-prefetch-cache.service';
import { OfflineLeafletTileLayer } from '../services/offline-leaflet-tile-layer';
import { OfflineMapAreaMetadata, OfflineMapTileService } from '../services/offline-map-tile.service';
import { Subscription } from 'rxjs';
import { App } from '@capacitor/app';
import { Geolocation } from '@capacitor/geolocation';
// Leaflet map library
import * as L from 'leaflet';

interface OfficeLocationMarkerData {
  id: string;
  latitude: number;
  longitude: number;
  payload: Record<string, unknown>;
}

interface RadiusOption {
  label: string;
  value: number;
}

interface RadiusSquareBounds {
  center: { latitude: number; longitude: number };
  top: { latitude: number; longitude: number };
  bottom: { latitude: number; longitude: number };
  left: { latitude: number; longitude: number };
  right: { latitude: number; longitude: number };
  southWest: { latitude: number; longitude: number };
  northEast: { latitude: number; longitude: number };
}

@Component({
  selector: 'app-chat-page',
  templateUrl: './chat-page.page.html',
  styleUrls: ['./chat-page.page.scss'],
  standalone: false
})

export class ChatPagePage implements OnInit, OnDestroy {
  // --- Chat Options Overlay State ---
  showChatOptionsOverlay = false;
  chatOptionsOverlayY = 0;
  private chatOptionsLongPressTimer: any = null;
  private chatOptionsDragStartY: number | null = null;
  private chatOptionsDragCurrentY: number | null = null;
  private chatOptionsDragActive = false;
  private chatOptionsMinDragToClose = 80;
  private chatOptionsSelectedChat: any = null;
  receiverUserId: string | any;
  newRecepientUserId: string | any;
  sessionImageObjectCounter: number = 0;
    // Long-press logic for chat-item
    onChatItemPressStart(event: MouseEvent | TouchEvent, chat: any) {
      if (this.chatOptionsLongPressTimer) clearTimeout(this.chatOptionsLongPressTimer);
      this.chatOptionsLongPressTimer = setTimeout(() => {
        this.chatOptionsSelectedChat = chat;
        this.showChatOptionsOverlay = true;
        this.chatOptionsOverlayY = 0;
      }, 420); // 420ms for long-press
    }

    onChatItemPressEnd(event: MouseEvent | TouchEvent) {
      if (this.chatOptionsLongPressTimer) {
        clearTimeout(this.chatOptionsLongPressTimer);
        this.chatOptionsLongPressTimer = null;
      }
    }

    // Overlay drag-to-close logic
    onOverlayDragStart(event: MouseEvent | TouchEvent) {
      event.stopPropagation();
      this.chatOptionsDragActive = true;
      this.chatOptionsDragStartY = this.getEventY(event);
      this.chatOptionsDragCurrentY = 0;
      document.addEventListener('mousemove', this.onOverlayDragMove);
      document.addEventListener('touchmove', this.onOverlayDragMove, { passive: false });
      document.addEventListener('mouseup', this.onOverlayDragEnd);
      document.addEventListener('touchend', this.onOverlayDragEnd);
    }

    onOverlayDragMove = (event: MouseEvent | TouchEvent) => {
      if (!this.chatOptionsDragActive || this.chatOptionsDragStartY === null) return;
      const y = this.getEventY(event);
      const deltaY = y - this.chatOptionsDragStartY;
      this.chatOptionsDragCurrentY = deltaY > 0 ? deltaY : 0;
      this.chatOptionsOverlayY = this.chatOptionsDragCurrentY;
    };

    onOverlayDragEnd = (event: MouseEvent | TouchEvent) => {
      if (!this.chatOptionsDragActive) return;
      this.chatOptionsDragActive = false;
      document.removeEventListener('mousemove', this.onOverlayDragMove);
      document.removeEventListener('touchmove', this.onOverlayDragMove);
      document.removeEventListener('mouseup', this.onOverlayDragEnd);
      document.removeEventListener('touchend', this.onOverlayDragEnd);
      if ((this.chatOptionsDragCurrentY || 0) > this.chatOptionsMinDragToClose) {
        this.closeChatOptionsOverlay();
      } else {
        this.chatOptionsOverlayY = 0;
      }
      this.chatOptionsDragStartY = null;
      this.chatOptionsDragCurrentY = null;
    };

    getEventY(event: MouseEvent | TouchEvent): number {
      if ((event as TouchEvent).touches && (event as TouchEvent).touches.length > 0) {
        return (event as TouchEvent).touches[0].clientY;
      } else if ((event as MouseEvent).clientY !== undefined) {
        return (event as MouseEvent).clientY;
      }
      return 0;
    }

    async closeChatOptionsOverlay(removeSelectedChat: boolean = false): Promise<void> {
      const selectedChat = this.chatOptionsSelectedChat;
      this.showChatOptionsOverlay = false;
      this.chatOptionsOverlayY = 0;
      this.chatOptionsSelectedChat = null;
      this.chatOptionsDragStartY = null;
      this.chatOptionsDragCurrentY = null;
      this.chatOptionsDragActive = false;

      if (!removeSelectedChat || !selectedChat?.chatId) {
        return;
      }

      const currentUid = await this.resolveCurrentUid();
      if (!currentUid) {
        console.warn('[ChatPage] Unable to delete selected chat preview: missing current uid.');
        return;
      }

      try {
        await this.chatService.clearChatForUser(selectedChat.chatId, currentUid);
        this.chats = this.chats.filter((chat) => chat?.chatId !== selectedChat.chatId);

        if (this.currentChatId === selectedChat.chatId) {
          this.closeChat();
        }
      } catch (error) {
        console.error('[ChatPage] Failed to delete selected chat preview:', error);
        alert('Unable to delete this conversation right now. Please try again.');
      }
    }

    // Placeholder logic for options
    onDeleteChatOption() {
      void this.closeChatOptionsOverlay(true);
    }
    onNotifyChatOption() {
      alert('Notify option pressed (placeholder).');
      void this.closeChatOptionsOverlay();
    }

  // --- Map Bottom Sheet State ---
  isMapBottomSheetActive = false;
  mapSheetViewMode: 'detail' | 'list' = 'detail';
  mapSheetAggregatedEngineers: any[] = [];
  selectedMapEngineer: any = null;
  private mapSheetDragStartY: number | null = null;
  private readonly mapSheetDragThreshold = 55;

  toggleMapBottomSheet(): void {
    this.isMapBottomSheetActive = !this.isMapBottomSheetActive;
    console.log(`[ChatPage.mapBottomSheet] Toggled. State: ${this.isMapBottomSheetActive ? 'Active' : 'Inactive'}`);
  }

  onMapSheetDragStart(event: MouseEvent | TouchEvent): void {
    this.mapSheetDragStartY = this.getSheetEventY(event);

    const moveHandler = (moveEvent: MouseEvent | TouchEvent): void => {
      if (this.mapSheetDragStartY === null) return;
      const deltaY = this.mapSheetDragStartY - this.getSheetEventY(moveEvent);
      if (deltaY > this.mapSheetDragThreshold && !this.isMapBottomSheetActive) {
        this.isMapBottomSheetActive = true;
        console.log('[ChatPage.mapBottomSheet] Drag-up activated. State: Active');
        cleanup();
      } else if (deltaY < -this.mapSheetDragThreshold && this.isMapBottomSheetActive) {
        this.isMapBottomSheetActive = false;
        console.log('[ChatPage.mapBottomSheet] Drag-down deactivated. State: Inactive');
        cleanup();
      }
    };

    const upHandler = (): void => {
      this.mapSheetDragStartY = null;
      cleanup();
    };

    const cleanup = (): void => {
      document.removeEventListener('mousemove', moveHandler as EventListener);
      document.removeEventListener('touchmove', moveHandler as EventListener);
      document.removeEventListener('mouseup', upHandler);
      document.removeEventListener('touchend', upHandler);
    };

    document.addEventListener('mousemove', moveHandler as EventListener, { passive: true });
    document.addEventListener('touchmove', moveHandler as EventListener, { passive: true });
    document.addEventListener('mouseup', upHandler, { once: true });
    document.addEventListener('touchend', upHandler, { once: true });
  }

  private getSheetEventY(event: MouseEvent | TouchEvent): number {
    if ('touches' in event && event.touches.length > 0) return event.touches[0].clientY;
    if ('changedTouches' in event && (event as TouchEvent).changedTouches.length > 0) {
      return (event as TouchEvent).changedTouches[0].clientY;
    }
    return (event as MouseEvent).clientY;
  }

  openMapMarkerBottomSheet(markerData: any): void {
    this.mapSheetViewMode = 'detail';
    this.mapSheetAggregatedEngineers = markerData ? [markerData] : [];
    this.selectedMapEngineer = markerData;
    this.isMapBottomSheetActive = true;
    console.log('[ChatPage.mapBottomSheet] Marker clicked. State: Active', { engineer: markerData });
  }

  openChatFromMapSheet(event: MouseEvent): void {
    event.stopPropagation();
    if (!this.selectedMapEngineer) return;

    const selectedId = this.selectedMapEngineer?.id || this.selectedMapEngineer?.uid || this.selectedMapEngineer?.userID || this.selectedMapEngineer?.email;
    if (!selectedId) {
      alert('Unable to open chat for this marker because no linked user account was found.');
      return;
    }

    if (this.selectedMapEngineer) {
      void this.selectEngineer(this.selectedMapEngineer);
    }
  }

  openMapSheetEngineerDetail(engineer: any, event?: Event): void {
    event?.stopPropagation();
    this.selectedMapEngineer = engineer;
    this.mapSheetViewMode = 'detail';
    this.isMapBottomSheetActive = true;
  }

  backToMapSheetList(event?: Event): void {
    event?.stopPropagation();
    if (this.mapSheetAggregatedEngineers.length > 1) {
      this.mapSheetViewMode = 'list';
    }
  }

  getMapSheetEngineerName(engineer: any): string {
    if (!engineer || typeof engineer !== 'object') return 'Unknown User';
    const firstName = typeof engineer.firstName === 'string' ? engineer.firstName.trim() : '';
    const lastName = typeof engineer.lastName === 'string' ? engineer.lastName.trim() : '';
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) return fullName;
    if (typeof engineer.name === 'string' && engineer.name.trim()) return engineer.name.trim();
    if (typeof engineer.email === 'string' && engineer.email.trim()) return engineer.email.trim();
    if (typeof engineer.markerTitle === 'string' && engineer.markerTitle.trim()) return engineer.markerTitle.trim();
    return 'Unknown User';
  }

  getMapSheetEngineerSubtitle(engineer: any): string {
    if (!engineer || typeof engineer !== 'object') return '';
    const contact = engineer.phoneNumber || engineer.phone || engineer.contactNumber || engineer.mobile || engineer.mobileNumber || engineer.contact;
    if (typeof contact === 'string' && contact.trim()) return contact.trim();
    if (typeof engineer.email === 'string' && engineer.email.trim()) return engineer.email.trim();
    if (typeof engineer.address === 'string' && engineer.address.trim()) return engineer.address.trim();
    return 'No contact info';
  }

  getMapSheetEngineerDistanceLabel(engineer: any): string {
    const distance = Number(engineer?.distanceFromCenterMeters);
    if (!Number.isFinite(distance) || distance < 0) return '';
    if (distance >= 1000) return `${(distance / 1000).toFixed(2)} km away`;
    return `${Math.round(distance)} m away`;
  }

  getMapSheetEngineerInitials(engineer: any): string {
    return this.getInitials(this.getMapSheetEngineerName(engineer));
  }

  // --- Conversation Attachment Sheet Methods ---
  toggleAttachmentSheet(): void {
    this.isAttachmentSheetActive = !this.isAttachmentSheetActive;
    console.log(`[ChatPage.attachmentSheet] Toggled. State: ${this.isAttachmentSheetActive ? 'Active' : 'Inactive'}`);
  }

  async openAttachmentSheet(): Promise<void> {
    this.attachmentSheetViewMode = 'grid';
    this.isAttachmentSheetActive = true;
    await this.loadConversationAttachments();
    console.log('[ChatPage.attachmentSheet] Opened. State: Active');
  }

  closeAttachmentSheet(): void {
    this.isAttachmentSheetActive = false;
    console.log('[ChatPage.attachmentSheet] Closed. State: Inactive');
  }

  /**
   * Load conversation attachments from both messages and user's session objects.
   * Fetches sessions created by the current user and maps them as attachments.
   * Also validates that sessions belong to the current user to prevent data leaks.
   */
  async loadConversationAttachments(): Promise<void> {
    try {
      const attachments: any[] = [];
      
      // Load attachments from current conversation messages
      // Filter messages that contain media/attachments
      if (this.messages && this.messages.length > 0) {
        this.messages.forEach((msg: any) => {
          if (msg.attachments && Array.isArray(msg.attachments)) {
            msg.attachments.forEach((attachment: any) => {
              attachments.push({
                ...attachment,
                messageId: msg.id,
                senderId: msg.senderId,
                timestamp: msg.timestamp,
                attachmentType: 'message'
              });
            });
          } else if (msg.imageUrl || msg.fileUrl) {
            attachments.push({
              url: msg.imageUrl || msg.fileUrl,
              type: msg.imageUrl ? 'image' : 'file',
              name: msg.fileName || 'Attachment',
              messageId: msg.id,
              senderId: msg.senderId,
              timestamp: msg.timestamp,
              attachmentType: 'message'
            });
          }
        });
      }

      // Fetch and filter user's session objects
      const currentUserId = this.auth3.getCurrentUser()?.uid || this.userID;
      if (currentUserId) {
        try {
          const userSessions = await this.auth3.getUserSessions(currentUserId);
          console.log('[ChatPage.loadConversationAttachments] Fetched user sessions:', userSessions.length);
          
          if (userSessions && Array.isArray(userSessions)) {
            const sessionsToDelete: any[] = [];

            for (const session of userSessions) {
              // Validate that session belongs to the current user
              if (!this.validateSessionBelongsToCurrentUser(session)) {
                console.warn('[ChatPage.loadConversationAttachments] Session does not belong to current user, marking for deletion', {
                  sessionId: session?.id,
                  sessionUserId: session?.userId,
                  currentUserId
                });
                sessionsToDelete.push(session);
                continue;
              }

              // Only include sessions owned by the current user
              if (session.userId === currentUserId) {
                attachments.push({
                  id: session.id,
                  name: session.name || 'Untitled Session',
                  type: 'session',
                  created: session.created,
                  imageKeys: session.imageKeys || [],
                  imageCount: (session.imageKeys && session.imageKeys.length) || 0,
                  userId: session.userId,
                  totalBoundingBoxes: session.totalBoundingBoxes || 0,
                  timestamp: session.created || new Date().toISOString(),
                  attachmentType: 'session'
                });
              }
            }

            // Clean up any sessions that belong to a different user
            if (sessionsToDelete.length > 0) {
              console.warn('[ChatPage.loadConversationAttachments] Found mismatched sessions, cleaning up...', {
                count: sessionsToDelete.length
              });
              for (const session of sessionsToDelete) {
                try {
                  await this.deleteSessionIfMismatchedUser(session);
                } catch (error) {
                  console.error('[ChatPage.loadConversationAttachments] Failed to delete mismatched session', {
                    sessionId: session?.id,
                    error
                  });
                }
              }
            }
          }
          
          console.log('[ChatPage.loadConversationAttachments] Total attachments (messages + sessions):', attachments.length);
        } catch (error) {
          console.warn('[ChatPage.loadConversationAttachments] Failed to fetch user sessions:', error);
          // Continue with just message attachments if session fetch fails
        }
      }

      this.conversationAttachments = attachments;
    } catch (error) {
      console.error('[ChatPage.loadConversationAttachments] Error loading attachments:', error);
      this.conversationAttachments = [];
    }
  }

  selectAttachment(attachment: any, event?: Event): void {
    event?.stopPropagation();
    this.selectedAttachment = attachment;
    this.attachmentSheetViewMode = 'detail';
    console.log('[ChatPage.attachmentSheet] Attachment selected', attachment);
    // Optionally trigger debug printing for sessions
    if (attachment?.type === 'session') {
      this.debugPrintAttachmentData(attachment);
    }
  }

  backToAttachmentGrid(event?: Event): void {
    event?.stopPropagation();
    if (this.conversationAttachments.length > 0) {
      this.attachmentSheetViewMode = 'grid';
    }
  }

  getAttachmentPreviewIcon(attachment: any): string {
    const type = attachment?.type || 'file';
    if (type === 'image') return 'image-outline';
    if (type === 'pdf') return 'document-outline';
    if (type === 'video') return 'play-circle-outline';
    if (type === 'session') return 'images-outline';
    return 'attach-outline';
  }

  // Open debug dialog for attachment
  onAttachmentDebugClick(attachment: any, event?: Event): void {
    if (event) event.stopPropagation();
    this.selectedAttachmentForDebug = attachment;
    this.isAttachmentDebugDialogOpen = true;
    console.log('[ChatPage] Attachment debug click detected. Debug info:');
  }

  // Close debug dialog without action
  closeAttachmentDebugDialog(): void {
    if (!this.isAttachmentCopyInProgress) {
      this.isAttachmentDebugDialogOpen = false;
      this.selectedAttachmentForDebug = null;
    }
  }

  // Confirm debug action: copy session to chat recipient with transformed filenames and S3 uploads
  async confirmAttachmentDebugAction(attachment: any): Promise<void> {
    console.log('[ChatPage] Attachment share action initiated...');
    
    if (attachment?.type !== 'session' || !attachment?.id) {
      console.error('[ChatPage] Invalid attachment for share operation');
      alert('Invalid session attachment');
      return;
    }

    // SECURITY: Validate that the attachment belongs to the current user
    if (!this.validateSessionBelongsToCurrentUser(attachment)) {
      console.error('[ChatPage] SECURITY: Cannot share session - belongs to different user');
      alert('Security error: Cannot share session from another user');
      return;
    }

    // Get receiver's user ID from active chat using multiple fallback strategies
    // this.receiverUserId: string | null = null;

    // Strategy 1: Use helper function to extract from activeChat
    this.receiverUserId = this.extractReceiverUserIdFromChat(this.activeChat);
    if (this.receiverUserId) {
      console.log('[ChatPage.confirmAttachmentDebugAction] Found receiver ID via extractReceiverUserIdFromChat:', this.receiverUserId);
    }
    
    // Strategy 2: Check if we stored it during openChat
    if (!this.receiverUserId && (this.activeChat as any)?._recipientUserId) {
      this.receiverUserId = (this.activeChat as any)._recipientUserId;
      console.log('[ChatPage.confirmAttachmentDebugAction] Found receiver ID via stored _recipientUserId:', this.receiverUserId);
    }

    // Strategy 3: Try direct property access on activeChat
    if (!this.receiverUserId && this.activeChat) {
      const directProps = ['userId', 'uid', 'userID', 'recipientId', 'recipientUID', 'otherUserId', 'participantId'];
      for (const prop of directProps) {
        if ((this.activeChat as any)[prop]) {
          this.receiverUserId = (this.activeChat as any)[prop];
          console.log(`[ChatPage.confirmAttachmentDebugAction] Found receiver ID via direct property .${prop}:`, this.receiverUserId);
          break;
        }
      }
    }

    // Strategy 4: Look up chat from the chats array if we have a chatId
    if (!this.receiverUserId && this.currentChatId) {
      const foundChat = this.chats.find((c: any) => c.chatId === this.currentChatId);
      if (foundChat) {
        this.receiverUserId = this.extractReceiverUserIdFromChat(foundChat);
        if (this.receiverUserId) {
          console.log('[ChatPage.confirmAttachmentDebugAction] Found receiver ID from chats array:', this.receiverUserId);
        }
      }
    }

    // Strategy 5: If activeChat has participants array, extract the "other" user ID
    if (!this.receiverUserId && this.activeChat?.participants && Array.isArray(this.activeChat.participants)) {
      const currentUserId = this.auth3.getCurrentUser()?.uid || this.userID;
      console.log('[ChatPage.confirmAttachmentDebugAction] Participants array:', this.activeChat.participants);
      console.log('[ChatPage.confirmAttachmentDebugAction] Current user ID:', currentUserId);
      
      // Handle both string IDs and objects with uid/userId properties
      const otherParticipant = this.activeChat.participants.find((p: any) => {
        // If participant is a string (user ID), compare directly
        if (typeof p === 'string') {
          return p !== currentUserId;
        }
        // If participant is an object, check uid or userId properties
        return (p.uid !== currentUserId && p.userId !== currentUserId);
      });
      
      if (otherParticipant) {
        // Extract the ID appropriately based on type
        if (typeof otherParticipant === 'string') {
          this.receiverUserId = otherParticipant;
        } else {
          this.receiverUserId = otherParticipant.uid || otherParticipant.userId;
        }
        console.log('[ChatPage.confirmAttachmentDebugAction] Found receiver ID from participants array:', this.receiverUserId);
      }
    }

    // Strategy 6: Try otherParticipantId if it's different from current user
    if (!this.receiverUserId && this.activeChat?.otherParticipantId) {
      const currentUserId = this.auth3.getCurrentUser()?.uid || this.userID;
      if (this.activeChat.otherParticipantId !== currentUserId) {
        this.receiverUserId = this.activeChat.otherParticipantId;
        console.log('[ChatPage.confirmAttachmentDebugAction] Found receiver ID via otherParticipantId:', this.receiverUserId);
      }
    }
    
    if (!this.receiverUserId) {
      console.error('[ChatPage.confirmAttachmentDebugAction] Cannot determine receiver user ID after all strategies. Chat details:');
      console.error('  Active chat:', this.activeChat);
      console.error('  Is chat open?', this.isChatOpen);
      console.error('  Current chat ID:', this.currentChatId);
      console.error('  Chat keys:', this.activeChat ? Object.keys(this.activeChat) : 'No activeChat');
      console.error('  Chats array length:', this.chats?.length || 0);
      alert('Error: Cannot determine recipient. Please ensure a chat is properly opened and try again. Check console for debugging details.');
      return;
    }

    const currentUserId = this.auth3.getCurrentUser()?.uid || this.userID;
    
    if (!currentUserId) {
      console.error('[ChatPage] Cannot determine current user ID');
      alert('Error: Cannot determine current user');
      return;
    }

    try {
      this.isAttachmentCopyInProgress = true;
      this.attachmentDebugState = 'active'; // Transition to active state
      this.attachmentCopyProgress = 0;
      this.attachmentCopyStatusText = 'Initializing...';

      console.log('[ChatPage] ====== SESSION SHARE INITIATED ======');
      console.log('[ChatPage] Sender (current user):', currentUserId);
      console.log('[ChatPage] Receiver (chat recipient):', this.receiverUserId);
      console.log('[ChatPage] Original session ID:', attachment.id);

      this.updateCopyProgress(5, 'Loading session data...');

      // Step 1: Debug print original data
      console.log('[ChatPage] Original attachment:');
      await this.debugPrintAttachmentData(attachment);

      // Step 2: Create NEW session with unique ID for receiver (copy, not replacement)
      const newSessionId = `s-${Date.now()}`; // Generate NEW unique session ID
      console.log('[ChatPage] New copied session ID:', newSessionId);
      
      const newSession: any = {
        id: newSessionId, // NEW session ID (not a replacement of original)
        name: attachment.name, // Use same name (unique sessionId makes it distinct)
        imageKeys: [], // Will be populated with new image filenames
        created: new Date().toISOString(), // New creation timestamp
        totalBoundingBoxes: attachment.totalBoundingBoxes || 0,
        userId: this.receiverUserId, // RECEIVER OWNS the copy
        sessionId: newSessionId
      };

      this.updateCopyProgress(15, 'Fetching images from S3...');

      // Step 3: Fetch original images and transform for receiver
      const transformedImages: any[] = [];
      const sessionImageKeys = attachment.imageKeys || [];
      const totalImages = sessionImageKeys.length;

      for (let i = 0; i < totalImages; i++) {
        const imageKey = sessionImageKeys[i];
        // Try lookup by original (base64) first, then by filename (for copied sessions)
        let originalImage = (this.imageStorage as any).getEntryForImage(imageKey);
        if (!originalImage) {
          // imageKey might be a filename, not a base64 key
          originalImage = (this.imageStorage as any).getEntryByFilename(imageKey);
        }
        
        if (!originalImage) {
          console.warn('[ChatPage] Image not found locally:', imageKey);
          console.warn('[ChatPage] All stored images:', (this.imageStorage as any).getImages().map((img: any) => ({ filename: img.filename, hasOriginal: !!img.original })));
          continue;
        }

        console.log('[ChatPage] ✅ Found image:', { imageKey, filename: originalImage.filename, hasOriginal: !!originalImage.original, hasS3Key: !!originalImage.originalS3Key });

        this.updateCopyProgress(
          15 + ((i) / totalImages) * 30,
          `Fetching image ${i + 1}/${totalImages} from S3...`
        );

        // Fetch from S3 if URLs exist
        let originalDataUrl = originalImage.original;
        let withBoxesDataUrl = originalImage.withBoxes;

        if (originalImage.originalS3Key) {
          try {
            originalDataUrl = await (this.imageStorage as any).fetchS3ObjectAsDataUrl(
              originalImage.originalS3Key
            ) || originalImage.original;
          } catch (e) {
            console.warn('[ChatPage] Failed to fetch original from S3:', e);
          }
        }

        if (originalImage.withBoxesS3Key) {
          try {
            withBoxesDataUrl = await (this.imageStorage as any).fetchS3ObjectAsDataUrl(
              originalImage.withBoxesS3Key
            ) || originalImage.withBoxes;
          } catch (e) {
            console.warn('[ChatPage] Failed to fetch withBoxes from S3:', e);
          }
        }

        // Validate that we have image data
        if (!originalDataUrl && !withBoxesDataUrl) {
          console.warn('[ChatPage] ❌ No image data available (original and withBoxes are both empty)');
          console.warn('[ChatPage] Image details:', { 
            filename: originalImage.filename, 
            hasOriginal: !!originalImage.original,
            hasWithBoxes: !!originalImage.withBoxes,
            hasS3Original: !!originalImage.originalS3Key,
            hasS3WithBoxes: !!originalImage.withBoxesS3Key
          });
          continue;
        }

        // Transform filename to use receiver's userId
        const newFilename = this.transformImageFilenameUserId(imageKey, this.receiverUserId);
        
        // Transform withBoxes filename if it exists (handle both cases: with/without _withBoxes suffix)
        let newWithBoxesFilename = newFilename; // Default to same as original if no withBoxes
        if (originalImage.withBoxes && originalImage.withBoxes !== originalImage.original) {
          // If withBoxes is different from original, transform it too
          // First, try to transform the original withBoxes filename if available
          if (originalImage.filename) {
            // Derive withBoxes filename from original by replacing userID part
            newWithBoxesFilename = this.transformImageFilenameUserId(originalImage.filename, this.receiverUserId);
          } else {
            // Fallback: just ensure the userId in imageKey is transformed
            newWithBoxesFilename = this.transformImageFilenameUserId(imageKey, this.receiverUserId);
          }
        }

        // Transform S3 keys to use receiver's userId
        const newOriginalS3Key = originalImage.originalS3Key
          ? this.transformImageFilenameUserId(originalImage.originalS3Key, this.receiverUserId)
          : undefined;
        const newWithBoxesS3Key = originalImage.withBoxesS3Key
          ? this.transformImageFilenameUserId(originalImage.withBoxesS3Key, this.receiverUserId)
          : undefined;

        console.log('[ChatPage] Transforming image:');
        console.log(`  Original key: ${imageKey}`);
        console.log(`  New key (original): ${newFilename}`);
        console.log(`  New key (withBoxes): ${newWithBoxesFilename}`);
        console.log(`  Old userId in key: ${attachment.userId}`);
        console.log(`  New userId in key: ${this.receiverUserId}`);
        console.log(`  Original S3 Key: ${originalImage.originalS3Key || 'N/A'}`);
        console.log(`  New Original S3 Key: ${newOriginalS3Key || 'N/A'}`);
        console.log(`  Original S3 URL: ${originalImage.originalS3Url || 'N/A'}`);

        const transformedImage = {
          ...originalImage,
          original: originalDataUrl,
          withBoxes: withBoxesDataUrl,
          filename: newFilename,
          withBoxesFilename: newWithBoxesFilename, // Store the transformed withBoxes filename
          userId: this.receiverUserId,
          sessionId: newSession.id,
          originalKey: imageKey,
          // Preserve and transform S3 keys and URLs
          originalS3Key: newOriginalS3Key || originalImage.originalS3Key,
          originalS3Url: originalImage.originalS3Url,
          withBoxesS3Key: newWithBoxesS3Key || originalImage.withBoxesS3Key,
          withBoxesS3Url: originalImage.withBoxesS3Url,
          // Preserve storage paths and URLs
          storagePath: originalImage.storagePath,
          storageUrl: originalImage.storageUrl,
          withBoxesStoragePath: originalImage.withBoxesStoragePath,
          withBoxesStorageUrl: originalImage.withBoxesStorageUrl
        };

        transformedImages.push(transformedImage);
      }

      // Set imageKeys - use transformed filenames (preserving the same structure as original session)
      // The original session's imageKeys contain filenames, so the new session should too
      newSession.imageKeys = transformedImages.map(img => img.filename);
      console.log('[ChatPage] ========== SESSION CREATED ==========');
      console.log('[ChatPage] Full Session Object:', {
        id: newSession.id,
        name: newSession.name,
        userId: newSession.userId,
        created: newSession.created,
        imageKeysCount: newSession.imageKeys.length,
        imageKeysSample: newSession.imageKeys.slice(0, 1).map((k: string) => k.substring(0, 50) + '...')
      });
      console.log('[ChatPage] Session Object (Full):', JSON.stringify(newSession, null, 2));
      console.log('[ChatPage] Transformed Images Count:', transformedImages.length);
      
      // Log each transformed image
      transformedImages.forEach((img, idx) => {
        console.log(`[ChatPage] ========== TRANSFORMED IMAGE #${idx + 1} ==========`);
        console.log(`[ChatPage] Image Object:`, {
          filename: img.filename,
          userId: img.userId,
          sessionId: img.sessionId,
          originalKey: img.originalKey,
          hasOriginal: !!img.original,
          originalLength: img.original?.length || 0,
          hasWithBoxes: !!img.withBoxes,
          withBoxesLength: img.withBoxes?.length || 0,
          timestamp: img.timestamp
        });
        console.log(`[ChatPage] Full Image #${idx + 1}:`, JSON.stringify({
          filename: img.filename,
          userId: img.userId,
          sessionId: img.sessionId,
          originalKey: img.originalKey,
          originalS3Key: img.originalS3Key,
          withBoxesS3Key: img.withBoxesS3Key,
          hasOriginal: !!img.original,
          hasWithBoxes: !!img.withBoxes
        }, null, 2));
      });

      // Step 4: Register session FIRST before storing images
      // This ensures the session exists in the service so saveSessionWithImagesToFirestore can find it
      this.updateCopyProgress(50, 'Registering session in service...');
      
      try {
        console.log('[ChatPage] Registering new session in service:', {
          sessionId: newSession.id,
          sessionName: newSession.name,
          receiverId: this.receiverUserId,
          imageCount: transformedImages.length
        });
        
        const svc: any = this.imageStorage;
        if (typeof svc.registerSession === 'function') {
          svc.registerSession(newSession);
          console.log('[ChatPage] ✅ Session registered successfully');
        } else {
          console.error('[ChatPage] ❌ registerSession method not found');
          throw new Error('registerSession method not available');
        }
      } catch (e) {
        console.error('[ChatPage] Session registration FAILED:', e);
        throw e; // Critical error - cannot proceed
      }

      // Step 5: Upload transformed images to S3 with new keys
      this.updateCopyProgress(55, 'Uploading images to S3 with new user ID...');
      
      for (let i = 0; i < transformedImages.length; i++) {
        const image = transformedImages[i];
        
        this.updateCopyProgress(
          55 + ((i) / transformedImages.length) * 15,
          `Uploading image ${i + 1}/${transformedImages.length} to S3...`
        );

        try {
          console.log(`[ChatPage] Uploading image ${i + 1}/${transformedImages.length}:`, {
            originalFilename: image.originalKey,
            newFilename: image.filename,
            newUserId: image.userId
          });
          
          // Upload original image to S3 with new key (only if original data URL exists)
          if (image.original) {
            try {
              console.log(`[ChatPage] 📤 S3 UPLOAD ORIGINAL - Details:`, {
                filename: image.filename,
                dataUrlLength: image.original?.length || 0,
                sessionId: newSession.id
              });
              
              const uploadResult = await (this.imageStorage as any).uploadSessionImageOriginal(
                image.original,
                newSession.id,
                image.filename  // Pass transformed filename
              );
              if (uploadResult) {
                console.log('[ChatPage] ✅ ORIGINAL UPLOADED - S3 Key:', {
                  s3Key: uploadResult?.s3Key,
                  url: uploadResult?.url,
                  filename: image.filename
                });
                image.originalS3Key = uploadResult?.s3Key;
                image.originalS3Url = uploadResult?.url;
              } else {
                console.warn('[ChatPage] ⚠️ Upload returned no result for original image');
              }
            } catch (e) {
              console.warn('[ChatPage] Failed to upload original image:', e);
            }
          }

          // Upload withBoxes image to S3 with new key (only if withBoxes data URL exists)
          if (image.withBoxes && image.withBoxes !== image.original) {
            try {
              // Use the pre-calculated transformed withBoxes filename
              const withBoxesFileName = image.withBoxesFilename || 
                `${image.filename.replace(/(\.jpg|\.png)$/i, '')}_withBoxes${image.filename.match(/(\.jpg|\.png)$/i)?.[0] || '.jpg'}`;
              
              console.log('[ChatPage] 📤 S3 UPLOAD WITHBOXES - Details:', {
                filename: withBoxesFileName,
                dataUrlLength: image.withBoxes?.length || 0,
                sessionId: newSession.id
              });
              
              const uploadResult = await (this.imageStorage as any).uploadSessionImageWithBoxes(
                image.withBoxes,
                newSession.id,
                withBoxesFileName  // Pass transformed filename
              );
              if (uploadResult) {
                console.log('[ChatPage] ✅ WITHBOXES UPLOADED - S3 Key:', {
                  s3Key: uploadResult?.s3Key,
                  url: uploadResult?.url,
                  filename: withBoxesFileName
                });
                image.withBoxesS3Key = uploadResult?.s3Key;
                image.withBoxesS3Url = uploadResult?.url;
              } else {
                console.warn('[ChatPage] ⚠️ Upload returned no result for withBoxes image');
              }
            } catch (e) {
              console.warn('[ChatPage] Failed to upload withBoxes image:', e);
            }
          }
        } catch (e) {
          console.warn('[ChatPage] S3 upload warning for image:', image.filename, e);
        }
      }

      this.updateCopyProgress(72, 'Storing images locally...');

      // Step 6: Store transformed images using ImageStorageService
      // CRITICAL: Images must be stored with the ORIGINAL property as the key
      // so that Firestore save can find them by their original base64 string
      for (let i = 0; i < transformedImages.length; i++) {
        const image = transformedImages[i];
        
        console.log(`[ChatPage] 💾 STORING IMAGE ${i + 1}/${transformedImages.length} LOCALLY`);
        console.log(`[ChatPage] Image Before addImage:`, {
          filename: image.filename,
          hasOriginal: !!image.original,
          originalLength: image.original?.length || 0,
          s3KeyOriginal: image.originalS3Key,
          s3KeyWithBoxes: image.withBoxesS3Key
        });
        console.log(`[ChatPage] Full Image Object Before Store:`, JSON.stringify({
          filename: image.filename,
          userId: image.userId,
          sessionId: image.sessionId,
          originalS3Key: image.originalS3Key,
          withBoxesS3Key: image.withBoxesS3Key,
          hasOriginal: !!image.original,
          hasWithBoxes: !!image.withBoxes
        }, null, 2));
        
        // Call addImage with only the image parameter
        await (this.imageStorage as any).addImage(image);
        
        console.log(`[ChatPage] ✅ Image ${i + 1} stored to service`);
        
        this.updateCopyProgress(
          72 + ((i + 1) / transformedImages.length) * 12,
          `Storing image ${i + 1}/${transformedImages.length}...`
        );
      }

      this.updateCopyProgress(87, 'Persisting to Firestore...');

      // Step 7: Persist session with transformed images to Firestore
      // This writes the copied session and all its images to Firestore under receiver's ownership
      try {
        console.log('[ChatPage] ========== FIRESTORE SAVE START ==========');
        console.log('[ChatPage] 📝 FINAL SESSION BEFORE FIRESTORE SAVE:', {
          sessionId: newSession.id,
          sessionName: newSession.name,
          receiverId: this.receiverUserId,
          imageCount: transformedImages.length,
          imageKeysCount: newSession.imageKeys.length,
          imageKeysSample: newSession.imageKeys.slice(0, 2).map((k: string) => k.substring(0, 50) + '...')
        });
        console.log('[ChatPage] 📝 COMPLETE SESSION OBJECT:', JSON.stringify(newSession, null, 2));
        
        console.log('[ChatPage] 📝 IMAGES TO BE SAVED (Firestore):');
        transformedImages.forEach((img, idx) => {
          console.log(`[ChatPage] ========== IMAGE #${idx + 1} FOR FIRESTORE ==========`);
          console.log(`[ChatPage] Image Details:`, {
            filename: img.filename,
            userId: img.userId,
            sessionId: img.sessionId,
            originalS3Key: img.originalS3Key,
            withBoxesS3Key: img.withBoxesS3Key,
            hasOriginal: !!img.original,
            hasWithBoxes: !!img.withBoxes
          });
          console.log(`[ChatPage] Full Image #${idx + 1}:`, JSON.stringify({
            filename: img.filename,
            userId: img.userId,
            sessionId: img.sessionId,
            originalS3Key: img.originalS3Key,
            withBoxesS3Key: img.withBoxesS3Key,
            timestamp: img.timestamp,
            prediction: img.prediction
          }, null, 2));
        });
        
        try {
          console.log('[ChatPage] 📝 Service storedImages count:', (this.imageStorage as any).getImages().length);
          console.log('[ChatPage] 📝 Service sessions count:', (this.imageStorage as any).getSessions().length);
        } catch (err) {
          console.warn('[ChatPage] Could not get service counts:', err);
        }
        
        await (this.imageStorage as any).saveSessionWithImagesToFirestore(newSession.id, this.receiverUserId);
        
        console.log('[ChatPage] ✅ Session and images persisted to Firestore successfully');
        console.log('[ChatPage] ========== FIRESTORE SAVE COMPLETE ==========');
      } catch (e) {
        console.error('[ChatPage] ❌ Firestore persistence FAILED:', e);
        console.error('[ChatPage] Session was:', newSession);
        console.error('[ChatPage] Images were:', transformedImages.map(img => ({
          filename: img.filename,
          userId: img.userId,
          sessionId: img.sessionId,
          s3KeyOriginal: img.originalS3Key,
          s3KeyWithBoxes: img.withBoxesS3Key
        })));
        throw e; // Re-throw to trigger catch block so user knows there was an issue
      }

      this.updateCopyProgress(100, 'Complete!');

      console.log('[ChatPage] ====== SESSION SHARE COMPLETED ======');
      console.log('[ChatPage] ORIGINAL SESSION (sender):');
      console.log(`  - ID: ${attachment.id}`);
      console.log(`  - Owner (sender): ${attachment.userId} (${currentUserId})`);
      console.log(`  - Name: ${attachment.name}`);
      console.log(`  - Images: ${attachment.imageKeys?.length || 0}`);
      
      console.log('[ChatPage] NEW SHARED SESSION (receiver):');
      console.log(`  - ID: ${newSession.id}`);
      console.log(`  - Owner (receiver): ${this.receiverUserId}`);
      console.log(`  - Name: ${newSession.name}`);
      console.log(`  - Images: ${transformedImages.length}`);
      
      console.log('[ChatPage] User ID Transformation:');
      console.log(`  - From: ${attachment.userId}`);
      console.log(`  - To: ${this.receiverUserId}`);
      
      console.log('[ChatPage] Transformed image details:');
      transformedImages.forEach(img => {
        console.log(`  - Original filename: ${img.originalKey || 'unknown'}`);
        console.log(`    New filename: ${img.filename}`);
        console.log(`    New userId: ${img.userId}`);
        console.log(`    Original S3 key: ${img.originalS3Key}`);
        console.log(`    WithBoxes S3 key: ${img.withBoxesS3Key}`);
        console.log(`    Original S3 URL: ${img.originalS3Url || 'N/A'}`);
        console.log(`    WithBoxes S3 URL: ${img.withBoxesS3Url || 'N/A'}`);
      });

      // Verify stored and posted data
      console.log('[ChatPage] ====== STORAGE & POST VERIFICATION ======');
      
      console.log('[ChatPage] SESSION OBJECT - Stored & Posted:');
      console.log(`  - Session ID: ${newSession.id}`);
      console.log(`  - Session Name: ${newSession.name}`);
      console.log(`  - Session Owner (receiver userId): ${newSession.userId}`);
      console.log(`  - Session Created: ${newSession.created}`);
      console.log(`  - Total Bounding Boxes: ${newSession.totalBoundingBoxes}`);
      console.log(`  - Image Keys Count: ${newSession.imageKeys?.length || 0}`);
      console.log(`  - Image Keys:`);
      newSession.imageKeys?.forEach((key: string, idx: number) => {
        console.log(`    [${idx + 1}] ${key}`);
      });

      console.log('[ChatPage] SESSION IMAGE OBJECTS - Stored & Posted:');
      transformedImages.forEach((img: any, imgIdx: number) => {
        console.log(`  [Image ${imgIdx + 1}] ${img.filename}`);
        console.log(`    - User ID: ${img.userId} (Receiver)`);
        console.log(`    - Session ID: ${img.sessionId}`);
        console.log(`    - Timestamp: ${img.timestamp}`);
        console.log(`    - Original S3 Key (posted): ${img.originalS3Key || 'Not set'}`);
        console.log(`    - WithBoxes S3 Key (posted): ${img.withBoxesS3Key || 'Not set'}`);
        console.log(`    - Prediction: ${img.prediction ? JSON.stringify(img.prediction) : 'None'}`);
        console.log(`    - Total Bounding Boxes: ${img.boxes?.length || 0}`);
      });

      console.log('[ChatPage] S3 IMAGES - Upload Verification:');
      transformedImages.forEach((img: any, imgIdx: number) => {
        console.log(`  [Image ${imgIdx + 1}] ${img.filename}`);
        console.log(`    - Original Image:`);
        console.log(`      S3 Key: ${img.originalS3Key || 'Not uploaded'}`);
        console.log(`      S3 URL: ${img.originalS3Url || 'Not available'}`);
        console.log(`      Data URL present: ${img.original ? 'Yes' : 'No'}`);
        console.log(`    - WithBoxes Image:`);
        console.log(`      S3 Key: ${img.withBoxesS3Key || 'Not uploaded'}`);
        console.log(`      S3 URL: ${img.withBoxesS3Url || 'Not available'}`);
        console.log(`      Data URL present: ${img.withBoxes ? 'Yes' : 'No'}`);
      });

      console.log('[ChatPage] STORAGE SUMMARY:');
      console.log(`  - Session object posted to receiver's Firestore: ${this.receiverUserId}`);
      console.log(`  - Total images posted: ${transformedImages.length}`);
      console.log(`  - S3 original images uploaded: ${transformedImages.filter(img => img.originalS3Url).length}`);
      console.log(`  - S3 withBoxes images uploaded: ${transformedImages.filter(img => img.withBoxesS3Url).length}`);
      console.log(`  - Firestore session collection updated: Yes (saveSessionWithImagesToFirestore)`);
      console.log(`  - Local storage updated: Yes (ImageStorageService.addImage for each)`);

      console.log('[ChatPage] ====== END SESSION SHARE ======');

      setTimeout(() => {
        this.isAttachmentCopyInProgress = false;
        this.attachmentDebugState = 'completed'; // Transition to completed state
        this.attachmentCopyProgress = 0;
      }, 1000);
    } catch (e) {
      console.error('[ChatPage] Error during session share:', e);
      console.error('[ChatPage] Session share failed with details:');
      console.error('  - Error name:', (e as any)?.name);
      console.error('  - Error code:', (e as any)?.code);
      console.error('  - Error message:', (e as any)?.message);
      console.error('  - Full error:', e);
      this.isAttachmentCopyInProgress = false;
      this.attachmentCopyProgress = 0;
      
      // Provide user-friendly error messages based on error type
      let userMessage = 'Error sharing session. Check console for details.';
      if ((e as any)?.code === 'permission-denied') {
        userMessage = 'Permission denied: Unable to save session to recipient. Check Firestore security rules.';
      } else if ((e as any)?.message?.includes('Cannot determine receiver')) {
        userMessage = 'Receiver ID determination failed. Ensure you have a valid chat open.';
      } else if ((e as any)?.message?.includes('Cannot determine current')) {
        userMessage = 'Current user identification failed. Please re-login and try again.';
      }
      
      alert(userMessage);
    }
  }

  private resolveAttachmentShareRecipient(): string | null {
    if (!this.newRecepientUserId && this.receiverUserId) {
      this.extractOriginalUserIdFromReceiverUserId();
    }

    const candidate = (this.newRecepientUserId || this.receiverUserId || '').toString().trim();
    return candidate.length > 0 ? candidate : null;
  }

  private getStoredImageForAttachment(imageKey: string): any | null {
    if (!imageKey) {
      return null;
    }

    const service: any = this.imageStorage;

    if (typeof service.getEntryForImage === 'function') {
      const byFilename = service.getEntryForImage(imageKey);
      if (byFilename) {
        return byFilename;
      }
    }

    if (typeof service.getAllImages === 'function') {
      const storedImages = service.getAllImages() || [];
      return storedImages.find((img: any) => {
        return img?.filename === imageKey
          || img?.original === imageKey
          || img?.withBoxes === imageKey
          || img?.originalKey === imageKey
          || img?.originalS3Key === imageKey
          || img?.withBoxesS3Key === imageKey;
      }) || null;
    }

    return null;
  }

  private transformKeyForAttachmentShare(value: string, recipientUserId: string): string {
    if (!value || !recipientUserId) {
      return value;
    }

    const regex = /(userID:).*?(?=sessionId:)/;
    if (regex.test(value)) {
      return value.replace(regex, `$1${recipientUserId}`);
    }

    const transformedByPageMethod = this.transformImageFilenameUserId(value, recipientUserId);
    if (transformedByPageMethod && transformedByPageMethod !== value) {
      return transformedByPageMethod;
    }

    return value;
  }

  private changeUserIdPrefixUntilSessionId(filename: string, recipientUserId: string): string {
    if (!filename || !recipientUserId) {
      return filename;
    }

    if (!filename.startsWith('userID:')) {
      return filename;
    }

    const regex = /(userID:).*?(?=sessionId:)/;
    if (regex.test(filename)) {
      return filename.replace(regex, `$1${recipientUserId}`);
    }

    return filename;
  }

  private async copySessionImageForRecipient(
    originalImage: any,
    imageKey: string,
    recipientUserId: string,
    newSessionId: string
  ): Promise<any | null> {
    const service: any = this.imageStorage;
    const effectiveRecipientUserId = (this.newRecepientUserId || recipientUserId || '').toString().trim();

    if (!effectiveRecipientUserId) {
      console.error('[ChatPage.copySessionImageForRecipient] Missing recipient user ID for key:', imageKey);
      return null;
    }

    const originalDataUrl = originalImage?.original || (originalImage?.originalS3Key ? await service.fetchS3ObjectAsDataUrl(originalImage.originalS3Key) : null);
    const withBoxesDataUrl = originalImage?.withBoxes || (originalImage?.withBoxesS3Key ? await service.fetchS3ObjectAsDataUrl(originalImage.withBoxesS3Key) : null);

    if (!originalDataUrl && !withBoxesDataUrl) {
      return null;
    }

    const sourceFilename = originalImage?.filename || imageKey;
    const transformedFilename = this.transformKeyForAttachmentShare(sourceFilename, effectiveRecipientUserId);
    const transformedOriginalS3Key = originalImage?.originalS3Key
      ? this.transformKeyForAttachmentShare(originalImage.originalS3Key, effectiveRecipientUserId)
      : transformedFilename;
    const transformedWithBoxesFilename = originalImage?.withBoxesS3Key
      ? this.transformKeyForAttachmentShare(originalImage.withBoxesS3Key, effectiveRecipientUserId)
      : (service.buildWithBoxesFilename ? service.buildWithBoxesFilename(transformedFilename) : transformedFilename);
    const transformedStoragePath = originalImage?.storagePath
      ? this.transformKeyForAttachmentShare(originalImage.storagePath, effectiveRecipientUserId)
      : transformedOriginalS3Key;
    const transformedWithBoxesStoragePath = originalImage?.withBoxesStoragePath
      ? this.transformKeyForAttachmentShare(originalImage.withBoxesStoragePath, effectiveRecipientUserId)
      : transformedWithBoxesFilename;

    const copiedImage: any = {
      ...originalImage,
      original: originalDataUrl || originalImage?.original || '',
      withBoxes: withBoxesDataUrl || originalImage?.withBoxes || '',
      filename: transformedFilename,
      userId: effectiveRecipientUserId,
      sessionId: newSessionId,
      originalKey: imageKey,
      fileImageName: this.transformKeyForAttachmentShare(
        originalImage?.fileImageName || sourceFilename || imageKey,
        effectiveRecipientUserId
      ),
      originalS3Key: transformedOriginalS3Key,
      originalS3Url: null,
      withBoxesS3Key: transformedWithBoxesFilename,
      withBoxesS3Url: null,
      storagePath: transformedStoragePath,
      storageUrl: null,
      withBoxesStoragePath: transformedWithBoxesStoragePath,
      withBoxesStorageUrl: null,
      originalUploadAttempted: !!originalDataUrl,
      originalUploadSucceeded: false,
      withBoxesUploadAttempted: !!withBoxesDataUrl,
      withBoxesUploadSucceeded: false
    };

    if (originalDataUrl) {
      const originalUpload = await service.uploadSessionImageOriginal(originalDataUrl, newSessionId, transformedOriginalS3Key || transformedFilename);
      if (originalUpload) {
        copiedImage.originalS3Key = originalUpload.s3Key;
        copiedImage.originalS3Url = originalUpload.url;
        copiedImage.storagePath = originalUpload.s3Key;
        copiedImage.storageUrl = originalUpload.url;
        copiedImage.originalUploadSucceeded = true;
      }
    }

    if (withBoxesDataUrl) {
      const withBoxesUpload = await service.uploadSessionImageWithBoxes(withBoxesDataUrl, newSessionId, transformedWithBoxesFilename);
      if (withBoxesUpload) {
        copiedImage.withBoxesS3Key = withBoxesUpload.s3Key;
        copiedImage.withBoxesS3Url = withBoxesUpload.url;
        copiedImage.withBoxesStoragePath = withBoxesUpload.s3Key;
        copiedImage.withBoxesStorageUrl = withBoxesUpload.url;
        copiedImage.withBoxesUploadSucceeded = true;
      }
    }

    return copiedImage;
  }

  private async fetchSessionImageObjectsFromFirestoreByImageKeys(
    sessionId: string,
    imageKeys: string[]
  ): Promise<any[]> {
    if (!sessionId || !Array.isArray(imageKeys) || imageKeys.length === 0) {
      return [];
    }

    const sourceKeys = new Set(imageKeys.filter((key) => typeof key === 'string' && key.trim().length > 0));
    if (sourceKeys.size === 0) {
      return [];
    }

    const matchedSessionImageObjects: any[] = [];

    try {
      const imagesRef = collection(this.firestore, 'images');
      const imageQuery = query(imagesRef, where('sessionId', '==', sessionId));
      const querySnapshot = await getDocs(imageQuery);

      querySnapshot.forEach((docSnap) => {
        const imageDoc: any = {
          firestoreDocId: docSnap.id,
          ...docSnap.data()
        };

        const candidates = [
          docSnap.id,
          imageDoc?.filename,
          imageDoc?.originalKey,
          imageDoc?.originalS3Key,
          imageDoc?.withBoxesS3Key
        ].filter((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);

        const isRelatedToSessionKey = candidates.some((candidate) => sourceKeys.has(candidate));
        if (isRelatedToSessionKey) {
          matchedSessionImageObjects.push(imageDoc);
        }
      });

      console.log('[ChatPage.confirmAttachmentShareCopy] Firestore session image objects fetched from images collection (matched by original session imageKeys):', {
        sessionId,
        requestedImageKeys: Array.from(sourceKeys),
        matchedCount: matchedSessionImageObjects.length,
        matchedSessionImageObjects
      });
    } catch (error) {
      console.warn('[ChatPage.confirmAttachmentShareCopy] Failed to fetch related session image objects from Firestore images collection by imageKeys:', error);
    }

    return matchedSessionImageObjects;
  }

  private printSelectedSessionImageObjectsFromFirestore(
    selectedSession: any,
    imageKeys: string[],
    sessionImageObjects: any[]
  ): void {
    console.group('[ChatPage.confirmAttachmentShareCopy] Selected session image objects from Firestore images collection');
    console.log('Selected session:', {
      id: selectedSession?.id || null,
      name: selectedSession?.name || null,
      userId: selectedSession?.userId || null,
      imageKeysCount: Array.isArray(imageKeys) ? imageKeys.length : 0
    });
    console.log('Requested imageKeys:', Array.isArray(imageKeys) ? imageKeys : []);
    console.log('Matched image object count:', Array.isArray(sessionImageObjects) ? sessionImageObjects.length : 0);
    console.log('Matched image objects:', Array.isArray(sessionImageObjects) ? sessionImageObjects : []);
    console.groupEnd();
  }

  // Copy the selected session, its images, and the related S3 objects for the current recipient.
  async confirmAttachmentShareCopy(attachment: any): Promise<void> {
    console.log('[ChatPage.confirmAttachmentShareCopy] ===== SESSION COPY WORKFLOW START =====');

    const selectedSession = attachment || this.selectedAttachmentForDebug || this.selectedAttachment;
    if (!selectedSession) {
      console.error('[ChatPage.confirmAttachmentShareCopy] No session selected');
      alert('No session selected');
      return;
    }

    if (selectedSession.type !== 'session' || !selectedSession.id) {
      console.error('[ChatPage.confirmAttachmentShareCopy] Invalid session attachment:', selectedSession);
      alert('Invalid session attachment');
      return;
    }

    if (!this.validateSessionBelongsToCurrentUser(selectedSession)) {
      console.error('[ChatPage.confirmAttachmentShareCopy] SECURITY: session does not belong to the current user');
      alert('Security error: Cannot share session from another user');
      return;
    }

    const currentUserId = this.auth3.getCurrentUser()?.uid || this.userID;
    if (!currentUserId) {
      console.error('[ChatPage.confirmAttachmentShareCopy] Cannot determine current user ID');
      alert('Error: Cannot determine current user');
      return;
    }

    const recipientUserId = this.resolveAttachmentShareRecipient();
    if (!recipientUserId) {
      console.error('[ChatPage.confirmAttachmentShareCopy] Cannot determine recipient user ID', {
        activeChat: this.activeChat,
        currentChatId: this.currentChatId,
        receiverUserId: this.receiverUserId,
        newRecepientUserId: this.newRecepientUserId
      });
      alert('Error: Cannot determine recipient. Please open a chat with a valid user first.');
      return;
    }

    this.receiverUserId = recipientUserId;
    this.newRecepientUserId = recipientUserId;

    const service: any = this.imageStorage;
    const newSessionId = `s-${Date.now()}`;
    const copiedSession: any = JSON.parse(JSON.stringify(selectedSession));
    copiedSession.id = newSessionId;
    copiedSession.sessionId = newSessionId;
    copiedSession.userId = recipientUserId;
    copiedSession.created = new Date().toISOString();
    copiedSession.imageKeys = [];

    try {
      this.isAttachmentCopyInProgress = true;
      this.attachmentDebugState = 'active';
      this.attachmentCopyProgress = 0;
      this.attachmentCopyStatusText = 'Initializing session copy...';

      this.updateCopyProgress(5, 'Loading session data...');

      const sourceImageKeys = Array.isArray(selectedSession.imageKeys) ? selectedSession.imageKeys : [];
      copiedSession.imageKeys = sourceImageKeys.map((key: string) => this.transformKeyForAttachmentShare(key, recipientUserId));
      const copiedImages: any[] = [];
      const uploadStatusByImage: Array<{
        sourceImageKey: string;
        copiedFilename: string;
        originalUploadAttempted: boolean;
        originalUploadSucceeded: boolean;
        withBoxesUploadAttempted: boolean;
        withBoxesUploadSucceeded: boolean;
      }> = [];

      this.updateCopyProgress(15, 'Copying session images...');

      const firestoreImageObjects = new Map<string, any>();
      const sessionImageObjectsWithFetchedS3ByKey = new Map<string, any>();
      const sourceSessionImageObjectsFromFirestore: any[] = [];
      try {
        const fetchedImageObjects = await this.fetchSessionImageObjectsFromFirestoreByImageKeys(
          selectedSession.id,
          sourceImageKeys
        );
        sourceSessionImageObjectsFromFirestore.push(...fetchedImageObjects);

        sourceSessionImageObjectsFromFirestore.forEach((imageDoc: any) => {
          const docId = (imageDoc?.firestoreDocId || '').toString();
          if (docId) {
            firestoreImageObjects.set(docId, imageDoc);
          }
          if (imageDoc?.filename) {
            firestoreImageObjects.set(imageDoc.filename, imageDoc);
          }
          if (imageDoc?.originalKey) {
            firestoreImageObjects.set(imageDoc.originalKey, imageDoc);
          }
          if (imageDoc?.originalS3Key) {
            firestoreImageObjects.set(imageDoc.originalS3Key, imageDoc);
          }
          if (imageDoc?.withBoxesS3Key) {
            firestoreImageObjects.set(imageDoc.withBoxesS3Key, imageDoc);
          }
        });

        this.printSelectedSessionImageObjectsFromFirestore(
          selectedSession,
          sourceImageKeys,
          sourceSessionImageObjectsFromFirestore
        );



        console.log('[ChatPage.confirmAttachmentShareCopy] Stored source session image objects from Firestore images collection:', sourceSessionImageObjectsFromFirestore);

        const copiedSessionImageObjects: any[] = [];
        const copiedSessionImageObjectsWithFetchedS3: any[] = [];

        for (let i = 0; i < sourceSessionImageObjectsFromFirestore.length; i++) {
          const sourceImageObject = sourceSessionImageObjectsFromFirestore[i];
          const clonedImageObject: any = JSON.parse(JSON.stringify(sourceImageObject || {}));

          if (typeof clonedImageObject.filename === 'string' && clonedImageObject.filename.trim()) {
            clonedImageObject.filename = this.changeUserIdPrefixUntilSessionId(clonedImageObject.filename, recipientUserId);
          }

          clonedImageObject.userId = recipientUserId;
          clonedImageObject.sessionId = newSessionId;

          copiedSessionImageObjects.push(clonedImageObject);

          const sourceOriginalS3Key = typeof sourceImageObject?.originalS3Key === 'string'
            ? sourceImageObject.originalS3Key
            : '';
          const sourceWithBoxesS3Key = typeof sourceImageObject?.withBoxesS3Key === 'string'
            ? sourceImageObject.withBoxesS3Key
            : '';

          const originalDataUrl = sourceOriginalS3Key
            ? await service.fetchS3ObjectAsDataUrl(sourceOriginalS3Key)
            : null;
          const withBoxesDataUrl = sourceWithBoxesS3Key
            ? await service.fetchS3ObjectAsDataUrl(sourceWithBoxesS3Key)
            : null;

          const storedFetchedImageObject: any = {
            ...clonedImageObject,
            original: originalDataUrl || clonedImageObject.original || '',
            withBoxes: withBoxesDataUrl || clonedImageObject.withBoxes || '',
            originalS3Key: sourceOriginalS3Key || clonedImageObject.originalS3Key || null,
            withBoxesS3Key: sourceWithBoxesS3Key || clonedImageObject.withBoxesS3Key || null
          };

          copiedSessionImageObjectsWithFetchedS3.push(storedFetchedImageObject);

          const lookupCandidates = [
            sourceImageObject?.filename,
            sourceImageObject?.originalKey,
            sourceImageObject?.firestoreDocId,
            sourceImageObject?.originalS3Key,
            sourceImageObject?.withBoxesS3Key
          ];

          lookupCandidates.forEach((candidate) => {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
              sessionImageObjectsWithFetchedS3ByKey.set(candidate, storedFetchedImageObject);
            }
          });
        }

        

        console.group('[ChatPage.confirmAttachmentShareCopy] Session image object one-to-one copy with filename/userId transformation');
        console.log('recipientUserId:', recipientUserId);
        console.log('copiedSessionImageObjects:', copiedSessionImageObjects);
        console.groupEnd();
        
        this.sessionImageObjectCounter = copiedSessionImageObjectsWithFetchedS3.length
        console.group('[ChatPage.confirmAttachmentShareCopy] Session image objects fetched from S3 and stored');
        console.log('storedCount:', copiedSessionImageObjectsWithFetchedS3.length);
        console.log('copiedSessionImageObjectsWithFetchedS3:', copiedSessionImageObjectsWithFetchedS3);

        for (let i = 0; i < this.sessionImageObjectCounter; i++) {

          console.log("the loop triggered")
          const imgObj = copiedSessionImageObjectsWithFetchedS3[i];
          console.log(`[ChatPage.confirmAttachmentShareCopy] Old Image object ${i + 1}/${this.sessionImageObjectCounter}:`, {
            filename: imgObj.filename,

            originalS3Key: imgObj.originalS3Key,
            originalS3Url: imgObj.originalS3Url,
            storagePath: imgObj.storagePath,
            storageUrl: imgObj.storageUrl,            
            hasOriginalDataUrl: !!imgObj.original,


            withBoxesS3Key: imgObj.withBoxesS3Key,
            hasWithBoxesDataUrl: !!imgObj.withBoxes,
            withBoxesS3Url: imgObj.withBoxesS3Url,
            withBoxesStoragePath: imgObj.withBoxesStoragePath,
            withBoxesStorageUrl: imgObj.withBoxesStorageUrl,


            userID: imgObj.userId
          });
          
          console.log("Original image from originalS3Key", imgObj.originalS3Key);
          this.imageStorage.verifyImageExists(imgObj.originalS3Key);
          console.log("WithBoxes image from withBoxesS3Key", imgObj.withBoxesS3Key);
          this.imageStorage.verifyImageExists(imgObj.withBoxesS3Key);
          imgObj.userId = recipientUserId;

          
          
          console.log("old filename", imgObj.filename);
          const newFilename = this.changeUserID(imgObj.filename, recipientUserId);
          console.log("new filename", newFilename);
          imgObj.filename = newFilename;
          console.log("new filename applied to object", imgObj.filename);


        
        //original 
          const sourceKey = this.changeUserID(imgObj.originalS3Key, recipientUserId);
          const destinationKey = imgObj.originalS3Key;
          
          console.log("originalS3Key", sourceKey);
        console.log("originaldestinationS3Key", destinationKey);

  // Validation
  if (sourceKey === destinationKey) {
    console.error("Source and Destination are the same. Change the ID first!");
    return;
  }

  // this.isCopying = true;
  try {
    // 2. Execute the internal S3 Copy command
    const result = await this.imageStorage.copyFile(sourceKey, destinationKey);
    // const result = { success: false }; // Mock result for demonstration
    console.log('[ChatPage.confirmAttachmentShareCopy] copyFile result (original):', {
      index: i + 1,
      total: this.sessionImageObjectCounter,
      sourceKey,
      destinationKey,
      result
    });
    
    // 3. Generate and log the metadata if the copy was successful
    if (result.success) {
      const bucketBaseUrl = 'https://my-angular-test-bucket-12345.s3.ap-southeast-2.amazonaws.com/';
      
      const newImageMetadata = {
        originalS3Key: sourceKey,
        originalS3Url: `${bucketBaseUrl}${sourceKey}`,
        storagePath: destinationKey,
        storageUrl: `${bucketBaseUrl}${destinationKey}`
      };

       imgObj.originalS3Key = newImageMetadata.originalS3Key,
       imgObj.originalS3Url = newImageMetadata.originalS3Url,
       imgObj.storagePath = newImageMetadata.storagePath,
       imgObj.storageUrl = newImageMetadata.storageUrl,

      console.group('✅ S3 Copy Operation Complete');
      console.log('New Image Metadata:', newImageMetadata);
      console.log('[ChatPage.confirmAttachmentShareCopy] copyFile SUCCESS (original)', {
        index: i + 1,
        total: this.sessionImageObjectCounter,
        sourceKey,
        destinationKey,
        result
      });
      
    } else {
      console.warn('[ChatPage.confirmAttachmentShareCopy] copyFile FAILED (original)', {
        index: i + 1,
        total: this.sessionImageObjectCounter,
        sourceKey,
        destinationKey,
        result
      });
    }
  } catch (error) {
    console.error('[ChatPage.confirmAttachmentShareCopy] copyFile ERROR (original)', {
      index: i + 1,
      total: this.sessionImageObjectCounter,
      sourceKey,
      destinationKey,
      error
    });
  } finally {
    // this.isCopying = false;
  }

  //withBoxes
          const sourceKey2 = this.changeUserID(imgObj.withBoxesS3Key, recipientUserId);
          const destinationKey2 = imgObj.withBoxesS3Key;
          
          console.log("withBoxesS3Key", sourceKey2);
        console.log("withBoxesdestinationS3Key", destinationKey2);

  // Validation
  if (sourceKey2 === destinationKey2) {
    console.error("Source and Destination are the same. Change the ID first!");
    return;
  }

  // this.isCopying = true;
  try {
    // 2. Execute the internal S3 Copy command
    const result = await this.imageStorage.copyFile(sourceKey2, destinationKey);
    // const result = { success: false }; // Mock result for demonstration
    console.log('[ChatPage.confirmAttachmentShareCopy] copyFile result (withBoxes):', {
      index: i + 1,
      total: this.sessionImageObjectCounter,
      sourceKey: sourceKey2,
      destinationKey,
      result
    });
    
    // 3. Generate and log the metadata if the copy was successful
    if (result.success) {
      const bucketBaseUrl = 'https://my-angular-test-bucket-12345.s3.ap-southeast-2.amazonaws.com/';
      
      const newImageMetadata = {
        originalS3Key: sourceKey2,
        originalS3Url: `${bucketBaseUrl}${sourceKey2}`,
        storagePath: destinationKey,
        storageUrl: `${bucketBaseUrl}${destinationKey}`
      };

       imgObj.withBoxesS3Key = newImageMetadata.originalS3Key,
       imgObj.withBoxesS3Url = newImageMetadata.storageUrl,
       imgObj.withBoxesStoragePath = newImageMetadata.storagePath,
       imgObj.withBoxesStorageUrl = newImageMetadata.storageUrl,

       //  imgObj.withBoxes = newImageMetadata.originalS3Url,

      console.group('✅ S3 Copy Operation Complete');
      console.log('New Image Metadata:', newImageMetadata);
      console.log('[ChatPage.confirmAttachmentShareCopy] copyFile SUCCESS (withBoxes)', {
        index: i + 1,
        total: this.sessionImageObjectCounter,
        sourceKey: sourceKey2,
        destinationKey,
        result
      });
      
    } else {
      console.warn('[ChatPage.confirmAttachmentShareCopy] copyFile FAILED (withBoxes)', {
        index: i + 1,
        total: this.sessionImageObjectCounter,
        sourceKey: sourceKey2,
        destinationKey,
        result
      });
    }
  } catch (error) {
    console.error('[ChatPage.confirmAttachmentShareCopy] copyFile ERROR (withBoxes)', {
      index: i + 1,
      total: this.sessionImageObjectCounter,
      sourceKey: sourceKey2,
      destinationKey,
      error
    });
  } finally {
    // this.isCopying = false;
  }



          console.log(`[ChatPage.confirmAttachmentShareCopy] new Image object ${i + 1}/${this.sessionImageObjectCounter}:`, {
            filename: imgObj.filename,
            
            originalS3Key: imgObj.originalS3Key,
            originalS3Url: imgObj.originalS3Url,
            storagePath: imgObj.storagePath,
            storageUrl: imgObj.storageUrl,            
            hasOriginalDataUrl: !!imgObj.original,


            withBoxesS3Key: imgObj.withBoxesS3Key,
            hasWithBoxesDataUrl: !!imgObj.withBoxes,
            withBoxesS3Url: imgObj.withBoxesS3Url,
            withBoxesStoragePath: imgObj.withBoxesStoragePath,
            withBoxesStorageUrl: imgObj.withBoxesStorageUrl,
            userID: imgObj.userId

          });

          const imagesCollectionRef = collection(this.firestore, 'images');
          const fallbackDocId = `${newSessionId}_img_${i + 1}_${Date.now()}`;
          const imageDocId = (imgObj?.filename || fallbackDocId).toString();
          const imageDocRef = doc(imagesCollectionRef, imageDocId);
          const imageDocPayload: any = {
            ...imgObj,
            filename: imageDocId,
            userId: recipientUserId,
            sessionId: newSessionId,
            firestoreDocId: imageDocId,
            firestoreSavedAt: new Date().toISOString()
          };

          try {
            await setDoc(imageDocRef, imageDocPayload, { merge: true });
            const verifySnapshot = await getDoc(imageDocRef);

            if (verifySnapshot.exists()) {
              console.log(`[ChatPage.confirmAttachmentShareCopy] Firestore store SUCCESS for imgObj ${i + 1}/${this.sessionImageObjectCounter}`, {
                imageDocId,
                saved: true,
                imgObj: imageDocPayload
              });
            } else {
              console.warn(`[ChatPage.confirmAttachmentShareCopy] Firestore verify FAILED for imgObj ${i + 1}/${this.sessionImageObjectCounter}`, {
                imageDocId,
                saved: false,
                imgObj: imageDocPayload
              });
            }
          } catch (storeError) {
            console.error(`[ChatPage.confirmAttachmentShareCopy] Firestore store FAILED for imgObj ${i + 1}/${this.sessionImageObjectCounter}`, {
              imageDocId,
              error: storeError,
              imgObj: imageDocPayload
            });
          }

          
      }


        console.groupEnd();
      } catch (firestoreError) {
        console.warn('[ChatPage.confirmAttachmentShareCopy] Unable to load session images from Firestore, falling back to local cache only:', firestoreError);
      }

       

      

      for (let i = 0; i < sourceImageKeys.length; i++) {
        const imageKey = sourceImageKeys[i];
        const fetchedImageFromSessionObjects = sessionImageObjectsWithFetchedS3ByKey.get(imageKey) || null;
        const cachedImage = this.getStoredImageForAttachment(imageKey);
        const originalImage = fetchedImageFromSessionObjects
          || cachedImage
          || firestoreImageObjects.get(imageKey)
          || firestoreImageObjects.get(cachedImage?.filename || '')
          || null;

        if (!originalImage) {
          console.warn('[ChatPage.confirmAttachmentShareCopy] Image not found for key:', imageKey);
          continue;
        }

        this.updateCopyProgress(
          15 + ((i / Math.max(sourceImageKeys.length, 1)) * 45),
          `Copying image ${i + 1}/${sourceImageKeys.length}...`
        );

        const copiedImage = await this.copySessionImageForRecipient(originalImage, imageKey, recipientUserId, newSessionId);
        if (!copiedImage) {
          console.warn('[ChatPage.confirmAttachmentShareCopy] Skipping image because no usable image data was found:', imageKey);
          continue;
        }

        copiedImages.push(copiedImage);
        uploadStatusByImage.push({
          sourceImageKey: imageKey,
          copiedFilename: copiedImage.filename,
          originalUploadAttempted: !!copiedImage.originalUploadAttempted,
          originalUploadSucceeded: !!copiedImage.originalUploadSucceeded,
          withBoxesUploadAttempted: !!copiedImage.withBoxesUploadAttempted,
          withBoxesUploadSucceeded: !!copiedImage.withBoxesUploadSucceeded
        });

        const transformedOriginalKey = this.transformKeyForAttachmentShare(imageKey, recipientUserId);
        const existingKeyIndex = copiedSession.imageKeys.findIndex((key: string) => key === transformedOriginalKey);
        if (existingKeyIndex >= 0) {
          copiedSession.imageKeys[existingKeyIndex] = copiedImage.filename;
        } else {
          copiedSession.imageKeys.push(copiedImage.filename);
        }

        if (typeof service.addImage === 'function') {
          await service.addImage(copiedImage);
        }
      }

      copiedSession.totalBoundingBoxes = copiedSession.totalBoundingBoxes ?? selectedSession.totalBoundingBoxes ?? 0;

      if (typeof service.registerSession === 'function') {
        service.registerSession(copiedSession);
      } else if (typeof service.addSessionIfNotExists === 'function') {
        service.addSessionIfNotExists(copiedSession);
      }

      this.updateCopyProgress(70, 'Uploading copied session to Firestore...');

      await service.saveSessionWithImagesToFirestore(copiedSession.id, recipientUserId);

      this.updateCopyProgress(100, 'Session copy completed');

      console.log('[ChatPage.confirmAttachmentShareCopy] ===== SESSION COPY WORKFLOW COMPLETE =====');
      console.log('[ChatPage.confirmAttachmentShareCopy] Original session:', selectedSession);
      console.log('[ChatPage.confirmAttachmentShareCopy] Copied session:', copiedSession);
      console.log('[ChatPage.confirmAttachmentShareCopy] Copied images:', copiedImages);
      console.log('[ChatPage.confirmAttachmentShareCopy] Firestore image objects used for copy:', Array.from(firestoreImageObjects.values()));
      console.log('[ChatPage.confirmAttachmentShareCopy] Per-image upload status (original/withBoxes):', uploadStatusByImage);

      console.log('Receiver user ID:', recipientUserId);
      console.log('Current user ID:', currentUserId);

      const failedUploads = uploadStatusByImage.filter((item) => {
        const originalFailed = item.originalUploadAttempted && !item.originalUploadSucceeded;
        const withBoxesFailed = item.withBoxesUploadAttempted && !item.withBoxesUploadSucceeded;
        return originalFailed || withBoxesFailed;
      });

      if (failedUploads.length > 0) {
        console.warn('[ChatPage.confirmAttachmentShareCopy] Some image uploads did not complete successfully:', failedUploads);
      }

      this.isAttachmentCopyInProgress = false;
      this.attachmentDebugState = 'completed';
      this.selectedAttachmentForDebug = copiedSession;
    } catch (error) {
      console.error('[ChatPage.confirmAttachmentShareCopy] Failed to copy session:', error);
      this.isAttachmentCopyInProgress = false;
      this.attachmentCopyProgress = 0;
      this.attachmentCopyStatusText = '';
      this.attachmentDebugState = 'inactive';
      alert('Error sharing session. Check console for details.');
      return;
    }
  }
   
  changeUserID(currentFileName: string, targetID: string): string {
  // 1. Validation: Does it start with 'userID:'?
  if (!currentFileName.startsWith('userID:')) {
    console.warn('⚠️ UI: String does not start with userID:. Skipping.');
    return currentFileName;
  }

  // 2. REGEX: Finds 'userID:' and everything until 'sessionId:'
  // $1 refers to the first capturing group (userID:)
  const regex = /(userID:).*?(?=sessionId:)/;

  if (regex.test(currentFileName)) {
    const updatedString = currentFileName.replace(regex, `$1${targetID}`);
    
    console.log('✅ UI: Process complete.');
    console.log('📄 New String:', updatedString);
    
    return updatedString;
  } else {
    console.warn('⚠️ UI: Pattern "userID:...sessionId:" not found.');
    return currentFileName;
  }
}

  //  async confirmAttachmentShareCopy(attachment: any): Promise<void> {
  //   console.log('[ChatPage.confirmAttachmentShareCopy] ===== SESSION COPY WORKFLOW START =====');

  //   const selectedSession = attachment || this.selectedAttachmentForDebug || this.selectedAttachment;
  //   if (!selectedSession) {
  //     console.error('[ChatPage.confirmAttachmentShareCopy] No session selected');
  //     alert('No session selected');
  //     return;
  //   }

  //   if (selectedSession.type !== 'session' || !selectedSession.id) {
  //     console.error('[ChatPage.confirmAttachmentShareCopy] Invalid session attachment:', selectedSession);
  //     alert('Invalid session attachment');
  //     return;
  //   }

  //   if (!this.validateSessionBelongsToCurrentUser(selectedSession)) {
  //     console.error('[ChatPage.confirmAttachmentShareCopy] SECURITY: session does not belong to the current user');
  //     alert('Security error: Cannot share session from another user');
  //     return;
  //   }

  //   const currentUserId = this.auth3.getCurrentUser()?.uid || this.userID;
  //   if (!currentUserId) {
  //     console.error('[ChatPage.confirmAttachmentShareCopy] Cannot determine current user ID');
  //     alert('Error: Cannot determine current user');
  //     return;
  //   }

  //   const recipientUserId = this.resolveAttachmentShareRecipient();
  //   if (!recipientUserId) {
  //     console.error('[ChatPage.confirmAttachmentShareCopy] Cannot determine recipient user ID', {
  //       activeChat: this.activeChat,
  //       currentChatId: this.currentChatId,
  //       receiverUserId: this.receiverUserId,
  //       newRecepientUserId: this.newRecepientUserId
  //     });
  //     alert('Error: Cannot determine recipient. Please open a chat with a valid user first.');
  //     return;
  //   }

  //   this.receiverUserId = recipientUserId;
  //   this.newRecepientUserId = recipientUserId;

  //   const service: any = this.imageStorage;
  //   const newSessionId = `s-${Date.now()}`;
  //   const copiedSession: any = JSON.parse(JSON.stringify(selectedSession));
  //   copiedSession.id = newSessionId;
  //   copiedSession.sessionId = newSessionId;
  //   copiedSession.userId = recipientUserId;
  //   copiedSession.created = new Date().toISOString();
  //   copiedSession.imageKeys = [];

  //   try {
  //     this.isAttachmentCopyInProgress = true;
  //     this.attachmentDebugState = 'active';
  //     this.attachmentCopyProgress = 0;
  //     this.attachmentCopyStatusText = 'Initializing session copy...';

  //     this.updateCopyProgress(5, 'Loading session data...');

  //     const sourceImageKeys = Array.isArray(selectedSession.imageKeys) ? selectedSession.imageKeys : [];
  //     copiedSession.imageKeys = sourceImageKeys.map((key: string) => this.transformKeyForAttachmentShare(key, recipientUserId));
  //     const copiedImages: any[] = [];
  //     const uploadStatusByImage: Array<{
  //       sourceImageKey: string;
  //       copiedFilename: string;
  //       originalUploadAttempted: boolean;
  //       originalUploadSucceeded: boolean;
  //       withBoxesUploadAttempted: boolean;
  //       withBoxesUploadSucceeded: boolean;
  //     }> = [];

  //     this.updateCopyProgress(15, 'Copying session images...');

  //     const firestoreImageObjects = new Map<string, any>();
  //     const sessionImageObjectsWithFetchedS3ByKey = new Map<string, any>();
  //     const sourceSessionImageObjectsFromFirestore: any[] = [];
  //     try {
  //       const fetchedImageObjects = await this.fetchSessionImageObjectsFromFirestoreByImageKeys(
  //         selectedSession.id,
  //         sourceImageKeys
  //       );
  //       sourceSessionImageObjectsFromFirestore.push(...fetchedImageObjects);

  //       sourceSessionImageObjectsFromFirestore.forEach((imageDoc: any) => {
  //         const docId = (imageDoc?.firestoreDocId || '').toString();
  //         if (docId) {
  //           firestoreImageObjects.set(docId, imageDoc);
  //         }
  //         if (imageDoc?.filename) {
  //           firestoreImageObjects.set(imageDoc.filename, imageDoc);
  //         }
  //         if (imageDoc?.originalKey) {
  //           firestoreImageObjects.set(imageDoc.originalKey, imageDoc);
  //         }
  //         if (imageDoc?.originalS3Key) {
  //           firestoreImageObjects.set(imageDoc.originalS3Key, imageDoc);
  //         }
  //         if (imageDoc?.withBoxesS3Key) {
  //           firestoreImageObjects.set(imageDoc.withBoxesS3Key, imageDoc);
  //         }
  //       });

  //       this.printSelectedSessionImageObjectsFromFirestore(
  //         selectedSession,
  //         sourceImageKeys,
  //         sourceSessionImageObjectsFromFirestore
  //       );

        

  //       console.log('[ChatPage.confirmAttachmentShareCopy] Stored source session image objects from Firestore images collection:', sourceSessionImageObjectsFromFirestore);

  //       const copiedSessionImageObjects: any[] = [];
  //       const copiedSessionImageObjectsWithFetchedS3: any[] = [];

  //       for (let i = 0; i < sourceSessionImageObjectsFromFirestore.length; i++) {
  //         const sourceImageObject = sourceSessionImageObjectsFromFirestore[i];
  //         const clonedImageObject: any = JSON.parse(JSON.stringify(sourceImageObject || {}));

  //         if (typeof clonedImageObject.filename === 'string' && clonedImageObject.filename.trim()) {
  //           clonedImageObject.filename = this.changeUserIdPrefixUntilSessionId(clonedImageObject.filename, recipientUserId);
  //         }

  //         clonedImageObject.userId = recipientUserId;
  //         clonedImageObject.sessionId = newSessionId;

  //         copiedSessionImageObjects.push(clonedImageObject);

  //         const sourceOriginalS3Key = typeof sourceImageObject?.originalS3Key === 'string'
  //           ? sourceImageObject.originalS3Key
  //           : '';
  //         const sourceWithBoxesS3Key = typeof sourceImageObject?.withBoxesS3Key === 'string'
  //           ? sourceImageObject.withBoxesS3Key
  //           : '';

  //         const originalDataUrl = sourceOriginalS3Key
  //           ? await service.fetchS3ObjectAsDataUrl(sourceOriginalS3Key)
  //           : null;
  //         const withBoxesDataUrl = sourceWithBoxesS3Key
  //           ? await service.fetchS3ObjectAsDataUrl(sourceWithBoxesS3Key)
  //           : null;

  //         const storedFetchedImageObject: any = {
  //           ...clonedImageObject,
  //           original: originalDataUrl || clonedImageObject.original || '',
  //           withBoxes: withBoxesDataUrl || clonedImageObject.withBoxes || '',
  //           originalS3Key: sourceOriginalS3Key || clonedImageObject.originalS3Key || null,
  //           withBoxesS3Key: sourceWithBoxesS3Key || clonedImageObject.withBoxesS3Key || null
  //         };

  //         copiedSessionImageObjectsWithFetchedS3.push(storedFetchedImageObject);

  //         const lookupCandidates = [
  //           sourceImageObject?.filename,
  //           sourceImageObject?.originalKey,
  //           sourceImageObject?.firestoreDocId,
  //           sourceImageObject?.originalS3Key,
  //           sourceImageObject?.withBoxesS3Key
  //         ];

  //         lookupCandidates.forEach((candidate) => {
  //           if (typeof candidate === 'string' && candidate.trim().length > 0) {
  //             sessionImageObjectsWithFetchedS3ByKey.set(candidate, storedFetchedImageObject);
  //           }
  //         });
  //       }

  //       console.group('[ChatPage.confirmAttachmentShareCopy] Session image object one-to-one copy with filename/userId transformation');
  //       console.log('recipientUserId:', recipientUserId);
  //       console.log('copiedSessionImageObjects:', copiedSessionImageObjects);
  //       console.groupEnd();

  //       console.group('[ChatPage.confirmAttachmentShareCopy] Session image objects fetched from S3 and stored');
  //       console.log('storedCount:', copiedSessionImageObjectsWithFetchedS3.length);
  //       console.log('copiedSessionImageObjectsWithFetchedS3:', copiedSessionImageObjectsWithFetchedS3);
  //       console.groupEnd();
  //     } catch (firestoreError) {
  //       console.warn('[ChatPage.confirmAttachmentShareCopy] Unable to load session images from Firestore, falling back to local cache only:', firestoreError);
  //     }

  //     for (let i = 0; i < sourceImageKeys.length; i++) {
  //       const imageKey = sourceImageKeys[i];
  //       const fetchedImageFromSessionObjects = sessionImageObjectsWithFetchedS3ByKey.get(imageKey) || null;
  //       const cachedImage = this.getStoredImageForAttachment(imageKey);
  //       const originalImage = fetchedImageFromSessionObjects
  //         || cachedImage
  //         || firestoreImageObjects.get(imageKey)
  //         || firestoreImageObjects.get(cachedImage?.filename || '')
  //         || null;

  //       if (!originalImage) {
  //         console.warn('[ChatPage.confirmAttachmentShareCopy] Image not found for key:', imageKey);
  //         continue;
  //       }

  //       this.updateCopyProgress(
  //         15 + ((i / Math.max(sourceImageKeys.length, 1)) * 45),
  //         `Copying image ${i + 1}/${sourceImageKeys.length}...`
  //       );

  //       const copiedImage = await this.copySessionImageForRecipient(originalImage, imageKey, recipientUserId, newSessionId);
  //       if (!copiedImage) {
  //         console.warn('[ChatPage.confirmAttachmentShareCopy] Skipping image because no usable image data was found:', imageKey);
  //         continue;
  //       }

  //       copiedImages.push(copiedImage);
  //       uploadStatusByImage.push({
  //         sourceImageKey: imageKey,
  //         copiedFilename: copiedImage.filename,
  //         originalUploadAttempted: !!copiedImage.originalUploadAttempted,
  //         originalUploadSucceeded: !!copiedImage.originalUploadSucceeded,
  //         withBoxesUploadAttempted: !!copiedImage.withBoxesUploadAttempted,
  //         withBoxesUploadSucceeded: !!copiedImage.withBoxesUploadSucceeded
  //       });

  //       const transformedOriginalKey = this.transformKeyForAttachmentShare(imageKey, recipientUserId);
  //       const existingKeyIndex = copiedSession.imageKeys.findIndex((key: string) => key === transformedOriginalKey);
  //       if (existingKeyIndex >= 0) {
  //         copiedSession.imageKeys[existingKeyIndex] = copiedImage.filename;
  //       } else {
  //         copiedSession.imageKeys.push(copiedImage.filename);
  //       }

  //       if (typeof service.addImage === 'function') {
  //         await service.addImage(copiedImage);
  //       }
  //     }

  //     copiedSession.totalBoundingBoxes = copiedSession.totalBoundingBoxes ?? selectedSession.totalBoundingBoxes ?? 0;

  //     if (typeof service.registerSession === 'function') {
  //       service.registerSession(copiedSession);
  //     } else if (typeof service.addSessionIfNotExists === 'function') {
  //       service.addSessionIfNotExists(copiedSession);
  //     }

  //     this.updateCopyProgress(70, 'Uploading copied session to Firestore...');

  //     await service.saveSessionWithImagesToFirestore(copiedSession.id, recipientUserId);

  //     this.updateCopyProgress(100, 'Session copy completed');

  //     console.log('[ChatPage.confirmAttachmentShareCopy] ===== SESSION COPY WORKFLOW COMPLETE =====');
  //     console.log('[ChatPage.confirmAttachmentShareCopy] Original session:', selectedSession);
  //     console.log('[ChatPage.confirmAttachmentShareCopy] Copied session:', copiedSession);
  //     console.log('[ChatPage.confirmAttachmentShareCopy] Copied images:', copiedImages);
  //     console.log('[ChatPage.confirmAttachmentShareCopy] Firestore image objects used for copy:', Array.from(firestoreImageObjects.values()));
  //     console.log('[ChatPage.confirmAttachmentShareCopy] Per-image upload status (original/withBoxes):', uploadStatusByImage);

  //     console.log('Receiver user ID:', recipientUserId);
  //     console.log('Current user ID:', currentUserId);

  //     const failedUploads = uploadStatusByImage.filter((item) => {
  //       const originalFailed = item.originalUploadAttempted && !item.originalUploadSucceeded;
  //       const withBoxesFailed = item.withBoxesUploadAttempted && !item.withBoxesUploadSucceeded;
  //       return originalFailed || withBoxesFailed;
  //     });

  //     if (failedUploads.length > 0) {
  //       console.warn('[ChatPage.confirmAttachmentShareCopy] Some image uploads did not complete successfully:', failedUploads);
  //     }

  //     this.isAttachmentCopyInProgress = false;
  //     this.attachmentDebugState = 'completed';
  //     this.selectedAttachmentForDebug = copiedSession;
  //   } catch (error) {
  //     console.error('[ChatPage.confirmAttachmentShareCopy] Failed to copy session:', error);
  //     this.isAttachmentCopyInProgress = false;
  //     this.attachmentCopyProgress = 0;
  //     this.attachmentCopyStatusText = '';
  //     this.attachmentDebugState = 'inactive';
  //     alert('Error sharing session. Check console for details.');
  //     return;
  //   }
  // }

  

  async confirmAttachmentDebugActionVersion2(attachment: any): Promise<void> {
    return this.confirmAttachmentShareCopy(attachment);
  }

  // Confirm sharing completion: close dialogs and request location permission
  async confirmSharingComplete(): Promise<void> {
    try {
      // Close the debug dialog and attachment sheet
      this.isAttachmentDebugDialogOpen = false;
      this.selectedAttachmentForDebug = null;
      this.attachmentDebugState = 'inactive';
      this.closeAttachmentSheet();

      // Auto-send success message
      this.messageText = 'File shared successfully';
      setTimeout(() => {
        this.sendMessage();
      }, 500);

      // Request location permission for location-based features
      console.log('[ChatPage] Requesting location permission for enhanced features...');
      // await this.requestLocationPermissionForFeatures();
    } catch (e) {
      console.error('[ChatPage] Error during sharing completion:', e);
    }
  }

  // Request location permission and explain why it's needed
  private async requestLocationPermissionForFeatures(): Promise<void> {
    try {
      // Show education dialog before requesting
      const confirmed = await new Promise<boolean>(resolve => {
        const alert = document.createElement('div');
        alert.innerHTML = `
          <div class="location-permission-dialog" style="
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 24px;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 9999;
            max-width: 300px;
            text-align: center;
          ">
            <h3 style="margin: 0 0 16px 0; font-size: 18px; color: #333;">Enable Location</h3>
            <p style="margin: 0 0 16px 0; font-size: 14px; color: #666; line-height: 1.5;">
              Allow location access for optimum use of the application. This enables location-based features to show your current location and provide location services in Chat and other pages.
            </p>
            <div style="display: flex; gap: 10px;">
              <button onclick="window.locationDialogResult = false; this.parentElement.parentElement.remove();" style="
                flex: 1;
                padding: 10px;
                border: 1px solid #ddd;
                background: #f5f5f5;
                border-radius: 6px;
                cursor: pointer;
              ">Cancel</button>
              <button onclick="window.locationDialogResult = true; this.parentElement.parentElement.remove();" style="
                flex: 1;
                padding: 10px;
                border: none;
                background: #FF9800;
                color: white;
                border-radius: 6px;
                cursor: pointer;
              ">Enable</button>
            </div>
          </div>
        `;
        document.body.appendChild(alert);
        
        const checkInterval = setInterval(() => {
          if ((window as any).locationDialogResult !== undefined) {
            clearInterval(checkInterval);
            resolve((window as any).locationDialogResult);
            (window as any).locationDialogResult = undefined;
          }
        }, 100);

        setTimeout(() => {
          clearInterval(checkInterval);
          resolve(false);
        }, 30000);
      });

      if (confirmed) {
        // Request geolocation permission
        navigator.geolocation.getCurrentPosition(
          (position) => {
            console.log('[ChatPage] Location obtained:', position.coords);
          },
          (error) => {
            console.warn('[ChatPage] Location error:', error);
          },
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
      }
    } catch (e) {
      console.error('[ChatPage] Error requesting location:', e);
    }
  }

  /**
   * Transform an image filename to use a new userId
   * Format: userID:oldUserIdpart...sessionId:sessionIdpart...
   * Replace ONLY the FIRST userID (up to first sessionId:) with new userId while preserving the rest
   * Example transformation:
   *   Input:  userID:qlqoKE1Gw3RhjnML9U3YA20vava2sessionId:s-1776736184763img3_userID:...
   *   Output: userID:(newUserId)sessionId:s-1776736184763img3_userID:...
   */
  private transformImageFilenameUserId(filename: string, newUserId: string): string {
    try {
      // Use non-greedy match to capture the FIRST userID up to the FIRST 'sessionId:'
      // Pattern: ^userID:(.+?)sessionId:
      // The .+? matches minimum characters (non-greedy) until the literal 'sessionId:'
      const match = filename.match(/^userID:(.+?)sessionId:/);
      
      if (match) {
        const oldUserId = match[1];
        // Extract everything AFTER the first 'sessionId:' to preserve the rest of the filename
        const restIndex = filename.indexOf('sessionId:');
        const rest = filename.substring(restIndex); // includes 'sessionId:' and everything after
        const newFilename = `userID:${newUserId}${rest}`;
        
        console.log(`[ChatPage] Filename transform successful:`);
        console.log(`  Original:    ${filename}`);
        console.log(`  Transformed: ${newFilename}`);
        console.log(`  Old UserID:  ${oldUserId}`);
        console.log(`  New UserID:  ${newUserId}`);
        
        return newFilename;
      } else {
        // Pattern doesn't match - return original and log for debugging
        console.warn('[ChatPage] Filename pattern not recognized for transformation');
        console.warn(`  Pattern expected: userID:<userId>sessionId:...`);
        console.warn(`  Actual filename:  ${filename}`);
        return filename;
      }
    } catch (e) {
      console.error('[ChatPage] Error transforming filename:', e);
      console.error(`  Filename: ${filename}`);
      console.error(`  New UserID: ${newUserId}`);
      return filename;
    }
  }

  private updateCopyProgress(percent: number, status: string): void {
    this.attachmentCopyProgress = Math.min(percent, 100);
    this.attachmentCopyStatusText = status;
    console.log(`[ChatPage.copyProgress] ${percent}% - ${status}`);
  }

  // Debug method: print attachment object and related images from Firestore/S3
  private async debugPrintAttachmentData(attachment: any): Promise<void> {
    try {
      console.log('========== ATTACHMENT DEBUG INFO ==========');
      console.log('Attachment Object:', JSON.parse(JSON.stringify(attachment)));
      
      if (attachment?.type === 'session' && attachment?.id) {
        console.log('\n--- Session Details ---');
        console.log('Session ID:', attachment.id);
        console.log('Session Name:', attachment.name);
        console.log('Image Count:', attachment.imageCount || 0);
        console.log('Image Keys Count:', attachment.imageKeys?.length || 0);
        console.log('Image Keys:', attachment.imageKeys);
        console.log('Total Bounding Boxes:', attachment.totalBoundingBoxes || 0);
        console.log('Created:', attachment.created);

        // Get all stored images
        let allImages: any[] = [];
        try {
          if (typeof (this.imageStorage as any).getAllImages === 'function') {
            const result = (this.imageStorage as any).getAllImages();
            allImages = result instanceof Promise ? await result : result;
          } else if (typeof (this.imageStorage as any).getImages === 'function') {
            const result = (this.imageStorage as any).getImages();
            allImages = result instanceof Promise ? await result : result;
          }
          if (!Array.isArray(allImages)) allImages = [];
        } catch (e) {
          console.warn('[ChatPage] Failed to get all images:', e);
          allImages = [];
        }

        console.log('\n--- All Stored Images ---');
        console.log('Total Stored Images:', allImages.length);
        allImages.forEach((img: any, idx: number) => {
          console.log(`  [${idx}] Filename: ${img.filename}, Original: ${img.original?.substring?.(0, 50)}..., S3: ${img.s3Url?.substring?.(0, 50) || 'N/A'}...`);
        });

        // Print images for this specific session
        const sessionImages = allImages.filter((img: any) => 
          attachment.imageKeys?.includes(img.filename) || 
          attachment.imageKeys?.includes(img.original)
        );
        console.log(`\n--- Images in this Session (${sessionImages.length} total) ---`);
        sessionImages.forEach((img: any, idx: number) => {
          console.log(`  [${idx}] Filename: ${img.filename}`);
          console.log(`       Original: ${img.original}`);
          console.log(`       S3 URL: ${img.s3Url}`);
          console.log(`       Boxes: ${img.boxes?.length || 0}`);
        });
      } else {
        console.log('\n--- Message Attachment Details ---');
        console.log('Type:', attachment?.type);
        console.log('Size:', attachment?.size);
      }
      console.log('========== END DEBUG INFO ==========\n');
    } catch (e) {
      console.error('[ChatPage] Error during attachment debug print:', e);
    }
  }

  private static userSyncTasks: Map<string, Promise<void>> = new Map();
  userName: string | null = null;
  firstName: string | null = null;
  lastName: string | null = null;
  email: string | null = null;
  phone: string | null = null;
  gender: string | null = null;
  birthday: string | null = null;
  engineeringID: string | null = null;
  userID: string | null = null;
  sessions: any[] = [];
  lastSessionDisplayName: string | null = null;
  private backButtonSub: any; // hardware back handler
  isLoggedIn: boolean = false;
  userRole: string | null = null;
  isSidebarOpen: boolean = false;
  syncStatusText: string = 'Not synced';
  cacheWarmStatusText: string = 'Not synced';
  syncStatusState: 'idle' | 'syncing' | 'completed' | 'error' = 'idle';

  // Storage keys (centralized for easier management)
  private readonly STORAGE_KEYS = {
    isLoggedIn: 'isLoggedIn',
    userData: 'userData',
    userProfile: 'userProfile',
    currentSessionId: 'currentSessionId',
    isLoggedInSession: 'isLoggedInSession',
    currentUserId: 'currentUserId'
  };
  // UI: toggles between preview list and active chat conversation
  isChatOpen: boolean = false;
  activeChat: any = null;
  // current chat id and messages
  currentChatId: string | null = null;
  messages: Message[] = [];
  messageText: string = '';
  tappedMessageId: string | null = null;
  private messagesSub?: Subscription;
  private typingSub?: Subscription;
  private typingDebounceTimeoutId?: ReturnType<typeof setTimeout>;
  isOtherUserTyping: boolean = false;
  private readonly typingDebounceMs = 220;
  private userProfileCache: Map<string, any> = new Map();
  isSearching = false;
  searchQuery = '';
  // active bottom navigation tab: 'person' | 'people' | 'location' | 'settings'
  activeTab: 'person' | 'people' | 'location' | 'settings' | 'profile' = 'people';
  private map?: L.Map | null = null;
  private baseTileLayer?: OfflineLeafletTileLayer;
  private userLocationMarker?: L.Marker;
  private readonly fallbackCoordinates = { latitude: 10.324849, longitude: 123.849164 };
  private readonly osmTileTemplate = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  private readonly offlineTileSubdomains = ['a', 'b', 'c'];
  offlineModeEnabled = false;
  offlineDownloadInProgress = false;
  offlineDownloadProgressPct = 0;
  offlineDownloadStatusText = 'No offline download started.';
  offlineMinZoom = 13;
  offlineMaxZoom = 17;
  offlineMaxTilesPerDownload = 1600;
  offlineAreaName = '';
  downloadedOfflineAreas: OfflineMapAreaMetadata[] = [];
  private connectivityOnline = true;
  private mapBootstrapSequence = 0;
  private readonly mapOnlineProbeDelayMs = 1400;
  private readonly mapOnlineProbeTimeoutMs = 2200;
  private readonly mapOnlineMarkerRefreshDelayMs = 1400;
  private readonly mapLocationActivationGraceMs = 1200;
  private locationPromptShownOnce = false;
  mapBootstrapStatusVisible = false;
  mapBootstrapStatusText = '';
  mapBootstrapStatusTone: 'loading' | 'success' | 'offline' | 'warning' = 'loading';
  private mapBootstrapStatusHideTimeoutId?: ReturnType<typeof setTimeout>;
  private mapInitAttempts = 0;
  private readonly maxMapInitAttempts = 8;
  private mapResizeTimeoutId?: ReturnType<typeof setTimeout>;
  private markerOverlayElement?: HTMLDivElement;
  private markerSelectionOverlayElement?: HTMLDivElement;
  private mapTapOverlayElement?: HTMLDivElement;
  private markerSelectionSquare?: L.Rectangle;
  private markerSquareHalfSideMeters = 440;
  
  // --- Attachment Debug Dialog State ---
  isAttachmentDebugDialogOpen: boolean = false;
  selectedAttachmentForDebug: any = null;
  attachmentDebugState: 'inactive' | 'active' | 'completed' = 'inactive'; // Track dialog state
  
  // --- Attachment Copy Progress State ---
  isAttachmentCopyInProgress: boolean = false;
  attachmentCopyProgress: number = 0;
  attachmentCopyStatusText: string = '';
  
  // Periodic service recovery checker (internet & location)
  private serviceRecoveryCheckInterval?: ReturnType<typeof setInterval>;
  private readonly serviceRecoveryCheckMs = 7000; // Check every 7 seconds
  private lastInternetStatus = true;
  private lastLocationStatus = true;
// private markerSquareHalfSideMeters = 8050; //1 mile radius
  isRadiusSelectionOverlayOpen = false;
  showAdvancedOptions = false;
  readonly markerRadiusOptions: RadiusOption[] = [
    { label: '500m', value: 440 },
    { label: '1km', value: 880 },
    { label: '1.5km', value: 1320 },
    { label: '2km', value: 1760 },
    { label: '2.5km', value: 2200 }
  ];
  selectedRadiusHalfSideMeters = this.markerSquareHalfSideMeters;
  aggregatedRadiusMarkerData: Array<OfficeLocationMarkerData & {
    distanceFromCenterMeters: number;
    associatedUser: any | null;
    resolvedUserId: string | null;
    markerTitle: string;
  }> = [];
  private lastRadiusAggregationBounds?: RadiusSquareBounds;
  private readonly defaultRadiusAggregationCenter = {
    latitude: 10.302051,
    longitude: 123.902243
  };

  // --- Conversation Attachment Sheet State ---
  isAttachmentSheetActive = false;
  attachmentSheetViewMode: 'detail' | 'grid' = 'grid';
  conversationAttachments: any[] = [];
  selectedAttachment: any = null;
  
  // Conversation Attachment Sheet State - moved up with other state variables
  private officeLocationMarkerData: OfficeLocationMarkerData[] = [];
  private officeLocationLeafletMarkers: L.Marker[] = [];
  private markerUserProfileMap: Map<L.Marker, any> = new Map();
  private mapRefreshTimerId?: ReturnType<typeof setInterval>;
  private readonly mapRefreshIntervalMs = 30000; // 30 seconds
  // Background location-based marker fetching
  private currentUserLocation: {
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: string;
  } | null = null;
  private isBackgroundLocationFetchActive = false;
  private backgroundLocationFetchInterval?: ReturnType<typeof setInterval>;

  private dismissMapTapOverlay(): void {
    if (!this.mapTapOverlayElement) return;
    try { document.body.removeChild(this.mapTapOverlayElement); } catch {}
    this.mapTapOverlayElement = undefined;
  }

  private isElementVisiblyRendered(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const intersectsViewport = (
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= viewportHeight &&
      rect.left <= viewportWidth
    );

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0 &&
      intersectsViewport
    );
  }

  private drawMarkerCenteredSquare(center: L.LatLng, trigger: 'click' | 'touchend' | 'story-item', titleText: string): void {
    if (!this.map) {
      console.warn('[ChatPage.markerSquare] Skipped drawing square because map is not initialized.');
      return;
    }

    const halfSideMeters = this.markerSquareHalfSideMeters;
    const sideMeters = halfSideMeters * 2;

    // Approximate meter-to-degree conversion at the marker latitude.
    const metersPerDegreeLat = 111_320;
    const cosLat = Math.cos((center.lat * Math.PI) / 180);
    const metersPerDegreeLng = Math.max(1, Math.abs(cosLat) * 111_320);
    const deltaLat = halfSideMeters / metersPerDegreeLat;
    const deltaLng = halfSideMeters / metersPerDegreeLng;

    const southWest = L.latLng(center.lat - deltaLat, center.lng - deltaLng);
    const northEast = L.latLng(center.lat + deltaLat, center.lng + deltaLng);
    const squareBounds = L.latLngBounds(southWest, northEast);

    try {
      this.markerSelectionSquare?.remove();
    } catch {}

    this.markerSelectionSquare = L.rectangle(squareBounds, {
      color: '#111111',
      weight: 2,
      fill: false,
      interactive: false
    }).addTo(this.map);

    try { this.markerSelectionSquare.bringToFront(); } catch {}

    const areaSqMeters = sideMeters * sideMeters;
    const areaHectares = areaSqMeters / 10_000;
    const cornerRadiusMeters = Math.sqrt(2) * halfSideMeters;

    console.log('[ChatPage.markerSquare] Square drawn around marker', {
      trigger,
      titleText,
      center: {
        latitude: Number(center.lat.toFixed(6)),
        longitude: Number(center.lng.toFixed(6))
      },
      squareRadiusMeters: halfSideMeters,
      cornerRadiusMeters: Number(cornerRadiusMeters.toFixed(2)),
      sideMeters,
      areaSquareMeters: Number(areaSqMeters.toFixed(2)),
      areaHectares: Number(areaHectares.toFixed(4)),
      bounds: {
        southWest: {
          latitude: Number(southWest.lat.toFixed(6)),
          longitude: Number(southWest.lng.toFixed(6))
        },
        northEast: {
          latitude: Number(northEast.lat.toFixed(6)),
          longitude: Number(northEast.lng.toFixed(6))
        }
      }
    });
  }

  private async ensureMapReadyForLocationTab(maxAttempts: number = 18, delayMs: number = 120): Promise<L.Map | null> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.map) {
        return this.map;
      }

      const mapElement = document.getElementById('map');
      if (mapElement) {
        await this.initMap();
        if (this.map) {
          return this.map;
        }
      }

      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), delayMs);
      });
    }

    return this.map ?? null;
  }

  private applyMarkerSelectionOverlayInlineStyles(
    overlay: HTMLDivElement,
    wrap: HTMLDivElement,
    panel: HTMLDivElement,
    list: HTMLDivElement,
    closeBtn: HTMLButtonElement
  ): void {
    const isMobile = window.innerWidth <= 640;

    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0, 0, 0, 0.14)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '2147483646',
      padding: isMobile ? '12px' : '16px'
    });

    Object.assign(wrap.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
      maxWidth: isMobile ? '94vw' : '560px'
    });

    Object.assign(panel.style, {
      width: '100%',
      maxWidth: isMobile ? '94vw' : '540px',
      background: '#e8e8e8',
      border: '1px solid #b8b8b8',
      borderRadius: '12px',
      padding: isMobile ? '14px 12px' : '20px 18px 16px',
      boxSizing: 'border-box',
      // maxHeight: isMobile ? 'min(82vh, 500px)' : 'min(80vh, 530px)',
       maxHeight: isMobile ? 'min(82vh, 350px)' : 'min(80vh, 530px)',
      display: 'flex',
      flexDirection: 'column',
      gap: isMobile ? '12px' : '16px',
      boxShadow: '0 8px 20px rgba(0, 0, 0, 0.1)'
    });

    Object.assign(list.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: isMobile ? '10px' : '14px',
      overflowY: 'auto',
      maxHeight: isMobile ? 'min(52vh, 300px)' : 'min(52vh, 340px)',
      paddingRight: '2px'
    });

    Object.assign(closeBtn.style, {
      alignSelf: 'flex-end',
      width: isMobile ? '138px' : '176px',
      height: isMobile ? '120px' : '126px',
      padding: '0 16px',
      border: 'none',
      borderRadius: '10px',
      background: '#4432d8',
      color: '#ffffff',
      fontSize: isMobile ? '1.35rem' : '2rem',
      lineHeight: '1',
      cursor: 'pointer'
    });
  }

  private applyMarkerSelectionItemInlineStyles(
    item: HTMLButtonElement,
    avatar: HTMLDivElement,
    info: HTMLDivElement,
    name: HTMLDivElement,
    sub: HTMLDivElement
  ): void {
    const isMobile = window.innerWidth <= 640;

    Object.assign(item.style, {
      display: 'flex',
      alignItems: 'center',
      gap: isMobile ? '10px' : '14px',
      width: '100%',
      border: 'none',
      borderRadius: '5px',
      // background: '#4fd86f',
      background: 'FCF8F8',
      padding: isMobile ? '8px 10px' : '10px 14px',
      minHeight: isMobile ? '78px' : '92px',
      cursor: 'pointer',
      textAlign: 'left',
      transition: 'transform 0.12s ease, filter 0.12s ease'
    });

    Object.assign(avatar.style, {
      width: isMobile ? '52px' : '64px',
      height: isMobile ? '52px' : '64px',
      minWidth: isMobile ? '52px' : '64px',
      borderRadius: '999px',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#ffb429'
    });

    Object.assign(info.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '3px',
      minWidth: '0'
    });

    Object.assign(name.style, {
      fontSize: isMobile ? '1.2rem' : '1.9rem',
      lineHeight: '1.5',
      color: '#1f1f1f',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    });

    Object.assign(sub.style, {
      fontSize: isMobile ? '1.25rem' : '1.9rem',
      lineHeight: '1.02',
      color: '#1f1f1f',
      opacity: '0.95',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    });
  }

  private applyMapTapOverlayInlineStyles(
    overlay: HTMLDivElement,
    panel: HTMLDivElement,
    title: HTMLHeadingElement,
    lngInput: HTMLInputElement,
    latInput: HTMLInputElement,
    message: HTMLDivElement,
    actions: HTMLDivElement,
    cancelBtn: HTMLButtonElement,
    placeBtn: HTMLButtonElement
  ): void {
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
      zIndex: '2147483647',
      background: 'rgba(0, 0, 0, 0.45)'
    });

    Object.assign(panel.style, {
      background: '#ffffff',
      borderRadius: '14px',
      width: '100%',
      maxWidth: '360px',
      padding: '16px',
      boxShadow: '0 12px 30px rgba(0, 0, 0, 0.2)',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    });

    Object.assign(title.style, {
      margin: '0 0 4px',
      fontSize: '17px'
    });

    const inputStyle: Partial<CSSStyleDeclaration> = {
      height: '40px',
      padding: '0 10px',
      border: '1px solid #d6d6d6',
      borderRadius: '8px'
    };
    Object.assign(lngInput.style, inputStyle);
    Object.assign(latInput.style, inputStyle);

    Object.assign(message.style, {
      minHeight: '18px',
      fontSize: '12px',
      color: '#d32f2f'
    });

    Object.assign(actions.style, {
      display: 'flex',
      gap: '8px',
      justifyContent: 'flex-end'
    });

    Object.assign(cancelBtn.style, {
      height: '36px',
      padding: '0 14px',
      borderRadius: '8px',
      border: '1px solid #d0d0d0',
      background: '#fff'
    });

    Object.assign(placeBtn.style, {
      height: '36px',
      padding: '0 14px',
      borderRadius: '8px',
      border: 'none',
      background: '#387ef5',
      color: '#fff'
    });
  }

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

  // Real-time chat list for the current user
  chats: any[] = [];
  private chatsSub?: Subscription;

  // Test markers (similar to goalTasks) for placing sample markers on the Leaflet map
  testMarkers: Array<{ id: number; name: string; latitude: number; longitude: number }> = [
    { id: 1, name: 'Test Marker A', latitude: 10.324849, longitude: 123.849164 },
    { id: 2, name: 'Test Marker B', latitude: 10.326000, longitude: 123.850000 },
    { id: 3, name: 'Test Marker C', latitude: 10.323500, longitude: 123.847500 },
    { id: 4, name: 'Test Marker D', latitude: 10.327200, longitude: 123.848900 },
    { id: 5, name: 'Test Marker E', latitude: 10.317700, longitude: 123.903700 }
  ];

  // Ensure the stories property is declared and initialized
  stories: any[] = [];

  /** Inject auth, router, and image storage services for navigation and data. */
  constructor(private formBuilder: FormBuilder, private router: Router, private authService: AuthService, private navCtrl: NavController, public auth3: Auth3Service, private imageStorage: ImageStorageService, private platform: Platform, private firestore: Firestore, private chatService: ChatService, private presenceService: PresenceService, private userPrefetchCache: UserPrefetchCacheService, private offlineMapTileService: OfflineMapTileService, private ngZone: NgZone) {

  }


ngOnInit(): void {
  console.log('[ChatPage.ngOnInit] ===== PAGE INIT START (ngOnInit called) =====');
  console.log('[ChatPage.ngOnInit] Auth currentUser on ngOnInit:', this.auth3.getCurrentUser()?.uid || 'null');

  const cachedUid = this.resolveCachedUid();
  if (cachedUid) {
    this.refreshCacheWarmStatus(cachedUid);

    const cachedProfile = this.userPrefetchCache.getCachedUserProfile(cachedUid);
    if (cachedProfile) {
      this.firstName = cachedProfile.firstName || this.firstName;
      this.lastName = cachedProfile.lastName || this.lastName;
      this.email = cachedProfile.email || this.email;
    }

    const cachedChats = this.userPrefetchCache.getCachedChats(cachedUid);
    if (cachedChats.length > 0) {
      this.chats = [...cachedChats];
    }

    const cachedEngineers = this.userPrefetchCache.getCachedEngineers(cachedUid);
    if (cachedEngineers.length > 0) {
      this.engineers = [...cachedEngineers];
    }

    this.userPrefetchCache.warmUserDataInBackground(cachedUid, 'chat-page-ngOnInit').finally(() => {
      this.refreshCacheWarmStatus(cachedUid);
    });

    // Load user location from storage and start background marker fetch
    this.loadUserLocationAndStartBackgroundFetch(cachedUid);

    // Get and save current location if available
    void this.getAndSaveCurrentLocation();
  }

  this.initialize();
  this.refreshOfflineAreaList();
  this.startUserChatsSubscription().catch((err) => {
    console.warn('[ChatPage.ngOnInit] Unable to start chat list subscription:', err);
  });
  
  // Start periodic checker for internet and location service recovery
  this.startServiceRecoveryChecker();

  // Setup hardware back button handler
  this.setupHardwareBackButton();
}

getCurrentMapBoundsBBox(): { west: number; south: number; east: number; north: number } | null {
  if (!this.map) {
    return null;
  }

  const bounds = this.map.getBounds();
  return {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth()
  };
}

toggleOfflineMode(): void {
  this.offlineModeEnabled = !this.offlineModeEnabled;
  this.applyEffectiveTileLayerMode();
  this.offlineDownloadStatusText = this.offlineModeEnabled
    ? 'Offline mode enabled. Only cached tiles will render.'
    : 'Offline mode disabled. Online fallback enabled.';
}

private isNativeDevice(): boolean {
  return this.platform.is('android') || this.platform.is('ios');
}

  async downloadVisibleMapAreaOffline(): Promise<void> {
    console.log('[ChatPage.download] Function called');
    console.log('[ChatPage.download] Platform:', this.isNativeDevice() ? 'NATIVE (Android/iOS)' : 'WEB/BROWSER');
    
    if (!this.map) {
      console.warn('[ChatPage.download] Map not initialized, attempting to initialize...');
      await this.initMap();
      if (!this.map) {
        console.error('[ChatPage.download] Failed to initialize map');
        return;
      }
    }

    const minZoom = Math.floor(this.offlineMinZoom);
    const maxZoom = Math.floor(this.offlineMaxZoom);
    if (maxZoom < minZoom) {
      console.error('[ChatPage.download] Invalid zoom range:', {minZoom, maxZoom});
      alert('Invalid zoom range: max zoom must be greater than or equal to min zoom.');
      return;
    }

    const bounds = this.map.getBounds();
    console.log('[ChatPage.download] Map bounds:', bounds);
    
    this.offlineDownloadInProgress = true;
    this.offlineDownloadProgressPct = 0;
    this.offlineDownloadStatusText = 'Preparing offline tile download...';
    console.log('[ChatPage.download] Starting offline download with settings:', {
      minZoom, maxZoom, maxTiles: this.offlineMaxTilesPerDownload
    });

    let lastProgressTime = Date.now();
    let lastProgressPercentage = 0;
    const progressCheckIntervalMs = 5000; // Check for progress every 5 seconds
    const maxNoProgressTimeMs = 30000; // Timeout if no progress for 30 seconds
    const isNative = this.isNativeDevice();

    try {
      console.log('[ChatPage.download] Calling service.downloadTilesForBounds...');
      
      // Create a promise that races the download against a timeout
      const downloadPromise = this.offlineMapTileService.downloadTilesForBounds({
        bounds,
        minZoom,
        maxZoom,
        urlTemplate: this.osmTileTemplate,
        subdomains: this.offlineTileSubdomains,
        maxTiles: this.offlineMaxTilesPerDownload,
        concurrency: 6,
        areaName: (this.offlineAreaName || '').trim() || `Area ${new Date().toLocaleString()}`,
        onProgress: (progress) => {
          try {
            const now = Date.now();
            lastProgressTime = now;
            lastProgressPercentage = progress.percentage;
            
            console.log('[ChatPage.progress] Callback received:', {
              completed: progress.completed,
              total: progress.total,
              percentage: progress.percentage,
              timeSinceLastProgress: 0
            });
            
            // Ensure progress updates trigger Angular change detection
            this.ngZone.run(() => {
              this.offlineDownloadProgressPct = progress.percentage;
              this.offlineDownloadStatusText = `Downloading tiles: ${progress.completed}/${progress.total} (${progress.percentage}%)`;
              console.log('[ChatPage.progress] UI updated:', this.offlineDownloadStatusText);
            });
          } catch (callbackError) {
            console.error('[ChatPage.progress] Error in progress callback:', callbackError);
          }
        }
      });

      // Monitor for stalled progress
      const progressMonitor = setInterval(() => {
        const timeSinceLastProgress = Date.now() - lastProgressTime;
        console.log('[ChatPage.download] Progress check - timeSinceLastProgress:', timeSinceLastProgress, 'lastPercentage:', lastProgressPercentage);
        
        if (timeSinceLastProgress > maxNoProgressTimeMs && lastProgressPercentage < 100) {
          console.warn('[ChatPage.download] Download appears stalled - no progress for', timeSinceLastProgress, 'ms');
          clearInterval(progressMonitor);
          // The race condition will handle this
        }
      }, progressCheckIntervalMs);

      // Device-aware timeout calculation
      // On native devices, operations are slower, so be more generous with timeouts
      // NOTE: Storage now uses Web Cache API (instant), so timeout is primarily for network fetches
      const estimatedTileCount = Math.min(this.offlineMaxTilesPerDownload, 200);
      const baseTimeoutPerTile = isNative ? 300 : 200; // 300ms per tile on device (network only now), 200ms on web
      const minTimeout = isNative ? 60000 : 45000; // 60s min on device, 45s on web
      const timeoutMs = Math.max(minTimeout, estimatedTileCount * baseTimeoutPerTile);
      
      console.log('[ChatPage.download] Device-aware timeout settings (Cache API enabled):', {
        isNative,
        estimatedTileCount,
        baseTimeoutPerTile,
        minTimeout,
        calculatedTimeoutMs: timeoutMs
      });

      const summary = await Promise.race([
        downloadPromise,
        new Promise<any>((_, reject) => {
          setTimeout(() => {
            clearInterval(progressMonitor);
            const message = `Download timeout after ${timeoutMs}ms. Completed: ${lastProgressPercentage}%.${
              isNative ? ' On device, try: 1) Reduce Max Tiles to 30-50, 2) Use lower zoom levels (10-15), 3) Check network connection.' 
              : ' Check your network connection.'
            }`;
            reject(new Error(message));
          }, timeoutMs);
        })
      ]);

      clearInterval(progressMonitor);
      
      console.log('[ChatPage.download] Download completed with summary:', summary);
      this.offlineDownloadStatusText = `Offline tiles ready. Downloaded: ${summary.downloaded}, cached: ${summary.cached}, failed: ${summary.failed}.`;
      this.refreshOfflineAreaList();
      this.baseTileLayer?.redraw();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const displayMessage = errorMsg.includes('timeout') 
        ? `Download timeout. Try: 1) Lower zoom levels, 2) Reduce Max Tiles to 30, 3) Ensure good network connection. Details: ${errorMsg}`
        : `Download failed: ${errorMsg}`;
      
      this.offlineDownloadStatusText = displayMessage;
      console.error('[ChatPage.download] Download error:', error);
      console.error('[ChatPage.download] Error details:', {
        name: (error as any)?.name,
        message: (error as any)?.message,
        stack: (error as any)?.stack,
        timeSinceStart: Date.now() - lastProgressTime
      });
      alert(displayMessage);
    } finally {
      this.offlineDownloadInProgress = false;
      console.log('[ChatPage.download] Download finished. offlineDownloadInProgress set to false.');
    }
  }

async clearOfflineMapCache(): Promise<void> {
  const confirmed = confirm('Clear all offline map tiles? This cannot be undone.');
  if (!confirmed) {
    return;
  }

  try {
    await this.offlineMapTileService.clearAllTiles();
    this.refreshOfflineAreaList();
    this.offlineDownloadProgressPct = 0;
    this.offlineDownloadStatusText = 'Offline map cache cleared.';
    this.baseTileLayer?.redraw();
  } catch (error) {
    console.error('[ChatPage.offlineMap] Failed to clear offline tile cache.', error);
    alert('Failed to clear offline map cache. See console for details.');
  }
}

private refreshOfflineAreaList(): void {
  this.downloadedOfflineAreas = this.offlineMapTileService.listOfflineAreas();
}

private getEffectiveOfflineMode(): boolean {
  return this.offlineModeEnabled || !this.connectivityOnline;
}

private applyEffectiveTileLayerMode(): void {
  this.baseTileLayer?.setOfflineMode(this.getEffectiveOfflineMode());
}

private async waitMs(durationMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, durationMs));
  });
}

private setMapBootstrapStatus(
  message: string,
  autoHideAfterMs?: number,
  tone: 'loading' | 'success' | 'offline' | 'warning' = 'loading'
): void {
  this.mapBootstrapStatusText = message;
  this.mapBootstrapStatusTone = tone;
  this.mapBootstrapStatusVisible = true;

  if (this.mapBootstrapStatusHideTimeoutId) {
    clearTimeout(this.mapBootstrapStatusHideTimeoutId);
    this.mapBootstrapStatusHideTimeoutId = undefined;
  }

  if (autoHideAfterMs && autoHideAfterMs > 0) {
    this.mapBootstrapStatusHideTimeoutId = setTimeout(() => {
      this.mapBootstrapStatusVisible = false;
      this.mapBootstrapStatusHideTimeoutId = undefined;
    }, autoHideAfterMs);
  }
}

private hideMapBootstrapStatus(): void {
  if (this.mapBootstrapStatusHideTimeoutId) {
    clearTimeout(this.mapBootstrapStatusHideTimeoutId);
    this.mapBootstrapStatusHideTimeoutId = undefined;
  }
  this.mapBootstrapStatusVisible = false;
}

getMapBootstrapToneIcon(): string {
  switch (this.mapBootstrapStatusTone) {
    case 'success':
      return 'checkmark-circle';
    case 'offline':
      return 'cloud-offline';
    case 'warning':
      return 'warning';
    case 'loading':
    default:
      return 'sync';
  }
}

private async maybePromptForLocationActivation(): Promise<void> {
  try {
    const permission = await Geolocation.checkPermissions();
    const fineGranted = permission.location === 'granted';
    const coarseGranted = permission.coarseLocation === 'granted';
    if (fineGranted || coarseGranted) {
      return;
    }
  } catch {
    return;
  }

  if (!this.locationPromptShownOnce) {
    alert('Please activate location for best map accuracy. The map will continue with cached data while waiting.');
    this.locationPromptShownOnce = true;
  }

  await this.waitMs(this.mapLocationActivationGraceMs);
}

private async getInitialCoordinatesWithTimeout(timeoutMs: number = 4500): Promise<{ latitude: number; longitude: number } | null> {
  try {
    // First, try to get current coordinates with timeout
    const coordinates = await Promise.race<
      { latitude: number; longitude: number } | null
    >([
      this.getCurrentCoordinates(),
      this.waitMs(timeoutMs).then(() => null)
    ]);
    
    if (coordinates) {
      console.log('[ChatPage.getInitialCoordinatesWithTimeout] Current location obtained successfully:', coordinates);
      return coordinates;
    }

    // If current coordinates failed or timed out, try stored location
    console.log('[ChatPage.getInitialCoordinatesWithTimeout] Current location unavailable, checking stored location...');
    const storedLocation = this.getStoredUserLocation();
    if (storedLocation) {
      console.log('[ChatPage.getInitialCoordinatesWithTimeout] Using stored location:', storedLocation);
      return storedLocation;
    }

    // No stored location available
    console.log('[ChatPage.getInitialCoordinatesWithTimeout] No stored location available; will use fallback coordinates.');
    return null;
  } catch (error) {
    console.error('[ChatPage.getInitialCoordinatesWithTimeout] Error getting coordinates:', error);
    // Try stored location as fallback
    const storedLocation = this.getStoredUserLocation();
    if (storedLocation) {
      console.log('[ChatPage.getInitialCoordinatesWithTimeout] Exception occurred; using stored location:', storedLocation);
      return storedLocation;
    }
    return null;
  }
}

private renderLocalMarkerCacheImmediately(): void {
  // Load markers from localStorage synchronously - NO DELAYS
  this.officeLocationMarkerData = this.loadOfficeMarkerDataFromLocalStorage();
  this.renderStoredOfficeLocationMarkers();
  
  const markerCount = this.officeLocationMarkerData.length;
  if (markerCount > 0) {
    this.setMapBootstrapStatus(`Loaded ${markerCount} local marker(s).`, undefined, 'success');
    console.log('[ChatPage.markerCache] Local markers rendered immediately without waiting for internet.');
  } else {
    this.setMapBootstrapStatus('Loading markers from offline cache...', undefined, 'loading');
  }
}

private async probeOnlineAfterStaggerWindow(): Promise<boolean> {
  this.setMapBootstrapStatus('Checking network availability...', undefined, 'loading');
  await this.waitMs(this.mapOnlineProbeDelayMs);

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }

  try {
    const probeUrl = this.offlineMapTileService.buildTileUrl(this.osmTileTemplate, 1, 1, 1, this.offlineTileSubdomains);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.mapOnlineProbeTimeoutMs);
    try {
      await fetch(probeUrl, {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    return true;
  } catch {
    return typeof navigator !== 'undefined' ? navigator.onLine !== false : false;
  }
}

private async runStaggeredOnlineBootstrap(bootstrapId: number): Promise<void> {
  // IMPORTANT: Local markers are ALREADY rendered at this point
  // This method only handles online refresh in the background
  
  const isOnline = await this.probeOnlineAfterStaggerWindow();
  if (bootstrapId !== this.mapBootstrapSequence) {
    return;
  }

  this.connectivityOnline = isOnline;
  this.applyEffectiveTileLayerMode();

  if (!isOnline) {
    this.offlineDownloadStatusText = 'Offline detected. Using locally stored tiles and markers.';
    this.setMapBootstrapStatus('Offline mode active. Using local map cache.', 2600, 'offline');
    console.log('[ChatPage.mapBootstrap] Offline mode - local markers remain visible.');
    return;
  }

  // Check if user location is available - required for smart marker filtering
  const hasUserLocation = this.currentUserLocation !== null || this.getStoredUserLocation() !== null;
  
  if (!hasUserLocation) {
    console.log('[ChatPage.mapBootstrap] Online but no user location available. Skipping Firebase marker fetch. Using local cache.');
    this.offlineDownloadStatusText = 'Online but no location available. Using local marker cache.';
    this.setMapBootstrapStatus('Awaiting location data...', undefined, 'loading');
    return;
  }

  // Online detected AND location available: refresh markers in the background WITHOUT blocking the map
  this.offlineDownloadStatusText = 'Online detected. Fetching markers from Firebase...';
  this.setMapBootstrapStatus('Online detected. Fetching map markers...', undefined, 'loading');
  
  // Short delay before checking for fresh markers (let network stabilize)
  await this.waitMs(this.mapOnlineMarkerRefreshDelayMs);
  if (bootstrapId !== this.mapBootstrapSequence) {
    return;
  }

  // Refresh markers in background - don't block UI
  this.refreshMarkersFromOnlineInBackground(bootstrapId).catch((error) => {
    console.warn('[ChatPage.mapBootstrap] Unexpected error in background refresh:', error);
  });
}

private async refreshMarkersFromOnlineInBackground(bootstrapId: number): Promise<void> {
  // This runs AFTER local markers are already displayed
  // Refresh marker data from Firestore if online AND location is available
  console.log('[ChatPage.markerRefresh] Starting background marker refresh from Firestore');
  
  try {
    const previousMarkersCount = this.officeLocationMarkerData.length;
    
    // Verify location is available before attempting Firebase fetch
    const hasUserLocation = this.currentUserLocation !== null || this.getStoredUserLocation() !== null;
    
    if (!hasUserLocation) {
      console.log('[ChatPage.markerRefresh] No user location available - skipping Firebase fetch, keeping local cache.');
      this.offlineDownloadStatusText = 'Waiting for location. Using local marker cache.';
      this.setMapBootstrapStatus('Location unavailable. Using cached markers.', 2200, 'warning');
      return;
    }
    
    // Fetch fresh markers from Firestore (only fetches when online AND location is available)
    await this.fetchOfficeLocationMarkerData();
    
    // Verify the bootstrap is still current (map wasn't closed/recreated)
    if (bootstrapId !== this.mapBootstrapSequence) {
      console.log('[ChatPage.markerRefresh] Bootstrap ID mismatch - skipping UI update due to map recreation.');
      return;
    }
    
    // Re-render markers on the map with fresh data
    this.renderStoredOfficeLocationMarkers();
    
    // Refresh map display after marker updates
    if (this.map) {
      try {
        console.log('[ChatPage.markerRefresh] Refreshing map display after marker update...');
        // Invalidate map size to ensure proper rendering
        this.map.invalidateSize();
        
        // If user location is available, optionally center map on user location
        const userLocation = this.currentUserLocation || this.getStoredUserLocation();
        if (userLocation) {
          this.map.setView([userLocation.latitude, userLocation.longitude], this.map.getZoom());
          console.log('[ChatPage.markerRefresh] Map view refreshed centered on user location.');
        }
      } catch (mapRefreshError) {
        console.warn('[ChatPage.markerRefresh] Error refreshing map display:', mapRefreshError);
      }
    }
    
    const newMarkersCount = this.officeLocationMarkerData.length;
    const markerUpdate = newMarkersCount === previousMarkersCount 
      ? `${newMarkersCount} markers (unchanged)` 
      : `${previousMarkersCount} → ${newMarkersCount} markers (updated)`;
    
    this.offlineDownloadStatusText = `Markers refreshed from Firebase: ${markerUpdate}`;
    this.setMapBootstrapStatus(`Online markers loaded: ${markerUpdate}`, 2200, 'success');
    console.log('[ChatPage.markerRefresh] Background marker refresh completed successfully.', {
      previousCount: previousMarkersCount,
      newCount: newMarkersCount,
      source: 'Firebase',
      mapRefreshed: true
    });
  } catch (error) {
    console.warn('[ChatPage.markerRefresh] Firebase fetch failed - reverting to locally cached markers.', error);
    
    // Ensure we have local marker data as fallback
    this.officeLocationMarkerData = this.loadOfficeMarkerDataFromLocalStorage();
    
    // Verify the bootstrap is still current before updating UI
    if (bootstrapId !== this.mapBootstrapSequence) {
      return;
    }
    
    // Re-render with local markers
    this.renderStoredOfficeLocationMarkers();
    
    this.offlineDownloadStatusText = 'Firebase fetch failed. Using local marker cache.';
    this.setMapBootstrapStatus('Using locally cached markers.', 2600, 'warning');
  }
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

    if (this.userID) {
      this.refreshCacheWarmStatus(this.userID);
      this.userPrefetchCache.warmUserDataInBackground(this.userID, 'chat-page-initialize').finally(() => {
        this.refreshCacheWarmStatus(this.userID || '');
      });
    }

    if (!this.chatsSub) {
      this.startUserChatsSubscription().catch((err) => {
        console.warn('[ChatPage.initialize] Deferred chat list subscription failed:', err);
      });
    }

    // Start presence service (RTDB -> Firestore sync)
    try { this.presenceService.start(); } catch (e) { console.warn('PresenceService.start failed', e); }
  } catch (err) {
    console.warn('[ChatPage] initialize error', err);
  }
}

private resolveCachedUid(): string {
  const currentUid = this.auth3.getCurrentUser()?.uid || this.userID || '';
  if (currentUid) {
    return currentUid;
  }

  try {
    const userDataRaw = localStorage.getItem('userData');
    if (!userDataRaw) return '';
    const userData = JSON.parse(userDataRaw);
    return userData?.userID || '';
  } catch {
    return '';
  }
}

private refreshCacheWarmStatus(userId: string): void {
  if (!userId) {
    this.cacheWarmStatusText = 'Not synced';
    return;
  }

  this.cacheWarmStatusText = this.userPrefetchCache.getLastWarmLabel(userId);
}

private async resolveCurrentUid(timeoutMs: number = 8000): Promise<string | null> {
  const directUid = this.auth3.getCurrentUser()?.uid || this.userID || null;
  if (directUid) {
    this.userID = directUid;
    return directUid;
  }

  try {
    const authedUser = await this.auth3.waitForAuthUser(timeoutMs);
    const waitedUid = authedUser?.uid || null;
    if (waitedUid) {
      this.userID = waitedUid;
    }
    return waitedUid;
  } catch (error) {
    console.warn('[ChatPage] Failed to resolve current UID from auth state:', error);
    return null;
  }
}

private async startUserChatsSubscription(): Promise<void> {
  const uid = await this.resolveCurrentUid();
  if (!uid) {
    return;
  }

  try { this.chatsSub?.unsubscribe(); } catch {}

  this.chatsSub = this.chatService.getUserChats(uid).subscribe(async (chats) => {
    const hydratedChats = await this.hydrateChatsForDisplay(chats || [], uid);
    this.chats = hydratedChats;
    this.userPrefetchCache.storeChats(uid, hydratedChats as any);
    this.refreshCacheWarmStatus(uid);

    // Keep the open header in sync when profile/presence changes in Firestore.
    if (this.activeChat?.chatId) {
      const updated = hydratedChats.find((c) => c.chatId === this.activeChat.chatId);
      if (updated) {
        this.activeChat = { ...this.activeChat, ...updated };
      }
    }
  });
}

private resolveTimestampToMillis(timestamp: any): number {
  if (!timestamp) return 0;
  if (typeof timestamp?.toMillis === 'function') return timestamp.toMillis();
  if (typeof timestamp?.seconds === 'number') return timestamp.seconds * 1000;
  if (typeof timestamp === 'number') return timestamp;
  return 0;
}

private composeUserDisplayName(user: any): string {
  if (!user) return '';
  const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
  return fullName || user?.name || user?.displayName || user?.email || '';
}

private async getUserProfileById(userId: string): Promise<any | null> {
  if (!userId) return null;
  if (this.userProfileCache.has(userId)) {
    return this.userProfileCache.get(userId);
  }

  try {
    const userRef = doc(this.firestore, 'users', userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      this.userProfileCache.set(userId, null);
      return null;
    }

    const profile = { id: userSnap.id, ...(userSnap.data() as any) };
    this.userProfileCache.set(userId, profile);
    return profile;
  } catch (error) {
    console.warn('[ChatPage] Failed to load user profile for chat participant:', userId, error);
    return null;
  }
}

private async hydrateChatsForDisplay(rawChats: Chat[], currentUid: string): Promise<any[]> {
  const hydrated = await Promise.all(
    (rawChats || []).map(async (chat: any) => {
      const clearedAtMillis = this.resolveTimestampToMillis(chat?.clearedBy?.[currentUid]);
      const lastActivityMillis = this.resolveTimestampToMillis(chat?.timestamp);
      if (clearedAtMillis > 0 && lastActivityMillis <= clearedAtMillis) {
        return null;
      }

      const participants = Array.isArray(chat?.participants) ? chat.participants : [];
      const otherParticipantId = participants.find((participantId: string) => participantId && participantId !== currentUid) || null;
      const otherProfile = otherParticipantId ? await this.getUserProfileById(otherParticipantId) : null;

      const nameFromProfile = this.composeUserDisplayName(otherProfile);
      const avatarFromProfile = otherProfile?.photoURL || otherProfile?.avatar || otherProfile?.avatarUrl || null;

      return {
        ...chat,
        id: otherParticipantId || chat?.chatId,
        otherParticipantId,
        name: chat?.name || nameFromProfile || otherParticipantId || chat?.chatId,
        avatar: chat?.avatar || avatarFromProfile,
        isOnline: Boolean(otherProfile?.isOnline)
      };
    })
  );

  return hydrated.filter((chat) => Boolean(chat)).sort((a, b) => {
    const tA = this.resolveTimestampToMillis(a?.timestamp);
    const tB = this.resolveTimestampToMillis(b?.timestamp);
    return tB - tA;
  });
}

private upsertChatPreview(chatPreview: any): void {
  if (!chatPreview?.chatId) return;
  const existingIndex = this.chats.findIndex((chat) => chat.chatId === chatPreview.chatId);

  if (existingIndex >= 0) {
    const existingChat = this.chats[existingIndex];
    this.chats.splice(existingIndex, 1);
    this.chats.unshift({ ...existingChat, ...chatPreview });
    return;
  }

  this.chats.unshift(chatPreview);
}

private subscribeToTypingState(chatId: string, currentUid: string): void {
  try { this.typingSub?.unsubscribe(); } catch {}

  this.typingSub = this.chatService.observeTyping(chatId).subscribe((typingStates: TypingState[]) => {
    this.isOtherUserTyping = (typingStates || []).some(
      (state) => state.userId !== currentUid && state.isTyping
    );
  });
}

private async updateTypingState(isTyping: boolean): Promise<void> {
  const chatId = this.currentChatId;
  const currentUid = this.auth3.getCurrentUser()?.uid || this.userID || '';
  if (!chatId || !currentUid) return;

  try {
    await this.chatService.setTypingState(chatId, currentUid, isTyping);
  } catch (error) {
    console.warn('[ChatPage] Unable to update typing state:', error);
  }
}

private async resetTypingStateForCurrentUser(): Promise<void> {
  if (this.typingDebounceTimeoutId) {
    clearTimeout(this.typingDebounceTimeoutId);
    this.typingDebounceTimeoutId = undefined;
  }

  await this.updateTypingState(false);
  this.isOtherUserTyping = false;
}

onMessageDraftChange(value: string): void {
  this.messageText = value;
  const hasDraft = (value || '').trim().length > 0;

  if (this.typingDebounceTimeoutId) {
    clearTimeout(this.typingDebounceTimeoutId);
  }

  this.typingDebounceTimeoutId = setTimeout(() => {
    this.updateTypingState(hasDraft).catch((error) => {
      console.warn('[ChatPage] Debounced typing update failed:', error);
    });
  }, hasDraft ? this.typingDebounceMs : 0);
}

onMessageInputBlur(): void {
  this.updateTypingState(false).catch((error) => {
    console.warn('[ChatPage] Failed to clear typing state on blur:', error);
  });
}

isMessageDelivered(message: Message): boolean {
  return Boolean(message?.deliveredAt || message?.timestamp);
}

getMessageStatusLabel(message: Message): 'Sent' | 'Delivered' | 'Read' {
  if (message?.isRead) return 'Read';
  if (this.isMessageDelivered(message)) return 'Delivered';
  return 'Sent';
}


  // Additional methods can be added here
onMsgBubbleTap(message: Message): void {
  this.tappedMessageId = this.tappedMessageId === (message.id ?? null) ? null : (message.id ?? null);
}


  /** Navigate to legacy camera page route. */
  goToHomePage() {
    this.router.navigate(['/home-page2']);
    console.log('camera page');
  }

  async onFindEngineerStoryClick(): Promise<void> {
    console.log('[ChatPage.findEngineerStory] Find Engineer story tapped. Navigating to map tab...');
    this.setNav('location');

    const mapInstance = await this.ensureMapReadyForLocationTab();
    if (!mapInstance) {
      console.warn('[ChatPage.findEngineerStory] Unable to initialize map after switching to location tab.');
      return;
    }

    const coordinates = await this.getCurrentCoordinates();
    if (!coordinates) {
      console.warn('[ChatPage.findEngineerStory] Current coordinates unavailable; square will not be drawn.');
      return;
    }

    const center = L.latLng(coordinates.latitude, coordinates.longitude);
    await this.markUserLocation(mapInstance, coordinates);
    this.drawMarkerCenteredSquare(center, 'story-item', 'Find Engineer Story');

    try {
      mapInstance.setView(center, 16);
    } catch (err) {
      console.warn('[ChatPage.findEngineerStory] Failed to center map view after drawing square.', err);
    }

    console.log('[ChatPage.findEngineerStory] Current location square drawn from story tap.', {
      latitude: Number(center.lat.toFixed(6)),
      longitude: Number(center.lng.toFixed(6))
    });
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
    const cacheUid = this.resolveCachedUid();
    if (cacheUid && this.engineers.length === 0) {
      const cachedEngineers = this.userPrefetchCache.getCachedEngineers(cacheUid);
      if (cachedEngineers.length > 0) {
        this.engineers = [...cachedEngineers];
      }
    }

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
      if (cacheUid) {
        this.userPrefetchCache.storeEngineers(cacheUid, arr);
        this.refreshCacheWarmStatus(cacheUid);
      }
      console.log('[ChatPage] Engineers fetched from Firestore:', this.engineers);
    } catch (err) {
      console.error('[ChatPage] Error fetching engineers:', err);
      this.engineers = [];
    }
  }

  /** Handle selecting an engineer from search results: create chat and subscribe messages */
  async selectEngineer(user: any) {
    console.log('[ChatPage] Engineer selected:', user);

    const selectedId = user?.id || user?.uid || user?.userID || user?.email;
    const selectedName = user?.firstName
      ? `${user.firstName} ${user?.lastName || ''}`.trim()
      : (user?.name || user?.email || 'Unknown User');
    const selectedAvatar = user?.photoURL || user?.avatar || null;

    if (!selectedId) {
      console.warn('[ChatPage] Missing selected engineer/user id from search result payload:', user);
      this.currentChatId = null;
      return;
    }

    const currentUid = await this.resolveCurrentUid();
    if (!currentUid) {
      console.warn('[ChatPage] Missing current user uid; cannot bind backend chat yet.');
      this.currentChatId = null;
      return;
    }

    // Open conversation container immediately to match expected UX on tap.
    this.activeChat = {
      id: selectedId,
      otherParticipantId: selectedId,
      name: selectedName,
      avatar: selectedAvatar,
      isOnline: Boolean(user?.isOnline),
      lastMessage: '',
      timestamp: null
    };
    this.isSearching = false;
    this.isChatOpen = true;
    this.messages = [];
    this.isOtherUserTyping = false;
    try { document.body.classList.add('chat-open'); } catch {}

    try {
      // ensure chat document exists and get deterministic chatId
      const chat = await this.chatService.createOrEnsureChat(currentUid, selectedId);
      const selectedProfile = await this.getUserProfileById(selectedId);
      const resolvedName = this.composeUserDisplayName(selectedProfile) || selectedName;
      const resolvedAvatar = selectedProfile?.photoURL || selectedProfile?.avatar || selectedProfile?.avatarUrl || selectedAvatar;

      const chatPreview = {
        chatId: chat.chatId,
        participants: chat.participants,
        id: selectedId,
        otherParticipantId: selectedId,
        name: resolvedName,
        avatar: resolvedAvatar,
        isOnline: Boolean(selectedProfile?.isOnline),
        lastMessage: '',
        timestamp: null
      };

      this.activeChat = chatPreview;
      this.isSearching = false;
      this.isChatOpen = true;
      this.messages = [];
      this.isOtherUserTyping = false;

      this.upsertChatPreview(chatPreview);

      await this.subscribeToChatMessages(chat.chatId, currentUid);
      this.subscribeToTypingState(chat.chatId, currentUid);
      console.log('[ChatPage] Opened chat', chat.chatId);
    } catch (error) {
      console.error('[ChatPage] Failed to bind backend chat for selected user:', error);
      const errorCode = (error as any)?.code || '';
      if (errorCode === 'permission-denied' || errorCode === 'firestore/permission-denied') {
        alert('Chat access is blocked by Firestore security rules. Deploy the updated firestore.rules, then try again.');
      }
      this.currentChatId = null;
    }
  }

  private async subscribeToChatMessages(chatId: string, currentUid: string): Promise<void> {
    this.currentChatId = chatId;
    try { this.messagesSub?.unsubscribe(); } catch {}

    this.messagesSub = this.chatService.getMessages(chatId).subscribe(async (msgs) => {
      this.messages = msgs || [];
      const unread = this.messages.filter(m => !m.isRead && m.senderId !== currentUid && m.id);
      for (const m of unread) {
        try { await this.chatService.markMessageAsRead(chatId, m.id!); } catch (e) { console.warn('markMessageAsRead failed', e); }
      }
    });
  }

  /** Send a message in the current chat */
  async sendMessage() {
    if (!this.currentChatId) return;
    const senderId = this.auth3.getCurrentUser()?.uid || this.userID || '';
    if (!senderId) return;
    const text = (this.messageText || '').trim();
    if (!text) return;
    try {
      await this.updateTypingState(false);
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
    console.log('[ChatPage.logout] Logout initiated');
    
    // Close sidebar immediately to provide user feedback
    this.isSidebarOpen = false;
    
    // Get current user ID before we start clearing
    const currentUserId = this.userID || this.auth3.getCurrentUser()?.uid || '';
    
    // Clear all user-related data
    try {
      await this.clearAllUserData(currentUserId);
    } catch (error) {
      console.error('[ChatPage.logout] Error during data cleanup:', error);
    }

    // Clear sync state for user
    if (currentUserId) {
      this.clearSyncStateForUser(currentUserId);
    }
    
    this.syncStatusState = 'idle';
    this.syncStatusText = 'Not synced';
    this.cacheWarmStatusText = 'Not synced';
    
    try {
      await this.auth3.logout();
    } catch {}
    
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

  /**
   * Centralized function to clear ALL user-related data from local and session storage.
   * Called on logout to ensure no user data persists for the next login.
   * Also validates and removes sessions/images that don't match the current user ID.
   */
  private async clearAllUserData(userId: string): Promise<void> {
    console.log('[ChatPage.clearAllUserData] Beginning complete user data cleanup', { userId });

    // Clear localStorage keys
    const localStorageKeys = [
      this.STORAGE_KEYS.isLoggedIn,
      this.STORAGE_KEYS.userData,
      this.STORAGE_KEYS.userProfile,
      this.STORAGE_KEYS.currentSessionId,
      this.STORAGE_KEYS.currentUserId,
      // User-specific keys (old format compatibility)
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
        console.warn(`[ChatPage.clearAllUserData] Failed to remove localStorage key: ${key}`, e);
      }
    }

    // Clear sessionStorage keys
    const sessionStorageKeys = [
      this.STORAGE_KEYS.userProfile,
      this.STORAGE_KEYS.isLoggedInSession,
      'userProfile',
      'isLoggedInSession'
    ];

    for (const key of sessionStorageKeys) {
      try {
        sessionStorage.removeItem(key);
      } catch (e) {
        console.warn(`[ChatPage.clearAllUserData] Failed to remove sessionStorage key: ${key}`, e);
      }
    }

    // Clear user-specific storage keys (dynamic keys based on userId)
    if (userId) {
      const userSpecificKeys = [
        `user_sync_status_${userId}`,
        `user_sync_bootstrap_done_${userId}`,
        `user_current_location_${userId}`,
        `office-location-markers-${userId}`
      ];

      for (const key of userSpecificKeys) {
        try {
          localStorage.removeItem(key);
          sessionStorage.removeItem(key);
        } catch (e) {
          console.warn(`[ChatPage.clearAllUserData] Failed to remove user-specific key: ${key}`, e);
        }
      }
    }

    // Clear sessions and images from ImageStorageService
    try {
      if (this.imageStorage && typeof this.imageStorage.clear === 'function') {
        await this.imageStorage.clear();
        console.log('[ChatPage.clearAllUserData] Cleared all images from storage');
      }
    } catch (e) {
      console.warn('[ChatPage.clearAllUserData] Failed to clear images', e);
    }

    // Clear sessions from Ionic Storage
    try {
      if ((this.imageStorage as any)._storage) {
        await (this.imageStorage as any)._storage?.remove('stored_image_sessions');
        console.log('[ChatPage.clearAllUserData] Cleared all sessions from storage');
      }
    } catch (e) {
      console.warn('[ChatPage.clearAllUserData] Failed to clear sessions', e);
    }

    console.log('[ChatPage.clearAllUserData] Complete user data cleanup finished');
  }

  /**
   * Validate that a session/attachment belongs to the current user.
   * If it doesn't, log a warning and return false.
   * This is used to prevent accidental cross-user data access.
   */
  private validateSessionBelongsToCurrentUser(session: any): boolean {
    const currentUserId = this.auth3.getCurrentUser()?.uid || this.userID;
    const sessionUserId = session?.userId;

    if (!currentUserId || !sessionUserId) {
      console.warn('[ChatPage.validateSessionBelongsToCurrentUser] Cannot validate - missing current or session userId', {
        currentUserId,
        sessionUserId,
        sessionId: session?.id
      });
      return false;
    }

    if (currentUserId !== sessionUserId) {
      console.error('[ChatPage.validateSessionBelongsToCurrentUser] SECURITY: Session belongs to different user!', {
        currentUserId,
        sessionUserId,
        sessionId: session?.id
      });
      return false;
    }

    return true;
  }

  /**
   * Delete a session and all its associated images if they don't belong to the current user.
   * This prevents accidental exposure of other users' data.
   */
  private async deleteSessionIfMismatchedUser(session: any): Promise<void> {
    if (this.validateSessionBelongsToCurrentUser(session)) {
      return; // Session belongs to current user, don't delete
    }

    console.warn('[ChatPage.deleteSessionIfMismatchedUser] Deleting mismatched session', {
      sessionId: session?.id,
      sessionUserId: session?.userId,
      currentUserId: this.userID || this.auth3.getCurrentUser()?.uid
    });

    try {
      // Clean up session images if imageStorage has removeImage method
      if (session?.imageKeys && Array.isArray(session.imageKeys)) {
        for (const imageKey of session.imageKeys) {
          try {
            // Attempt to remove the image through storage service
            if (this.imageStorage && typeof (this.imageStorage as any).removeImage === 'function') {
              await (this.imageStorage as any).removeImage(imageKey);
            }
          } catch (error) {
            console.warn('[ChatPage.deleteSessionIfMismatchedUser] Failed to delete image', { imageKey, error });
          }
        }
      }

      console.log('[ChatPage.deleteSessionIfMismatchedUser] Session marked for deletion', { sessionId: session?.id });
      // Note: Complete session deletion would require service endpoints
      // For now, we log the issue and prevent the session from being used
    } catch (error) {
      console.error('[ChatPage.deleteSessionIfMismatchedUser] Failed to process mismatched session', {
        sessionId: session?.id,
        error
      });
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

  openRadiusSelectionOverlay(): void {
    this.selectedRadiusHalfSideMeters = this.markerSquareHalfSideMeters;
    this.isRadiusSelectionOverlayOpen = true;
  }

  closeRadiusSelectionOverlay(): void {
    this.isRadiusSelectionOverlayOpen = false;
  }

  async confirmRadiusSelection(): Promise<void> {
    const selectedHalfSideMeters = Number(this.selectedRadiusHalfSideMeters);
    if (!Number.isFinite(selectedHalfSideMeters) || selectedHalfSideMeters <= 0) {
      alert('Please select a valid radius size.');
      return;
    }

    this.markerSquareHalfSideMeters = selectedHalfSideMeters;
    this.isRadiusSelectionOverlayOpen = false;
    await this.aggregateMarkersWithinSelectedRadius();
  }

  private resolveRadiusAggregationCenter(): { latitude: number; longitude: number; source: 'selected-engineer' | 'map-center' | 'default-center' } {
    if (this.selectedMapEngineer && typeof this.selectedMapEngineer === 'object') {
      const selectedCenter = this.resolveOfficeMarkerCoordinates(this.selectedMapEngineer as Record<string, unknown>);
      if (selectedCenter) {
        return {
          ...selectedCenter,
          source: 'selected-engineer'
        };
      }
    }

    if (this.map) {
      const mapCenter = this.map.getCenter();
      return {
        latitude: mapCenter.lat,
        longitude: mapCenter.lng,
        source: 'map-center'
      };
    }

    return {
      ...this.defaultRadiusAggregationCenter,
      source: 'default-center'
    };
  }

  private buildRadiusSquareBounds(centerLatitude: number, centerLongitude: number, halfSideMeters: number): RadiusSquareBounds {
    const metersPerDegreeLat = 111_320;
    const cosLat = Math.cos((centerLatitude * Math.PI) / 180);
    const metersPerDegreeLng = Math.max(1, Math.abs(cosLat) * 111_320);

    const deltaLat = halfSideMeters / metersPerDegreeLat;
    const deltaLng = halfSideMeters / metersPerDegreeLng;

    const top = { latitude: centerLatitude + deltaLat, longitude: centerLongitude };
    const bottom = { latitude: centerLatitude - deltaLat, longitude: centerLongitude };
    const left = { latitude: centerLatitude, longitude: centerLongitude - deltaLng };
    const right = { latitude: centerLatitude, longitude: centerLongitude + deltaLng };

    return {
      center: { latitude: centerLatitude, longitude: centerLongitude },
      top,
      bottom,
      left,
      right,
      southWest: { latitude: bottom.latitude, longitude: left.longitude },
      northEast: { latitude: top.latitude, longitude: right.longitude }
    };
  }

  private calculateDistanceMeters(
    startLatitude: number,
    startLongitude: number,
    endLatitude: number,
    endLongitude: number
  ): number {
    const toRadians = (value: number): number => (value * Math.PI) / 180;
    const earthRadiusMeters = 6_371_000;
    const deltaLat = toRadians(endLatitude - startLatitude);
    const deltaLng = toRadians(endLongitude - startLongitude);
    const lat1 = toRadians(startLatitude);
    const lat2 = toRadians(endLatitude);

    const haversine =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const arc = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
    return earthRadiusMeters * arc;
  }

  /**
   * Load user location from localStorage and start background fetching of markers.
   * Checks if user has location enabled and fetches markers within radius bounds.
   */
  private loadUserLocationAndStartBackgroundFetch(userId: string): void {
    try {
      const locationKey = `user_sidebar_location_${userId}`;
      const storedLocation = localStorage.getItem(locationKey);

      if (!storedLocation) {
        console.log('[ChatPage.backgroundFetch] No stored user location found.', { locationKey });
        return;
      }

      this.currentUserLocation = JSON.parse(storedLocation);
      console.log('[ChatPage.backgroundFetch] User location loaded from storage:', {
        latitude: this.currentUserLocation?.latitude,
        longitude: this.currentUserLocation?.longitude
      });

      // Start background fetch interval
      this.startBackgroundMarkerFetch();
    } catch (error) {
      console.error('[ChatPage.backgroundFetch] Failed to load user location:', error);
    }
  }

  /**
   * Start a background interval to fetch markers within the user's location radius.
   * Runs every 10 seconds if user location is available.
   * Automatically stops when location is not available.
   */
  private startBackgroundMarkerFetch(): void {
    if (this.isBackgroundLocationFetchActive) {
      console.log('[ChatPage.backgroundFetch] Background fetch already active.');
      return;
    }

    if (!this.currentUserLocation) {
      console.warn('[ChatPage.backgroundFetch] Cannot start background fetch without user location.');
      return;
    }

    this.isBackgroundLocationFetchActive = true;
    console.log('[ChatPage.backgroundFetch] Starting background marker fetch interval (every 10 seconds)');

    this.backgroundLocationFetchInterval = setInterval(async () => {
      if (!this.currentUserLocation) {
        console.log('[ChatPage.backgroundFetch] User location no longer available. Stopping interval.');
        this.stopBackgroundMarkerFetch();
        return;
      }

      try {
        await this.fetchMarkersWithinUserLocationRadius();
      } catch (error) {
        console.error('[ChatPage.backgroundFetch] Error fetching markers in background:', error);
      }
    }, 10000); // Fetch every 10 seconds
  }

  /**
   * Stop the background marker fetch interval.
   */
  private stopBackgroundMarkerFetch(): void {
    if (this.backgroundLocationFetchInterval) {
      clearInterval(this.backgroundLocationFetchInterval);
      this.backgroundLocationFetchInterval = undefined;
      this.isBackgroundLocationFetchActive = false;
      console.log('[ChatPage.backgroundFetch] Background marker fetch stopped.');
    }
  }

  /**
   * Get the localStorage key for storing the current user's location.
   * Scoped to the current user to avoid cross-user data leaks.
   */
  private getUserLocationStorageKey(): string {
    const userId = this.userID || this.auth3.getCurrentUser()?.uid || 'unknown_user';
    return `user_current_location_${userId}`;
  }

  /**
   * Fetch current user location and save it locally if available.
   * Called during initialization to populate the stored location.
   */
  private async getAndSaveCurrentLocation(): Promise<{ latitude: number; longitude: number } | null> {
    try {
      console.log('[ChatPage.getAndSaveCurrentLocation] Attempting to fetch and save current location...');
      const location = await this.getCurrentCoordinates();
      
      if (location && (location.latitude !== this.fallbackCoordinates.latitude || location.longitude !== this.fallbackCoordinates.longitude)) {
        // Location was successfully fetched (not fallback)
        try {
          const storageKey = this.getUserLocationStorageKey();
          localStorage.setItem(storageKey, JSON.stringify({
            latitude: location.latitude,
            longitude: location.longitude,
            timestamp: new Date().toISOString()
          }));
          console.log('[ChatPage.getAndSaveCurrentLocation] Current location saved to localStorage:', {
            latitude: location.latitude,
            longitude: location.longitude
          });
        } catch (storageError) {
          console.warn('[ChatPage.getAndSaveCurrentLocation] Failed to save location to localStorage:', storageError);
        }
        return location;
      } else {
        console.log('[ChatPage.getAndSaveCurrentLocation] Location is fallback coordinates; skipping storage.');
        return location;
      }
    } catch (error) {
      console.error('[ChatPage.getAndSaveCurrentLocation] Error fetching current location:', error);
      return null;
    }
  }

  /**
   * Load the user's location from localStorage if available.
   */
  private getStoredUserLocation(): { latitude: number; longitude: number } | null {
    try {
      const storageKey = this.getUserLocationStorageKey();
      const storedData = localStorage.getItem(storageKey);
      if (!storedData) {
        console.log('[ChatPage.getStoredUserLocation] No stored location found.');
        return null;
      }

      const parsed = JSON.parse(storedData);
      console.log('[ChatPage.getStoredUserLocation] Location loaded from storage:', {
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        timestamp: parsed.timestamp
      });
      return {
        latitude: parsed.latitude,
        longitude: parsed.longitude
      };
    } catch (error) {
      console.error('[ChatPage.getStoredUserLocation] Error loading stored location:', error);
      return null;
    }
  }

  /**
   * Fetch markers from Firestore that fall within the bounding box around the user's current location.
   * Calculates top, bottom, left, right boundaries and filters markers based on these bounds.
   * Results are stored in officeLocationMarkerData array.
   */
  private async fetchMarkersWithinUserLocationRadius(): Promise<void> {
    if (!this.currentUserLocation) {
      console.warn('[ChatPage.fetchMarkersWithinUserLocationRadius] No user location available.');
      return;
    }

    const { latitude, longitude } = this.currentUserLocation;
    console.log('[ChatPage.fetchMarkersWithinUserLocationRadius] Fetching markers for center position:', {
      latitude,
      longitude,
      radiusMeters: this.markerSquareHalfSideMeters
    });

    try {
      // Fetch all markers from Firestore
      await this.fetchOfficeLocationMarkerData();

      // Calculate bounding box around user location
      const bounds = this.buildRadiusSquareBounds(latitude, longitude, this.markerSquareHalfSideMeters);

      // Filter markers that fall within the calculated bounds
      const markersWithinBounds = this.officeLocationMarkerData.filter((marker) => (
        marker.latitude <= bounds.top.latitude &&
        marker.latitude >= bounds.bottom.latitude &&
        marker.longitude >= bounds.left.longitude &&
        marker.longitude <= bounds.right.longitude
      ));

      console.log('[ChatPage.fetchMarkersWithinUserLocationRadius] Markers aggregated within radius bounds:', {
        centerLatitude: latitude,
        centerLongitude: longitude,
        topBoundLatitude: bounds.top.latitude,
        bottomBoundLatitude: bounds.bottom.latitude,
        leftBoundLongitude: bounds.left.longitude,
        rightBoundLongitude: bounds.right.longitude,
        totalMarkersInRadius: markersWithinBounds.length,
        totalMarkersLoaded: this.officeLocationMarkerData.length,
        markersDetails: markersWithinBounds.map((marker) => ({
          id: marker.id,
          latitude: marker.latitude,
          longitude: marker.longitude,
          payload: marker.payload
        }))
      });
    } catch (error) {
      console.error('[ChatPage.fetchMarkersWithinUserLocationRadius] Failed to fetch markers:', error);
    }
  }

  private getOfficeMarkerUserId(marker: OfficeLocationMarkerData): string | null {
    const markerUserIdRaw = marker.payload['userId'] || marker.payload['uid'] || marker.payload['userID'];
    if (typeof markerUserIdRaw !== 'string') return null;
    const trimmed = markerUserIdRaw.trim();
    return trimmed || null;
  }

  private mergeMarkerAndUserForMapSheet(
    marker: OfficeLocationMarkerData & { distanceFromCenterMeters: number; markerTitle: string },
    associatedUser: any,
    resolvedUserId: string | null
  ): any {
    return {
      ...(associatedUser && typeof associatedUser === 'object' ? associatedUser : {}),
      id: associatedUser?.id || associatedUser?.uid || associatedUser?.userID || resolvedUserId || undefined,
      uid: associatedUser?.uid || associatedUser?.id || associatedUser?.userID || resolvedUserId || undefined,
      userID: associatedUser?.userID || associatedUser?.uid || associatedUser?.id || resolvedUserId || undefined,
      markerId: marker.id,
      markerPayload: marker.payload,
      markerTitle: marker.markerTitle,
      latitude: marker.latitude,
      longitude: marker.longitude,
      distanceFromCenterMeters: marker.distanceFromCenterMeters
    };
  }

  private async aggregateMarkersForMapSheet(centerLatitude: number, centerLongitude: number): Promise<any[]> {
    await this.fetchOfficeLocationMarkerData();

    const bounds = this.buildRadiusSquareBounds(centerLatitude, centerLongitude, this.markerSquareHalfSideMeters);
    const markersInsideBounds = this.officeLocationMarkerData.filter((marker) => (
      marker.latitude <= bounds.top.latitude &&
      marker.latitude >= bounds.bottom.latitude &&
      marker.longitude >= bounds.left.longitude &&
      marker.longitude <= bounds.right.longitude
    ));

    const enrichedMarkers = await Promise.all(markersInsideBounds.map(async (marker) => {
      const resolvedUserId = this.getOfficeMarkerUserId(marker);
      const associatedUser = resolvedUserId ? await this.fetchUserProfileByUserId(resolvedUserId) : null;
      return {
        ...marker,
        markerTitle: this.buildOfficeMarkerTitle(marker),
        associatedUser,
        resolvedUserId,
        distanceFromCenterMeters: this.calculateDistanceMeters(
          centerLatitude,
          centerLongitude,
          marker.latitude,
          marker.longitude
        )
      };
    }));

    this.aggregatedRadiusMarkerData = enrichedMarkers;
    this.lastRadiusAggregationBounds = bounds;

    return enrichedMarkers.map((marker) => this.mergeMarkerAndUserForMapSheet(marker, marker.associatedUser, marker.resolvedUserId));
  }

  /**
   * Unified handler for aggregating markers and displaying them in the map sheet.
   * Called when clicking on a marker OR clicking on the map.
   * Draws the radius square, fetches aggregated markers, and displays results.
   */
  private async handleLocationClickForMapAggregation(
    latitude: number,
    longitude: number,
    trigger: 'click' | 'touchend' | 'story-item',
    titleText: string
  ): Promise<void> {
    const center = L.latLng(latitude, longitude);

    // Draw the marker-centered square
    try {
      this.drawMarkerCenteredSquare(center, trigger, titleText);
    } catch (squareError) {
      console.error('[ChatPage.aggregation] Failed to draw marker square', {
        trigger,
        titleText,
        squareError
      });
    }

    // Aggregate markers within the radius
    const aggregatedMapSheetItems = await this.aggregateMarkersForMapSheet(latitude, longitude);
    this.mapSheetAggregatedEngineers = aggregatedMapSheetItems;

    // Display aggregated results
    if (aggregatedMapSheetItems.length > 1) {
      this.selectedMapEngineer = aggregatedMapSheetItems[0];
      this.mapSheetViewMode = 'list';
      this.isMapBottomSheetActive = true;
      console.log('[ChatPage.mapAggregation] Multiple engineers found. Opening list view.', {
        trigger,
        titleText,
        aggregatedCount: aggregatedMapSheetItems.length,
        center: { latitude: Number(center.lat.toFixed(6)), longitude: Number(center.lng.toFixed(6)) }
      });
      return;
    }

    if (aggregatedMapSheetItems.length === 1) {
      this.mapSheetViewMode = 'detail';
      this.selectedMapEngineer = aggregatedMapSheetItems[0];
      this.isMapBottomSheetActive = true;
      console.log('[ChatPage.mapAggregation] Single engineer found. Opening detail view.', {
        trigger,
        titleText,
        center: { latitude: Number(center.lat.toFixed(6)), longitude: Number(center.lng.toFixed(6)) }
      });
      return;
    }

    // No engineers found - show fallback
    const fallback = {
      markerTitle: titleText,
      latitude,
      longitude,
      name: titleText
    };
    this.mapSheetViewMode = 'detail';
    this.openMapMarkerBottomSheet(fallback);
    console.log('[ChatPage.mapAggregation] No engineers found. Opening detail view with fallback.', {
      trigger,
      titleText,
      center: { latitude: Number(center.lat.toFixed(6)), longitude: Number(center.lng.toFixed(6)) }
    });
  }

  private async onOfficeMarkerSelectedForMapSheet(marker: L.Marker, titleText: string, trigger: 'click' | 'touchend'): Promise<void> {
    const markerCenter = marker.getLatLng();
    // Use the unified handler for aggregation and display
    await this.handleLocationClickForMapAggregation(markerCenter.lat, markerCenter.lng, trigger, titleText);
  }

  async aggregateMarkersWithinSelectedRadius(): Promise<void> {
    const center = this.resolveRadiusAggregationCenter();
    const aggregatedMapSheetItems = await this.aggregateMarkersForMapSheet(center.latitude, center.longitude);

    if (this.map) {
      this.drawMarkerCenteredSquare(L.latLng(center.latitude, center.longitude), 'story-item', 'Radius Selection Area');
    }

    this.mapSheetAggregatedEngineers = aggregatedMapSheetItems;
    if (aggregatedMapSheetItems.length > 1) {
      this.mapSheetViewMode = 'list';
      this.selectedMapEngineer = aggregatedMapSheetItems[0];
      this.isMapBottomSheetActive = true;
    } else if (aggregatedMapSheetItems.length === 1) {
      this.mapSheetViewMode = 'detail';
      this.selectedMapEngineer = aggregatedMapSheetItems[0];
      this.isMapBottomSheetActive = true;
    }

    console.log('[ChatPage.radiusAggregation] Aggregated markers inside selected radius bounds', {
      center,
      centerSource: center.source,
      selectedHalfSideMeters: this.markerSquareHalfSideMeters,
      top: this.lastRadiusAggregationBounds ? {
        latitude: Number(this.lastRadiusAggregationBounds.top.latitude.toFixed(6)),
        longitude: Number(this.lastRadiusAggregationBounds.top.longitude.toFixed(6))
      } : null,
      bottom: this.lastRadiusAggregationBounds ? {
        latitude: Number(this.lastRadiusAggregationBounds.bottom.latitude.toFixed(6)),
        longitude: Number(this.lastRadiusAggregationBounds.bottom.longitude.toFixed(6))
      } : null,
      left: this.lastRadiusAggregationBounds ? {
        latitude: Number(this.lastRadiusAggregationBounds.left.latitude.toFixed(6)),
        longitude: Number(this.lastRadiusAggregationBounds.left.longitude.toFixed(6))
      } : null,
      right: this.lastRadiusAggregationBounds ? {
        latitude: Number(this.lastRadiusAggregationBounds.right.latitude.toFixed(6)),
        longitude: Number(this.lastRadiusAggregationBounds.right.longitude.toFixed(6))
      } : null,
      totalMarkersLoaded: this.officeLocationMarkerData.length,
      aggregatedMarkersCount: this.aggregatedRadiusMarkerData.length,
      aggregatedMarkers: this.aggregatedRadiusMarkerData.map((marker) => ({
        id: marker.id,
        latitude: marker.latitude,
        longitude: marker.longitude,
        distanceFromCenterMeters: Number(marker.distanceFromCenterMeters.toFixed(2)),
        resolvedUserId: marker.resolvedUserId,
        payload: marker.payload
      }))
    });

    alert(`Radius updated to ${this.markerSquareHalfSideMeters}m. Aggregated ${this.aggregatedRadiusMarkerData.length} marker(s) inside the selected area.`);
  }

  openMarkerCreationOverlay(): void {
    if (this.markerOverlayElement) return;

    const overlay = document.createElement('div');
    overlay.className = 'map-overlay map-overlay--dim';

    const panel = document.createElement('div');
    panel.className = 'map-overlay-panel';

    const title = document.createElement('h3');
    title.textContent = 'Create map marker';
    title.className = 'map-overlay-title';

    const latInput = document.createElement('input');
    latInput.type = 'number';
    latInput.placeholder = 'Latitude (e.g. 10.324849)';
    latInput.step = 'any';
    latInput.className = 'map-overlay-input';

    const lngInput = document.createElement('input');
    lngInput.type = 'number';
    lngInput.placeholder = 'Longitude (e.g. 123.849164)';
    lngInput.step = 'any';
    lngInput.className = 'map-overlay-input';

    const message = document.createElement('div');
    message.className = 'map-overlay-message';

    const actions = document.createElement('div');
    actions.className = 'map-overlay-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'map-overlay-btn map-overlay-btn--secondary';

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.textContent = 'Create Marker';
    createBtn.className = 'map-overlay-btn map-overlay-btn--primary';

    actions.appendChild(cancelBtn);
    actions.appendChild(createBtn);

    panel.appendChild(title);
    panel.appendChild(latInput);
    panel.appendChild(lngInput);
    panel.appendChild(message);
    panel.appendChild(actions);
    overlay.appendChild(panel);

    const dismiss = () => {
      try { document.body.removeChild(overlay); } catch {}
      if (this.markerOverlayElement === overlay) {
        this.markerOverlayElement = undefined;
      }
    };

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) dismiss();
    });

    panel.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    cancelBtn.addEventListener('click', () => dismiss());

    const createMarkerFromInput = async () => {
      const latitude = Number.parseFloat(latInput.value);
      const longitude = Number.parseFloat(lngInput.value);

      if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        message.textContent = 'Please enter valid numeric latitude and longitude.';
        return;
      }

      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        message.textContent = 'Latitude must be -90..90 and longitude must be -180..180.';
        return;
      }

      if (!this.map) {
        await this.initMap();
      }

      if (!this.map) {
        console.error('[ChatPage.openMarkerCreationOverlay] Map initialization failed');
        message.textContent = 'Initializing map. Please try again in a moment.';
        return;
      }

      const customMarker = L.marker([latitude, longitude])
        .addTo(this.map)
        .bindPopup(`Marker: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`)
        .openPopup();
      this.bindMarkerSelectionTrigger(customMarker, 'Marker Selection Overlay');

      this.map.setView([latitude, longitude], 15);
      console.log('[ChatPage.openMarkerCreationOverlay] Custom marker created:', { latitude, longitude });
      dismiss();
    };

    createBtn.addEventListener('click', () => { void createMarkerFromInput(); });
    latInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        lngInput.focus();
      }
    });
    lngInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void createMarkerFromInput();
      }
    });

    // document.body.appendChild(overlay);
    this.markerOverlayElement = overlay;
    latInput.focus();
  }

  async openMarkerSelectionOverlay(titleText: string = 'Engineer Selection Overlay'): Promise<void> {
    console.log('[ChatPage.markerSelection] openMarkerSelectionOverlay requested', {
      titleText,
      hasOverlayRef: !!this.markerSelectionOverlayElement,
      engineersCached: this.engineers.length
    });

    if (this.markerSelectionOverlayElement) {
      const isMounted = document.body.contains(this.markerSelectionOverlayElement);
      const isVisible = isMounted && this.isElementVisiblyRendered(this.markerSelectionOverlayElement);
      console.log('[ChatPage.markerSelection] Existing overlay reference detected', { isMounted, isVisible });

      if (isMounted && isVisible) {
        console.log('[ChatPage.markerSelection] Overlay is already open; skipping duplicate render.');
        return;
      }

      try { document.body.removeChild(this.markerSelectionOverlayElement); } catch {}
      this.markerSelectionOverlayElement = undefined;
      console.warn('[ChatPage.markerSelection] Cleared stale overlay reference before rendering a new one.');
    }

    if (!this.engineers.length) {
      try { await this.fetchEngineers(); } catch (err) { console.warn('[ChatPage] fetchEngineers in marker overlay failed', err); }
    }

    const options = (this.engineers.length ? this.engineers : this.searchConversationResults) || [];
    const optionsSource = this.engineers.length ? 'firestore-engineers' : 'placeholder-results';
    console.log('[ChatPage.markerSelection] Preparing overlay options', {
      source: optionsSource,
      count: options.length
    });

    const overlay = document.createElement('div');
    overlay.className = 'marker-selection-overlay';

    const wrap = document.createElement('div');
    wrap.className = 'marker-selection-wrap';

    const panel = document.createElement('div');
    panel.className = 'marker-selection-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', titleText || 'Engineer selection');

    const list = document.createElement('div');
    list.className = 'marker-selection-list';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'marker-selection-close-btn';
    closeBtn.textContent = 'Close';

    this.applyMarkerSelectionOverlayInlineStyles(overlay, wrap, panel, list, closeBtn);

    const dismiss = (reason: 'button' | 'backdrop' | 'selection' = 'button') => {
      console.log('[ChatPage.markerSelection] Closing overlay', { reason });
      try { document.body.removeChild(overlay); } catch {}
      if (this.markerSelectionOverlayElement === overlay) {
        this.markerSelectionOverlayElement = undefined;
      }
    };

    if (!options.length) {
      const empty = document.createElement('div');
      empty.textContent = 'No engineers available.';
      empty.className = 'marker-selection-empty';
      Object.assign(empty.style, {
        textAlign: 'center',
        color: '#636363',
        padding: '24px 12px',
        fontSize: '0.95rem'
      });
      list.appendChild(empty);
    } else {
      for (const [optionIndex, option] of options.entries()) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'marker-selection-item';

        const avatar = document.createElement('div');
        avatar.className = 'marker-selection-avatar';

        const avatarUrl = option?.photoURL || option?.avatar;
        if (avatarUrl) {
          const img = document.createElement('img');
          img.src = avatarUrl;
          img.alt = 'avatar';
          img.className = 'marker-selection-avatar-image';
          Object.assign(img.style, {
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          });
          avatar.appendChild(img);
        } else {
          const initials = (option?.initials || this.getInitials(option?.firstName ? `${option.firstName} ${option?.lastName || ''}` : option?.name || option?.email || 'U')).toUpperCase();
          const initialText = document.createElement('span');
          initialText.textContent = initials;
          initialText.className = 'marker-selection-avatar-initials';
          Object.assign(initialText.style, {
            color: '#1f1f1f',
            fontWeight: '700',
            fontSize: window.innerWidth <= 640 ? '0.95rem' : '1rem'
          });
          avatar.appendChild(initialText);
        }

        const info = document.createElement('div');
        info.className = 'marker-selection-info';

        const name = document.createElement('div');
        const displayName = option?.firstName
          ? `${option.firstName} ${option?.lastName || ''}`.trim()
          : (option?.name || option?.email || 'Unknown User');
        name.textContent = displayName;
        name.className = 'marker-selection-name';

        const sub = document.createElement('div');
        const contact = option?.phoneNumber
          || option?.phone
          || option?.contactNumber
          || option?.mobile
          || option?.mobileNumber
          || option?.telephone
          || option?.tel
          || option?.contact
          || 'Phone Number';
        sub.textContent = contact;
        sub.className = 'marker-selection-sub';

        this.applyMarkerSelectionItemInlineStyles(item, avatar, info, name, sub);

        item.addEventListener('pointerenter', () => {
          item.style.filter = 'brightness(0.98)';
        });
        item.addEventListener('pointerleave', () => {
          item.style.filter = '';
          item.style.transform = '';
        });
        item.addEventListener('pointerdown', () => {
          item.style.transform = 'scale(0.99)';
        });
        item.addEventListener('pointerup', () => {
          item.style.transform = '';
        });

        info.appendChild(name);
        info.appendChild(sub);
        item.appendChild(avatar);
        item.appendChild(info);

        item.addEventListener('click', async () => {
          const selectedId = option?.id || option?.uid || option?.userID || option?.email || 'unknown';
          const selectedPayload = {
            source: optionsSource,
            selectedIndex: optionIndex,
            selectedId,
            selectedName: displayName,
            selectedContact: contact,
            selectedItemData: option
          };

          console.log('[ChatPage.markerSelection] Engineer row tapped', selectedPayload);
          dismiss('selection');

          // Start chat directly from the exact selected marker list item.
          try {
            await this.selectEngineer(option);
            console.log('[ChatPage.markerSelection] Chat start requested from marker selection', {
              selectedId,
              selectedName: displayName,
              selectedIndex: optionIndex,
              source: optionsSource
            });
          } catch (error) {
            console.error('[ChatPage.markerSelection] Failed to start chat from marker selection', {
              selectedId,
              selectedIndex: optionIndex,
              source: optionsSource,
              error
            });
          }
        });

        list.appendChild(item);
      }
    }

    closeBtn.addEventListener('click', () => dismiss('button'));

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) dismiss('backdrop');
    });

    panel.addEventListener('click', (event) => event.stopPropagation());

    panel.appendChild(list);
    panel.appendChild(closeBtn);
    wrap.appendChild(panel);
    overlay.appendChild(wrap);

    // Append the overlay to the body and keep a reference for future checks/removal.
    // document.body.appendChild(overlay);
    this.markerSelectionOverlayElement = overlay;

    const rect = panel.getBoundingClientRect();
    const overlayComputedStyle = window.getComputedStyle(overlay);
    console.log('[ChatPage.markerSelection] Overlay rendered', {
      isMounted: document.body.contains(overlay),
      isVisible: this.isElementVisiblyRendered(overlay),
      optionsCount: options.length,
      panelTop: Math.round(rect.top),
      panelLeft: Math.round(rect.left),
      panelWidth: Math.round(rect.width),
      panelHeight: Math.round(rect.height),
      overlayPosition: overlayComputedStyle.position,
      overlayZIndex: overlayComputedStyle.zIndex,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    });

    try { closeBtn.focus(); } catch {}
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

  /**
   * Resolve the actual recipient UID for copy-session flow.
   * Handles either a direct UID or a composite chatId format like: uidA_uidB.
   * Uses current logged-in UID to select the "other" participant.
   */
  private extractOriginalUserIdFromReceiverUserId(): void {
    if (!this.receiverUserId || typeof this.receiverUserId !== 'string') {
      console.warn('[ChatPage.extractOriginalUserIdFromReceiverUserId] receiverUserId is not a valid string:', this.receiverUserId);
      return;
    }

    const rawReceiver = String(this.receiverUserId).trim();
    const currentUid = (this.auth3.getCurrentUser()?.uid || this.userID || '').trim();
    let extractedRecipient: string | null = null;

    // If already a direct UID (not composite), use as-is.
    if (!rawReceiver.includes('_')) {
      extractedRecipient = rawReceiver;
    } else {
      // Primary path: chatId usually looks like "uidA_uidB".
      // Pick the participant that is not the current user.
      const directParts = rawReceiver.split('_').map((p) => p.trim()).filter(Boolean);
      if (currentUid) {
        const other = directParts.find((p) => p !== currentUid);
        if (other) extractedRecipient = other;
      }

      // Fallback for IDs containing underscores: match by prefix/suffix against current UID.
      if (!extractedRecipient && currentUid) {
        const currentPrefix = `${currentUid}_`;
        const currentSuffix = `_${currentUid}`;
        if (rawReceiver.startsWith(currentPrefix)) {
          extractedRecipient = rawReceiver.slice(currentPrefix.length).trim();
        } else if (rawReceiver.endsWith(currentSuffix)) {
          extractedRecipient = rawReceiver.slice(0, rawReceiver.length - currentSuffix.length).trim();
        }
      }

      // Last fallback when current UID is unavailable: keep legacy behavior.
      if (!extractedRecipient && directParts.length > 0) {
        extractedRecipient = directParts[0];
      }
    }

    if (!extractedRecipient) {
      console.warn('[ChatPage.extractOriginalUserIdFromReceiverUserId] Could not extract original user ID from receiverUserId:', this.receiverUserId);
      return;
    }

    // Normalize both fields so subsequent copy/session code paths use the resolved recipient UID.
    this.newRecepientUserId = extractedRecipient;
    this.receiverUserId = extractedRecipient;

    console.log('[ChatPage.extractOriginalUserIdFromReceiverUserId] Extracted recipient user ID:', {
      rawReceiverUserId: rawReceiver,
      currentUid,
      newRecepientUserId: this.newRecepientUserId,
      receiverUserId: this.receiverUserId
    });
  }

  /**
   * Extract the recipient/other user ID from a chat object.
   * Tries multiple property names and logs the process for debugging.
   */
  private extractReceiverUserIdFromChat(chat: any): string | null {
    if (!chat || typeof chat !== 'object') {
      console.warn('[ChatPage.extractReceiverUserIdFromChat] Invalid chat object:', chat);
      return null;
    }

    console.log('[ChatPage.extractReceiverUserIdFromChat] Attempting to extract receiver ID from chat:', chat);

    // Try different property names in order
    const propertyNames = ['userId', 'otherUserId', 'uid', 'userID', 'receiverId', 'recipientId'];
    for (const prop of propertyNames) {
      if (chat[prop] && typeof chat[prop] === 'string' && chat[prop].trim()) {
        console.log(`[ChatPage.extractReceiverUserIdFromChat] Found receiver ID in '.${prop}': ${chat[prop]}`);
        return chat[prop];
      }
    }

    // If not found in top-level properties, try nested objects
    if (chat.chatUser && chat.chatUser.id) {
      console.log('[ChatPage.extractReceiverUserIdFromChat] Found receiver ID in .chatUser.id:', chat.chatUser.id);
      return chat.chatUser.id;
    }

    if (chat.otherUser && chat.otherUser.id) {
      console.log('[ChatPage.extractReceiverUserIdFromChat] Found receiver ID in .otherUser.id:', chat.otherUser.id);
      return chat.otherUser.id;
    }

    // Last resort: log all properties to help debugging
    console.warn('[ChatPage.extractReceiverUserIdFromChat] Could not extract receiver ID. Chat object properties:');
    console.warn('  Full chat object:', JSON.stringify(chat, null, 2));
    console.warn('  Top-level keys:', Object.keys(chat));
    
    return null;
  }

  closeSidebar() {
    this.isSidebarOpen = false;
  }

  /** Open the conversation view for a selected chat */
  async openChat(chat: any) {
    this.activeChat = chat || { name: 'Chat' };
    this.isChatOpen = true;
    this.isSearching = false;
    this.messages = [];
    this.isOtherUserTyping = false;
    try { document.body.classList.add('chat-open'); } catch {}

    const currentUid = await this.resolveCurrentUid();
    // For chat-list, chatId is always present
    const chatId = chat?.chatId;
    
    // Extract recipient user ID using the helper function.
    this.receiverUserId = this.extractReceiverUserIdFromChat(chat);
    if (!this.receiverUserId && typeof chatId === 'string') {
      this.receiverUserId = chatId;
    }
    console.log('receiverUserId extracted from chat:', this.receiverUserId);

    // Extract original user ID from receiverUserId (split by underscore)
    this.extractOriginalUserIdFromReceiverUserId();
    
    // Log user ID information when chat is opened
    console.log('[ChatPage.openChat] Chat item selected:', {
      currentUserId: currentUid,
      chatId: chatId,
      receiverUserId: this.receiverUserId,
      chatObject: chat
    });
    
    // Store receiver ID on activeChat for later use in confirmAttachmentDebugAction
    if (this.activeChat && this.receiverUserId) {
      this.activeChat._recipientUserId = this.receiverUserId;
    }
    
    if (!currentUid || !chatId) {
      this.currentChatId = null;
      return;
    }
    try {
      const hydrated = await this.hydrateChatsForDisplay([chat], currentUid);
      if (hydrated.length > 0) {
        this.activeChat = hydrated[0];
        // Preserve recipient ID after hydration
        if (this.activeChat && this.receiverUserId) {
          this.activeChat._recipientUserId = this.receiverUserId;
        }
      }
      await this.subscribeToChatMessages(chatId, currentUid);
      this.subscribeToTypingState(chatId, currentUid);
    } catch (error) {
      console.warn('[ChatPage.openChat] Unable to load chat history for selected chat:', error);
      this.currentChatId = null;
    }
  }

  /** Close the conversation view and return to the chat list preview */
  closeChat() {
    this.resetTypingStateForCurrentUser().catch(() => {});
    try { this.typingSub?.unsubscribe(); } catch {}
    this.typingSub = undefined;
    try { this.messagesSub?.unsubscribe(); } catch {}
    this.messagesSub = undefined;
    if (this.typingDebounceTimeoutId) {
      clearTimeout(this.typingDebounceTimeoutId);
      this.typingDebounceTimeoutId = undefined;
    }
    this.isOtherUserTyping = false;
    this.currentChatId = null;
    this.isChatOpen = false;
    this.activeChat = null;
    try { document.body.classList.remove('chat-open'); } catch {}
  }

  openNewChat(): void {
    this.isSearching = true; // Activate search mode
    setTimeout(() => {
      const searchInput = document.querySelector('.search-bar input') as HTMLInputElement;
      if (searchInput) {
        searchInput.focus(); // Focus on the search input field
      }
    }, 0);
  }

  /** Switch bottom navigation tab and update view state. */
  /**
   * Trigger offline tile download with default values.
   * Uses configured offlineMinZoom, offlineMaxZoom, and offlineMaxTilesPerDownload.
   */
  private async triggerOfflineDownloadWithDefaults(): Promise<void> {
    if (this.offlineDownloadInProgress) {
      console.log('[ChatPage.offlineDownload] Offline download already in progress. Skipping duplicate request.');
      return;
    }
    
    console.log('[ChatPage.offlineDownload] Triggering offline tile download with default values:', {
      minZoom: this.offlineMinZoom,
      maxZoom: this.offlineMaxZoom,
      maxTiles: this.offlineMaxTilesPerDownload
    });
    
    try {
      await this.downloadVisibleMapAreaOffline();
    } catch (error) {
      console.error('[ChatPage.offlineDownload] Error triggering offline download:', error);
    }
  }

  setNav(tab: 'person' | 'people' | 'location' | 'settings' | 'profile') {
    if (this.isChatOpen) {
      this.closeChat();
    }

    this.activeTab = tab;

    // Ensure the main chat preview is shown when selecting person or people
    if (tab === 'person' || tab === 'people') {
      this.isSearching = false;
      this.dismissMapTapOverlay();
      this.destroyMapInstance();
      this.stopMapRefreshTimer();
    }

    // Selecting location will show the Map view (ensure no chat overlay is open)
    if (tab === 'location') {
      this.isSearching = false;
      this.handleMapResizeOnReentry();
      this.scheduleMapInitialization();
      // Start periodic map refresh when entering location tab
      this.startMapRefreshTimer();
      // Trigger offline tile download in background (with default values)
      void this.triggerOfflineDownloadWithDefaults();
    } else if (tab === 'settings' || tab === 'profile') {
      this.dismissMapTapOverlay();
      this.destroyMapInstance();
      this.stopMapRefreshTimer();
    }
  }

  private destroyMapInstance(): void {
    if (!this.map) return;
    this.mapBootstrapSequence += 1;
    this.hideMapBootstrapStatus();
    this.baseTileLayer = undefined;
    try {
      this.map.remove();
    } catch (error) {
      console.warn('[ChatPage.destroyMapInstance] Failed to remove map instance cleanly.', error);
    }
    this.markerSelectionSquare = undefined;
    this.map = null;
    this.userLocationMarker = undefined;
    this.officeLocationLeafletMarkers = [];
  }

  private bindMarkerSelectionTrigger(marker: L.Marker, titleText: string): void {
    marker.off('click');
    marker.off('touchend');

    const openOverlay = (trigger: 'click' | 'touchend') => {
      void this.onOfficeMarkerSelectedForMapSheet(marker, titleText, trigger)
        .then(() => {
          console.log('[ChatPage.markerSelection] Marker interaction processed for map sheet', { trigger, titleText });
        })
        .catch((err) => {
          console.error('[ChatPage.markerSelection] Marker interaction failed for map sheet', {
            trigger,
            titleText,
            err
          });
        });
    };

    marker.on('click', () => openOverlay('click'));
    marker.on('touchend', () => openOverlay('touchend'));
  }

  private handleMapTapCoordinates(latitude: number, longitude: number, source: 'click' | 'touchend'): void {
    const roundedLatitude = Number(latitude.toFixed(6));
    const roundedLongitude = Number(longitude.toFixed(6));
    console.log(`[ChatPage.mapTap] ${source} trigger detected:`, {
      latitude: roundedLatitude,
      longitude: roundedLongitude
    });
    // Use the same unified aggregation handler as marker clicks
    void this.handleLocationClickForMapAggregation(roundedLatitude, roundedLongitude, source, 'Map Click Location');
  }

  private handleMapTap(event: L.LeafletMouseEvent): void {
    this.handleMapTapCoordinates(event.latlng.lat, event.latlng.lng, 'click');
  }

  private bindMapTapCapture(): void {
    if (!this.map) return;
    console.log('[ChatPage.bindMapTapCapture] Binding click/touch map listeners for tap-marker overlay.');
    this.map.off('click');
    this.map.off('touchend');
    this.map.on('click', (event: L.LeafletMouseEvent) => this.handleMapTap(event));
    this.map.on('touchend', (event: any) => {
      const touchLatLng = event?.latlng;
      if (!touchLatLng) {
        console.warn('[ChatPage.mapTap] touchend detected but no latlng was provided by Leaflet.', event);
        return;
      }
      this.handleMapTapCoordinates(touchLatLng.lat, touchLatLng.lng, 'touchend');
    });
  }

  private openMapTapMarkerOverlay(initialLatitude: number, initialLongitude: number): void {
    console.log('[ChatPage.mapTapOverlay] Triggered for tapped coordinates:', {
      latitude: initialLatitude,
      longitude: initialLongitude
    });
    if (!this.map) {
      console.warn('[ChatPage.mapTapOverlay] Not opened because map is not initialized.');
      return;
    }

    if (this.mapTapOverlayElement) {
      const isMounted = document.body.contains(this.mapTapOverlayElement);
      const isVisible = isMounted && this.isElementVisiblyRendered(this.mapTapOverlayElement);

      if (!isMounted || !isVisible) {
        console.warn('[ChatPage.mapTapOverlay] Overlay state exists but is not visibly rendered. Recreating overlay.', {
          isMounted,
          isVisible
        });
        this.dismissMapTapOverlay();
      } else {
        console.log('[ChatPage.mapTapOverlay] Already open; skipping duplicate trigger.');
        return;
      }
    }

    const overlay = document.createElement('div');
    overlay.className = 'map-overlay map-overlay--dim';

    const panel = document.createElement('div');
    panel.className = 'map-overlay-panel';

    const title = document.createElement('h3');
    title.textContent = 'Place marker from tapped position';
    title.className = 'map-overlay-title';

    const lngInput = document.createElement('input');
    lngInput.type = 'number';
    lngInput.placeholder = 'Longitude (from tap)';
    lngInput.step = 'any';
    lngInput.value = initialLongitude.toFixed(6);
    lngInput.className = 'map-overlay-input';

    const latInput = document.createElement('input');
    latInput.type = 'number';
    latInput.placeholder = 'Latitude (from tap)';
    latInput.step = 'any';
    latInput.value = initialLatitude.toFixed(6);
    latInput.className = 'map-overlay-input';

    const message = document.createElement('div');
    message.className = 'map-overlay-message';

    const actions = document.createElement('div');
    actions.className = 'map-overlay-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'map-overlay-btn map-overlay-btn--secondary';

    const placeBtn = document.createElement('button');
    placeBtn.type = 'button';
    placeBtn.textContent = 'Place Marker';
    placeBtn.className = 'map-overlay-btn map-overlay-btn--primary';

    actions.appendChild(cancelBtn);
    actions.appendChild(placeBtn);

    panel.appendChild(title);
    panel.appendChild(lngInput);
    panel.appendChild(latInput);
    panel.appendChild(message);
    panel.appendChild(actions);
    overlay.appendChild(panel);

    this.applyMapTapOverlayInlineStyles(
      overlay,
      panel,
      title,
      lngInput,
      latInput,
      message,
      actions,
      cancelBtn,
      placeBtn
    );

    const dismiss = () => {
      try { document.body.removeChild(overlay); } catch {}
      if (this.mapTapOverlayElement === overlay) {
        this.mapTapOverlayElement = undefined;
      }
    };

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) dismiss();
    });

    panel.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    cancelBtn.addEventListener('click', () => dismiss());

    // Custom icon for markers placed from map tap overlay
    const placeMarkerFromInput = () => {
      if (!this.map) {
        console.warn('[ChatPage.openMarkerSelectionOverlay] Map not ready, attempting to initialize...');
        this.initMap().then(() => {
          if (!this.map) {
            message.textContent = 'Map initialization in progress. Please try again in a moment.';
          }
        });
        return;
      }

      const latitude = Number.parseFloat(latInput.value);
      const longitude = Number.parseFloat(lngInput.value);

      if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        message.textContent = 'Please enter valid numeric latitude and longitude.';
        return;
      }

      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        message.textContent = 'Latitude must be -90..90 and longitude must be -180..180.';
        return;
      }

      console.log('[ChatPage.mapTapOverlay] Place Marker tapped with:', { latitude, longitude });

      const tappedMarker = L.marker([latitude, longitude], { icon: this.tapMarkerIcon })
        .addTo(this.map)
        .bindPopup(`Marker: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`)
        .openPopup();

      this.bindMarkerSelectionTrigger(tappedMarker, 'Marker Selection Overlay');
      this.map.setView([latitude, longitude], 15);
      console.log('[ChatPage.mapTap] marker placed from overlay:', { latitude, longitude });
      dismiss();
    };

    placeBtn.addEventListener('click', placeMarkerFromInput);
    lngInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        latInput.focus();
      }
    });
    latInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        placeMarkerFromInput();
      }
    });

    // document.body.appendChild(overlay);
    this.mapTapOverlayElement = overlay;
    console.log('[ChatPage.mapTapOverlay] Overlay opened successfully.');
    console.log('[ChatPage.mapTapOverlay] Overlay visibility snapshot:', {
      isMounted: document.body.contains(overlay),
      isVisible: this.isElementVisiblyRendered(overlay),
      rect: overlay.getBoundingClientRect().toJSON()
    });
    lngInput.focus();
  }

  // Custom icon for markers placed from map tap overlay
  private readonly tapMarkerIcon = L.icon({
    iconUrl: 'assets/map/tap-marker.png', // Place your custom marker image here
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowUrl: 'assets/map/marker-shadow2.png',
    shadowSize: [41, 41]
  });

  private handleMapResizeOnReentry(): void {
    if (!this.map) return;

    try {
      this.map.invalidateSize();
      console.log('[ChatPage.setNav] Map resize triggered on location tab re-entry (immediate).');
    } catch (error) {
      console.warn('[ChatPage.setNav] Immediate map resize failed on re-entry.', error);
    }

    if (this.mapResizeTimeoutId) {
      clearTimeout(this.mapResizeTimeoutId);
    }

    this.mapResizeTimeoutId = setTimeout(() => {
      if (this.activeTab !== 'location' || !this.map) return;
      try {
        this.map.invalidateSize();
        console.log('[ChatPage.setNav] Map resize triggered on location tab re-entry (delayed).');
      } catch (error) {
        console.warn('[ChatPage.setNav] Delayed map resize failed on re-entry.', error);
      }
    }, 180);
  }

  private scheduleMapInitialization(): void {
    this.mapInitAttempts = 0;
    const attemptInit = () => {
      if (this.activeTab !== 'location') return;

      this.mapInitAttempts += 1;
      const mapEl = document.getElementById('map');

      if (mapEl) {
        console.log('[ChatPage.setNav] Location tab active. Initializing map now.');
        void this.initMap();
        return;
      }

      if (this.mapInitAttempts < this.maxMapInitAttempts) {
        console.log('[ChatPage.setNav] Waiting for map container to render before initMap...', {
          attempt: this.mapInitAttempts,
          maxAttempts: this.maxMapInitAttempts
        });
        setTimeout(attemptInit, 75);
      } else {
        console.warn('[ChatPage.setNav] Map container still not found after retries.');
      }
    };

    setTimeout(attemptInit, 0);
  }

  private async getCurrentCoordinates(): Promise<{ latitude: number; longitude: number } | null> {
    console.log('[ChatPage.getCurrentCoordinates] Resolving current coordinates...');
    try {
      const permission = await Geolocation.checkPermissions();
      console.log('[ChatPage.getCurrentCoordinates] Permission status:', permission);
      if (permission.location !== 'granted') {
        await Geolocation.requestPermissions();
        console.log('[ChatPage.getCurrentCoordinates] Requested location permissions');
      }

      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000
      });

      console.log('[ChatPage.getCurrentCoordinates] Coordinates fetched via Capacitor:', {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      });

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };
    } catch (capacitorError) {
      console.warn('[ChatPage.getCurrentCoordinates] Capacitor geolocation failed, trying browser geolocation', capacitorError);
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve(pos),
            (err) => reject(err),
            { enableHighAccuracy: true, timeout: 15000 }
          );
        });

        console.log('[ChatPage.getCurrentCoordinates] Coordinates fetched via browser geolocation:', {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });

        return {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };
      } catch (browserError) {
        console.warn('[ChatPage.getCurrentCoordinates] Unable to get current coordinates; using fallback coordinates', {
          fallback: this.fallbackCoordinates,
          capacitorError,
          browserError
        });
        return { ...this.fallbackCoordinates };
      }
    }
  }

  /**
   * Start periodic checker to detect when internet and location services become available.
   * Runs every 7 seconds and updates map/markers/location when services recover.
   */
  private startServiceRecoveryChecker(): void {
    if (this.serviceRecoveryCheckInterval) {
      clearInterval(this.serviceRecoveryCheckInterval);
    }

    console.log('[ChatPage.startServiceRecoveryChecker] Starting periodic service recovery checker...');
    this.serviceRecoveryCheckInterval = setInterval(async () => {
      try {
        await this.checkAndRecoverServices();
      } catch (error) {
        console.error('[ChatPage.serviceRecoveryChecker] Error during check cycle:', error);
      }
    }, this.serviceRecoveryCheckMs);
  }

  /**
   * Stop the periodic service recovery checker and clean up the interval.
   */
  private stopServiceRecoveryChecker(): void {
    if (this.serviceRecoveryCheckInterval) {
      clearInterval(this.serviceRecoveryCheckInterval);
      this.serviceRecoveryCheckInterval = undefined;
      console.log('[ChatPage.stopServiceRecoveryChecker] Service recovery checker stopped.');
    }
  }

  /**
   * Check internet connectivity status using browser API and fallback methods.
   */
  private async checkInternetStatus(): Promise<boolean> {
    // Primary method: browser's navigator.onLine API
    if (!navigator.onLine) {
      return false;
    }
    
    // Additional validation: try a quick fetch to verify actual connectivity
    try {
      const response = await fetch('https://www.google.com/gen_204', {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-store'
      });
      return response.status === 204 || response.status === 0; // 0 for no-cors mode
    } catch (error) {
      // If fetch fails but navigator.onLine is true, assume connected
      console.warn('[ChatPage.checkInternetStatus] Fetch validation failed, using navigator.onLine:', navigator.onLine);
      return navigator.onLine;
    }
  }

  /**
   * Check if location services are available and accessible.
   */
  private async checkLocationStatus(): Promise<boolean> {
    try {
      const permission = await Geolocation.checkPermissions();
      return permission.location === 'granted';
    } catch (error) {
      console.warn('[ChatPage.checkLocationStatus] Failed to check location permissions:', error);
      return false;
    }
  }

  /**
   * Check for service recovery and update data if services become available.
   */
  private async checkAndRecoverServices(): Promise<void> {
    const internetNow = await this.checkInternetStatus();
    const locationNow = await this.checkLocationStatus();

    // Check if internet was unavailable but is now available
    if (!this.lastInternetStatus && internetNow) {
      console.log('[ChatPage.checkAndRecoverServices] Internet reconnected! Updating data...');
      // Trigger map refresh, fetch markers again
      try {
        await this.fetchMarkersWithinUserLocationRadius();
        console.log('[ChatPage.checkAndRecoverServices] Markers updated after internet recovery.');
      } catch (error) {
        console.error('[ChatPage.checkAndRecoverServices] Failed to update markers:', error);
      }
    }

    // Check if location was unavailable but is now available
    if (!this.lastLocationStatus && locationNow) {
      console.log('[ChatPage.checkAndRecoverServices] Location access recovered! Fetching and updating user location...');
      try {
        const coords = await this.getCurrentCoordinates();
        if (coords) {
          // Update user location marker on the map if map is initialized
          if (this.map && this.userLocationMarker) {
            this.userLocationMarker.setLatLng([coords.latitude, coords.longitude]);
            console.log('[ChatPage.checkAndRecoverServices] User location marker updated:', coords);
          }
          // Fetch markers around new location
          await this.fetchMarkersWithinUserLocationRadius();
          console.log('[ChatPage.checkAndRecoverServices] Markers updated after location recovery.');
        }
      } catch (error) {
        console.error('[ChatPage.checkAndRecoverServices] Failed to update location/markers:', error);
      }
    }

    // Update status trackers
    this.lastInternetStatus = internetNow;
    this.lastLocationStatus = locationNow;
  }

  private toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  private resolveOfficeMarkerCoordinates(payload: Record<string, unknown>): { latitude: number; longitude: number } | null {
    const directLatitude = this.toFiniteNumber(payload['latitude'] ?? payload['lat']);
    const directLongitude = this.toFiniteNumber(payload['longitude'] ?? payload['lng'] ?? payload['lon'] ?? payload['long']);

    if (
      directLatitude !== null &&
      directLongitude !== null &&
      Math.abs(directLatitude) <= 90 &&
      Math.abs(directLongitude) <= 180
    ) {
      return { latitude: directLatitude, longitude: directLongitude };
    }

    const nestedLocationCandidates = [payload['location'], payload['officeLocation'], payload['coordinates']];
    for (const locationField of nestedLocationCandidates) {
      if (!locationField || typeof locationField !== 'object') continue;

      const locationRecord = locationField as Record<string, unknown>;
      const nestedLatitude = this.toFiniteNumber(locationRecord['latitude'] ?? locationRecord['lat'] ?? locationRecord['_lat']);
      const nestedLongitude = this.toFiniteNumber(locationRecord['longitude'] ?? locationRecord['lng'] ?? locationRecord['lon'] ?? locationRecord['_long']);

      if (
        nestedLatitude !== null &&
        nestedLongitude !== null &&
        Math.abs(nestedLatitude) <= 90 &&
        Math.abs(nestedLongitude) <= 180
      ) {
        return { latitude: nestedLatitude, longitude: nestedLongitude };
      }
    }

    return null;
  }

  private buildOfficeMarkerTitle(markerData: OfficeLocationMarkerData): string {
    const nameValue = markerData.payload['name'];
    if (typeof nameValue === 'string' && nameValue.trim()) return nameValue.trim();

    const titleValue = markerData.payload['title'];
    if (typeof titleValue === 'string' && titleValue.trim()) return titleValue.trim();

    return `Office Marker ${markerData.id}`;
  }

  private clearOfficeLocationMapMarkers(): void {
    if (!this.officeLocationLeafletMarkers.length) return;

    for (const marker of this.officeLocationLeafletMarkers) {
      try {
        marker.remove();
      } catch {}
      this.markerUserProfileMap.delete(marker);
    }

    this.officeLocationLeafletMarkers = [];
  }

  private async fetchUserProfileByUserId(userId: string): Promise<any> {
    if (!userId) return null;
    
    // Check cache first
    if (this.userProfileCache.has(userId)) {
      console.log('[ChatPage.userProfile] User profile found in cache', { userId });
      return this.userProfileCache.get(userId);
    }

    try {
      console.log('[ChatPage.userProfile] Fetching user profile from Firestore', { userId });
      const userDocRef = doc(this.firestore, 'users', userId);
      const userDocSnapshot = await getDoc(userDocRef);
      
      if (userDocSnapshot.exists()) {
        const userData = userDocSnapshot.data() as any;
        this.userProfileCache.set(userId, userData);
        console.log('[ChatPage.userProfile] User profile fetched and cached', { userId, userData });
        return userData;
      } else {
        console.warn('[ChatPage.userProfile] User document does not exist', { userId });
        return null;
      }
    } catch (error) {
      console.error('[ChatPage.userProfile] Error fetching user profile', { userId, error });
      return null;
    }
  }

  private async fetchOfficeLocationMarkerData(): Promise<void> {
    const authedUser = this.auth3.getCurrentUser() ?? await this.auth3.waitForAuthUser(5000).catch(() => null);
    if (!authedUser?.uid) {
      console.warn('[ChatPage.userOfficeLocationMarker] Skipping Firebase fetch - auth user not ready. Falling back to localStorage.');
      // Try to load from localStorage as a fallback
      this.officeLocationMarkerData = this.loadOfficeMarkerDataFromLocalStorage();
      return;
    }

    try {
      console.log('[ChatPage.userOfficeLocationMarker] Fetching userOfficeLocationMarker collection from Firestore...');
      const markerCollectionRef = collection(this.firestore, 'userOfficeLocationMarker');
      const markerSnapshot = await getDocs(markerCollectionRef);
      const parsedMarkers: OfficeLocationMarkerData[] = [];

      markerSnapshot.forEach((markerDoc) => {
        const payload = (markerDoc.data() as Record<string, unknown>) ?? {};
        const coordinates = this.resolveOfficeMarkerCoordinates(payload);

        if (!coordinates) {
          console.warn('[ChatPage.userOfficeLocationMarker] Skipping document with invalid coordinates.', {
            docId: markerDoc.id,
            payload
          });
          return;
        }

        parsedMarkers.push({
          id: markerDoc.id,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          payload
        });
      });

      this.officeLocationMarkerData = parsedMarkers;
      // Save to localStorage after successful Firebase fetch
      this.saveOfficeMarkerDataToLocalStorage();
      console.log('[ChatPage.userOfficeLocationMarker] Successfully fetched and stored from Firebase.', {
        source: 'Firebase',
        totalDocuments: markerSnapshot.size,
        markersStored: parsedMarkers.length,
        markersSkipped: markerSnapshot.size - parsedMarkers.length
      });
    } catch (error) {
      const errorCode = (error as { code?: string } | null)?.code ?? 'unknown';
      if (errorCode === 'permission-denied') {
        console.error('[ChatPage.userOfficeLocationMarker] Permission denied while reading Firebase collection. Check firestore.rules for list/get read access on /userOfficeLocationMarker.', error);
      } else {
        console.error('[ChatPage.userOfficeLocationMarker] Failed to fetch from Firebase.', error);
      }
      // Fall back to localStorage data if Firestore fetch fails
      console.log('[ChatPage.userOfficeLocationMarker] Falling back to locally stored markers.');
      this.officeLocationMarkerData = this.loadOfficeMarkerDataFromLocalStorage();
    }
  }

  private renderStoredOfficeLocationMarkers(): void {
    const mapInstance = this.map;
    if (!mapInstance) {
      console.warn('[ChatPage.userOfficeLocationMarker] Render skipped because map is not initialized.');
      return;
    }

    this.clearOfficeLocationMapMarkers();

    if (!this.officeLocationMarkerData.length) {
      console.log('[ChatPage.userOfficeLocationMarker] No stored marker data available for rendering.');
      return;
    }

    for (const markerData of this.officeLocationMarkerData) {
      try {
        const markerTitle = this.buildOfficeMarkerTitle(markerData);
        const marker = L.marker([markerData.latitude, markerData.longitude], { icon: this.testMarkerIcon })
          .addTo(mapInstance)
          .bindPopup(`<strong>${markerTitle}</strong>`);

        // Fetch and cache user profile for this marker's userID
        const locationUserId = (markerData.payload['userId'] || markerData.payload['uid'] || markerData.payload['userID']) as string | undefined;
        if (locationUserId) {
          this.fetchUserProfileByUserId(locationUserId)
            .then((userProfile) => {
              if (userProfile) {
                this.markerUserProfileMap.set(marker, userProfile);
                console.log('[ChatPage.userOfficeLocationMarker] User profile cached for marker', {
                  userId: locationUserId,
                  firstName: userProfile.firstName,
                  lastName: userProfile.lastName
                });
              }
            })
            .catch((err) => {
              console.error('[ChatPage.userOfficeLocationMarker] Failed to fetch user profile', { locationUserId, err });
            });
        }

        this.bindMarkerSelectionTrigger(marker, markerTitle);

        const logMarkerPayload = (trigger: 'click' | 'touchend') => {
          console.log('[ChatPage.userOfficeLocationMarker] Marker tapped.', {
            trigger,
            id: markerData.id,
            latitude: markerData.latitude,
            longitude: markerData.longitude,
            payload: markerData.payload,
            name: markerData.payload['name'],
            title: markerData.payload['title'],
            description: markerData.payload['description'],
            availableTime: markerData.payload['availableTime'],
            unAvailableTime: markerData.payload['unavailableTime'],
            contactInfo: markerData.payload['contactInfo'],
            address: markerData.payload['address'],
            email: markerData.payload['email'],
            locationuserid: markerData.payload['userId'] || markerData.payload['uid'] || markerData.payload['userID']
          });
        };

        marker.on('click', () => logMarkerPayload('click'));
        marker.on('touchend', () => logMarkerPayload('touchend'));
        this.officeLocationLeafletMarkers.push(marker);
      } catch (error) {
        console.error('[ChatPage.userOfficeLocationMarker] Failed to render a marker from stored data.', {
          markerData,
          error
        });
      }
    }

    console.log('[ChatPage.userOfficeLocationMarker] Stored markers rendered on map.', {
      markerCount: this.officeLocationLeafletMarkers.length
    });
  }

  private async loadAndRenderOfficeLocationMarkers(): Promise<void> {
    await this.fetchOfficeLocationMarkerData();
    this.renderStoredOfficeLocationMarkers();
  }

  /**
   * Get the localStorage key for storing office location marker data.
   * Scoped to the current user to avoid cross-user data leaks.
   */
  private getOfficeMarkerStorageKey(): string {
    const userId = this.auth3.getCurrentUser()?.uid || this.userID || 'unknown';
    return `office-location-markers-${userId}`;
  }

  /**
   * Save the current office location marker data to localStorage.
   * This provides a fallback cache in case Firestore is unavailable.
   */
  private saveOfficeMarkerDataToLocalStorage(): void {
    try {
      const key = this.getOfficeMarkerStorageKey();
      const dataToStore = JSON.stringify(this.officeLocationMarkerData);
      localStorage.setItem(key, dataToStore);
      console.log('[ChatPage.markerStorage] Marker data saved to localStorage.', {
        markerCount: this.officeLocationMarkerData.length,
        storageKey: key
      });
    } catch (error) {
      console.error('[ChatPage.markerStorage] Failed to save marker data to localStorage.', error);
    }
  }

  /**
   * Load office location marker data from localStorage.
   * Returns empty array if no data is found or if loading fails.
   */
  private loadOfficeMarkerDataFromLocalStorage(): OfficeLocationMarkerData[] {
    try {
      const key = this.getOfficeMarkerStorageKey();
      const storedData = localStorage.getItem(key);
      if (!storedData) {
        console.log('[ChatPage.markerStorage] No cached marker data found in localStorage.');
        return [];
      }
      const parsedData = JSON.parse(storedData) as OfficeLocationMarkerData[];
      console.log('[ChatPage.markerStorage] Marker data loaded from localStorage.', {
        markerCount: parsedData.length
      });
      return Array.isArray(parsedData) ? parsedData : [];
    } catch (error) {
      console.error('[ChatPage.markerStorage] Failed to load marker data from localStorage.', error);
      return [];
    }
  }

  /**
   * Start a periodic timer that refreshes the map and marker data.
   * This ensures the map stays up-to-date even after inactivity or display issues.
   * Only starts one timer; subsequent calls are ignored if timer is already running.
   */
  private startMapRefreshTimer(): void {
    if (this.mapRefreshTimerId) {
      console.log('[ChatPage.mapRefresh] Map refresh timer already running.');
      return;
    }

    this.mapRefreshTimerId = setInterval(async () => {
      console.log('[ChatPage.mapRefresh] Periodic map refresh triggered.');
      if (this.activeTab !== 'location' || !this.map) {
        return; // Don't refresh if user is not on location tab or map is not initialized
      }

      try {
        // Fetch latest marker data from Firestore
        await this.fetchOfficeLocationMarkerData();
        // Save to local storage for offline access
        this.saveOfficeMarkerDataToLocalStorage();
        // Re-render on the map
        this.renderStoredOfficeLocationMarkers();
        console.log('[ChatPage.mapRefresh] Periodic map refresh completed successfully.');
      } catch (error) {
        console.error('[ChatPage.mapRefresh] Error during periodic map refresh:', error);
      }
    }, this.mapRefreshIntervalMs);

    console.log('[ChatPage.mapRefresh] Map refresh timer started.', {
      intervalMs: this.mapRefreshIntervalMs
    });
  }

  /**
   * Stop the periodic map refresh timer.
   * Safe to call even if the timer is not running.
   */
  private stopMapRefreshTimer(): void {
    if (this.mapRefreshTimerId) {
      clearInterval(this.mapRefreshTimerId);
      this.mapRefreshTimerId = undefined;
      console.log('[ChatPage.mapRefresh] Map refresh timer stopped.');
    }
  }

  /**
   * Manually trigger a map refresh (fetch, save, and render).
   * Useful for on-demand updates without waiting for the periodic timer.
   */
  async manualMapRefresh(): Promise<void> {
    console.log('[ChatPage.mapRefresh] Manual map refresh triggered.');
    try {
      await this.fetchOfficeLocationMarkerData();
      this.saveOfficeMarkerDataToLocalStorage();
      this.renderStoredOfficeLocationMarkers();
      console.log('[ChatPage.mapRefresh] Manual map refresh completed successfully.');
    } catch (error) {
      console.error('[ChatPage.mapRefresh] Error during manual map refresh:', error);
    }
  }

  /** Initialize Leaflet map in the `map` element. Safe to call multiple times. */
  private async initMap(): Promise<void> {
    console.log('[ChatPage.initMap] Initializing map...');
    try {
      const mapEl = document.getElementById('map');
      if (!mapEl) {
        console.warn('[ChatPage.initMap] Map element not found (#map).');
        return;
      }

      // If map exists but points to an old/detached container (after tab/page navigation), recreate it.
      if (this.map) {
        const existingContainer = (this.map as any)?._container as HTMLElement | undefined;
        if (!existingContainer || existingContainer !== mapEl || !document.body.contains(existingContainer)) {
          console.log('[ChatPage.initMap] Existing map is bound to a stale container. Recreating map instance.');
          this.destroyMapInstance();
        }
      }

      this.mapBootstrapSequence += 1;
      const bootstrapId = this.mapBootstrapSequence;
      this.setMapBootstrapStatus('Preparing map...', undefined, 'loading');

      await this.maybePromptForLocationActivation();
      const coordinates = await this.getInitialCoordinatesWithTimeout();
      console.log('[ChatPage.initMap] Coordinates resolved for map:', coordinates);
      const center: [number, number] = coordinates
        ? [coordinates.latitude, coordinates.longitude]
        : [this.fallbackCoordinates.latitude, this.fallbackCoordinates.longitude];

      if (this.map) {
        console.log('[ChatPage.initMap] Map already initialized. Updating view and markers.');
        // already initialized: invalidate size in case container changed
        this.map.invalidateSize();
        // IMPORTANT: Render local markers and tiles immediately WITHOUT waiting for internet checks
        this.renderLocalMarkerCacheImmediately();
        this.applyEffectiveTileLayerMode();
        this.bindMapTapCapture();
        this.map.setView(center, 15);
        await this.markUserLocation(this.map, coordinates);
        // Start background online refresh (won't block map display since markers & tiles are already visible)
        void this.runStaggeredOnlineBootstrap(bootstrapId);
        return;
      }

      this.map = L.map(mapEl).setView(center, coordinates ? 15 : 13);
      console.log('[ChatPage.initMap] Leaflet map created with center:', center);
      // place developer/test markers after map creation
      try { this.placeTestMarkers(); } catch (err) { console.error('[ChatPage.initMap] placeTestMarkers error', err); }

      // Create offline-capable tile layer with offline mode enabled immediately
      // This ensures offline tiles are displayed right away if available
      this.baseTileLayer = new OfflineLeafletTileLayer(this.osmTileTemplate, this.offlineMapTileService, {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
        subdomains: this.offlineTileSubdomains,
        crossOrigin: true,
        offlineMode: this.getEffectiveOfflineMode()
      });
      this.baseTileLayer.addTo(this.map);
      console.log('[ChatPage.initMap] Offline-capable tile layer added (offline tiles displayed if available).');

      this.bindMapTapCapture();

      // CRITICAL: Load and render local markers SYNCHRONOUSLY and immediately - happens BEFORE internet checks
      // Both local markers AND offline tiles are now visible to the user
      console.log('[ChatPage.initMap] Rendering local marker cache immediately with offline tiles (before any internet checks).');
      this.renderLocalMarkerCacheImmediately();
      
      await this.markUserLocation(this.map, coordinates);
      
      // Start background online refresh (won't block display since markers & tiles are already rendered)
      // If online & location detected, refreshes markers from Firestore and stores them locally
      void this.runStaggeredOnlineBootstrap(bootstrapId);
      
      console.log('[ChatPage.initMap] Map initialization complete with offline tiles and local markers visible.');
    } catch (err) {
      console.warn('[ChatPage.initMap] Initialization failed', err);
    }
  }

  async markUserLocation(map: L.Map, coordinates?: { latitude: number; longitude: number } | null) {
      console.log('[ChatPage.markUserLocation] Marking user location...', { coordinatesFromCaller: coordinates });
      try {
        const resolvedCoordinates = coordinates ?? await this.getCurrentCoordinates();
        if (!resolvedCoordinates) {
          console.warn('[ChatPage.markUserLocation] No coordinates resolved.');
          return;
        }

        const { latitude, longitude } = resolvedCoordinates;
        console.log('[ChatPage.markUserLocation] Coordinates used for marker:', { latitude, longitude });

        if (this.userLocationMarker) {
          this.userLocationMarker.setLatLng([latitude, longitude]);
          this.bindMarkerSelectionTrigger(this.userLocationMarker, 'You are here Selection Overlay');
          console.log('[ChatPage.markUserLocation] Existing marker updated.');
        } else {
          // this.userLocationMarker = L.marker([latitude, longitude])
          //   .addTo(map)
          //   .bindPopup('You are here!')
          //   .openPopup();
          this.userLocationMarker = L.marker([latitude, longitude], {
  icon: this.userLocationIcon
})
  .addTo(map)
  .bindPopup('You are here!')
  .openPopup();
          this.bindMarkerSelectionTrigger(this.userLocationMarker, 'You are here Selection Overlay');

          console.log('[ChatPage.markUserLocation] New marker created.');
        }

        map.setView([latitude, longitude], 15);
        console.log('[ChatPage.markUserLocation] Map centered on user location.');
      } catch (error) {
        console.error('[ChatPage.markUserLocation] Failed to mark user location:', error);
      }
    }

    // Add once in your class (near other properties)
private readonly userLocationIcon = L.icon({
  iconUrl: 'assets/map/user-marker.png',
  // iconRetinaUrl: 'assets/map/marker-icon-2x.png', // optional but recommended
  shadowUrl: 'assets/map/marker-shadow2.png',      // optional
  iconRetinaUrl: 'assets/user-marker.png', // optional but recommended
  // shadowUrl: 'assets/user-marker.png',      // optional
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

    /** Place the test markers (from `testMarkers`) onto the currently-initialized map, using a custom icon. */
    private readonly testMarkerIcon = L.icon({
      iconUrl: 'assets/map/test-marker.png', // Place your custom marker image here
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowUrl: 'assets/map/marker-shadow2.png',
      shadowSize: [41, 41]
    });

    private placeTestMarkers(): void {
      if (!this.map) return;
      for (const m of this.testMarkers) {
        try {
          const marker = L.marker([m.latitude, m.longitude], { icon: this.testMarkerIcon })
            .addTo(this.map)
            .bindPopup(`<strong>${m.name}</strong>`);
          // preserve same behavior as other markers: open selection overlay when clicked
          this.bindMarkerSelectionTrigger(marker, m.name);
        } catch (err) {
          console.error('[ChatPage.placeTestMarkers] Failed to add marker', m, err);
        }
      }
    }

  ionViewDidLeave(): void {
    this.destroyMapInstance();
    this.stopMapRefreshTimer();
    if (this.markerOverlayElement) {
      try { document.body.removeChild(this.markerOverlayElement); } catch {}
      this.markerOverlayElement = undefined;
    }
    if (this.markerSelectionOverlayElement) {
      try { document.body.removeChild(this.markerSelectionOverlayElement); } catch {}
      this.markerSelectionOverlayElement = undefined;
    }
    this.dismissMapTapOverlay();
    this.hideMapBootstrapStatus();
  }

  /**
   * Setup hardware back button handler with priority handling for different UI states.
   * The handler follows a hierarchical approach to handle the deepest/most specific UI state first.
   */
  private setupHardwareBackButton(): void {
    this.backButtonSub = this.platform.backButton.subscribeWithPriority(9999, () => {
      this.handleHardwareBackButton();
    });
  }

  /**
   * Handle hardware back button press with hierarchical UI state management.
   * Priority order (from highest to lowest):
   * 1. Close attachment debug dialog if open
   * 2. Go back on attachment detail view if shown
   * 3. Toggle/close attachment sheet if active
   * 4. Close chat conversation if open
   * 5. Handle map view states (radius overlay, map sheet)
   * 6. Close search if active
   * 7. Close sidebar if open
   * 8. Navigate to home if in chat list
   */
  private handleHardwareBackButton(): void {
    // Priority 1: Close attachment debug dialog
    if (this.isAttachmentDebugDialogOpen) {
      this.closeAttachmentDebugDialog();
      return;
    }

    // Priority 2: Go back from attachment detail view
    if (this.attachmentSheetViewMode === 'detail' && this.selectedAttachment) {
      this.backToAttachmentGrid();
      return;
    }

    // Priority 3: Toggle attachment sheet if active
    if (this.isAttachmentSheetActive) {
      this.toggleAttachmentSheet();
      return;
    }

    // Priority 4: Close chat conversation
    if (this.isChatOpen) {
      this.closeChat();
      return;
    }

    // Priority 5: Handle map view states
    if (this.activeTab === 'location') {
      // Priority 5a: Close radius selection overlay
      if (this.isRadiusSelectionOverlayOpen) {
        this.closeRadiusSelectionOverlay();
        return;
      }

      // Priority 5b: Toggle map bottom sheet
      if (this.isMapBottomSheetActive) {
        this.toggleMapBottomSheet();
        return;
      }

      // Priority 5c: Exit map view and return to people tab
      this.setNav('people');
      return;
    }

    // Priority 6: Close search
    if (this.isSearching) {
      this.closeSearch();
      return;
    }

    // Priority 7: Close sidebar
    if (this.isSidebarOpen) {
      this.closeSidebar();
      return;
    }

    // Priority 8: Navigate to home page from chat list
    if (this.activeTab === 'person' || this.activeTab === 'people' || this.activeTab === 'profile') {
      this.goToHomePage();
    }
  }

  public editProfile() {
    console.log('[ChatPage] Edit Profile triggered');
  }

  ngOnDestroy(): void {
    // Clean up service recovery checker
    this.stopServiceRecoveryChecker();
    // Clean up background fetch
    this.stopBackgroundMarkerFetch();
    // Clean up chat subscription
    try { this.chatsSub?.unsubscribe(); } catch {}
    this.chatsSub = undefined;
    this.resetTypingStateForCurrentUser().catch(() => {});
    try { this.typingSub?.unsubscribe(); } catch {}
    this.typingSub = undefined;
    if (this.typingDebounceTimeoutId) {
      clearTimeout(this.typingDebounceTimeoutId);
      this.typingDebounceTimeoutId = undefined;
    }
    if (this.markerOverlayElement) {
      try { document.body.removeChild(this.markerOverlayElement); } catch {}
      this.markerOverlayElement = undefined;
    }
    if (this.markerSelectionOverlayElement) {
      try { document.body.removeChild(this.markerSelectionOverlayElement); } catch {}
      this.markerSelectionOverlayElement = undefined;
    }
    this.dismissMapTapOverlay();
    this.hideMapBootstrapStatus();
    if (this.mapResizeTimeoutId) {
      clearTimeout(this.mapResizeTimeoutId);
      this.mapResizeTimeoutId = undefined;
    }
    if (this.mapBootstrapStatusHideTimeoutId) {
      clearTimeout(this.mapBootstrapStatusHideTimeoutId);
      this.mapBootstrapStatusHideTimeoutId = undefined;
    }
    // Stop periodic map refresh timer
    this.stopMapRefreshTimer();
    try { this.messagesSub?.unsubscribe(); } catch {}
    this.messagesSub = undefined;
    // Clean up hardware back button subscription
    try { this.backButtonSub?.unsubscribe(); } catch {}
    this.backButtonSub = undefined;
    // optional: set offline on destroy if desired
  }


}

