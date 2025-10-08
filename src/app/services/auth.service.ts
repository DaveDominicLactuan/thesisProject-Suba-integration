import { Injectable } from '@angular/core';
import { auth, db } from '../firebase';
import {
  
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Auth, createUserWithEmailAndPassword, UserCredential } from '@angular/fire/auth';
import { Firestore, doc, setDoc } from '@angular/fire/firestore';




@Injectable({ providedIn: 'root' })
export class AuthService {

  constructor(private auth: Auth, private firestore: Firestore) {}

  // // ✅ Register new user
  // async register(email: string, password: string, fullName: string, engineeringId: string) {
  //   // 1. Create Firebase Auth account
  //   const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  //   const user = userCredential.user;

  //   // 2. Store extra info in Firestore
  //   await this.firestore.collection('users').doc(user.uid).set({
  //     fullName: fullName,
  //     engineeringId: engineeringId,
  //     email: email,
  //     createdAt: new Date()
  //   });

  //   return user;
  // }

  // async register(email: string, password: string, fullName: string, engineeringId: string): Promise<UserCredential> {
  //   // Create the user with Firebase Auth
  //   const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
  //   const user = userCredential.user;

  //   // Save extra user info to Firestore
  //   const userDocRef = doc(this.firestore, `users/${user.uid}`);
  //   await setDoc(userDocRef, {
  //     uid: user.uid,
  //     email: user.email,
  //     fullName: fullName,
  //     engineeringId: engineeringId,
  //     createdAt: new Date()
  //   });

  //   return userCredential;
  // }

  // // ✅ Login user
  // login(email: string, password: string) {
  //   return signInWithEmailAndPassword(auth, email, password);
  // }


  login(email: string, password: string) {
    return signInWithEmailAndPassword(this.auth, email, password);
  }

  async register(email: string, password: string, fullName: string, engineeringId: string) {
    // Create account in Firebase Auth
    const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
    const user = userCredential.user;

    // Save additional user data to Firestore
    const userDocRef = doc(this.firestore, `users/${user.uid}`);
    await setDoc(userDocRef, {
      uid: user.uid,
      email: user.email,
      fullName,
      engineeringId,
      createdAt: new Date()
    });

    return userCredential;
  }

  // ✅ Logout
  logout() {
    return signOut(auth);
  }

  // ✅ Auth state change
  onAuthChange(callback: (user: User | null) => void) {
    return onAuthStateChanged(auth, callback);
  }

  // ✅ Current user getter
  getCurrentUser() {
    return auth.currentUser;
  }
}
