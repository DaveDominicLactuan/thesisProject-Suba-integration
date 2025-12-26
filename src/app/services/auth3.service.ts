import { Injectable } from '@angular/core';
import { Auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from '@angular/fire/auth';
import { Firestore, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { doc as fbDoc, getDoc as fbGetDoc } from 'firebase/firestore';
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
  const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
  const uid = userCredential.user.uid;

  await setDoc(fbDoc(this.firestore, 'users', uid), {
    firstName,
    lastName,
    engineeringID,
    email, // safe here since we already checked
    role: role || (engineeringID ? 'engineer' : 'user'), // Store role explicitly
    createdAt: serverTimestamp()
  });

  return userCredential;
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
      const userDoc = await fbGetDoc(fbDoc(this.firestore, 'users', user.uid));
      if (userDoc.exists()) {
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