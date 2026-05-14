import { Injectable } from '@angular/core';
import { Auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from '@angular/fire/auth';
import { fetchSignInMethodsForEmail } from 'firebase/auth';
import { Firestore, setDoc, serverTimestamp, doc, getDoc, collection, query, where, getDocs } from '@angular/fire/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { UserPrefetchCacheService } from './user-prefetch-cache.service';

export type OfficeLocationPayload = {
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  officeAddress: string;
  latitude: number;
  longitude: number;
  role: string;
};

@Injectable({
  providedIn: 'root'
})
export class Auth3Service {
  private firstName = '';
  private lastName = '';
  constructor(private auth: Auth, private firestore: Firestore, private userPrefetchCache: UserPrefetchCacheService) {}

async login(email: string, password: string) {
  const normalizedEmail = (email || '').trim();
  const normalizedPassword = (password || '').trim();

  if (!normalizedEmail) {
    throw new Error('Email is required');
  }
  if (!normalizedPassword) {
    throw new Error('Password is required');
  }

  try {
    // Check which sign-in methods are available for this email to provide clearer errors
    try {
      const methods = await fetchSignInMethodsForEmail(this.auth, normalizedEmail);
      if (methods && methods.length > 0 && !methods.includes('password')) {
        const userErr = new Error(`auth/no-password-provider: This account uses a different sign-in provider (${methods.join(', ')}). Use the appropriate provider to sign in.`);
        (userErr as any).code = 'auth/no-password-provider';
        throw userErr;
      }
    } catch (checkErr) {
      // Non-fatal: if the helper call fails, proceed to attempt sign-in and rely on the underlying error
      console.warn('[Auth3Service.login] fetchSignInMethodsForEmail failed (continuing):', checkErr);
    }

    return await signInWithEmailAndPassword(this.auth, normalizedEmail, normalizedPassword);
  } catch (err: any) {
    const code = err?.code || '';
    const msg = err?.message || String(err);
    console.error('[Auth3Service.login] Firebase signInWithEmailAndPassword failed', { code, msg, email: normalizedEmail });

    // Map known Firebase codes to user-friendly messages but include original code for debugging
    let outMsg = msg;
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      outMsg = `Invalid email or password. Please check your credentials and try again.`;
    } else if (code === 'auth/too-many-requests') {
      outMsg = `Too many failed login attempts. Please wait and try again later.`;
    } else if (code === 'auth/invalid-email') {
      outMsg = `The email address is invalid.`;
    } else if (code === 'auth/user-disabled') {
      outMsg = `This account has been disabled.`;
    }

    const userErr = new Error(`auth/${code || 'unknown'}: ${outMsg}`);
    (userErr as any).code = code || `auth/${code || 'unknown'}`;
    throw userErr;
  }
}

async register(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
  engineeringID: string,
  role?: string,
  isAdmin: boolean = false
) {
  if (!email) {
    throw new Error('Email is required');
  }
    try {
      //creates the user with email and password
      const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
      // Get the newly created user's UID
      const uid = userCredential.user.uid;

      // Debug: log the uid and payload we will write to Firestore
      const payload = {
        userID: uid,
        firstName,
        lastName,
        engineeringID,
        email,
        role: role || (engineeringID ? 'engineer' : 'user'),
        isAdmin,
        createdAt: serverTimestamp()
      };
      console.log('[Auth3Service] createUserWithEmailAndPassword succeeded, uid=', uid);
      console.log('[Auth3Service] writing user profile payload to users/', uid, payload);

      try {
        // Write user profile to Firestore
        await setDoc(doc(this.firestore, 'users', uid), payload);
        console.log('[Auth3Service] setDoc succeeded for users/', uid);
      } catch (setErr) {
        console.error('[Auth3Service] setDoc failed for users/', uid, setErr);
        // Re-throw so calling UI sees an error if desired
        throw setErr;
      }

      return userCredential;
    } catch (err: any) {
      // Normalize Firebase error messages for the UI and logging
      console.error('[Auth3Service] register error:', err);
      const code = err?.code || 'auth/unknown-error';
      const message = err?.message || 'Registration failed';
      // Provide clearer messages for common auth errors
      if (code === 'auth/email-already-in-use') throw new Error('The email address is already in use.');
      if (code === 'auth/invalid-email') throw new Error('The email address is invalid.');
      if (code === 'auth/weak-password') throw new Error('The password is too weak (min 6 characters).');
      // Re-throw a generic error for other cases
      throw new Error(message);
    }
}

  // async logout() {
  //   return await signOut(this.auth);
  // }

  //  // ✅ Auth state change
  //   onAuthChange(callback: (user: User | null) => void) {
  //     return onAuthStateChanged(this.auth, callback);
  //   }
  
  //   // ✅ Current user getter
  //   getCurrentUser() {
  //     return this.auth.currentUser;
  //   }

  async logout() {
    const currentUid = this.getCurrentUser()?.uid || this.resolveCachedUid();
    if (currentUid) {
      this.userPrefetchCache.clearUserCache(currentUid);
    }
    return await signOut(this.auth);
  }

  private resolveCachedUid(): string {
    try {
      const raw = localStorage.getItem('userData');
      if (!raw) return '';
      const data = JSON.parse(raw);
      return data?.userID || '';
    } catch {
      return '';
    }
  }

  onAuthChange(callback: (user: User | null) => void) {
    return onAuthStateChanged(this.auth, callback);
  }

  getCurrentUser() {
    //gets the current user / uid
    return this.auth.currentUser;
  }

  async waitForAuthUser(timeoutMs: number = 8000): Promise<User | null> {
    const existing = this.getCurrentUser();
    console.log('[Auth3Service.waitForAuthUser] Called with timeout:', timeoutMs, 'ms. Existing currentUser:', existing?.uid || 'null');
    
    if (existing) {
      console.log('[Auth3Service.waitForAuthUser] User already existing, returning immediately');
      return existing;
    }

    return new Promise(resolve => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        console.warn('[Auth3Service.waitForAuthUser] TIMEOUT after', timeoutMs, 'ms; currentUser is null');
        resolve(this.getCurrentUser());
      }, timeoutMs);

      console.log('[Auth3Service.waitForAuthUser] Setting up onAuthStateChanged listener...');
      const unsubscribe = onAuthStateChanged(this.auth, user => {
        console.log('[Auth3Service.waitForAuthUser] onAuthStateChanged fired with user:', user?.uid || 'null');
        if (done) {
          console.log('[Auth3Service.waitForAuthUser] Already done, ignoring this auth change');
          return;
        }
        done = true;
        clearTimeout(timer);
        try { unsubscribe(); } catch (e) {}
        console.log('[Auth3Service.waitForAuthUser] Resolving with user:', user?.uid || 'null');
        resolve(user ?? null);
      });
    });
  }

  /**
   * Save or update the user's office location in the 'officeLocations' Firestore collection.
   */
  async saveOfficeLocation(userId: string, payload: OfficeLocationPayload): Promise<void> {
    if (!userId) {
      throw new Error('User id is required to save office location.');
    }

    if (!Number.isFinite(payload.latitude) || !Number.isFinite(payload.longitude)) {
      throw new Error('Valid office latitude and longitude are required.');
    }

    const officeLocationPayload = {
      userID: userId,
      email: payload.email,
      firstName: payload.firstName,
      lastName: payload.lastName,
      phoneNumber: payload.phoneNumber,
      officeAddress: payload.officeAddress,
      role: payload.role,
      officeLocation: {
        latitude: payload.latitude,
        longitude: payload.longitude,
      },
      createdAt: serverTimestamp(),
    };

    console.log('[Auth3Service] Writing office location payload:', officeLocationPayload);
    await setDoc(doc(this.firestore, 'userOfficeLocationMarker', userId), officeLocationPayload);
    console.log('[Auth3Service] Office location saved for uid:', userId);
  }

  // ✅ Get user profile from Firestore (uses native Firebase SDK to avoid injection warnings)
  async getUserProfile() {
    console.log('[Auth3Service.getUserProfile] Called. getCurrentUser():', this.getCurrentUser()?.uid || 'null');
    
    //gets the current user uid
    let user = this.getCurrentUser();
    if (!user) {
      console.log('[Auth3Service.getUserProfile] No currentUser, calling waitForAuthUser(15000)...');
      user = await this.waitForAuthUser(15000);
      console.log('[Auth3Service.getUserProfile] After waitForAuthUser, user:', user?.uid || 'null');
    }
    // if no user logged in, throw error
    if (!user) {
      console.error('[Auth3Service.getUserProfile] FATAL: No user logged in after all attempts');
      throw new Error('No user logged in');
    }

    // Fetch user document from Firestore
    try {
      console.log('[Auth3Service.getUserProfile] Fetching user doc from Firestore for uid:', user.uid);
      const userDoc = await getDoc(doc(this.firestore, 'users', user.uid));
      if (userDoc && userDoc.exists && userDoc.exists()) {
        const data = userDoc.data() as any;
        console.log('[Auth3Service.getUserProfile] Firestore doc found. Data:', data);
        this.firstName = data['firstName'] || '';
        this.lastName = data['lastName'] || '';
        return data;
      }
      // Fallback if doc missing: return auth-derived defaults
      console.log('[Auth3Service.getUserProfile] Firestore doc missing, returning auth defaults');
      return {
        firstName: '',
        lastName: '',
        engineeringID: '',
        email: user.email || '',
        role: 'user'
      };
    } catch (err) {
      // Handle permission errors gracefully without breaking UI
      console.error('[Auth3Service.getUserProfile] ERROR fetching from Firestore:', err);
      console.log('[Auth3Service.getUserProfile] Returning auth fallback');
      return {
        firstName: '',
        lastName: '',
        engineeringID: '',
        email: user.email || '',
        role: 'user'
      };
    }
  }

  /**
   * Fetch all sessions for a specific user from Firestore 'sessionsImages' collection.
   * Returns an array of session documents that match the given userId.
   */
  async getUserSessions(userId: string): Promise<any[]> {
    try {
      // console.log('[Auth3Service.getUserSessions] Fetching sessions for userId:', userId);
      const q = query(collection(this.firestore, 'sessionsImages'), where('userId', '==', userId));
      const querySnapshot = await getDocs(q);
      const sessions: any[] = [];
      querySnapshot.forEach((doc) => {
        sessions.push({ id: doc.id, ...doc.data() });
      });
      // console.log('[Auth3Service.getUserSessions] Fetched', sessions.length, 'sessions for userId:', userId);
      // console.log('[Auth3Service.getUserSessions] Sessions payload:', sessions);
      try {
        // console.log('[Auth3Service.getUserSessions] Sessions payload JSON:', JSON.stringify(sessions, null, 2));
      } catch (jsonErr) {
        // console.warn('[Auth3Service.getUserSessions] Failed to stringify sessions payload:', jsonErr);
      }
      return sessions;
    } catch (err) {
      // console.error('[Auth3Service.getUserSessions] ERROR fetching sessions:', err);
      return [];
    }
  }

  /**
   * Fetch all images for a specific user from Firestore 'images' collection.
   * Returns an array of image documents that match the given userId.
   */
  async getUserImages(userId: string): Promise<any[]> {
    try {
      console.log('[Auth3Service.getUserImages] Fetching images for userId:', userId);
      const q = query(collection(this.firestore, 'images'), where('userId', '==', userId));
      const querySnapshot = await getDocs(q);
      const images: any[] = [];
      querySnapshot.forEach((doc) => {
        images.push({ id: doc.id, ...doc.data() });
      });
      // console.log('[Auth3Service.getUserImages] Fetched', images.length, 'images for userId:', userId);
      // console.log('[Auth3Service.getUserImages] Images payload:', images);
      try {
        // console.log('[Auth3Service.getUserImages] Images payload JSON:', JSON.stringify(images, null, 2));
      } catch (jsonErr) {
        // console.warn('[Auth3Service.getUserImages] Failed to stringify images payload:', jsonErr);
      }
      return images;
    } catch (err) {
      // console.error('[Auth3Service.getUserImages] ERROR fetching images:', err);
      return [];
    }
  }

  // ✅ Optional getters for components
  getFirstName() {
    return this.firstName;
  }

  getLastName() {
    return this.lastName;
  }



}