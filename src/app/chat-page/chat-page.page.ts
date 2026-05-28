import { Component, OnInit, OnDestroy, NgZone } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { NavController, Platform } from '@ionic/angular';
import { User } from 'firebase/auth';
import { Auth3Service } from '../services/auth3.service';
import { Firestore, collection, doc, getDoc, query, where, getDocs, setDoc, deleteDoc } from '@angular/fire/firestore';
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
  chatOptionsDeleteInProgress = false;
  receiverUserId: string | any;
  newRecepientUserId: string | any;
  sessionImageObjectCounter: number = 0;
    // Long-press logic for chat-item
    onChatItemPressStart(event: MouseEvent | TouchEvent, chat: any) {
      if (this.chatOptionsLongPressTimer) clearTimeout(this.chatOptionsLongPressTimer);
      this.chatOptionsLongPressTimer = setTimeout(() => {
        this.chatOptionsSelectedChat = chat;
        console.log('[ChatPage.chatOptions] Long-press selected chat object:', chat);
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

    async closeChatOptionsOverlay(): Promise<void> {
      this.showChatOptionsOverlay = false;
      this.chatOptionsOverlayY = 0;
      this.chatOptionsSelectedChat = null;
      this.chatOptionsDragStartY = null;
      this.chatOptionsDragCurrentY = null;
      this.chatOptionsDragActive = false;
    }

    // Placeholder logic for options
    async onDeleteChatOption(): Promise<void> {
      const selectedChat = this.chatOptionsSelectedChat;
      console.log('[ChatPage.onDeleteChatOption] Selected chat object:', selectedChat);

      if (!selectedChat?.chatId) {
        console.warn('[ChatPage.onDeleteChatOption] No chat selected for deletion.');
        await this.closeChatOptionsOverlay();
        return;
      }

      if (this.chatOptionsDeleteInProgress) {
        return;
      }

      this.chatOptionsDeleteInProgress = true;

      try {
        await this.chatService.deleteChat(selectedChat.chatId);
        this.chats = this.chats.filter((chat) => chat?.chatId !== selectedChat.chatId);

        if (this.currentChatId === selectedChat.chatId) {
          this.closeChat();
        }
      } catch (error) {
        console.error('[ChatPage.onDeleteChatOption] Failed to delete chat from Firestore:', error);
        alert('Unable to delete this chat right now. Please try again.');
      } finally {
        this.chatOptionsDeleteInProgress = false;
        await this.closeChatOptionsOverlay();
      }
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
    // Capture the starting Y position when the drag begins.
    this.mapSheetDragStartY = this.getSheetEventY(event);

    // While the pointer moves, compare the current Y position to the start point
    // and switch the sheet open/closed once the drag passes the configured threshold.
    const moveHandler = (moveEvent: MouseEvent | TouchEvent): void => {
      // Ignore move events unless a drag started and we still have the start position.
      if (this.mapSheetDragStartY === null) return;

      // Measure how far the pointer moved vertically from where the drag began.
      const deltaY = this.mapSheetDragStartY - this.getSheetEventY(moveEvent);

      // Dragging upward beyond the threshold opens the sheet if it is currently closed.
      if (deltaY > this.mapSheetDragThreshold && !this.isMapBottomSheetActive) {
        this.isMapBottomSheetActive = true;
        console.log('[ChatPage.mapBottomSheet] Drag-up activated. State: Active');
        cleanup();

      // Dragging downward beyond the threshold closes the sheet if it is currently open.
      } else if (deltaY < -this.mapSheetDragThreshold && this.isMapBottomSheetActive) {
        this.isMapBottomSheetActive = false;
        console.log('[ChatPage.mapBottomSheet] Drag-down deactivated. State: Inactive');
        cleanup();
      }
    };

    // When the drag ends, clear the stored start point and remove the temporary listeners.
    const upHandler = (): void => {
      this.mapSheetDragStartY = null;
      cleanup();
    };

    // Remove all document-level listeners so the drag does not keep running after release.
    const cleanup = (): void => {
      document.removeEventListener('mousemove', moveHandler as EventListener);
      document.removeEventListener('touchmove', moveHandler as EventListener);
      document.removeEventListener('mouseup', upHandler);
      document.removeEventListener('touchend', upHandler);
    };

    // Listen on the document so the drag still works even if the pointer leaves the sheet.
    document.addEventListener('mousemove', moveHandler as EventListener, { passive: true });
    document.addEventListener('touchmove', moveHandler as EventListener, { passive: true });
    document.addEventListener('mouseup', upHandler, { once: true });
    document.addEventListener('touchend', upHandler, { once: true });
  }

  /**
   * Gets the vertical position from either a touch event or a mouse event.
   * This lets the drag logic work on both the mobile and desktop.
   */
  private getSheetEventY(event: MouseEvent | TouchEvent): number {
    // If this is an active touch event, use the first touch point's Y position.
    if ('touches' in event && event.touches.length > 0) return event.touches[0].clientY;

    // If the touch has already ended, use the last changed touch point's Y position.
    if ('changedTouches' in event && (event as TouchEvent).changedTouches.length > 0) {
      return (event as TouchEvent).changedTouches[0].clientY;
    }

    // Otherwise, fall back to the mouse pointer's Y position.
    return (event as MouseEvent).clientY;
  }

  openMapMarkerBottomSheet(markerData: any): void {
    this.mapSheetViewMode = 'detail';
    this.mapSheetAggregatedEngineers = markerData ? [markerData] : [];
    this.selectedMapEngineer = markerData;
    this.isMapBottomSheetActive = true;
    console.log('[ChatPage.mapBottomSheet] Marker clicked. State: Active', { engineer: markerData });
  }

  /**
   * Opens a chat from the selected map-sheet engineer.
   * It stops the click from bubbling, verifies that a valid engineer exists,
   * and then passes that engineer into the chat-selection flow.
   */
  openChatFromMapSheet(event: MouseEvent): void {
    // Prevent the click from also triggering parent sheet or backdrop handlers.
    event.stopPropagation();

    // If nothing is selected, there is no chat target to open.
    if (!this.selectedMapEngineer) return;

    // Try several possible ID fields so the code works with different engineer shapes.
    const selectedId = this.selectedMapEngineer?.id || this.selectedMapEngineer?.uid || this.selectedMapEngineer?.userID || this.selectedMapEngineer?.email;

    // If no usable ID exists, show a message and stop here.
    if (!selectedId) {
      alert('Unable to open chat for this marker because no linked user account was found.');
      return;
    }

    // Open the chat for the currently selected engineer.
    if (this.selectedMapEngineer) {
      void this.selectEngineer(this.selectedMapEngineer);
    }
  }

  /**
   * Opens the map bottom sheet in detail mode for one/selected engineer.
   * It prevents parent click handlers from firing, stores the selected engineer, and then shows the sheet in its detail view.
   */
  openMapSheetEngineerDetail(engineer: any, event?: Event): void {
    // Stop the click from bubbling up to parent elements.
    event?.stopPropagation();

    // Save the chosen engineer so the sheet can display their information.
    this.selectedMapEngineer = engineer;

    // Switch the sheet into detail mode instead of the list view.
    this.mapSheetViewMode = 'detail';

    // Make sure the bottom sheet is visible.
    this.isMapBottomSheetActive = true;
  }

  /**
   * Returns the map bottom sheet from the engineer detail view back to the list view.
   * It stops the click from bubbling, then only switches to list mode when there are multiple engineers to show.
   */
  backToMapSheetList(event?: Event): void {
    // Prevent this click from also triggering parent UI handlers.
    event?.stopPropagation();

    // Only show the list view when there is more than one engineer in the sheet.
    if (this.mapSheetAggregatedEngineers.length > 1) {
      this.mapSheetViewMode = 'list';
    }
  }

  /**
   * Returns a human-readable name for an engineer object.
   * Preference order: firstName + lastName -> name -> email -> markerTitle -> 'Unknown User'.
   */
  getMapSheetEngineerName(engineer: any): string {
    // If the input is missing or not an object, we cannot derive a name.
    if (!engineer || typeof engineer !== 'object') return 'Unknown User';

    // Safely read first and last name, trimming whitespace when present.
    const firstName = typeof engineer.firstName === 'string' ? engineer.firstName.trim() : '';
    const lastName = typeof engineer.lastName === 'string' ? engineer.lastName.trim() : '';

    // Prefer a combined "First Last" when either is present.
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) return fullName;

    // Fall back to other properties commonly containing a display name.
    if (typeof engineer.name === 'string' && engineer.name.trim()) return engineer.name.trim();
    if (typeof engineer.email === 'string' && engineer.email.trim()) return engineer.email.trim();
    if (typeof engineer.markerTitle === 'string' && engineer.markerTitle.trim()) return engineer.markerTitle.trim();

    // Final fallback when no usable name-like field exists.
    return 'Unknown User';
  }

  /**
   * getMapSheetEngineerSubtitle(engineer: any): string
   *
   * Line-by-line explanation:
   * 1) Guard clause: if the input is missing or not an object, return an empty subtitle.
   * 2) Build `contact` by trying several common phone/contact property names in order,
   *    returning the first defined/truthy value.
   * 3) If `contact` is a non-empty string after trimming, return it (preferred subtitle).
   * 4) Otherwise, if `engineer.email` is a non-empty string, return the trimmed email.
   * 5) Otherwise, if `engineer.address` is a non-empty string, return the trimmed address.
   * 6) Final fallback: return the literal 'No contact info'.
   */
  getMapSheetEngineerSubtitle(engineer: any): string {
    // 1) Guard: ensure we received an object; otherwise, no subtitle is available.
    if (!engineer || typeof engineer !== 'object') return '';

    // 2) Prefer any available phone/contact-related field. The `||` chain picks the first defined/truthy value.
    const contact = engineer.phoneNumber || engineer.phone || engineer.contactNumber || engineer.mobile || engineer.mobileNumber || engineer.contact;

    // 3) If the contact value is a string and not just whitespace, return it trimmed.
    if (typeof contact === 'string' && contact.trim()) return contact.trim();

    // 4) Fallback to email if present and non-empty.
    if (typeof engineer.email === 'string' && engineer.email.trim()) return engineer.email.trim();

    // 5) Fallback to address if present and non-empty.
    if (typeof engineer.address === 'string' && engineer.address.trim()) return engineer.address.trim();

    // 6) Nothing usable found — return a clear fallback string.
    return 'No contact info';
  }

  /**
   * getMapSheetEngineerDistanceLabel(engineer: any): string
   *
   * Line-by-line explanation:
   * 1) Convert the engineer's `distanceFromCenterMeters` to a Number (handles strings/undefined).
   * 2) If the result is not a finite number or is negative, return an empty string (no label).
   * 3) If the distance is 1000 meters or more, format as kilometers with two decimals.
   * 4) Otherwise, round to the nearest meter and format as meters.
   */
  getMapSheetEngineerDistanceLabel(engineer: any): string {
    // 1) Coerce the possibly-missing value into a Number.
    const distance = Number(engineer?.distanceFromCenterMeters);

    // 2) Guard: if conversion failed (NaN/infinite) or negative distance, don't show a label.
    if (!Number.isFinite(distance) || distance < 0) return '';

    // 3) If 1000m or more, present as kilometers with two decimal places for readability.
    if (distance >= 1000) return `${(distance / 1000).toFixed(2)} km away`;

    // 4) Otherwise present as rounded meters.
    return `${Math.round(distance)} m away`;
  }

  /**
   * Returns initials for an engineer by deriving a display name then extracting initials.
   *
   * Line-by-line explanation:
   * 1) `getMapSheetEngineerName(engineer)` resolves a human-friendly display name
   *    (prefers first/last, then name/email/markerTitle, or 'Unknown User').
   * 2) `getInitials(...)` converts that display name into an initials string (e.g. "John Doe" -> "JD").
   * 3) The function returns the resulting initials string.
   */
  getMapSheetEngineerInitials(engineer: any): string {
    // Derive a display name using the existing helper, then compute initials from it.
    return this.getInitials(this.getMapSheetEngineerName(engineer));
  }

  // --- Conversation Attachment Sheet Methods ---
  /**
   * toggleAttachmentSheet(): void
   *
   * Line-by-line explanation:
   * 1) Flip the `isAttachmentSheetActive` boolean to open/close the attachment sheet.
   * 2) Log the new state to the console for debugging, using a ternary to show 'Active' or 'Inactive'.
   */
  toggleAttachmentSheet(): void {
    // 1) Toggle the boolean: if it was true -> false, false -> true.
    this.isAttachmentSheetActive = !this.isAttachmentSheetActive;

    // 2) Emit a concise debug message showing the resulting state.
    console.log(`[ChatPage.attachmentSheet] Toggled. State: ${this.isAttachmentSheetActive ? 'Active' : 'Inactive'}`);
  }

  /**
   * openAttachmentSheet(): Promise<void>
   *
   * Line-by-line explanation:
   * 1) Set the view mode for the attachment sheet to 'grid' so attachments display as tiles.
   * 2) Mark the attachment sheet as active so the UI renders the sheet.
   * 3) Load attachments for the current conversation (messages and sessions) before showing details.
   * 4) Emit a console debug message confirming the sheet is now open.
   */
  async openAttachmentSheet(): Promise<void> {
    // 1) Use grid view for the attachment sheet UI (thumbnail grid preferred).
    this.attachmentSheetViewMode = 'grid';

    // 2) Toggle on the sheet visibility flag so templates show the attachment sheet.
    this.isAttachmentSheetActive = true;

    // 3) Ensure the list of attachments is populated before the user inspects them.
    await this.loadConversationAttachments();

    // 4) Helpful debug log to indicate the sheet is open and active.
    console.log('[ChatPage.attachmentSheet] Opened. State: Active');
  }

  /**
   * closeAttachmentSheet(): void
   *
   * Line-by-line explanation:
   * 1) Set the `isAttachmentSheetActive` flag to false so the UI hides the sheet.
   * 2) Log a concise debug message indicating the sheet has been closed.
   */
  closeAttachmentSheet(): void {
    // 1) Toggle off visibility so templates no longer render the attachment sheet.
    this.isAttachmentSheetActive = false;

    // 2) Emit a debug message for developers to confirm the sheet closed.
    console.log('[ChatPage.attachmentSheet] Closed. State: Inactive');
  }

  /**
   * Load conversation attachments from both messages and user's session objects.
   * Fetches sessions created by the current user and maps them as attachments.
   * Also validates that sessions belong to the current user to prevent data leaks.
   */
  /**
   * loadConversationAttachments(): Promise<void>
   *
   * Line-by-line explanation:
   * 1) Create an empty `attachments` array to collect both message attachments and session objects.
   * 2) Iterate message list and extract any attachments or inline URLs, normalizing them into a common shape.
   * 3) Resolve the current user's ID and fetch their saved sessions (if available).
   * 4) Validate each session belongs to the current user, add valid sessions as attachments, and queue mismatched sessions for deletion.
   * 5) Clean up mismatched sessions by calling a deletion helper.
   * 6) Merge message attachments and session attachments, then sort sessions newest-first by created/timestamp.
   * 7) On any error, log and clear the attachments to avoid stale UI state.
   */
  async loadConversationAttachments(): Promise<void> {
    try {
      // 1) Collector for normalized attachments (messages + sessions)
      const attachments: any[] = [];

      // 2) If there are chat messages, inspect each one for attachments or inline media URLs
      if (this.messages && this.messages.length > 0) {
        this.messages.forEach((msg: any) => {
          // If the message already contains an attachments array, copy those entries and add metadata
          if (msg.attachments && Array.isArray(msg.attachments)) {
            msg.attachments.forEach((attachment: any) => {
              attachments.push({
                ...attachment,
                // Keep trace of origin message for later actions (e.g. open, share)
                messageId: msg.id,
                senderId: msg.senderId,
                timestamp: msg.timestamp,
                attachmentType: 'message'
              });
            });

          // Otherwise, if the message contains an imageUrl or fileUrl, create a minimal attachment object
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

      // 3) Try to gather the current user's sessions and include them as 'session' attachments
      const currentUserId = this.auth3.getCurrentUser()?.uid || this.userID;
      if (currentUserId) {
        try {
          // Fetch user sessions from the auth3 service
          const userSessions = await this.auth3.getUserSessions(currentUserId);
          console.log('[ChatPage.loadConversationAttachments] Fetched user sessions:', userSessions.length);

          if (userSessions && Array.isArray(userSessions)) {
            const sessionsToDelete: any[] = [];

            // 4) Validate ownership and transform sessions into attachment objects
            for (const session of userSessions) {
              // If the session fails the ownership validation, mark for deletion and skip it
              if (!this.validateSessionBelongsToCurrentUser(session)) {
                console.warn('[ChatPage.loadConversationAttachments] Session does not belong to current user, marking for deletion', {
                  sessionId: session?.id,
                  sessionUserId: session?.userId,
                  currentUserId
                });
                sessionsToDelete.push(session);
                continue;
              }

              // Only include sessions whose `userId` matches the current user
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
                  attachmentType: 'session',
                  // Preserve session-specific flags and notes for display
                  engineerCheckedSession: !!session.engineerCheckedSession,
                  notes: !!session.notes ? session.notes : 'No notes available'
                });
              }
            }

            // 5) Attempt to delete any sessions that clearly belonged to a different user
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
          // If session fetching fails, we continue with message attachments only
          console.warn('[ChatPage.loadConversationAttachments] Failed to fetch user sessions:', error);
        }
      }

      // 6) Normalize and sort attachments: keep session items newest-first based on created/timestamp
      this.conversationAttachments = [...attachments].sort((a, b) => {
        const aIsSession = a?.attachmentType === 'session' || a?.type === 'session';
        const bIsSession = b?.attachmentType === 'session' || b?.type === 'session';

        // Only reorder when both items are sessions: newest (larger timestamp) first
        if (aIsSession && bIsSession) {
          const aMillis = new Date(a?.created || a?.timestamp || 0).getTime() || 0;
          const bMillis = new Date(b?.created || b?.timestamp || 0).getTime() || 0;
          return bMillis - aMillis;
        }

        // Preserve original order for mixed types
        return 0;
      });
    } catch (error) {
      // 7) On unexpected errors, clear the attachments to avoid showing inconsistent data
      console.error('[ChatPage.loadConversationAttachments] Error loading attachments:', error);
      this.conversationAttachments = [];
    }
  }

  /**
   * selectAttachment(attachment, event): void
   *
   * Line-by-line explanation:
   * 1) Stop the click event from bubbling so parent/backdrop handlers don't react.
   * 2) Store the selected attachment on component state for display/actions.
   * 3) Switch the attachment sheet into 'detail' mode to show full session info.
   * 4) Log useful debug information about the selected attachment.
   * 5) If the selection is a session object, call a debug helper to print session internals.
   */
  selectAttachment(attachment: any, event?: Event): void {
    // 1) Prevent parent click handlers (backdrop or sheet) from also firing
    event?.stopPropagation();

    // 2) Save the selected attachment so the UI can render its detail view
    this.selectedAttachment = attachment;

    // 3) Move the attachment sheet into the detailed view mode
    this.attachmentSheetViewMode = 'detail';

    // 4) Debug logs to help trace selected object and key properties
    console.log('[ChatPage.selectAttachment] Full session object:', attachment);
    console.log('[ChatPage.selectAttachment] Session ID:', attachment?.id);
    console.log('[ChatPage.selectAttachment] Session Type:', attachment?.type);
    console.log('[ChatPage.selectAttachment] Engineer Checked:', attachment?.engineerCheckedSession);

    // 5) If the attachment is a session, optionally dump more debug information
    if (attachment?.type === 'session') {
      this.debugPrintAttachmentData(attachment);
    }
  }

  /**
   * backToAttachmentGrid(event?): void
   *
   * Line-by-line explanation:
   * 1) Stop the click from bubbling to parent/backdrop handlers.
   * 2) Only switch back to grid view when there are attachments to show.
   * 3) Update the attachment sheet view mode to 'grid' so thumbnails are displayed.
   */
  backToAttachmentGrid(event?: Event): void {
    // 1) Prevent parent click handlers from reacting to this click
    event?.stopPropagation();

    // 2) Guard: only switch to grid when we actually have attachments to display
    if (this.conversationAttachments.length > 0) {
      // 3) Set view mode to 'grid' so the UI shows the attachment tiles
      this.attachmentSheetViewMode = 'grid';
    }
  }

  /**
   * getAttachmentPreviewIcon(attachment): string
   *
   * Line-by-line explanation:
   * 1) Safely read `attachment.type` using optional chaining; default to 'file' when missing.
   * 2) If the type is 'image', return the Ionic icon name for images.
   * 3) If the type is 'pdf', return the Ionic icon name for documents.
   * 4) If the type is 'video', return the Ionic icon name for video playback.
   * 5) If the type is 'session' (a saved session of images), return the multi-image icon.
   * 6) Otherwise return a generic attachment icon.
   */
  getAttachmentPreviewIcon(attachment: any): string {
    // 1) Read the attachment type with a safe fallback to 'file'.
    const type = attachment?.type || 'file';

    // 2) Image attachments -> show image outline icon.
    if (type === 'image') return 'image-outline';

    // 3) PDF attachments -> show document icon.
    if (type === 'pdf') return 'document-outline';

    // 4) Video attachments -> show play-circle icon.
    if (type === 'video') return 'play-circle-outline';

    // 5) Session attachments (collections of images) -> show images icon.
    if (type === 'session') return 'images-outline';

    // 6) Default icon for unknown or other attachment types.
    return 'attach-outline';
  }

  /**
   * onAttachmentDebugClick(attachment, event): void
   *
   * Line-by-line explanation:
   * 1) If an Event is provided, stop propagation so parent/backdrop handlers won't also react.
   * 2) Store the clicked attachment on `selectedAttachmentForDebug` so the debug UI can show details.
   * 3) Open the debug dialog by setting `isAttachmentDebugDialogOpen` to true.
   * 4) Log a concise debug message for developer tracing.
   */
  onAttachmentDebugClick(attachment: any, event?: Event): void {
    // 1) Prevent the click from bubbling to parent elements (backdrop, sheet, etc.)
    if (event) event.stopPropagation();

    // 2) Keep a reference to the attachment we're debugging so the dialog can render its data
    this.selectedAttachmentForDebug = attachment;

    // 3) Show the debug dialog in the UI
    this.isAttachmentDebugDialogOpen = true;

    // 4) Emit a log to help trace when the dialog was opened and which attachment is selected
    console.log('[ChatPage] Attachment debug click detected. Debug info:', { attachment });
  }

  /**
   * closeAttachmentDebugDialog(): void
   *
   * Line-by-line explanation:
   * 1) If an attachment copy/upload operation is in progress, do nothing to avoid interrupting it.
   * 2) Otherwise, hide the debug dialog and clear the stored debug attachment reference.
   */
  closeAttachmentDebugDialog(): void {
    // 1) Protect the dialog from being closed mid-copy to avoid inconsistent state
    if (!this.isAttachmentCopyInProgress) {
      // 2a) Hide the debug dialog
      this.isAttachmentDebugDialogOpen = false;

      // 2b) Clear the selected debug attachment so the dialog shows no stale data next time
      this.selectedAttachmentForDebug = null;
    }
  }



  private resolveAttachmentShareRecipient(): string | null {
    /**
     * resolveAttachmentShareRecipient()
     *
     * Line-by-line explanation:
     * 1) Prefer `newRecepientUserId` when it has been explicitly set (highest priority).
     * 2) Otherwise, if `receiverUserId` exists, attempt to normalize/extract original id
     *    and return it (keeps backwards compatibility with previously stored receiver IDs).
     * 3) If there is an `activeChat`, try to extract a recipient ID from its structure and
     *    store it into `receiverUserId` for future use.
     * 4) Also check `activeChat._recipientUserId` (set during `openChat`) as an alternate source.
     * 5) As a last resort, fall back to `currentChatId` when present and usable.
     * 6) If none of the above yields an ID, return `null` to indicate failure to resolve.
     */

    // 1) Highest priority: explicit new recipient override
    if (this.newRecepientUserId) {
      return this.newRecepientUserId;
    }

    // 2) Re-use an already-known receiver ID (and try to normalize it if extraction isnt applied yet)
    if (this.receiverUserId) {
      // If we haven't derived the original form yet, attempt to extract it for consistency
      if (!this.newRecepientUserId) {
        this.extractOriginalUserIdFromReceiverUserId();
      }
      return this.receiverUserId;
    }

    // 3) If an active chat is available, attempt structured extraction
    if (this.activeChat) {
      // Try the general extraction helper which understands several shapes of chat objects
      const extracted = this.extractReceiverUserIdFromChat(this.activeChat);
      if (extracted) {
        // Persist the discovered ID for future calls and return it now
        console.log('[ChatPage.resolveAttachmentShareRecipient] Extracted recipient from activeChat:', extracted);
        this.receiverUserId = extracted;
        return extracted;
      }

      // 4) Fallback: a legacy or previously-stored property set during chat open
      if ((this.activeChat as any)._recipientUserId) {
        console.log('[ChatPage.resolveAttachmentShareRecipient] Found recipient in activeChat._recipientUserId:', (this.activeChat as any)._recipientUserId);
        this.receiverUserId = (this.activeChat as any)._recipientUserId;
        return (this.activeChat as any)._recipientUserId;
      }
    }

    // 5) Last-resort: use the currentChatId when it looks like a user identifier
    if (this.currentChatId && typeof this.currentChatId === 'string') {
      console.log('[ChatPage.resolveAttachmentShareRecipient] Using currentChatId as fallback:', this.currentChatId);
      this.receiverUserId = this.currentChatId;
      return this.currentChatId;
    }

    // 6) Nothing found
    return null;
  }

  private sanitizeRecipientOrReceiverId(value: string | null | undefined): string {
    /**
     * sanitizeRecipientOrReceiverId(value): string
     *
     * Line-by-line explanation:
     * 1) If the input is not a string, warn and return an empty string.
     * 2) Trim surrounding whitespace from the input for consistent processing.
     * 3) If the trimmed value is short (<=28 chars), consider it already sanitized and return it.
     * 4) Look for the first underscore occurring at or after index 28 — this indicates a suffix
     *    appended by some storage formats that should be removed.
     * 5) If no such underscore exists, return the full trimmed value.
     * 6) Otherwise slice the string up to that underscore (exclusive) and return the sanitized id.
     */

    // 1) Reject non-string inputs early with a warning to aid debugging
    if (typeof value !== 'string') {
      console.warn('[ChatPage.sanitizeRecipientOrReceiverId] Non-string value received:', value);
      return '';
    }

    // 2) Trim whitespace for reliable length checks and comparisons
    const trimmed = value.trim();

    // 3) Short IDs are considered already acceptable; return as-is
    if (trimmed.length <= 28) {
      console.log('[ChatPage.sanitizeRecipientOrReceiverId] No sanitization needed (length <= 28)', {
        input: value,
        trimmed,
        length: trimmed.length
      });
      return trimmed;
    }

    // 4) Search for an underscore starting at position 28 — many generated IDs append metadata after this point
    const underscoreIndex = trimmed.indexOf('_', 28);

    // 5) If no underscore found, keep the full trimmed value
    if (underscoreIndex === -1) {
      console.log('[ChatPage.sanitizeRecipientOrReceiverId] No underscore found at/after index 28. Keeping full value.', {
        input: value,
        trimmed,
        length: trimmed.length
      });
      return trimmed;
    }

    // 6) Remove the appended suffix by slicing up to the underscore and return the sanitized result
    const sanitized = trimmed.slice(0, underscoreIndex);
    console.log('[ChatPage.sanitizeRecipientOrReceiverId] Sanitized value by removing suffix starting at underscore.', {
      input: value,
      trimmed,
      length: trimmed.length,
      underscoreIndex,
      sanitized,
      sanitizedLength: sanitized.length
    });

    return sanitized;
  }

  /**
   * getStoredImageForAttachment(imageKey)
   *
   * Purpose: Resolve a stored image object that corresponds to the provided
   * `imageKey` using the injected `imageStorage` service. Prefers a direct
   * lookup API when available, otherwise scans the cached images and matches
   * against several candidate identifier fields.
   *
   * Returns the matched image object or `null` when not found.
   */
  private getStoredImageForAttachment(imageKey: string): any | null {
    // 1) Guard: nothing to do when no key is provided.
    if (!imageKey) {
      return null;
    }

    // 2) Read the configured image storage service (may expose different APIs).
    const service: any = this.imageStorage;

    // 3) If the service exposes a direct lookup helper, prefer that for efficiency.
    if (typeof service.getEntryForImage === 'function') {
      // 3a) Ask the service for an entry that matches this key/filename.
      const byFilename = service.getEntryForImage(imageKey);
      // 3b) If we got a result, return it immediately.
      if (byFilename) {
        return byFilename;
      }
    }

    // 4) If no direct lookup exists, try to fetch all stored images and search.
    if (typeof service.getAllImages === 'function') {
      // 4a) Ensure we have an array to search (service may return undefined).
      const storedImages = service.getAllImages() || [];
      // 4b) Return the first image where any known identifier matches the key.
      return storedImages.find((img: any) => {
        // Check multiple candidate properties used by different storage implementations.
        return img?.filename === imageKey
          || img?.original === imageKey
          || img?.withBoxes === imageKey
          || img?.originalKey === imageKey
          || img?.originalS3Key === imageKey
          || img?.withBoxesS3Key === imageKey;
      }) || null;
    }

    // 5) If the service exposes neither helper, we cannot resolve the image.
    return null;
  }

  /**
   * transformKeyForAttachmentShare(value, recipientUserId): string
   *
   * Purpose: When sharing a stored session image with another user, many
   * image keys/filenames embed a user identifier. This helper attempts to
   * rewrite the incoming `value` so it references `recipientUserId` instead
   * of the original user. It prefers simple, detectable patterns first and
   * falls back to the more robust page-level filename transform helper.
   */
  private transformKeyForAttachmentShare(value: string, recipientUserId: string): string {
    // Guard: if either input is falsy, there's nothing to transform — return as-is.
    if (!value || !recipientUserId) {
      return value;
    }

    // Common on-the-wire pattern: filenames that start or contain an explicit
    // `userID:...sessionId:` segment. The regex captures the `userID:` prefix
    // and grabs everything up to (but not including) the following `sessionId:`.
    const regex = /(userID:).*?(?=sessionId:)/;

    // If the pattern is present, perform a targeted replace that preserves the
    // `userID:` label and swaps in the recipient's id. This avoids touching the
    // rest of the filename/session identifier content.
    if (regex.test(value)) {
      return value.replace(regex, `$1${recipientUserId}`);
    }

    // If the quick pattern didn't match, fall back to the page's more robust
    // filename transform that understands additional filename shapes.
    // `transformImageFilenameUserId` will try a non-greedy replacement that
    // only swaps the first `userID:...sessionId:` chunk it finds.
    const transformedByPageMethod = this.transformImageFilenameUserId(value, recipientUserId);

    // If the helper returned a different string, use it. Otherwise keep the
    // original value untouched (no safe transformation available).
    if (transformedByPageMethod && transformedByPageMethod !== value) {
      return transformedByPageMethod;
    }

    // Final fallback: nothing matched or transformation did not change the
    // input — return the original value so callers can decide how to proceed.
    return value;
  }

  private changeUserIdPrefixUntilSessionId(filename: string, recipientUserId: string): string {
    /**
     * changeUserIdPrefixUntilSessionId(filename, recipientUserId): string
     *
     * Purpose: Replace the first `userID:...` segment in a filename with a
     * provided `recipientUserId`, but only when that segment precedes a
     * `sessionId:` marker. This ensures we only change the user prefix that
     * is part of the canonical filename/session identifier and not other parts
     * of the string.
     */

    // 1) Guard: if either value is missing, nothing to do — return original.
    if (!filename || !recipientUserId) {
      return filename;
    }

    // 2) If the filename does not start with the expected 'userID:' prefix,
    //    we avoid making blind replacements and return the original string.
    if (!filename.startsWith('userID:')) {
      return filename;
    }

    // 3) Regex to capture the `userID:` prefix and everything up to the
    //    subsequent `sessionId:` token (non-greedy). The first capturing
    //    group is the literal 'userID:' label which we preserve on replace.
    const regex = /(userID:).*?(?=sessionId:)/;

    // 4) If the pattern exists, perform a targeted replacement that keeps the
    //    'userID:' label and substitutes in the new recipient id only for the
    //    matched prefix region.
    if (regex.test(filename)) {
      return filename.replace(regex, `$1${recipientUserId}`);
    }

    // 5) If no replaceable pattern was found, return the original filename
    //    unchanged so callers can handle the lack of transformation.
    return filename;
  }

  /**
   * copySessionImageForRecipient(originalImage, imageKey, recipientUserId, newSessionId)
   *
   * Purpose: Given a source image object (from a session), build a copy
   * of that image adapted for `recipientUserId` and upload any available
   * DataURLs (original / withBoxes) into the storage service under keys
   * transformed for the recipient. Returns the copied image object with
   * upload metadata populated or `null` when the operation cannot proceed.
   */
  private async copySessionImageForRecipient(
    originalImage: any,
    imageKey: string,
    recipientUserId: string,
    newSessionId: string
  ): Promise<any | null> {
    // 1) Service abstraction: image storage providers expose helpers used below
    const service: any = this.imageStorage;

    // 2) Determine effective recipient ID: allow an override stored on the page
    //    (`this.newRecepientUserId`) but fall back to the provided argument.
    const effectiveRecipientUserId = (this.newRecepientUserId || recipientUserId || '').toString().trim();

    // 3) Guard: we cannot proceed without a recipient user id.
    if (!effectiveRecipientUserId) {
      console.error('[ChatPage.copySessionImageForRecipient] Missing recipient user ID for key:', imageKey);
      return null;
    }

    // 4) Prefer in-object DataURLs when present; otherwise, attempt to fetch
    //    the referenced S3 objects as DataURLs for upload.
    const originalDataUrl = originalImage?.original || (originalImage?.originalS3Key ? await service.fetchS3ObjectAsDataUrl(originalImage.originalS3Key) : null);
    const withBoxesDataUrl = originalImage?.withBoxes || (originalImage?.withBoxesS3Key ? await service.fetchS3ObjectAsDataUrl(originalImage.withBoxesS3Key) : null);

    // 5) If there is no usable image data to upload, nothing to copy.
    if (!originalDataUrl && !withBoxesDataUrl) {
      return null;
    }

    // 6) Build transformed filenames/keys that reference the recipient user id.
    const sourceFilename = originalImage?.filename || imageKey;
    const transformedFilename = this.transformKeyForAttachmentShare(sourceFilename, effectiveRecipientUserId);

    // 7) For each known S3 key property, attempt to produce a transformed key
    //    that points to the same logical object for the recipient.
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

    // 8) Start composing the copied image object: preserve source metadata,
    //    but replace filename/user/session fields and attach upload flags.
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
      // Track whether we attempted uploads and whether they succeeded
      originalUploadAttempted: !!originalDataUrl,
      originalUploadSucceeded: false,
      withBoxesUploadAttempted: !!withBoxesDataUrl,
      withBoxesUploadSucceeded: false
    };

    // 9) If we have an original image DataURL, upload it using the storage helper
    //    and update the copiedImage with returned S3 keys/URLs and success flag.
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

    // 10) Similarly, upload the withBoxes DataURL when available and populate metadata.
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

    // 11) Return the assembled object to the caller so higher-level logic can
    //     register/store it alongside the copied session.
    return copiedImage;
  }

  private async fetchSessionImageObjectsFromFirestoreByImageKeys(
    sessionId: string,
    imageKeys: string[]
  ): Promise<any[]> {
    /**
     * fetchSessionImageObjectsFromFirestoreByImageKeys(sessionId, imageKeys)
     *
     * Purpose: Query the Firestore `images` collection for documents that
     * belong to a given `sessionId` and then match those documents against
     * the provided `imageKeys`. This helps locate image documents that are
     * related to the session by comparing several candidate identifier fields
     * (doc id, filename, originalKey, S3 keys).
     */

    // 1) Validate inputs early: require a session id and a non-empty array
    //    of image keys (guard against invalid calls).
    if (!sessionId || !Array.isArray(imageKeys) || imageKeys.length === 0) {
      return [];
    }

    // 2) Build a Set of source keys we will match against. Only include
    //    non-empty string keys to avoid false positives.
    const sourceKeys = new Set(imageKeys.filter((key) => typeof key === 'string' && key.trim().length > 0));
    if (sourceKeys.size === 0) {
      return [];
    }

    // 3) Collector array for matching Firestore image documents.
    const matchedSessionImageObjects: any[] = [];

    try {
      // 4) Query Firestore for all images that belong to the sessionId.
      //    This limits the documents we need to inspect locally.
      const imagesRef = collection(this.firestore, 'images');
      const imageQuery = query(imagesRef, where('sessionId', '==', sessionId));
      const querySnapshot = await getDocs(imageQuery);

      // 5) For each returned document, assemble a canonical object and then
      //    test a list of candidate identifier fields to see if any match a
      //    source key from the original session (doc id is also considered).
      querySnapshot.forEach((docSnap) => {
        const imageDoc: any = {
          firestoreDocId: docSnap.id,
          ...docSnap.data()
        };

        // 6) Candidate identifiers include the Firestore doc id and several
        //    common properties that may contain the original image key.
        const candidates = [
          docSnap.id,
          imageDoc?.filename,
          imageDoc?.originalKey,
          imageDoc?.originalS3Key,
          imageDoc?.withBoxesS3Key
        ].filter((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);

        // 7) If any candidate appears in the source key set, we consider the
        //    image document related to the requested session keys.
        const isRelatedToSessionKey = candidates.some((candidate) => sourceKeys.has(candidate));
        if (isRelatedToSessionKey) {
          matchedSessionImageObjects.push(imageDoc);
        }
      });

      // 8) Helpful debug log summarising the fetch and match results.
      console.log('[ChatPage.confirmAttachmentShareCopy] Firestore session image objects fetched from images collection (matched by original session imageKeys):', {
        sessionId,
        requestedImageKeys: Array.from(sourceKeys),
        matchedCount: matchedSessionImageObjects.length,
        matchedSessionImageObjects
      });
    } catch (error) {
      // 9) Non-fatal: if Firestore lookup fails, warn and return what we have
      //    (which will be empty in this branch). Higher-level logic may
      //    attempt to fall back to cached/local sources.
      console.warn('[ChatPage.confirmAttachmentShareCopy] Failed to fetch related session image objects from Firestore images collection by imageKeys:', error);
    }

    // 10) Return the array of matched image documents (may be empty).
    return matchedSessionImageObjects;
  }

  /**
   * printSelectedSessionImageObjectsFromFirestore(selectedSession, imageKeys, sessionImageObjects)
   *
   * Line-by-line:
   * 1) Start a console.group for clearer grouped logs.
   * 2) Log a summary object for the selected session (id,name,userId,imageKeysCount).
   * 3) Log the requested imageKeys array (or empty array).
   * 4) Log the count of matched sessionImageObjects (or 0).
   * 5) Log the matched sessionImageObjects array (or empty array).
   * 6) End the console.group.
   */
  private printSelectedSessionImageObjectsFromFirestore(
    selectedSession: any,
    imageKeys: string[],
    sessionImageObjects: any[]
  ): void {
    // 1) Group related debug messages for easier collapse/expand in the console.
    console.group('[ChatPage.confirmAttachmentShareCopy] Selected session image objects from Firestore images collection');
    // 2) Log a compact summary of the selected session.
    console.log('Selected session:', {
      // 2a) session id or null if missing
      id: selectedSession?.id || null,
      // 2b) session name or null if missing
      name: selectedSession?.name || null,
      // 2c) original session owner userId or null if missing
      userId: selectedSession?.userId || null,
      // 2d) number of image keys requested (safe guard for non-array)
      imageKeysCount: Array.isArray(imageKeys) ? imageKeys.length : 0
    });
    // 3) Print the requested image keys array, default to empty array when invalid
    console.log('Requested imageKeys:', Array.isArray(imageKeys) ? imageKeys : []);
    // 4) Show how many image documents matched (safe check for array)
    console.log('Matched image object count:', Array.isArray(sessionImageObjects) ? sessionImageObjects.length : 0);
    // 5) Dump the matched image objects for inspection (or empty list)
    console.log('Matched image objects:', Array.isArray(sessionImageObjects) ? sessionImageObjects : []);
    // 6) Close the console group started above
    console.groupEnd();
  }

  /**
   * confirmAttachmentShareCopy(attachment): Promise<void>
   *
   * Purpose: Copy a source session (including all its images from Firestore and S3)
   * to a recipient user. This involves:
   * 1) Validating the source session and current user permissions
   * 2) Resolving and sanitizing the recipient user ID
   * 3) Creating a new session copy with transformed image keys/filenames for the recipient
   * 4) Fetching original images from Firestore and S3
   * 5) Copying S3 objects to new recipient-owned locations
   * 6) Uploading image metadata to Firestore under the recipient's user ID
   * 7) Registering the copied session and sending a chat confirmation
   */
  async confirmAttachmentShareCopy(attachment: any): Promise<void> {
    // 1) Log start of the entire session copy workflow for debugging
    console.log('[ChatPage.confirmAttachmentShareCopy] ===== SESSION COPY WORKFLOW START =====');

    // 2) Determine which session to copy: explicit argument > debug selection > regular selection
    const selectedSession = attachment || this.selectedAttachmentForDebug || this.selectedAttachment;
    // 3) Guard: abort if no session was resolved from any source
    if (!selectedSession) {
      console.error('[ChatPage.confirmAttachmentShareCopy] No session selected');
      alert('No session selected');
      return;
    }

    // 4) Validate session shape: must be of type 'session' and have a non-empty id
    if (selectedSession.type !== 'session' || !selectedSession.id) {
      console.error('[ChatPage.confirmAttachmentShareCopy] Invalid session attachment:', selectedSession);
      alert('Invalid session attachment');
      return;
    }

    // 5) SECURITY CHECK: ensure the session belongs to the current (authenticated) user
    if (!this.validateSessionBelongsToCurrentUser(selectedSession)) {
      console.error('[ChatPage.confirmAttachmentShareCopy] SECURITY: session does not belong to the current user');
      alert('Security error: Cannot share session from another user');
      return;
    }

    // 6) Log the starting session object and its engineer-checked flag
    console.log("start of confirmAttachmentShareCopy with the session", selectedSession, "Engineer Checked Session:", selectedSession.engineerCheckedSession);
    
    // 7) Extract and preserve the session notes field; default to empty string if missing
    const sessionNotes = selectedSession.notes || '';
    // 8) Log detailed info about the notes field to aid debugging
    console.log("start of confirmAttachmentShareCopy with the session", selectedSession, "Session notes:", {
      notesValue: sessionNotes,
      notesType: typeof selectedSession.notes,
      notesExists: 'notes' in selectedSession,
      notesLength: typeof sessionNotes === 'string' ? sessionNotes.length : 'N/A'
    });

    // 9) Resolve the current authenticated user's ID from auth service or fallback to component userID
    const currentUserId = this.auth3.getCurrentUser()?.uid || this.userID;
    // 10) Guard: cannot proceed without knowing who is initiating the share
    if (!currentUserId) {
      console.error('[ChatPage.confirmAttachmentShareCopy] Cannot determine current user ID');
      alert('Error: Cannot determine current user');
      return;
    }

    // 11) Attempt to resolve the recipient user ID using helper that tries multiple sources
    const resolvedRecipientUserId = this.resolveAttachmentShareRecipient();
    // 12) Guard: if no recipient can be determined, show helpful error and abort
    if (!resolvedRecipientUserId) {
      console.error('[ChatPage.confirmAttachmentShareCopy] Cannot determine recipient user ID', {
        activeChat: this.activeChat,
        activeChatKeys: this.activeChat ? Object.keys(this.activeChat) : [],
        currentChatId: this.currentChatId,
        receiverUserId: this.receiverUserId,
        newRecepientUserId: this.newRecepientUserId
      });
      alert('Error: Cannot determine recipient. Please ensure a chat is open before sharing. If the issue persists, close and reopen the chat.');
      return;
    }

    // 13) Sanitize the resolved recipient ID (remove suffixes, trim, normalize)
    const recipientUserId = this.sanitizeRecipientOrReceiverId(resolvedRecipientUserId);
    // 14) Sanitize the previously-stored receiver ID or use the newly-resolved one
    const receiverId = this.sanitizeRecipientOrReceiverId(this.receiverUserId || recipientUserId);

    // 15) Log the sanitization results to track any transformations applied
    console.log('[ChatPage.confirmAttachmentShareCopy] Recipient/receiver ID sanitization result', {
      resolvedRecipientUserId,
      resolvedRecipientUserIdLength: resolvedRecipientUserId.length,
      existingReceiverUserId: this.receiverUserId,
      existingReceiverUserIdLength: (this.receiverUserId || '').toString().length,
      sanitizedRecipientUserId: recipientUserId,
      sanitizedRecipientUserIdLength: recipientUserId.length,
      sanitizedReceiverId: receiverId,
      sanitizedReceiverIdLength: receiverId.length,
      recipientChanged: recipientUserId !== resolvedRecipientUserId,
      receiverChanged: receiverId !== (this.receiverUserId || recipientUserId)
    });

    // 16) Guard: both recipient and receiver IDs must be non-empty strings after sanitization
    if (!recipientUserId || !receiverId) {
      console.error('[ChatPage.confirmAttachmentShareCopy] Recipient/receiver ID sanitization resulted in empty value', {
        resolvedRecipientUserId,
        receiverUserId: this.receiverUserId
      });
      alert('Error: Invalid recipient identifier. Please reopen the chat and try again.');
      return;
    }

    // 17) Store the sanitized IDs on component state for use by helper functions
    this.receiverUserId = receiverId;
    this.newRecepientUserId = recipientUserId;

    // 18) Log stored IDs to confirm they are now available to all methods
    console.log('[ChatPage.confirmAttachmentShareCopy] Stored sanitized IDs in component state', {
      receiverUserId: this.receiverUserId,
      receiverUserIdLength: (this.receiverUserId || '').toString().length,
      newRecepientUserId: this.newRecepientUserId,
      newRecepientUserIdLength: (this.newRecepientUserId || '').toString().length
    });

    // 19) Get reference to the injected image storage service
    const service: any = this.imageStorage;
    // 20) Generate a new unique session ID based on current timestamp
    const newSessionId = `s-${Date.now()}`;
    // 21) Deep clone the source session so we can modify it without affecting the original
    const copiedSession: any = JSON.parse(JSON.stringify(selectedSession));
    // 22) Replace the session ID with the newly-generated one
    copiedSession.id = newSessionId;
    // 23) Also update the sessionId field (some code may use one or the other)
    copiedSession.sessionId = newSessionId;
    // 24) Set the recipient user as the owner of the copied session
    copiedSession.userId = recipientUserId;
    // 25) Update the created timestamp to current time (reflects when copy was made)
    copiedSession.created = new Date().toISOString();
    // 26) Initialize imageKeys array as empty; will be populated as images are copied
    copiedSession.imageKeys = [];
    // 27) Preserve the engineer-checked flag from the source session (metadata about session review status)
    copiedSession.engineerCheckedSession = !!selectedSession.engineerCheckedSession;
    // 28) Preserve notes/comments from the source session (user-added descriptive text)
    copiedSession.notes = sessionNotes;

    // 29) Log the prepared copiedSession to verify all fields are set correctly
    console.log('[ChatPage.confirmAttachmentShareCopy] Prepared copiedSession with preserved fields', {
      copiedSessionId: copiedSession.id,
      copiedSessionUserId: copiedSession.userId,
      copiedSessionNotes: copiedSession.notes,
      copiedSessionNotesLength: typeof copiedSession.notes === 'string' ? copiedSession.notes.length : 'N/A',
      engineerCheckedSession: copiedSession.engineerCheckedSession
    });

    // 30) Begin try block for the main copy workflow
    try {
      // 31) Mark that a copy operation is in progress (prevents concurrent operations)
      this.isAttachmentCopyInProgress = true;
      // 32) Set debug state to 'active' to indicate UI should show progress
      this.attachmentDebugState = 'active';
      // 33) Initialize progress to 0%
      this.attachmentCopyProgress = 0;
      // 34) Set initial status message
      this.attachmentCopyStatusText = 'Initializing session copy...';

      // 35) Update UI progress to 5% with initial loading message
      this.updateCopyProgress(5, 'Loading session data...');

      // 36) Extract source image keys from selected session, or use empty array if missing
      const sourceImageKeys = Array.isArray(selectedSession.imageKeys) ? selectedSession.imageKeys : [];
      // 37) Transform all source image keys to use the recipient's user ID
      copiedSession.imageKeys = sourceImageKeys.map((key: string) => this.transformKeyForAttachmentShare(key, recipientUserId));
      // 38) Collector array for all successfully copied images
      const copiedImages: any[] = [];
      // 39) Track upload success/failure for each image (for final reporting)
      const uploadStatusByImage: Array<{
        sourceImageKey: string;
        copiedFilename: string;
        originalUploadAttempted: boolean;
        originalUploadSucceeded: boolean;
        withBoxesUploadAttempted: boolean;
        withBoxesUploadSucceeded: boolean;
      }> = [];

      // 40) Update progress to 15% before starting image copy
      this.updateCopyProgress(15, 'Copying session images...');

      // 41) Initialize map to store Firestore image documents indexed by multiple candidate keys
      const firestoreImageObjects = new Map<string, any>();
      // 42) Initialize map to store images fetched from S3, indexed by original source keys
      const sessionImageObjectsWithFetchedS3ByKey = new Map<string, any>();
      // 43) Collector array for all image documents fetched from Firestore
      const sourceSessionImageObjectsFromFirestore: any[] = [];
      // 44) Inner try block for Firestore operations (allows graceful fallback to local cache)
      try {
        // 45) Query Firestore images collection for documents matching the source session
        const fetchedImageObjects = await this.fetchSessionImageObjectsFromFirestoreByImageKeys(
          selectedSession.id,
          sourceImageKeys
        );
        // 46) Add all fetched documents to our collector array
        sourceSessionImageObjectsFromFirestore.push(...fetchedImageObjects);

        // 47) Index each fetched image document by all its potential identifier fields
        sourceSessionImageObjectsFromFirestore.forEach((imageDoc: any) => {
          // 48) Index by Firestore document ID
          const docId = (imageDoc?.firestoreDocId || '').toString();
          if (docId) {
            firestoreImageObjects.set(docId, imageDoc);
          }
          // 49) Index by filename field
          if (imageDoc?.filename) {
            firestoreImageObjects.set(imageDoc.filename, imageDoc);
          }
          // 50) Index by originalKey field
          if (imageDoc?.originalKey) {
            firestoreImageObjects.set(imageDoc.originalKey, imageDoc);
          }
          // 51) Index by S3 key for original image
          if (imageDoc?.originalS3Key) {
            firestoreImageObjects.set(imageDoc.originalS3Key, imageDoc);
          }
          // 52) Index by S3 key for image with bounding boxes
          if (imageDoc?.withBoxesS3Key) {
            firestoreImageObjects.set(imageDoc.withBoxesS3Key, imageDoc);
          }
        });

        // 53) Debug-print the fetched session image objects before processing
        this.printSelectedSessionImageObjectsFromFirestore(
          selectedSession,
          sourceImageKeys,
          sourceSessionImageObjectsFromFirestore
        );

        // 54) Log all stored Firestore images for tracing
        console.log('[ChatPage.confirmAttachmentShareCopy] Stored source session image objects from Firestore images collection:', sourceSessionImageObjectsFromFirestore);

        // 55) Collector array for deep-cloned image objects with user/session ID updated
        const copiedSessionImageObjects: any[] = [];
        // 56) Collector array for images that also have S3 DataURLs fetched
        const copiedSessionImageObjectsWithFetchedS3: any[] = [];

        // 57) Loop through all fetched image documents and prepare copies
        for (let i = 0; i < sourceSessionImageObjectsFromFirestore.length; i++) {
          // 58) Get current source image document
          const sourceImageObject = sourceSessionImageObjectsFromFirestore[i];
          // 59) Deep clone the image object so modifications don't affect the original
          const clonedImageObject: any = JSON.parse(JSON.stringify(sourceImageObject || {}));

          // 60) If the filename contains a user ID prefix, transform it to use the recipient ID
          if (typeof clonedImageObject.filename === 'string' && clonedImageObject.filename.trim()) {
            clonedImageObject.filename = this.changeUserIdPrefixUntilSessionId(clonedImageObject.filename, recipientUserId);
          }

          // 61) Update the cloned image to reflect the new owner (recipient user)
          clonedImageObject.userId = recipientUserId;
          // 62) Update the cloned image to reference the new session
          clonedImageObject.sessionId = newSessionId;

          // 63) Add the cloned (but not yet S3-fetched) image to the collector
          copiedSessionImageObjects.push(clonedImageObject);

          // 64) Extract the S3 key for the original (unmodified) image, or empty string
          const sourceOriginalS3Key = typeof sourceImageObject?.originalS3Key === 'string'
            ? sourceImageObject.originalS3Key
            : '';
          // 65) Extract the S3 key for the image with bounding boxes, or empty string
          const sourceWithBoxesS3Key = typeof sourceImageObject?.withBoxesS3Key === 'string'
            ? sourceImageObject.withBoxesS3Key
            : '';

          // 66) Fetch the original image from S3 as a DataURL (base64 or blob URL), or null
          const originalDataUrl = sourceOriginalS3Key
            ? await service.fetchS3ObjectAsDataUrl(sourceOriginalS3Key)
            : null;
          // 67) Fetch the withBoxes image from S3 as a DataURL, or null
          const withBoxesDataUrl = sourceWithBoxesS3Key
            ? await service.fetchS3ObjectAsDataUrl(sourceWithBoxesS3Key)
            : null;

          // 68) Compose an object that includes the cloned data plus fetched S3 DataURLs
          //  It builds a normalized storedFetchedImageObject by copying clonedImageObject and attaching the fetched DataURLs (original, withBoxes) and S3 key references (originalS3Key, withBoxesS3Key) with sensible fallbacks so later code has a consistent image record for copying/uploading.
          const storedFetchedImageObject: any = {
            ...clonedImageObject,
            // 68a) Use fetched DataURL, fallback to cloned value, then empty string
            original: originalDataUrl || clonedImageObject.original || '',
            // 68b) Use fetched DataURL, fallback to cloned value, then empty string
            withBoxes: withBoxesDataUrl || clonedImageObject.withBoxes || '',
            // 68c) Keep original S3 key reference or mark as null
            originalS3Key: sourceOriginalS3Key || clonedImageObject.originalS3Key || null,
            // 68d) Keep withBoxes S3 key reference or mark as null
            withBoxesS3Key: sourceWithBoxesS3Key || clonedImageObject.withBoxesS3Key || null
          };

          // 69) Add the complete fetched image object to the collector
          copiedSessionImageObjectsWithFetchedS3.push(storedFetchedImageObject);

          // 70) Build list of all possible identifier candidates for this image
          const lookupCandidates = [
            sourceImageObject?.filename,
            sourceImageObject?.originalKey,
            sourceImageObject?.firestoreDocId,
            sourceImageObject?.originalS3Key,
            sourceImageObject?.withBoxesS3Key
          ];

          // 71) Index the fetched image by all valid lookup candidates for later retrieval
          lookupCandidates.forEach((candidate) => {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
              sessionImageObjectsWithFetchedS3ByKey.set(candidate, storedFetchedImageObject);
            }
          });
        }


        
        // 72) Console group to log the one-to-one image copy with transformations
        console.group('[ChatPage.confirmAttachmentShareCopy] Session image object one-to-one copy with filename/userId transformation');
        // 73) Log recipient user ID being used
        console.log('recipientUserId:', recipientUserId);
        // 74) Log all copied session image objects
        console.log('copiedSessionImageObjects:', copiedSessionImageObjects);
        // 75) End console group
        console.groupEnd();
        
        // 76) Store the count of images fetched from S3 for use in the S3 copy loop below
        this.sessionImageObjectCounter = copiedSessionImageObjectsWithFetchedS3.length
        // 77) Console group for logging S3-fetched images
        console.group('[ChatPage.confirmAttachmentShareCopy] Session image objects fetched from S3 and stored');
        // 78) Log the count of images fetched
        console.log('storedCount:', copiedSessionImageObjectsWithFetchedS3.length);
        // 79) Log all the fetched image objects
        console.log('copiedSessionImageObjectsWithFetchedS3:', copiedSessionImageObjectsWithFetchedS3);
        
        // 80) Initialize the image storage service's session ID generator
        this.imageStorage.setGenerateSessionId();

        // 81) Loop through each fetched image to copy its S3 objects and update metadata
        for (let i = 0; i < this.sessionImageObjectCounter; i++) {

          // 82) Log that the loop iteration is executing
          console.log("the loop triggered")
          // 83) Get current image object being processed
          const imgObj = copiedSessionImageObjectsWithFetchedS3[i];
          // 84) Log the "old" (pre-transformation) image object state
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
          
          // 85) Verify that the original image exists in S3 before attempting to copy
          console.log("Original image from originalS3Key", imgObj.originalS3Key);
          this.imageStorage.verifyImageExists(imgObj.originalS3Key);
          // 86) Verify that the withBoxes image exists in S3 before attempting to copy
          console.log("WithBoxes image from withBoxesS3Key", imgObj.withBoxesS3Key);
          this.imageStorage.verifyImageExists(imgObj.withBoxesS3Key);
          // 87) Ensure the image object now shows the recipient as the owner
          imgObj.userId = recipientUserId;

          
          
          // 88) Log the filename before transformation
          console.log("old filename", imgObj.filename);
          // 89) Transform the filename to use recipient user ID
          const newFilename = this.changeUserID(imgObj.filename, recipientUserId);
          // 90) Log the newly-transformed filename
          console.log("new filename", newFilename);
          // 91) Update the image object's filename to the transformed version
          imgObj.filename = newFilename;
          // 92) Log confirmation that the new filename was applied
          console.log("new filename applied to object", imgObj.filename);


        
        // 93) BEGIN ORIGINAL IMAGE COPY OPERATION
          const sourceKey = imgObj.originalS3Key ;
          // 94) Transform the destination S3 key to use recipient user ID
          const destinationKey = this.changeUserID(imgObj.originalS3Key, recipientUserId);
          
          // 95) Log source and destination keys for the original image copy
          console.log("originalS3Key", sourceKey);
        console.log("originaldestinationS3Key", destinationKey);

  // 96) Guard: source and destination must be different (otherwise copy is a no-op)
  if (sourceKey === destinationKey) {
    // 97) If they're the same, log error and abort the entire function
    console.error("Source and Destination are the same. Change the ID first!");
    return;
  }

  // 98) Try to copy the original image S3 object
  try {
    // 99) Call imageStorage service to copy the S3 object from source to destination key
    const result = await this.imageStorage.copyFile(sourceKey, destinationKey);
    // 100) Log the result of the copy operation
    console.log('[ChatPage.confirmAttachmentShareCopy] copyFile result (original):', {
      index: i + 1,
      total: this.sessionImageObjectCounter,
      sourceKey,
      destinationKey,
      result
    });
    
    // 101) If the copy succeeded, update image metadata with new S3 location
    if (result.success) {
      // 102) Define base URL for S3 bucket access (note: may be incomplete URL)
      const bucketBaseUrl = 'my-angular-test-bucket-12345'
      // 103) Compose new metadata object with transformed S3 location
      const newImageMetadata = {
        originalS3Key: destinationKey,
        originalS3Url: `${bucketBaseUrl}${destinationKey}`,
        storagePath: destinationKey,
        storageUrl: `${bucketBaseUrl}${destinationKey}`
      };

       // 104) Update the image object with the new S3 location info
       imgObj.originalS3Key = newImageMetadata.originalS3Key,
       imgObj.originalS3Url = newImageMetadata.originalS3Url,
       imgObj.storagePath = newImageMetadata.storagePath,
       imgObj.storageUrl = newImageMetadata.storageUrl,

      // 105) Log success with the new metadata
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
      // 106) If the copy failed, warn and continue (may retry or skip this image)
      console.warn('[ChatPage.confirmAttachmentShareCopy] copyFile FAILED (original)', {
        index: i + 1,
        total: this.sessionImageObjectCounter,
        sourceKey,
        destinationKey,
        result
      });
    }
  } catch (error) {
    // 107) Catch and log any errors thrown during the S3 copy
    console.error('[ChatPage.confirmAttachmentShareCopy] copyFile ERROR (original)', {
      index: i + 1,
      total: this.sessionImageObjectCounter,
      sourceKey,
      destinationKey,
      error
    });
  } finally {
    // 108) Cleanup (currently no-op but placeholder for future logic)
  }

  // 109) BEGIN WITHBOXES IMAGE COPY OPERATION (same logic as original, but for withBoxes variant)
          const sourceKey2 = imgObj.withBoxesS3Key;
          // 110) Transform the destination S3 key for withBoxes image
          const destinationKey2 = this.changeUserID(imgObj.withBoxesS3Key, recipientUserId);
          
          // 111) Log source and destination keys for the withBoxes image copy
          console.log("withBoxesS3Key", sourceKey2);
        console.log("withBoxesdestinationS3Key", destinationKey2);

  // 112) Guard: source and destination must be different
  if (sourceKey2 === destinationKey2) {
    // 113) If same, abort entire function
    console.error("Source and Destination are the same. Change the ID first!");
    return;
  }

  // 114) Try to copy the withBoxes image S3 object
  try {
    // 115) Call imageStorage service to copy the S3 object
    const result = await this.imageStorage.copyFile(sourceKey2, destinationKey2);
    // 116) Log the result
    console.log('[ChatPage.confirmAttachmentShareCopy] copyFile result (withBoxes):', {
      index: i + 1,
      total: this.sessionImageObjectCounter,
      sourceKey: sourceKey2,
      destinationKey,
      result
    });
    
    // 117) If copy succeeded, update withBoxes metadata
    if (result.success) {
      // 118) Define bucket base URL
      const bucketBaseUrl = 'https://my-angular-test-bucket-12345.s3.ap-southeast-2.amazonaws.com/';
      
      // 119) Compose new metadata for withBoxes S3 location
      const newImageMetadata = {
        withBoxesS3Key: destinationKey,
        withBoxesS3Url: `${bucketBaseUrl}${destinationKey}`,
        withBoxesStoragePath: destinationKey,
        withBoxesStorageUrl: `${bucketBaseUrl}${destinationKey}`
      };

       // 120) Update image object with new withBoxes S3 location info
       imgObj.withBoxesS3Key = newImageMetadata.withBoxesS3Key,
       imgObj.withBoxesS3Url = newImageMetadata.withBoxesS3Url,
       imgObj.withBoxesStoragePath = newImageMetadata.withBoxesStoragePath,
       imgObj.withBoxesStorageUrl = newImageMetadata.withBoxesStorageUrl,

       // 121) Log updated metadata
       console.log("newImageMetadata", newImageMetadata, "imgObj", imgObj);

       // 122) Log success
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
      // 123) If copy failed, warn and continue
      console.warn('[ChatPage.confirmAttachmentShareCopy] copyFile FAILED (withBoxes)', {
        index: i + 1,
        total: this.sessionImageObjectCounter,
        sourceKey: sourceKey2,
        destinationKey,
        result
      });
    }
  } catch (error) {
    // 124) Catch and log errors
    console.error('[ChatPage.confirmAttachmentShareCopy] copyFile ERROR (withBoxes)', {
      index: i + 1,
      total: this.sessionImageObjectCounter,
      sourceKey: sourceKey2,
      destinationKey,
      error
    });
  } finally {
    // 125) Cleanup placeholder
  }



          // 126) Log the updated (post-transformation) image object state
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
            userID: imgObj.userId,
            firestoreDocId: imgObj.filename

          });

          // 127) Log the complete image object for detailed inspection
          console.log("Full imgObj object:", imgObj)
          

          // 128) Try to save the transformed image metadata to Firestore
          try {
            // 129) Log the Firestore save attempt with image details
            console.log('[ChatPage.confirmAttachmentShareCopy] Posting imgObj to Firestore via ImageStorageService helper', {
              imageIndex: i + 1,
              totalImages: this.sessionImageObjectCounter,
              recipientUserId,
              imgObj
            });

            // 130) Call service method to post image object to Firestore for the recipient
            const imageDocId = await (this.imageStorage as any).postSampleImageToFirestoreVersion2(imgObj, recipientUserId);

            // 131) If Firestore save returned a document ID, the save succeeded
            if (imageDocId) {
              // 132) Log successful Firestore save with the returned doc ID
              console.log(`[ChatPage.confirmAttachmentShareCopy] Firestore store SUCCESS for imgObj ${i + 1}/${this.sessionImageObjectCounter}`, {
                imageDocId,
                saved: true,
                imgObj
              });
            } else {
              // 133) If no doc ID was returned, warn that Firestore save may have failed
              console.warn(`[ChatPage.confirmAttachmentShareCopy] Firestore verify returned no doc ID for imgObj ${i + 1}/${this.sessionImageObjectCounter}`, {
                saved: false,
                imgObj
              });
            }
          } catch (storeError) {
            // 134) Catch and log Firestore save errors
            console.error(`[ChatPage.confirmAttachmentShareCopy] Firestore store FAILED for imgObj ${i + 1}/${this.sessionImageObjectCounter}`, {
              error: storeError,
              imgObj
            });
          }

          
      }


        console.groupEnd();
      } catch (firestoreError) {
        // Catch Firestore load errors but continue with fallback (step 134)
        console.warn('[ChatPage.confirmAttachmentShareCopy] Unable to load session images from Firestore, falling back to local cache only:', firestoreError);
      }

      // ===== FALLBACK IMAGE COPY (STEPS 135-151) =====
      // Iterate through source image keys and attempt copy using available sources (Firestore, S3, or local cache)

      for (let i = 0; i < sourceImageKeys.length; i++) {
        // 135) Get the current source image key from the session
        const imageKey = sourceImageKeys[i];
        
        // 136) Try to retrieve image from S3-fetched map (primary source for already-fetched data)
        const fetchedImageFromSessionObjects = sessionImageObjectsWithFetchedS3ByKey.get(imageKey) || null;
        
        // 137) Try to retrieve image from local storage cache service
        const cachedImage = this.getStoredImageForAttachment(imageKey);
        
        // 138) Resolve image priority: fetched > cached > Firestore by key > Firestore by filename > null
        const originalImage = fetchedImageFromSessionObjects
          || cachedImage
          || firestoreImageObjects.get(imageKey)
          || firestoreImageObjects.get(cachedImage?.filename || '')
          || null;

        // 139) Guard: skip this image if no usable source was found
        if (!originalImage) {
          console.warn('[ChatPage.confirmAttachmentShareCopy] Image not found for key:', imageKey);
          continue;
        }

        // 140) Update progress bar: interpolate between 15% and 60% (45% range) based on image index
        this.updateCopyProgress(
          15 + ((i / Math.max(sourceImageKeys.length, 1)) * 45),
          `Copying image ${i + 1}/${sourceImageKeys.length}...`
        );

        // 141) Call helper to copy image for recipient (transforms filenames, handles S3/Firestore upload)
        const copiedImage = await this.copySessionImageForRecipient(originalImage, imageKey, recipientUserId, newSessionId);
        
        // 142) Guard: skip if copy failed (no usable data or upload error)
        if (!copiedImage) {
          console.warn('[ChatPage.confirmAttachmentShareCopy] Skipping image because no usable image data was found:', imageKey);
          continue;
        }

        // 143) Add successfully copied image to collector array
        copiedImages.push(copiedImage);
        
        // 144) Record upload status (attempted/succeeded flags for original and withBoxes variants)
        uploadStatusByImage.push({
          sourceImageKey: imageKey,
          copiedFilename: copiedImage.filename,
          originalUploadAttempted: !!copiedImage.originalUploadAttempted,
          originalUploadSucceeded: !!copiedImage.originalUploadSucceeded,
          withBoxesUploadAttempted: !!copiedImage.withBoxesUploadAttempted,
          withBoxesUploadSucceeded: !!copiedImage.withBoxesUploadSucceeded
        });

        // 145) Transform the source key to use recipient user ID
        const transformedOriginalKey = this.transformKeyForAttachmentShare(imageKey, recipientUserId);
        
        // 146) Check if this transformed key already exists in the copied session's imageKeys array
        const existingKeyIndex = copiedSession.imageKeys.findIndex((key: string) => key === transformedOriginalKey);
        
        // 147) Update existing entry or add new one to the imageKeys array
        if (existingKeyIndex >= 0) {
          copiedSession.imageKeys[existingKeyIndex] = copiedImage.filename;
        } else {
          copiedSession.imageKeys.push(copiedImage.filename);
        }

        // 148) If service has addImage helper, call it to register image locally
        if (typeof service.addImage === 'function') {
          await service.addImage(copiedImage);
        }
      }

      // ===== SESSION REGISTRATION & UPLOAD (STEPS 152-174) =====
      // Register the copied session locally and upload to Firestore

      // 152) Set totalBoundingBoxes: use copied value > fallback to original > default to 0
      copiedSession.totalBoundingBoxes = copiedSession.totalBoundingBoxes ?? selectedSession.totalBoundingBoxes ?? 0;

      // 153) Call service to register session locally (prefer registerSession, fallback to addSessionIfNotExists)
      if (typeof service.registerSession === 'function') {
        service.registerSession(copiedSession);
      } else if (typeof service.addSessionIfNotExists === 'function') {
        service.addSessionIfNotExists(copiedSession);
      }

      // 154) Update progress to 70% and set status message
      this.updateCopyProgress(70, 'Uploading copied session to Firestore...');

      // 155) Log copied session with engineer-checked flag for debugging
      console.log("Copied Session", copiedSession, "Copied Session EngineerChecked", copiedSession.engineerCheckedSession);
    
      // 156) Log original session with engineer-checked flag for comparison
      console.log("Selected Session", selectedSession, "Selected Session EngineerChecked", selectedSession.engineerCheckedSession);

      // 157) Verify notes field is present and properly typed before Firestore save
      console.log('[ChatPage.confirmAttachmentShareCopy] Verifying notes field before Firestore save', {
        sourceSessionNotes: selectedSession.notes || '',
        copiedSessionNotes: copiedSession.notes || '',
        notesWillBeSaved: {
          notes: copiedSession.notes,
          notesType: typeof copiedSession.notes,
          notesLength: typeof copiedSession.notes === 'string' ? copiedSession.notes.length : 0
        }
      });

      // 158) Log final state of sanitized IDs before Firestore save
      console.log('[ChatPage.confirmAttachmentShareCopy] Preparing Firestore session save with sanitized IDs', {
        copiedSessionId: copiedSession.id,
        copiedSessionUserId: copiedSession.userId,
        receiverId,
        recipientUserId,
        receiverUserIdState: this.receiverUserId,
        newRecepientUserIdState: this.newRecepientUserId
      });

      // 159) Call service method to save copied session and images to Firestore under recipient's user ID
      await service.saveSessionWithImagesToFirestore(copiedSession.id, receiverId);

      // 160) Update progress to 100% and set completion message
      this.updateCopyProgress(100, 'Session copy completed');

      // 161) Verify notes field persisted correctly after Firestore save
      console.log('[ChatPage.confirmAttachmentShareCopy] Post-save notes verification', {
        originalSessionNotes: selectedSession.notes || '(empty)',
        copiedSessionNotes: copiedSession.notes || '(empty)',
        originalNotesLength: typeof selectedSession.notes === 'string' ? selectedSession.notes.length : 0,
        copiedNotesLength: typeof copiedSession.notes === 'string' ? copiedSession.notes.length : 0
      });

      // 162) Final debug output of notes comparison
      console.log("Original Session Notes", selectedSession.notes);
      console.log("Copied Session Notes", copiedSession.notes);

      // 163) Log workflow completion and full session summary
      console.log('[ChatPage.confirmAttachmentShareCopy] ===== SESSION COPY WORKFLOW COMPLETE =====');
      console.log('[ChatPage.confirmAttachmentShareCopy] Original session:', selectedSession);
      console.log('[ChatPage.confirmAttachmentShareCopy] Copied session:', copiedSession);
      console.log('[ChatPage.confirmAttachmentShareCopy] Copied images:', copiedImages);
      console.log('[ChatPage.confirmAttachmentShareCopy] Firestore image objects used for copy:', Array.from(firestoreImageObjects.values()));
      console.log('[ChatPage.confirmAttachmentShareCopy] Per-image upload status (original/withBoxes):', uploadStatusByImage);

      // 164) Log user IDs for audit trail
      console.log('Receiver user ID:', receiverId);
      console.log('Current user ID:', currentUserId);

      // 165) Filter to find any images where upload was attempted but failed
      const failedUploads = uploadStatusByImage.filter((item) => {
        const originalFailed = item.originalUploadAttempted && !item.originalUploadSucceeded;
        const withBoxesFailed = item.withBoxesUploadAttempted && !item.withBoxesUploadSucceeded;
        return originalFailed || withBoxesFailed;
      });

      // 166) Log warning if any uploads failed (soft warning, workflow still completes)
      if (failedUploads.length > 0) {
        console.warn('[ChatPage.confirmAttachmentShareCopy] Some image uploads did not complete successfully:', failedUploads);
      }

      // ===== CONFIRMATION & CLEANUP (STEPS 175-189) =====
      // Mark operation complete, close dialogs, send confirmation message, and handle errors

      // 175) Mark the copy operation as complete (no longer in progress)
      this.isAttachmentCopyInProgress = false;
      
      // 176) Set debug state to 'completed' for UI to show completion status
      this.attachmentDebugState = 'completed';
      
      // 177) Store the copied session as the debug attachment for inspection
      this.selectedAttachmentForDebug = copiedSession;

      // 178) Try to send a confirmation message in the current chat with the shared session ID attached
      try {
        // 179) Verify a chat is currently open
        if (this.currentChatId) {
          // 180) Resolve sender ID from current user
          const senderId = this.auth3.getCurrentUser()?.uid || this.userID || '';
          
          // 181) Extract the new session ID for attachment to message
          const sharedSessionId = copiedSession?.id || null;
          
          // 182) Send confirmation message with shared session metadata
          await this.chatService.sendMessage(this.currentChatId, {
            senderId,
            receiverId,
            text: 'File shared successfully',
            sharedSessionId,
            metadata: {
              sharedSessionId
            }
          });
          
          // 183) Log successful message send
          console.log('[ChatPage.confirmAttachmentShareCopy] Sent confirmation message with sharedSessionId', sharedSessionId);
        } else {
          // 184) Warn if no active chat to send message to
          console.warn('[ChatPage.confirmAttachmentShareCopy] No current chat to send confirmation message to.');
        }
      } catch (sendErr) {
        // 185) Catch and log message send failures (non-fatal)
        console.warn('[ChatPage.confirmAttachmentShareCopy] Failed to send confirmation message', sendErr);
      }
    } catch (error) {
      // 186) Catch any unhandled errors from the entire copy workflow
      console.error('[ChatPage.confirmAttachmentShareCopy] Failed to copy session:', error);
      
      // 187) Reset all copy operation flags to indicate failure
      this.isAttachmentCopyInProgress = false;
      this.attachmentCopyProgress = 0;
      this.attachmentCopyStatusText = '';
      this.attachmentDebugState = 'inactive';
      
      // 188) Show alert to user indicating operation failed
      alert('Error sharing session. Check console for details.');
      
      // 189) Exit the function early to prevent further operations
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



  // Confirm sharing completion: close dialogs and request location permission
    async confirmSharingComplete(): Promise<void> {
      try {
        // 1) Close the attachment debug dialog so the UI hides the debug overlay
        this.isAttachmentDebugDialogOpen = false;
        // 2) Clear the stored debug attachment reference used for inspection
        this.selectedAttachmentForDebug = null;
        // 3) Mark the debug state as inactive to update any debug UI indicators
        this.attachmentDebugState = 'inactive';
        // 4) Close the attachment sheet (hides the session/attachment UI panel)
        this.closeAttachmentSheet();

        // 5) (optional) Auto-send a brief success message into the chat.
        //    This block is commented out to avoid unexpected messages; uncomment
        //    if you want the app to send the string automatically after sharing.
        // this.messageText = 'File shared successfully';
        // setTimeout(() => {
        //   this.sendMessage();
        // }, 500);

        // 6) Log intent to request location permission for optional features
        console.log('[ChatPage] Requesting location permission for enhanced features...');
        // 7) (optional) Call the interactive permission helper. Left commented
        //    to avoid prompting the user unexpectedly during automated flows.
        // await this.requestLocationPermissionForFeatures();
      } catch (e) {
        // 8) Catch and log any error that occurred during cleanup so the app
        //    can continue running and the developer sees the failure cause.
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
      // 1) Build a non-greedy regex to match the FIRST 'userID:...sessionId:' chunk
      //    It captures the user id portion between 'userID:' and the following 'sessionId:'
      //    Pattern: ^userID:(.+?)sessionId:
      const match = filename.match(/^userID:(.+?)sessionId:/);

      // 2) If the pattern matches, we will stitch a new filename that keeps the
      //    sessionId and any trailing data but replaces the captured user id.
      if (match) {
        // 3) `match[1]` is the old user id that was captured by the regex
        const oldUserId = match[1];
        // 4) Find the index where 'sessionId:' begins so we can preserve the rest
        const restIndex = filename.indexOf('sessionId:');
        // 5) Slice the string from 'sessionId:' to the end (keeps suffix intact)
        const rest = filename.substring(restIndex); // includes 'sessionId:' and everything after
        // 6) Compose the new filename by inserting the new user id and keeping the suffix
        const newFilename = `userID:${newUserId}${rest}`;

        // 7) Log the original and transformed values for debugging/audit
        console.log(`[ChatPage] Filename transform successful:`);
        console.log(`  Original:    ${filename}`);
        console.log(`  Transformed: ${newFilename}`);
        console.log(`  Old UserID:  ${oldUserId}`);
        console.log(`  New UserID:  ${newUserId}`);

        // 8) Return the safely transformed filename
        return newFilename;
      } else {
        // 9) If the expected pattern is not present, warn and return input unchanged
        console.warn('[ChatPage] Filename pattern not recognized for transformation');
        console.warn(`  Pattern expected: userID:<userId>sessionId:...`);
        console.warn(`  Actual filename:  ${filename}`);
        return filename;
      }
    } catch (e) {
      // 10) On any unexpected error, log details and return the original filename
      console.error('[ChatPage] Error transforming filename:', e);
      console.error(`  Filename: ${filename}`);
      console.error(`  New UserID: ${newUserId}`);
      return filename;
    }
  }

  private updateCopyProgress(percent: number, status: string): void {
    // 1) Ensure the progress percentage never exceeds 100 and store it
    this.attachmentCopyProgress = Math.min(percent, 100);
    // 2) Update the human-readable status text shown in the UI
    this.attachmentCopyStatusText = status;
    // 3) Emit a concise console log for developer debugging/tracing
    console.log(`[ChatPage.copyProgress] ${percent}% - ${status}`);
  }

  // Debug method: print attachment object and related images from Firestore/S3
  private async debugPrintAttachmentData(attachment: any): Promise<void> {
    try {
      // 1) Print a clear header so the debug output is easy to find in the console
      console.log('========== ATTACHMENT DEBUG INFO ==========');

      // 2) Deep-clone and log the attachment object to avoid accidental mutations
      //    during inspection (JSON stringify removes circular refs for readability)
      console.log('Attachment Object:', JSON.parse(JSON.stringify(attachment)));

      // 3) If this attachment represents a saved session (has type 'session' and an id)
      //    we print richer session metadata below; otherwise we skip to the end.
      if (attachment?.type === 'session' && attachment?.id) {
        // 4) Section header for session-specific details
        console.log('\n--- Session Details ---');

        // 5) Log the canonical session properties that help identify the session
        console.log('Session ID:', attachment.id);
        console.log('Session Name:', attachment.name);
        console.log('Image Count:', attachment.imageCount || 0);
        console.log('Image Keys Count:', attachment.imageKeys?.length || 0);
        console.log('Image Keys:', attachment.imageKeys);
        console.log('Total Bounding Boxes:', attachment.totalBoundingBoxes || 0);
        console.log('Created:', attachment.created);

        // 6) Attempt to retrieve all locally stored image objects from the
        //    injected imageStorage abstraction. Different versions expose
        //    different helpers so we defensively check both APIs.
        let allImages: any[] = [];
        try {
          // 7) Prefer the `getAllImages` API when available
          if (typeof (this.imageStorage as any).getAllImages === 'function') {
            const result = (this.imageStorage as any).getAllImages();
            allImages = result instanceof Promise ? await result : result;
          // 8) Fallback to `getImages` for older implementations
          } else if (typeof (this.imageStorage as any).getImages === 'function') {
            const result = (this.imageStorage as any).getImages();
            allImages = result instanceof Promise ? await result : result;
          }
          // 9) Normalize to an array if the call returned something unexpected
          if (!Array.isArray(allImages)) allImages = [];
        } catch (e) {
          // 10) If any error occurs while fetching cached images, log a warning
          //     and continue with an empty list so diagnostics remain non-blocking.
          console.warn('[ChatPage] Failed to get all images:', e);
          allImages = [];
        }

        // 11) Print a short summary of the local image cache for developer insight
        console.log('\n--- All Stored Images ---');
        console.log('Total Stored Images:', allImages.length);
        // 12) The detailed per-image logs are commented out to avoid noisy output;
        //     they can be enabled for deeper inspection during debugging.
        allImages.forEach((img: any, idx: number) => {
          // console.log(`  [${idx}] Filename: ${img.filename}, Original: ${img.original?.substring?.(0, 50)}..., S3: ${img.s3Url?.substring?.(0, 50) || 'N/A'}...`);
        });

        // 13) Build a list of images that belong to this session by matching
        //     either the stored `filename` or the `original` URL against the
        //     attachment's `imageKeys` array (multiple possible identifier fields)
        const sessionImages = allImages.filter((img: any) => 
          attachment.imageKeys?.includes(img.filename) || 
          attachment.imageKeys?.includes(img.original)
        );
        // 14) Per-image session logs are intentionally commented out; uncomment
        //     the block below when you need a full dump of each matched image.
        // console.log(`\n--- Images in this Session (${sessionImages.length} total) ---`);
        // sessionImages.forEach((img: any, idx: number) => {
        //   console.log(`  [${idx}] Filename: ${img.filename}`);
        //   console.log(`       Original: ${img.original}`);
        //   console.log(`       S3 URL: ${img.s3Url}`);
        //   console.log(`       Boxes: ${img.boxes?.length || 0}`);
        // });
      } else {
        // 15) For non-session attachments we currently do not print extra details;
        //     helper logs are left commented for optional use in the future.
        // console.log('\n--- Message Attachment Details ---');
        // console.log('Type:', attachment?.type);
        // console.log('Size:', attachment?.size);
      }

      // 16) Print a footer so the debug output block is visually delimited
      console.log('========== END DEBUG INFO ==========\n');
    } catch (e) {
      // 17) Any unexpected error during the diagnostic flow is logged here
      //     to aid troubleshooting without bubbling the exception further.
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
  private searchConversationResultsBackup: any[] = [];
  private engineersBackup: any[] = [];
  // active bottom navigation tab: 'person' | 'people' | 'location' | 'settings'
  activeTab: 'person' | 'people' | 'location' | 'settings' | 'profile' = 'people';
  private map?: L.Map | null = null;
  private baseTileLayer?: OfflineLeafletTileLayer;
  private userLocationMarker?: L.Marker;
  private readonly fallbackCoordinates = { latitude: 10.324849, longitude: 123.849164 };
  private pendingMapLocation: { latitude: number; longitude: number; label?: string } | null = null;
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
  private incomingMarkerLocationActive = false;
  private isBackgroundLocationFetchActive = false;
  private backgroundLocationFetchInterval?: ReturnType<typeof setInterval>;

  private dismissMapTapOverlay(): void {
    if (!this.mapTapOverlayElement) return;
    try { document.body.removeChild(this.mapTapOverlayElement); } catch {}
    this.mapTapOverlayElement = undefined;
  }


  /**
   * Returns true when the given DOM element is actually visible to the user.
   * Checks computed styles (`display`, `visibility`, `opacity`), layout size
   * (positive `width`/`height`), and whether the element's bounding rect
   * intersects the current viewport. Use to determine if an element is
   * rendered and at least partly on-screen.
   */
  private isElementVisiblyRendered(element: HTMLElement): boolean {
    // 1) Read computed styles to detect CSS-level hiding (display/visibility/opacity)
    const style = window.getComputedStyle(element);
    // 2) Get the element's bounding client rect (position and size in viewport coordinates)
    const rect = element.getBoundingClientRect();
    // 3) Resolve the current viewport dimensions (fallback to document dimensions)
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    // 4) Check whether the element's rect intersects the visible viewport at all
    const intersectsViewport = (
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= viewportHeight &&
      rect.left <= viewportWidth
    );

    // 5) Final visibility decision: element is considered visibly rendered when
    //    - it's not hidden by CSS (`display`, `visibility`, or `opacity`)
    //    - it has a positive layout size (`width` and `height` > 0)
    //    - and at least part of its bounding rect intersects the viewport
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
    // 1) Guard: ensure the Leaflet map instance exists before attempting to draw
    if (!this.map) {
      console.warn('[ChatPage.markerSquare] Skipped drawing square because map is not initialized.');
      return;
    }

    // 2) Compute square geometry in meters: half side (meters) and full side
    const halfSideMeters = this.markerSquareHalfSideMeters;
    const sideMeters = halfSideMeters * 2;

    // 3) Convert meter distances to latitude/longitude degrees at this latitude
    //    - metersPerDegreeLat is an approximate constant for latitude
    //    - longitude degrees shrink with latitude; use cos(lat) to adjust
    const metersPerDegreeLat = 111_320;
    const cosLat = Math.cos((center.lat * Math.PI) / 180);
    const metersPerDegreeLng = Math.max(1, Math.abs(cosLat) * 111_320);
    // 4) Delta degrees to move from center to square edges
    const deltaLat = halfSideMeters / metersPerDegreeLat;
    const deltaLng = halfSideMeters / metersPerDegreeLng;

    // 5) Build Leaflet LatLng corners for the rectangle bounds
    const southWest = L.latLng(center.lat - deltaLat, center.lng - deltaLng);
    const northEast = L.latLng(center.lat + deltaLat, center.lng + deltaLng);
    const squareBounds = L.latLngBounds(southWest, northEast);

    // 6) Remove any previously-drawn selection square to avoid duplicates
    try {
      this.markerSelectionSquare?.remove();
    } catch {}

    // 7) Create a new rectangle (non-filled, non-interactive) and add it to the map
    this.markerSelectionSquare = L.rectangle(squareBounds, {
      color: '#111111',
      weight: 2,
      fill: false,
      interactive: false
    }).addTo(this.map);

    // 8) Bring the rectangle to the front so it displays above other layers
    try { this.markerSelectionSquare.bringToFront(); } catch {}

    // 9) Compute some human-readable metrics for logging (area, hectares, corner radius)
    const areaSqMeters = sideMeters * sideMeters;
    const areaHectares = areaSqMeters / 10_000;
    const cornerRadiusMeters = Math.sqrt(2) * halfSideMeters;

    // 10) Log a compact summary including geometry and bounding coordinates
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

  /**
   * Waits for the Leaflet map to exist before location-tab logic continues.
   * It checks for an already-initialized map first, then looks for the map DOM
   * element, tries to initialize the map when the element is present, and
   * retries a limited number of times with a small delay between attempts.
   */
  private async ensureMapReadyForLocationTab(maxAttempts: number = 18, delayMs: number = 120): Promise<L.Map | null> {
    // Try multiple times because the location tab can render before the map is ready.
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // If the Leaflet map already exists, return it immediately.
      if (this.map) {
        return this.map;
      }

      // Check whether the map container exists in the DOM yet.
      const mapElement = document.getElementById('map');
      if (mapElement) {
        // If the container exists, attempt to initialize the map instance.
        await this.initMap();

        // If initialization succeeded, return the ready map.
        if (this.map) {
          return this.map;
        }
      }

      // Pause briefly before retrying so Angular/DOM rendering can catch up.
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), delayMs);
      });
    }

    // After all attempts, return the map if available; otherwise return null.
    return this.map ?? null;
  }

  // Conversation search results (loaded dynamically)
  searchConversationResults: any[] = [];

  // dynamic list of users with role 'engineer' from Firestore
  engineers: any[] = [];

  // Real-time chat list for the current user
  chats: any[] = [];
  private chatsSub?: Subscription;

  // Test markers (similar to goalTasks) for placing sample markers on the Leaflet map
  testMarkers: Array<{ id: number; name: string; latitude: number; longitude: number }> = [
    
  ];

  // Ensure the stories property is declared and initialized
  stories: any[] = [];

  /** Inject auth, router, and image storage services for navigation and data. */
  constructor(private formBuilder: FormBuilder, private router: Router, private route: ActivatedRoute, private authService: AuthService, private navCtrl: NavController, public auth3: Auth3Service, private imageStorage: ImageStorageService, private platform: Platform, private firestore: Firestore, private chatService: ChatService, private presenceService: PresenceService, private userPrefetchCache: UserPrefetchCacheService, private offlineMapTileService: OfflineMapTileService, private ngZone: NgZone) {

  }


/**
 * Component startup entry point.
 * Restores incoming navigation state, primes location/map behavior,
 * hydrates cached user data, and starts the chat/location background services.
 */
ngOnInit(): void {
  // 1) Emit a clear startup marker so initialization is easy to spot in the console.
  console.log('[ChatPage.ngOnInit] ===== PAGE INIT START (ngOnInit called) =====');

  // 2) Log the current authenticated user so we can confirm which account is booting.
  console.log('[ChatPage.ngOnInit] Auth currentUser on ngOnInit:', this.auth3.getCurrentUser()?.uid || 'null');

  // 3) Read any incoming map location from the route/query/session state.
  this.loadIncomingMapLocation();

  // 4) If navigation passed an `activeTab`, restore it so the user returns to the same section.
  try {
    const nav: any = (this.router && (this.router as any).getCurrentNavigation) ? (this.router as any).getCurrentNavigation() : null;
    const stateTab = (nav && nav.extras && nav.extras.state && (nav.extras.state as any).activeTab) || (history && (history.state && (history.state as any).activeTab));
    if (stateTab === 'people' || stateTab === 'location') {
      this.activeTab = stateTab;
      console.log('[ChatPage.ngOnInit] activeTab set from navigation state:', this.activeTab);
    }
  } catch (e) {
    // 5) Ignore navigation-state lookup errors so startup still continues.
  }

  // 6) If the location tab is active on entry, kick off map startup and offline download work.
  if (this.activeTab === 'location') {
    this.scheduleMapInitialization();
    this.startMapRefreshTimer();
    void this.triggerOfflineDownloadWithDefaults();
  }

  // 7) Resolve the current user id from cache/auth so the app can hydrate the correct data set.
  const cachedUid = this.resolveCachedUid();
  if (cachedUid) {
    // 8) Update the visible cache-sync label for this user.
    this.refreshCacheWarmStatus(cachedUid);

    // 9) If a cached profile exists, populate name/email fields from it.
    const cachedProfile = this.userPrefetchCache.getCachedUserProfile(cachedUid);
    if (cachedProfile) {
      this.firstName = cachedProfile.firstName || this.firstName;
      this.lastName = cachedProfile.lastName || this.lastName;
      this.email = cachedProfile.email || this.email;
    }

    // 10) Restore cached chat previews so the chat list appears immediately.
    const cachedChats = this.userPrefetchCache.getCachedChats(cachedUid);
    if (cachedChats.length > 0) {
      this.chats = [...cachedChats];
    }

    // 11) Restore cached engineers and keep a backup copy for search reset behavior.
    const cachedEngineers = this.userPrefetchCache.getCachedEngineers(cachedUid);
    if (cachedEngineers.length > 0) {
      this.engineers = [...cachedEngineers];
      this.engineersBackup = [...cachedEngineers];
    }

    // 12) Refresh the cache in the background so the UI can stay responsive.
    this.userPrefetchCache.warmUserDataInBackground(cachedUid, 'chat-page-ngOnInit').finally(() => {
      this.refreshCacheWarmStatus(cachedUid);
    });

    // 13) Only bootstrap the user's own location when no incoming map marker is taking precedence.
    if (!this.incomingMarkerLocationActive) {
      // 14) Load stored location and begin background marker fetching for the current user.
      this.loadUserLocationAndStartBackgroundFetch(cachedUid);

      // 15) Attempt to fetch and persist the current location for later use.
      void this.getAndSaveCurrentLocation();
    } else {
      // 16) Keep the incoming marker location intact and skip the normal location bootstrap.
      console.log('[ChatPage.ngOnInit] Incoming marker location active; skipping user location bootstrap.');
    }
  }

  // 17) Finish app bootstrap: initialize remaining services and live subscriptions.
  this.initialize();
  this.refreshOfflineAreaList();
  this.startUserChatsSubscription().catch((err) => {
    console.warn('[ChatPage.ngOnInit] Unable to start chat list subscription:', err);
  });
  
  // 18) Start the periodic recovery loop for internet/location/map state.
  this.startServiceRecoveryChecker();

  // 19) Register the hardware back button handler last so it can react to the final UI state.
  this.setupHardwareBackButton();
}

/**
 * Loads an incoming map location from the URL, navigation state, or session storage.
 * The first valid source wins, then the location tab is activated and the pending
 * marker location is stored so the map can open on that position.
 */
private loadIncomingMapLocation(): void {
  // 1) Read the query parameters from the current route snapshot.
  const queryParamMap = this.route?.snapshot?.queryParamMap;

  // 2) Try to parse latitude/longitude from the URL query string.
  const queryLatitude = queryParamMap ? Number.parseFloat(queryParamMap.get('markerLat') || '') : Number.NaN;
  const queryLongitude = queryParamMap ? Number.parseFloat(queryParamMap.get('markerLng') || '') : Number.NaN;

  // 3) Read the browser history state as a secondary source.
  const navState: any = history?.state || {};

  // 4) Parse latitude/longitude from navigation state if present.
  const stateLatitude = Number.parseFloat(navState?.markerLat);
  const stateLongitude = Number.parseFloat(navState?.markerLng);

  // 5) Prefer the URL query parameters when both coordinates are valid.
  if (Number.isFinite(queryLatitude) && Number.isFinite(queryLongitude)) {
    this.pendingMapLocation = {
      latitude: queryLatitude,
      longitude: queryLongitude,
      label: queryParamMap?.get('markerLabel') || undefined
    };
  } else if (Number.isFinite(stateLatitude) && Number.isFinite(stateLongitude)) {
    // 6) Otherwise, fall back to the navigation state values.
    this.pendingMapLocation = {
      latitude: stateLatitude,
      longitude: stateLongitude,
      label: navState?.markerLabel || undefined
    };
  } else {
    // 7) If neither source is valid, try the last stored marker location in session storage.
    try {
      const storedMarkerLocationRaw = sessionStorage.getItem('selectedMarkerLocation');
      if (storedMarkerLocationRaw) {
        const storedMarkerLocation = JSON.parse(storedMarkerLocationRaw);

        // 8) Parse the stored coordinates and only use them when both are finite numbers.
        const storedLatitude = Number.parseFloat(storedMarkerLocation?.latitude);
        const storedLongitude = Number.parseFloat(storedMarkerLocation?.longitude);

        if (Number.isFinite(storedLatitude) && Number.isFinite(storedLongitude)) {
          this.pendingMapLocation = {
            latitude: storedLatitude,
            longitude: storedLongitude,
            label: storedMarkerLocation?.markerData?.name || storedMarkerLocation?.markerData?.address || undefined
          };
        }
      }
    } catch (error) {
      // 9) Ignore storage parsing failures and keep startup moving.
      console.warn('[ChatPage.loadIncomingMapLocation] Failed to read stored marker location:', error);
    }
  }

  // 10) If a valid incoming location was found, switch the UI into location mode.
  if (this.pendingMapLocation) {
    this.activeTab = 'location';
    this.incomingMarkerLocationActive = true;

    // 11) Seed the current location object with the incoming marker coordinates.
    this.currentUserLocation = {
      latitude: this.pendingMapLocation.latitude,
      longitude: this.pendingMapLocation.longitude,
      accuracy: 0,
      timestamp: new Date().toISOString()
    };

    // 12) Log the resolved location for debugging.
    console.log('[ChatPage.loadIncomingMapLocation] Incoming map location loaded:', this.pendingMapLocation);

    // 13) Remove the stored marker payload so it does not get reused on later visits.
    try {
      sessionStorage.removeItem('selectedMarkerLocation');
    } catch (error) {
      console.warn('[ChatPage.loadIncomingMapLocation] Failed to clear stored marker location:', error);
    }
  }
}

getCurrentMapBoundsBBox(): { west: number; south: number; east: number; north: number } | null {
  /**
   * getCurrentMapBoundsBBox
   * ------------------------
   * Returns a simple bounding-box representation of the current Leaflet map
   * viewport. If the map instance isn't available (not yet initialized), the
   * function returns `null`.
   *
   * Line-by-line:
   * 1) Guard early when `this.map` is falsy and return `null`.
   * 2) Read the Leaflet `LatLngBounds` object from `this.map`.
   * 3) Build and return a plain object with numeric `west`, `south`, `east`,
   *    and `north` properties extracted from the bounds.
   */

  // Guard: map not ready -> no meaningful bounds to return
  if (!this.map) {
    return null;
  }

  // Read Leaflet LatLngBounds for the current viewport
  const bounds = this.map.getBounds();

  // Convert Leaflet bounds API to a compact plain object BBox
  return {
    // Minimum longitude (west edge)
    west: bounds.getWest(),
    // Minimum latitude (south edge)
    south: bounds.getSouth(),
    // Maximum longitude (east edge)
    east: bounds.getEast(),
    // Maximum latitude (north edge)
    north: bounds.getNorth()
  };
}

toggleOfflineMode(): void {
  /**
   * toggleOfflineMode
   * ------------------
   * Toggle the component's offline tile rendering mode and update UI state.
   *
   * Line-by-line:
   * 1) Flip the `offlineModeEnabled` boolean on the component.
   * 2) Re-apply the effective tile layer mode so the map tile layer updates.
   * 3) Update a human-readable status string to reflect the current mode.
   */

  // 1) Toggle the offline mode flag
  this.offlineModeEnabled = !this.offlineModeEnabled;

  // 2) Tell the tile layer to switch to the effective mode (offline/online)
  this.applyEffectiveTileLayerMode();

  // 3) Update user-facing status text depending on the new state
  this.offlineDownloadStatusText = this.offlineModeEnabled
    ? 'Offline mode enabled. Only cached tiles will render.'
    : 'Offline mode disabled. Online fallback enabled.';
}

/**
 * isNativeDevice
 * --------------
 * Returns `true` when the app is running on a native mobile platform
 * (Android or iOS). This is used to adjust timeouts / behavior for
 * device-specific performance characteristics.
 *
 * Line-by-line:
 * 1) Query the injected `Platform` service for Android runtime.
 * 2) Query the injected `Platform` service for iOS runtime.
 * 3) Return true if either platform check passes.
 */
private isNativeDevice(): boolean {
  // 1-2) Check platform flags exposed by Ionic's Platform service
  return this.platform.is('android') || this.platform.is('ios');
}

  /**
   * downloadVisibleMapAreaOffline(): Promise<void>
   *
   * Purpose: Downloads map tiles for the currently visible map area to enable offline browsing.
   * This function handles validation, progress tracking, device-aware timeout calculations,
   * and error recovery for tile downloads.
   *
   * High-level flow:
   * 1) Validate map exists and is initialized
   * 2) Validate zoom range is valid (min <= max)
   * 3) Extract current visible map bounds
   * 4) Initiate tile download with progress tracking
   * 5) Monitor for stalled downloads
   * 6) Calculate device-specific timeouts (longer on mobile devices)
   * 7) Race download against timeout promise
   * 8) Handle success or failure
   * 9) Clean up progress monitor
   */
  async downloadVisibleMapAreaOffline(): Promise<void> {
    // 1) Log entry point and current platform (NATIVE = Android/iOS, WEB/BROWSER = web version)
    console.log('[ChatPage.download] Function called');
    console.log('[ChatPage.download] Platform:', this.isNativeDevice() ? 'NATIVE (Android/iOS)' : 'WEB/BROWSER');
    
    // 2) Verify map instance exists; if not, attempt initialization
    if (!this.map) {
      console.warn('[ChatPage.download] Map not initialized, attempting to initialize...');
      await this.initMap();
      // 3) Guard: if map initialization failed, exit early to prevent errors
      if (!this.map) {
        console.error('[ChatPage.download] Failed to initialize map');
        return;
      }
    }

    // 4) Extract and floor min/max zoom levels from component state
    const minZoom = Math.floor(this.offlineMinZoom);
    const maxZoom = Math.floor(this.offlineMaxZoom);
    // 5) Validate zoom range: max must be >= min (logical requirement for zoom range)
    if (maxZoom < minZoom) {
      console.error('[ChatPage.download] Invalid zoom range:', {minZoom, maxZoom});
      alert('Invalid zoom range: max zoom must be greater than or equal to min zoom.');
      return;
    }

    // 6) Read the current visible map bounds (NW/SE corners of viewport)
    const bounds = this.map.getBounds();
    console.log('[ChatPage.download] Map bounds:', bounds);
    
    // 7) Set UI flags to indicate download is starting
    this.offlineDownloadInProgress = true;
    this.offlineDownloadProgressPct = 0;
    this.offlineDownloadStatusText = 'Preparing offline tile download...';
    console.log('[ChatPage.download] Starting offline download with settings:', {
      minZoom, maxZoom, maxTiles: this.offlineMaxTilesPerDownload
    });

    // 8) Initialize progress tracking variables (used by progress callback and monitor)
    let lastProgressTime = Date.now();
    let lastProgressPercentage = 0;
    const progressCheckIntervalMs = 5000; // Check for progress every 5 seconds
    const maxNoProgressTimeMs = 30000; // Timeout if no progress for 30 seconds
    const isNative = this.isNativeDevice();

    try {
      console.log('[ChatPage.download] Calling service.downloadTilesForBounds...');
      
      // 9) Initiate the tile download by calling the offline service with current map bounds and settings
      //    This returns a promise that completes when all tiles are fetched/cached
      const downloadPromise = this.offlineMapTileService.downloadTilesForBounds({
        bounds,           // Map viewport boundaries (NW/SE corners)
        minZoom,          // Starting zoom level for tile download
        maxZoom,          // Highest zoom level for tile download
        urlTemplate: this.osmTileTemplate,  // URL pattern for tile requests (e.g., OpenStreetMap)
        subdomains: this.offlineTileSubdomains,  // Subdomains for load balancing (a/b/c)
        maxTiles: this.offlineMaxTilesPerDownload,  // Hard limit on number of tiles to download
        concurrency: 6,   // Number of simultaneous tile downloads
        areaName: (this.offlineAreaName || '').trim() || `Area ${new Date().toLocaleString()}`,  // User-friendly name for this download area
        // 10) Progress callback: invoked periodically by the download service with status updates
        onProgress: (progress) => {
          try {
            const now = Date.now();
            // 11) Update timestamp so stall detector knows download is still active
            lastProgressTime = now;
            // 12) Capture current percentage for display and stall detection
            lastProgressPercentage = progress.percentage;
            
            // 13) Log progress details for debugging (completed tiles, total, percentage)
            console.log('[ChatPage.progress] Callback received:', {
              completed: progress.completed,
              total: progress.total,
              percentage: progress.percentage,
              timeSinceLastProgress: 0
            });
            
            // 14) Update UI inside ngZone.run() to ensure Angular change detection fires
            //     This refreshes the progress bar and status text in real-time
            this.ngZone.run(() => {
              this.offlineDownloadProgressPct = progress.percentage;
              this.offlineDownloadStatusText = `Downloading tiles: ${progress.completed}/${progress.total} (${progress.percentage}%)`;
              console.log('[ChatPage.progress] UI updated:', this.offlineDownloadStatusText);
            });
          } catch (callbackError) {
            // 15) Catch and log errors in the progress callback to avoid breaking the download
            console.error('[ChatPage.progress] Error in progress callback:', callbackError);
          }
        }
      });

      // 16) Set up a progress monitor that checks periodically if the download has stalled
      //     A stalled download has not made progress for maxNoProgressTimeMs milliseconds
      const progressMonitor = setInterval(() => {
        const timeSinceLastProgress = Date.now() - lastProgressTime;
        console.log('[ChatPage.download] Progress check - timeSinceLastProgress:', timeSinceLastProgress, 'lastPercentage:', lastProgressPercentage);
        
        // 17) If no progress received for 30 seconds AND download is not complete (< 100%), flag as stalled
        //     This is informational; the main timeout promise will ultimately cancel the download
        if (timeSinceLastProgress > maxNoProgressTimeMs && lastProgressPercentage < 100) {
          console.warn('[ChatPage.download] Download appears stalled - no progress for', timeSinceLastProgress, 'ms');
          clearInterval(progressMonitor);
          // 18) The Promise.race timeout will handle this if it continues
        }
      }, progressCheckIntervalMs);

      // 19) Calculate device-aware timeout: longer timeouts for native devices (slower network/CPU)
      //     Web Cache API is instant now, so timeout is primarily for network fetch operations
      const estimatedTileCount = Math.min(this.offlineMaxTilesPerDownload, 200);
      const baseTimeoutPerTile = isNative ? 300 : 200; // 300ms per tile on device, 200ms on web
      const minTimeout = isNative ? 60000 : 45000; // 60s min on device, 45s on web
      const timeoutMs = Math.max(minTimeout, estimatedTileCount * baseTimeoutPerTile);
      
      // 20) Log the calculated timeout values for debugging timeout-related issues
      console.log('[ChatPage.download] Device-aware timeout settings (Cache API enabled):', {
        isNative,
        estimatedTileCount,
        baseTimeoutPerTile,
        minTimeout,
        calculatedTimeoutMs: timeoutMs
      });

      // 21) Race the download promise against a timeout promise
      //     Whichever completes first wins; if timeout wins, the download is cancelled
      const summary = await Promise.race([
        downloadPromise,  // The actual tile download process
        new Promise<any>((_, reject) => {
          // 22) Create a timeout promise that rejects after timeoutMs milliseconds
          setTimeout(() => {
            clearInterval(progressMonitor);
            // 23) Build an error message that includes helpful suggestions for timeout recovery
            const message = `Download timeout after ${timeoutMs}ms. Completed: ${lastProgressPercentage}%.${
              isNative ? ' On device, try: 1) Reduce Max Tiles to 30-50, 2) Use lower zoom levels (10-15), 3) Check network connection.' 
              : ' Check your network connection.'
            }`;
            reject(new Error(message));
          }, timeoutMs);
        })
      ]);

      // 24) If we reach here, the download promise completed before timeout
      //     Stop the progress monitor since download is done
      clearInterval(progressMonitor);
      
      // 25) Log successful completion with summary statistics
      console.log('[ChatPage.download] Download completed with summary:', summary);
      // 26) Update UI with final download results (downloaded count, cached count, failed count)
      this.offlineDownloadStatusText = `Offline tiles ready. Downloaded: ${summary.downloaded}, cached: ${summary.cached}, failed: ${summary.failed}.`;
      // 27) Refresh the list of downloaded offline areas so UI shows new area
      this.refreshOfflineAreaList();
      // 28) Redraw the map tile layer to display newly cached tiles
      this.baseTileLayer?.redraw();
    } catch (error) {
      // 29) Handle any errors from the download process (timeout, network, service errors)
      const errorMsg = error instanceof Error ? error.message : String(error);
      // 30) Determine if this is a timeout error and provide context-specific suggestions
      const displayMessage = errorMsg.includes('timeout') 
        ? `Download timeout. Try: 1) Lower zoom levels, 2) Reduce Max Tiles to 30, 3) Ensure good network connection. Details: ${errorMsg}`
        : `Download failed: ${errorMsg}`;
      
      // 31) Update UI with error message
      this.offlineDownloadStatusText = displayMessage;
      // 32) Log error details for debugging (type, message, stack trace)
      console.error('[ChatPage.download] Download error:', error);
      console.error('[ChatPage.download] Error details:', {
        name: (error as any)?.name,
        message: (error as any)?.message,
        stack: (error as any)?.stack,
        timeSinceStart: Date.now() - lastProgressTime
      });
      // 33) Show alert to user so they know the download failed
      alert(displayMessage);
    } finally {
      // 34) Always execute cleanup: reset the download-in-progress flag
      //     This ensures the UI stops showing the download spinner regardless of success/failure
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
  if (this.pendingMapLocation) {
    console.log('[ChatPage.getInitialCoordinatesWithTimeout] Using incoming marker location:', this.pendingMapLocation);
    return {
      latitude: this.pendingMapLocation.latitude,
      longitude: this.pendingMapLocation.longitude
    };
  }

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
    // Capture the user's role for conditional UI (fallback to 'user')
    this.userRole = (profile && (profile.role || profile['role'])) || 'user';

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

/**
 * Returns the current logged-in user's role. If not yet available, fetches profile.
 */
public async getCurrentUserRole(): Promise<string> {
  if (this.userRole) return this.userRole;
  try {
    const profile = await this.auth3.getUserProfile().catch(() => null);
    this.userRole = (profile && (profile.role || profile['role'])) || 'user';
    return this.userRole as string;
  } catch (e) {
    return 'user';
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
  try {
    console.log('[ChatPage.onMsgBubbleTap] senderId:', message?.senderId);
    console.log('[ChatPage.onMsgBubbleTap] receiverId:', message?.receiverId);
  } catch (e) {
    console.warn('[ChatPage.onMsgBubbleTap] Failed to read senderId from message', e);
  }

  // If this message carries a shared session id, log it too (use any cast to avoid TS errors)
  try {
    const m: any = message as any;
    const sessionId = m?.sharedSessionId || m?.copiedSessionId || m?.sessionId || m?.metadata?.sharedSessionId;
    if (sessionId) {
      const currentUserId = (this.auth3.getCurrentUser()?.uid || this.userID || '').toString().trim();
      const messageReceiverId = (m?.receiverId || m?.metadata?.receiverId || '').toString().trim();

      if (!currentUserId || !messageReceiverId || currentUserId !== messageReceiverId) {
        console.log('[ChatPage.onMsgBubbleTap] Navigation blocked: receiverId does not match current user.', {
          currentUserId,
          messageReceiverId,
          sessionId
        });
        return;
      }

      console.log('[ChatPage.onMsgBubbleTap] sharedSessionId:', sessionId);
      this.goSessionPage(sessionId);
      return;
    }
  } catch (e) {
    console.warn('[ChatPage.onMsgBubbleTap] Failed to read sharedSessionId from message', e);
  }

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

  onSearchInput(value: string) {
    this.searchQuery = (value || '').toString().toLowerCase().trim();
    this.isSearching = this.searchQuery.length > 0;
    
    // Initialize backup arrays on first search if not already done
    if (this.searchConversationResultsBackup.length === 0 && this.searchConversationResults.length > 0) {
      this.searchConversationResultsBackup = [...this.searchConversationResults];
    }
    if (this.engineersBackup.length === 0 && this.engineers.length > 0) {
      this.engineersBackup = [...this.engineers];
    }
    
    // Automatically filter results as user types
    if (this.searchQuery.length > 0) {
      // Prefer filtering from backup snapshots when available, otherwise filter current arrays
      const searchSourceResults = (this.searchConversationResultsBackup.length > 0) ? this.searchConversationResultsBackup : this.searchConversationResults;
      const searchSourceEngineers = (this.engineersBackup.length > 0) ? this.engineersBackup : this.engineers;

      this.searchConversationResults = (searchSourceResults || []).filter(result => this.matchesSearchQuery(result));
      this.engineers = (searchSourceEngineers || []).filter(engineer => this.matchesSearchQuery(engineer));
    } else {
      // Restore full lists when search is cleared
      this.searchConversationResults = [...this.searchConversationResultsBackup];
      this.engineers = [...this.engineersBackup];
    }
  }

  private matchesSearchQuery(item: any): boolean {
    const query = this.searchQuery;
    const firstName = (item.firstName || '').toLowerCase();
    const lastName = (item.lastName || '').toLowerCase();
    const fullName = `${firstName} ${lastName}`.toLowerCase();
    const email = (item.email || '').toLowerCase();
    const name = (item.name || '').toLowerCase();
    const role = (item.role || '').toLowerCase();
    
    return (
      firstName.includes(query) ||
      lastName.includes(query) ||
      fullName.includes(query) ||
      email.includes(query) ||
      name.includes(query) ||
      role.includes(query)
    );
  }

  private isCurrentUserSearchResult(item: any): boolean {
    if (!item || typeof item !== 'object') {
      return false;
    }

    const currentUid = (
      this.auth3.getCurrentUser()?.uid ||
      this.userID ||
      this.resolveCachedUid() ||
      ''
    ).toString().trim();

    if (!currentUid) {
      return false;
    }

    const candidateIds = [
      item.id,
      item.uid,
      item.userID,
      item.userId,
      item.currentUserId
    ]
      .filter((value) => value !== undefined && value !== null)
      .map((value) => value.toString().trim())
      .filter((value) => value.length > 0);

    return candidateIds.includes(currentUid);
  }

  /**
   * Combined, deduplicated list used for search results display.
   * Prioritizes `engineers` then `searchConversationResults`, deduping by id/email/name.
   */
  get searchOptions(): any[] {
    const combined: any[] = [];
    const seen = new Set<string>();
    const pushIfNew = (it: any) => {
      if (!it) return;
      if (this.isCurrentUserSearchResult(it)) return;
      const key = (it.id || it.email || it.name || '').toString();
      if (!key) return;
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(it);
      }
    };

    // include engineers first (if any), then fallback/placeholder results
    (this.engineers || []).forEach(pushIfNew);
    (this.searchConversationResults || []).forEach(pushIfNew);

    return combined;
  }

  clearSearch() {
    this.searchQuery = '';
    this.isSearching = false;
    // Restore full lists from backups
    if (this.searchConversationResultsBackup.length > 0) {
      this.searchConversationResults = [...this.searchConversationResultsBackup];
    }
    if (this.engineersBackup.length > 0) {
      this.engineers = [...this.engineersBackup];
    }
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
        this.engineersBackup = [...cachedEngineers];
      }
    }

    try {
      const usersCol = collection(this.firestore, 'users');
      const snap = await getDocs(query(usersCol));
      const arr: any[] = [];
      snap.forEach(doc => {
        const data = { id: (doc as any).id, ...(doc.data() as any) };
        arr.push(data);
      });
      const filteredArr = arr.filter((user) => !this.isCurrentUserSearchResult(user));
      this.engineers = filteredArr;
      this.engineersBackup = filteredArr;
      // If a search is currently active, apply the search filter to the freshly fetched engineers
      if (this.searchQuery && this.searchQuery.length > 0) {
        try {
          this.engineers = this.engineersBackup.filter(engineer => this.matchesSearchQuery(engineer));
        } catch (e) {
          console.warn('[ChatPage] Error filtering users after fetch with active search:', e);
        }
      }
      if (cacheUid) {
        this.userPrefetchCache.storeEngineers(cacheUid, filteredArr);
        this.refreshCacheWarmStatus(cacheUid);
      }
      console.log('[ChatPage] Users fetched from Firestore for search:', this.engineers);
    } catch (err) {
      console.error('[ChatPage] Error fetching users for search:', err);
      this.engineers = [];
      this.engineersBackup = [];
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
  goSessionPage(sessionId?: string) {
    if (sessionId) {
      this.router.navigate(['/session-page'], { queryParams: { sessionId } });
      return;
    }

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
      'selectedMarkerLocation',
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
    if (this.incomingMarkerLocationActive) {
      console.log('[ChatPage.backgroundFetch] Incoming marker location active; skipping stored user location bootstrap.');
      return;
    }

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
    if (this.incomingMarkerLocationActive) {
      console.log('[ChatPage.getAndSaveCurrentLocation] Incoming marker location active; skipping current location save.');
      return this.pendingMapLocation
        ? {
            latitude: this.pendingMapLocation.latitude,
            longitude: this.pendingMapLocation.longitude
          }
        : null;
    }

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

  private sortMapSheetEntriesByDistance(entries: any[]): any[] {
    if (!Array.isArray(entries)) return [];

    return [...entries].sort((left, right) => {
      const leftDistance = Number(left?.distanceFromCenterMeters);
      const rightDistance = Number(right?.distanceFromCenterMeters);

      const leftIsValid = Number.isFinite(leftDistance) && leftDistance >= 0;
      const rightIsValid = Number.isFinite(rightDistance) && rightDistance >= 0;

      if (leftIsValid && rightIsValid) {
        return leftDistance - rightDistance;
      }

      if (leftIsValid) return -1;
      if (rightIsValid) return 1;
      return 0;
    });
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

    const mergedMarkers = enrichedMarkers.map((marker) => this.mergeMarkerAndUserForMapSheet(marker, marker.associatedUser, marker.resolvedUserId));
    return this.sortMapSheetEntriesByDistance(mergedMarkers);
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
    if (!this.incomingMarkerLocationActive && !this.lastLocationStatus && locationNow) {
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
        const markerIcon = this.isIncomingMarkerLocation(markerData)
          ? this.tapMarkerIcon
          : this.testMarkerIcon;
        const marker = L.marker([markerData.latitude, markerData.longitude], { icon: markerIcon })
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

  private isIncomingMarkerLocation(markerData: OfficeLocationMarkerData): boolean {
    if (!this.pendingMapLocation) {
      return false;
    }

    const markerLatitude = Number(markerData?.latitude);
    const markerLongitude = Number(markerData?.longitude);
    const incomingLatitude = Number(this.pendingMapLocation.latitude);
    const incomingLongitude = Number(this.pendingMapLocation.longitude);

    if (!Number.isFinite(markerLatitude) || !Number.isFinite(markerLongitude)) {
      return false;
    }

    const epsilon = 0.000001;
    return (
      Math.abs(markerLatitude - incomingLatitude) <= epsilon &&
      Math.abs(markerLongitude - incomingLongitude) <= epsilon
    );
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
        await this.markUserLocation(
          this.map,
          coordinates,
          this.pendingMapLocation?.label ? `Marker: ${this.pendingMapLocation.label}` : 'You are here!',
          this.incomingMarkerLocationActive ? this.tapMarkerIcon : this.userLocationIcon
        );
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
      
      await this.markUserLocation(
        this.map,
        coordinates,
        this.pendingMapLocation?.label ? `Marker: ${this.pendingMapLocation.label}` : 'You are here!',
        this.incomingMarkerLocationActive ? this.tapMarkerIcon : this.userLocationIcon
      );
      
      // Start background online refresh (won't block display since markers & tiles are already rendered)
      // If online & location detected, refreshes markers from Firestore and stores them locally
      void this.runStaggeredOnlineBootstrap(bootstrapId);
      
      console.log('[ChatPage.initMap] Map initialization complete with offline tiles and local markers visible.');
    } catch (err) {
      console.warn('[ChatPage.initMap] Initialization failed', err);
    }
  }

  async markUserLocation(
    map: L.Map,
    coordinates?: { latitude: number; longitude: number } | null,
    popupText: string = 'You are here!',
    iconOverride?: L.Icon
  ) {
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
  icon: iconOverride || this.userLocationIcon
})
  .addTo(map)
  .bindPopup(popupText)
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

  /** Navigate to sessions list page. */
  gochatPage() {
    this.removeBackButtonHandler();
    this.router.navigate(['/chat-page']);
    console.log('chat page');
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

   /** Navigate to chat page and open the 'people' tab. */
  gochatPagePeople() {
    this.removeBackButtonHandler();
    this.router.navigate(['/chat-page'], { state: { activeTab: 'people' } });
    console.log('chat page (people)');
  }

  /** Navigate to chat page and open the 'location' tab. */
  gochatPageLocation() {
    this.removeBackButtonHandler();
    this.router.navigate(['/chat-page'], { state: { activeTab: 'location' } });
    console.log('chat page (location)');
  }

   /** Navigate to chat page and open the 'location' tab. */
  goMarkerPage() {
    this.removeBackButtonHandler();
    this.router.navigate(['/office-map-marker-page']);
    console.log('chat page (location)');
  }


}

