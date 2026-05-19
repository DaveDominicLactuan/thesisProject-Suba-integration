import { Injectable } from '@angular/core';
import { Firestore, collection, doc, setDoc, serverTimestamp, writeBatch, query, where, orderBy, collectionData, docData, getDoc, updateDoc } from '@angular/fire/firestore';
import { Observable } from 'rxjs';

export interface Chat {
  chatId: string;
  participants: string[];
  lastMessage?: string;
  timestamp?: any;
  clearedBy?: Record<string, any>;
}

export interface Message {
  id?: string;
  senderId: string;
  receiverId?: string | null;
  text: string;
  sharedSessionId?: string | null;
  metadata?: {
    sharedSessionId?: string | null;
    receiverId?: string | null;
    [key: string]: any;
  };
  timestamp?: any;
  deliveredAt?: any;
  isRead?: boolean;
  readAt?: any;
}

export interface TypingState {
  userId: string;
  isTyping: boolean;
  updatedAt?: any;
}

export interface UserModel {
  uid: string;
  name?: string;
  avatarUrl?: string;
  isOnline?: boolean;
  lastSeen?: number;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  constructor(private firestore: Firestore) {}

  // Deterministic chatId for 1-on-1 chats (sort uids)
  createChatIdForUsers(uidA: string, uidB: string): string {
    const sorted = [uidA, uidB].sort();
    return `${sorted[0]}_${sorted[1]}`;
  }

  // Create a chat doc (id deterministic) or ensure it exists
  async createOrEnsureChat(uidA: string, uidB: string): Promise<Chat> {
    const chatId = this.createChatIdForUsers(uidA, uidB);
    const participants = [uidA, uidB].sort();
    const chatRef = doc(this.firestore, 'chats', chatId);
    // Ensure chat doc exists with participants
    await setDoc(chatRef, { chatId, participants }, { merge: true });
    return { chatId, participants };
  }

  // Return observable of chats for a user (array-contains)
  getUserChats(uid: string): Observable<Chat[]> {
    const chatsCol = collection(this.firestore, 'chats');
    const q = query(chatsCol, where('participants', 'array-contains', uid));
    return collectionData(q, { idField: 'chatId' }) as Observable<Chat[]>;
  }

  // Return observable of a single chat document
  observeChat(chatId: string): Observable<Chat | undefined> {
    const chatRef = doc(this.firestore, 'chats', chatId);
    return docData(chatRef, { idField: 'chatId' }) as Observable<Chat | undefined>;
  }

  // Hide a chat for one user without deleting it for other participants.
  async clearChatForUser(chatId: string, userId: string): Promise<void> {
    if (!chatId || !userId) return;

    const chatRef = doc(this.firestore, 'chats', chatId);
    await updateDoc(chatRef, {
      [`clearedBy.${userId}`]: serverTimestamp()
    });
  }

  // Observe messages for a chat in realtime (ordered)
  getMessages(chatId: string): Observable<Message[]> {
    const msgsCol = collection(this.firestore, 'chats', chatId, 'messages');
    const q = query(msgsCol, orderBy('timestamp', 'asc'));
    return collectionData(q, { idField: 'id' }) as Observable<Message[]>;
  }

  // Observe typing states for chat participants in realtime
  observeTyping(chatId: string): Observable<TypingState[]> {
    const typingCol = collection(this.firestore, 'chats', chatId, 'typing');
    return collectionData(typingCol, { idField: 'userId' }) as Observable<TypingState[]>;
  }

  // Upsert typing state for a participant
  async setTypingState(chatId: string, userId: string, isTyping: boolean): Promise<void> {
    const typingRef = doc(this.firestore, 'chats', chatId, 'typing', userId);
    await setDoc(
      typingRef,
      {
        userId,
        isTyping,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  // Send a message using a write batch: add message doc and update parent chat lastMessage/timestamp
  async sendMessage(
    chatId: string,
    message: {
      senderId: string;
      receiverId?: string | null;
      text: string;
      sharedSessionId?: string | null;
      metadata?: Record<string, any>;
      [key: string]: any;
    }
  ): Promise<void> {
    const chatRef = doc(this.firestore, 'chats', chatId);
    const msgsCol = collection(this.firestore, 'chats', chatId, 'messages');
    const messageRef = doc(msgsCol); // auto-id doc ref

    const batch = writeBatch(this.firestore);
    const messagePayload: any = {
      senderId: message.senderId,
      text: message.text,
      timestamp: serverTimestamp(),
      deliveredAt: serverTimestamp(),
      isRead: false
    };

    // Preserve extra metadata for special system messages (e.g., shared session reference)
    const sharedSessionId = message?.['sharedSessionId'] ?? message?.metadata?.['sharedSessionId'] ?? null;
    const receiverId = message?.['receiverId'] ?? message?.metadata?.['receiverId'] ?? null;

    if (receiverId) {
      messagePayload.receiverId = receiverId;
    }

    if (sharedSessionId || receiverId) {
      messagePayload.sharedSessionId = sharedSessionId;
      messagePayload.metadata = {
        ...(message.metadata || {}),
        ...(sharedSessionId ? { sharedSessionId } : {}),
        ...(receiverId ? { receiverId } : {})
      };
    } else if (message?.metadata && Object.keys(message.metadata).length > 0) {
      messagePayload.metadata = message.metadata;
    }

    batch.set(messageRef, messagePayload);
    batch.set(chatRef, { lastMessage: message.text, timestamp: serverTimestamp() }, { merge: true });
    await batch.commit();
  }

  // Mark a single message as read
  async markMessageAsRead(chatId: string, messageId: string): Promise<void> {
    const msgRef = doc(this.firestore, 'chats', chatId, 'messages', messageId);
    await setDoc(msgRef, { isRead: true, readAt: serverTimestamp() }, { merge: true });
  }

  // Fetch the last seen timestamp for a user
  async getLastSeen(userId: string): Promise<number | null> {
    const userRef = doc(this.firestore, 'users', userId);
    const userDoc = await getDoc(userRef);
    if (userDoc.exists()) {
      const userData = userDoc.data() as UserModel;
      return userData.lastSeen || null;
    }
    return null;
  }
}
