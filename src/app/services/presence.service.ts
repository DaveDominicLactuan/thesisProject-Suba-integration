import { Injectable } from '@angular/core';
import { getDatabase, ref, onValue, set, onDisconnect } from 'firebase/database';
import { Firestore, doc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

/**
 * PresenceService (hybrid):
 * - Uses RTDB .info/connected to detect online/offline
 * - Writes presence to RTDB under /status/{uid}
 * - Mirrors presence to Firestore users/{uid} doc (isOnline, lastSeen)
 */
@Injectable({ providedIn: 'root' })
export class PresenceService {
  private db: any;

  constructor(private firestore: Firestore, private auth: Auth) {
    try {
      this.db = getDatabase();
    } catch (e) {
      console.warn('PresenceService: failed to init RTDB', e);
    }
  }

  start() {
    if (!this.db) return;
    const user = this.auth.currentUser;
    if (!user) return;

    const userStatusRef = ref(this.db, '/status/' + user.uid);
    const amOnlineRef = ref(this.db, '.info/connected');

    onValue(amOnlineRef, async (snap) => {
      const connected = snap.val();
      if (connected) {
        // Set online in RTDB and set onDisconnect to mark offline
        try {
          await set(userStatusRef, { isOnline: true, lastSeen: Date.now() });
        } catch (e) {
          console.warn('PresenceService: set online failed', e);
        }

        try {
          onDisconnect(userStatusRef).set({ isOnline: false, lastSeen: Date.now() });
        } catch (e) {
          // some SDK versions require a different call; best-effort
        }

        // Mirror into Firestore users collection immediately
        try {
          await setDoc(doc(this.firestore, 'users', user.uid), { isOnline: true }, { merge: true });
        } catch (e) {
          console.warn('PresenceService: firestore set online failed', e);
        }
      } else {
        // Not connected: set Firestore isOnline false + lastSeen
        try {
          await setDoc(doc(this.firestore, 'users', user.uid), { isOnline: false, lastSeen: Date.now() }, { merge: true });
        } catch (e) {
          console.warn('PresenceService: firestore set offline failed', e);
        }
      }
    });
  }

  // Manual call to set offline (useful on explicit logout)
  async setOfflineNow(uid: string) {
    if (!uid) return;
    try {
      if (this.db) await set(ref(this.db, '/status/' + uid), { isOnline: false, lastSeen: Date.now() });
    } catch (e) {}
    try { await setDoc(doc(this.firestore, 'users', uid), { isOnline: false, lastSeen: Date.now() }, { merge: true }); } catch (e) {}
  }

}
