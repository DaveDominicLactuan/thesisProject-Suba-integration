import { Injectable } from '@angular/core';
import { Firestore, collection, doc, setDoc, serverTimestamp, writeBatch, query, where, orderBy, collectionData, docData } from '@angular/fire/firestore';
import { Observable } from 'rxjs';

export interface Chat {
  chatId: string;
  participants: string[];
  lastMessage?: string;
  timestamp?: any;
}

export interface Message {
  id?: string;
  senderId: string;
  text: string;
  timestamp?: any;
  isRead?: boolean;
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
    const chatRef = doc(this.firestore, 'chats', chatId);
    // Ensure chat doc exists with participants
    await setDoc(chatRef, { chatId, participants: [uidA, uidB] }, { merge: true });
    return { chatId, participants: [uidA, uidB] };
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

  // Observe messages for a chat in realtime (ordered)
  getMessages(chatId: string): Observable<Message[]> {
    const msgsCol = collection(this.firestore, 'chats', chatId, 'messages');
    const q = query(msgsCol, orderBy('timestamp', 'asc'));
    return collectionData(q, { idField: 'id' }) as Observable<Message[]>;
  }

  // Send a message using a write batch: add message doc and update parent chat lastMessage/timestamp
  async sendMessage(chatId: string, message: { senderId: string; text: string; }): Promise<void> {
    const chatRef = doc(this.firestore, 'chats', chatId);
    const msgsCol = collection(this.firestore, 'chats', chatId, 'messages');
    const messageRef = doc(msgsCol); // auto-id doc ref

    const batch = writeBatch(this.firestore);
    batch.set(messageRef, {
      senderId: message.senderId,
      text: message.text,
      timestamp: serverTimestamp(),
      isRead: false
    });
    batch.set(chatRef, { lastMessage: message.text, timestamp: serverTimestamp() }, { merge: true });
    await batch.commit();
  }

  // Mark a single message as read
  async markMessageAsRead(chatId: string, messageId: string): Promise<void> {
    const msgRef = doc(this.firestore, 'chats', chatId, 'messages', messageId);
    await setDoc(msgRef, { isRead: true, readAt: serverTimestamp() }, { merge: true });
  }

}
