import { Injectable } from '@angular/core';
import { Auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from '@angular/fire/auth';
import { Firestore, doc, setDoc, serverTimestamp, getDoc } from '@angular/fire/firestore';
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

async register(email: string, password: string, firstName: string, lastName: string, engineeringID: string) {
  if (!email) {
    throw new Error('Email is required');
  }
  const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
  const uid = userCredential.user.uid;

  await setDoc(doc(this.firestore, 'users', uid), {
    firstName,
    lastName,
    engineeringID,
    email, // safe here since we already checked
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

  // ✅ Get user profile from Firestore
  async getUserProfile() {
    const user = this.getCurrentUser();
    if (!user) throw new Error('No user logged in');

    const userDoc = await getDoc(doc(this.firestore, 'users', user.uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      this.firstName = data['firstName'] || '';
      this.lastName = data['lastName'] || '';
      return data;
    } else {
      throw new Error('User profile not found');
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