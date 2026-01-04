import { Injectable } from '@angular/core';
import { Auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from '@angular/fire/auth';
import { Firestore, setDoc, serverTimestamp, doc, getDoc } from '@angular/fire/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';


@Injectable({
  providedIn: 'root'
})
export class Auth3Service {
  private firstName = '';
  private lastName = '';
  constructor(private auth: Auth, private firestore: Firestore) {}

async login(email: string, password: string) {
  if (!email) {
    throw new Error('Email is required');
  }
  return await signInWithEmailAndPassword(this.auth, email, password);
}

async register(email: string, password: string, firstName: string, lastName: string, engineeringID: string, role?: string) {
  if (!email) {
    throw new Error('Email is required');
  }
    try {
      const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
      const uid = userCredential.user.uid;

      // Debug: log the uid and payload we will write to Firestore
      const payload = {
        firstName,
        lastName,
        engineeringID,
        email,
        role: role || (engineeringID ? 'engineer' : 'user'),
        createdAt: serverTimestamp()
      };
      console.log('[Auth3Service] createUserWithEmailAndPassword succeeded, uid=', uid);
      console.log('[Auth3Service] writing user profile payload to users/', uid, payload);

      try {
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
    return await signOut(this.auth);
  }

  onAuthChange(callback: (user: User | null) => void) {
    return onAuthStateChanged(this.auth, callback);
  }

  getCurrentUser() {
    return this.auth.currentUser;
  }

  // ✅ Get user profile from Firestore (uses native Firebase SDK to avoid injection warnings)
  async getUserProfile() {
    const user = this.getCurrentUser();
    if (!user) throw new Error('No user logged in');

    try {
      const userDoc = await getDoc(doc(this.firestore, 'users', user.uid));
      if (userDoc && userDoc.exists && userDoc.exists()) {
        const data = userDoc.data() as any;
        this.firstName = data['firstName'] || '';
        this.lastName = data['lastName'] || '';
        return data;
      }
      // Fallback if doc missing: return auth-derived defaults
      return {
        firstName: '',
        lastName: '',
        engineeringID: '',
        email: user.email || '',
        role: 'user'
      };
    } catch (err) {
      // Handle permission errors gracefully without breaking UI
      console.warn('[Auth3Service] getUserProfile failed, returning auth fallback', err);
      return {
        firstName: '',
        lastName: '',
        engineeringID: '',
        email: user.email || '',
        role: 'user'
      };
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