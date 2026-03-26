import { Injectable } from '@angular/core';
import { Firestore, collection, doc, getDoc, getDocs, query, where } from '@angular/fire/firestore';

export interface CachedChatPreview {
  chatId: string;
  participants: string[];
  otherParticipantId: string | null;
  name: string;
  avatar: string | null;
  lastMessage: string;
  timestamp: any;
  isOnline: boolean;
}

export interface CachedWarmData {
  userProfile: any | null;
  engineers: any[];
  chats: CachedChatPreview[];
  sessions: any[];
  images: any[];
  updatedAt: number;
}

@Injectable({
  providedIn: 'root'
})
export class UserPrefetchCacheService {
  private readonly keyPrefix = 'prefetch_cache_v1_';
  private readonly keyIndexPrefix = 'prefetch_cache_keys_v1_';
  private readonly defaultTtlMs = 10 * 60 * 1000;
  private static warmTasks: Map<string, Promise<CachedWarmData>> = new Map();

  constructor(private firestore: Firestore) {}

  private cacheKey(userId: string, key: string): string {
    return `${this.keyPrefix}${userId}_${key}`;
  }

  private cacheKeysIndexKey(userId: string): string {
    return `${this.keyIndexPrefix}${userId}`;
  }

  private readJson<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private writeJson(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  private rememberUserCacheKey(userId: string, key: string): void {
    const indexKey = this.cacheKeysIndexKey(userId);
    const existing = this.readJson<string[]>(indexKey, []);
    if (existing.includes(key)) return;
    existing.push(key);
    this.writeJson(indexKey, existing);
  }

  private persistUserKey(userId: string, key: string, value: unknown): void {
    const fullKey = this.cacheKey(userId, key);
    this.writeJson(fullKey, value);
    this.rememberUserCacheKey(userId, key);
  }

  private getUserKey<T>(userId: string, key: string, fallback: T): T {
    return this.readJson<T>(this.cacheKey(userId, key), fallback);
  }

  getCachedUserProfile(userId: string): any | null {
    if (!userId) return null;
    return this.getUserKey<any | null>(userId, 'profile', null);
  }

  getCachedEngineers(userId: string): any[] {
    if (!userId) return [];
    return this.getUserKey<any[]>(userId, 'engineers', []);
  }

  getCachedChats(userId: string): CachedChatPreview[] {
    if (!userId) return [];
    return this.getUserKey<CachedChatPreview[]>(userId, 'chats', []);
  }

  getCachedSessions(userId: string): any[] {
    if (!userId) return [];
    return this.getUserKey<any[]>(userId, 'sessions', []);
  }

  getCachedImages(userId: string): any[] {
    if (!userId) return [];
    return this.getUserKey<any[]>(userId, 'images', []);
  }

  getLastWarmAt(userId: string): number {
    if (!userId) return 0;
    return this.getUserKey<number>(userId, 'updatedAt', 0);
  }

  isCacheFresh(userId: string, ttlMs: number = this.defaultTtlMs): boolean {
    if (!userId) return false;
    const lastWarmAt = this.getLastWarmAt(userId);
    if (!lastWarmAt) return false;
    return (Date.now() - lastWarmAt) <= ttlMs;
  }

  formatAgeFromTimestamp(timestamp: number): string {
    if (!timestamp || !Number.isFinite(timestamp)) return 'never';
    const elapsedMs = Math.max(0, Date.now() - timestamp);
    const seconds = Math.floor(elapsedMs / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  getLastWarmLabel(userId: string): string {
    const timestamp = this.getLastWarmAt(userId);
    if (!timestamp) return 'Not synced';
    return `Last synced ${this.formatAgeFromTimestamp(timestamp)}`;
  }

  storeChats(userId: string, chats: CachedChatPreview[]): void {
    if (!userId) return;
    this.persistUserKey(userId, 'chats', chats || []);
    this.persistUserKey(userId, 'updatedAt', Date.now());
  }

  storeEngineers(userId: string, engineers: any[]): void {
    if (!userId) return;
    this.persistUserKey(userId, 'engineers', engineers || []);
    this.persistUserKey(userId, 'updatedAt', Date.now());
  }

  async warmUserData(userId: string, force: boolean = false): Promise<CachedWarmData> {
    if (!userId) {
      return {
        userProfile: null,
        engineers: [],
        chats: [],
        sessions: [],
        images: [],
        updatedAt: 0
      };
    }

    if (!force) {
      const existingTask = UserPrefetchCacheService.warmTasks.get(userId);
      if (existingTask) return existingTask;
    }

    const warmTask = this.performWarmUserData(userId)
      .finally(() => {
        UserPrefetchCacheService.warmTasks.delete(userId);
      });

    UserPrefetchCacheService.warmTasks.set(userId, warmTask);
    return warmTask;
  }

  warmUserDataInBackground(
    userId: string,
    reason: string = 'unknown',
    ttlMs: number = this.defaultTtlMs,
    force: boolean = false
  ): Promise<'warmed' | 'skipped' | 'failed'> {
    if (!userId) return Promise.resolve('failed');

    if (!force && this.isCacheFresh(userId, ttlMs)) {
      const lastWarmAt = this.getLastWarmAt(userId);
      console.log('[UserPrefetchCache] Warm skipped (cache still fresh)', {
        userId,
        reason,
        age: this.formatAgeFromTimestamp(lastWarmAt),
        ttlMs
      });
      return Promise.resolve('skipped');
    }

    return this.warmUserData(userId, force)
      .then((result) => {
        console.log('[UserPrefetchCache] Warmed user data', {
          userId,
          reason,
          chats: result.chats.length,
          engineers: result.engineers.length,
          sessions: result.sessions.length,
          images: result.images.length
        });
        return 'warmed' as const;
      })
      .catch((error) => {
        console.warn('[UserPrefetchCache] Warm failed', { userId, reason, error });
        return 'failed' as const;
      });
  }

  private async performWarmUserData(userId: string): Promise<CachedWarmData> {
    const [userProfile, engineers, chats, sessions, images] = await Promise.all([
      this.fetchUserProfile(userId),
      this.fetchEngineers(),
      this.fetchChatsForUser(userId),
      this.fetchSessionsForUser(userId),
      this.fetchImagesForUser(userId)
    ]);

    const payload: CachedWarmData = {
      userProfile,
      engineers,
      chats,
      sessions,
      images,
      updatedAt: Date.now()
    };

    this.persistUserKey(userId, 'profile', userProfile);
    this.persistUserKey(userId, 'engineers', engineers);
    this.persistUserKey(userId, 'chats', chats);
    this.persistUserKey(userId, 'sessions', sessions);
    this.persistUserKey(userId, 'images', images);
    this.persistUserKey(userId, 'updatedAt', payload.updatedAt);

    return payload;
  }

  private async fetchUserProfile(userId: string): Promise<any | null> {
    try {
      const userSnap = await getDoc(doc(this.firestore, 'users', userId));
      if (!userSnap.exists()) return null;
      return { id: userSnap.id, ...(userSnap.data() as any) };
    } catch {
      return this.getCachedUserProfile(userId);
    }
  }

  private async fetchEngineers(): Promise<any[]> {
    try {
      const usersCol = collection(this.firestore, 'users');
      const engineersQuery = query(usersCol, where('role', '==', 'engineer'));
      const snap = await getDocs(engineersQuery);
      const engineers: any[] = [];
      snap.forEach((row) => engineers.push({ id: row.id, ...(row.data() as any) }));
      return engineers;
    } catch {
      return [];
    }
  }

  private async fetchChatsForUser(userId: string): Promise<CachedChatPreview[]> {
    try {
      const chatsCol = collection(this.firestore, 'chats');
      const chatsQuery = query(chatsCol, where('participants', 'array-contains', userId));
      const chatsSnap = await getDocs(chatsQuery);
      const userCache = new Map<string, any | null>();
      const items: CachedChatPreview[] = [];

      for (const row of chatsSnap.docs) {
        const chatData = row.data() as any;
        const participants: string[] = Array.isArray(chatData?.participants) ? chatData.participants : [];
        const otherParticipantId = participants.find((p: string) => p && p !== userId) || null;

        let profile = null as any;
        if (otherParticipantId) {
          if (userCache.has(otherParticipantId)) {
            profile = userCache.get(otherParticipantId) || null;
          } else {
            try {
              const profileSnap = await getDoc(doc(this.firestore, 'users', otherParticipantId));
              profile = profileSnap.exists() ? { id: profileSnap.id, ...(profileSnap.data() as any) } : null;
            } catch {
              profile = null;
            }
            userCache.set(otherParticipantId, profile);
          }
        }

        const name = `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim() || profile?.name || profile?.email || otherParticipantId || row.id;

        items.push({
          chatId: row.id,
          participants,
          otherParticipantId,
          name,
          avatar: profile?.photoURL || profile?.avatar || profile?.avatarUrl || null,
          lastMessage: chatData?.lastMessage || '',
          timestamp: chatData?.timestamp || null,
          isOnline: Boolean(profile?.isOnline)
        });
      }

      items.sort((a, b) => {
        const aTs = this.toMillis(a.timestamp);
        const bTs = this.toMillis(b.timestamp);
        return bTs - aTs;
      });

      return items;
    } catch {
      return this.getCachedChats(userId);
    }
  }

  private async fetchSessionsForUser(userId: string): Promise<any[]> {
    try {
      const sessionsCol = collection(this.firestore, 'sessionsImages');
      const sessionsQuery = query(sessionsCol, where('userId', '==', userId));
      const snap = await getDocs(sessionsQuery);
      const sessions: any[] = [];
      snap.forEach((row) => sessions.push({ id: row.id, ...(row.data() as any) }));
      return sessions;
    } catch {
      return this.getCachedSessions(userId);
    }
  }

  private async fetchImagesForUser(userId: string): Promise<any[]> {
    try {
      const imagesCol = collection(this.firestore, 'images');
      const imagesQuery = query(imagesCol, where('userId', '==', userId));
      const snap = await getDocs(imagesQuery);
      const images: any[] = [];
      snap.forEach((row) => images.push({ id: row.id, ...(row.data() as any) }));
      return images;
    } catch {
      return this.getCachedImages(userId);
    }
  }

  private toMillis(value: any): number {
    if (!value) return 0;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value?.seconds === 'number') return value.seconds * 1000;
    if (typeof value === 'number') return value;
    return 0;
  }

  clearUserCache(userId: string): void {
    if (!userId) return;
    const indexKey = this.cacheKeysIndexKey(userId);
    const keys = this.readJson<string[]>(indexKey, []);
    for (const key of keys) {
      try {
        localStorage.removeItem(this.cacheKey(userId, key));
      } catch {}
    }
    try {
      localStorage.removeItem(indexKey);
    } catch {}
  }
}
