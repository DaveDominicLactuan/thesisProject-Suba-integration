import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { NavController } from '@ionic/angular';
import { Auth3Service } from '../services/auth3.service';
import { UserPrefetchCacheService } from '../services/user-prefetch-cache.service';


@Component({
  selector: 'app-login-page',
  templateUrl: './login-page.page.html',
  styleUrls: ['./login-page.page.scss'],
  standalone: false
})
export class LoginPagePage implements OnInit {


    email: string = '';
password: string = '';
confirmPassword: string = '';
rememberMe: boolean = false;
showPassword: boolean = false;
username: string = '';
firstName: string = '';
lastName: string = '';
selectedRole: string | null = null;
error = '';
engineeringID: string = '';
userID: string = '';
fullName: string = '';

signupForm: FormGroup;

  /** Inject auth/router; build a minimal form for demonstration, 
   * for login with authentication from auth 3 and fetches and stores basic profile data. using field for username and password */
  constructor(private formBuilder: FormBuilder, private router: Router, private auth: AuthService, private navCtrl: NavController, private auth3: Auth3Service, private userPrefetchCache: UserPrefetchCacheService) {
    this.signupForm = this.formBuilder.group({
      username: ['', Validators.required],
      password: ['', Validators.required],
    });
  }

  /**
   * Perform login via Auth3Service, then navigate to Home on success.
   */
  async login() {
    this.error = '';
    try {
      //tries login with email and password
      console.log('[LoginPage.login] ===== LOGIN FLOW START =====');
      console.log('[LoginPage.login] Email:', this.email);
      console.log('[LoginPage.login] Auth currentUser BEFORE login:', this.auth3.getCurrentUser()?.uid || 'null');
      await this.auth3.login(this.email, this.password);
      console.log('[LoginPage] Auth login succeeded for', this.email);
      console.log('[LoginPage.login] Auth currentUser IMMEDIATELY after login (before wait):', this.auth3.getCurrentUser()?.uid || 'null');
      const authedUser = await this.auth3.waitForAuthUser(15000);
      console.log('[LoginPage] Auth currentUser after login', authedUser?.uid || null);
      console.log('[LoginPage.login] After waitForAuthUser - returned user:', authedUser?.uid || 'null', 'email:', authedUser?.email || 'null');
      if (authedUser?.uid) {
        this.userPrefetchCache.warmUserDataInBackground(authedUser.uid, 'login-success');
      }

      // After successful login, persist login state and basic user data
      try {
        // Fetch user profile from Firestore using the login credentials of Auth3Service
        console.log('[LoginPage.login] About to call getUserProfile() - currentUser is:', this.auth3.getCurrentUser()?.uid || 'null');
        const profile = await this.auth3.getUserProfile();
        console.log('[LoginPage] Retrieved user profile from Firestore:', profile);
        const firstName = profile['firstName'] || '';
        const lastName = profile['lastName'] || '';
        const engineeringID = profile['engineeringID'] || '';
        const email = profile['email'] || this.email;
        const userID = profile['userID'] || '';
        const username = (firstName && lastName) ? `${firstName} ${lastName}` : (email || '');
        const userRole = engineeringID ? 'engineer' : 'user';
        //compiles user data as object for storing locally on device for offline access
        const userData = { username, userRole, firstName, lastName, engineeringID, email, userID };
        // Keep component fields updated for template/console visibility
        this.firstName = firstName;
        this.lastName = lastName;
        this.username = username;
        this.engineeringID = engineeringID;
        this.userID = userID;
        // Print user details for quick verification on login page
        console.log('[LoginPage] Login succeeded', userData);
        // Store user data locally for offline access
        try { localStorage.setItem('userData', JSON.stringify(userData)); } catch {}
      } catch (e) {
        // Even if profile fetch fails, mark as logged in so navigation proceeds
        console.warn('[LoginPage] getUserProfile failed; proceeding with fallback email only', e);
      }

      // Mark logged in and navigate to home, allow for when openign app navigate to home-page than landing page
      //  replacing history so back exits
      try { localStorage.setItem('isLoggedIn', 'true'); } catch {}
      console.log('[LoginPage.login] Successfully logged in. currentUser NOW:', this.auth3.getCurrentUser()?.uid || 'null');
      console.log('[LoginPage.login] About to navigate to /home-page2');
      console.log('[LoginPage.login] ===== LOGIN FLOW END (navigating) =====');

      //only remove login page from history stack in the browser, replaceUrl true does that
      this.router.navigateByUrl('/home-page2', { replaceUrl: true });


    } catch (err: any) {
      this.error = err.message || 'Login failed';
    }
  }

  /** Navigate to register route using NavController. */
  goToRegister() {
    this.navCtrl.navigateForward('/register');
    
  }

  /** Demo submit handler for the simple reactive form. */
  onSubmit() {
    if (this.signupForm.valid) {
      console.log('Form Submitted:', this.signupForm.value);
    } else {
      console.log('Form Invalid');
    }
  }

 

/** Track selected role (UX only, no auth effect). */
selectRole(role: string) {
  this.selectedRole = role;
  console.log('Selected Role:', role);
}

/** Toggle password input visibility. */
togglePasswordVisibility() {
  this.showPassword = !this.showPassword;
}


  /** Lifecycle: ready hook (no-op). */
  ngOnInit() {
  }

  /** Navigate directly to Home page (bypasses login flow). */
  goToHomePage() {
    this.router.navigate(['/home-page']);
    console.log('camera page');
  }

  /** Navigate directly to Home page (bypasses login flow). */
  goToHomePage2() {
    this.router.navigate(['/home-page2']);
    console.log('camera page');
  }

  /** Navigate to landing page; fall back to history back. */
  goBack() {
    try {
      // navigate back to landing page or previous history
      this.router.navigateByUrl('/landing-page');
    } catch (e) {
      window.history.back();
    }
  }

  // Keep a small shim so templates can call onBack() like the registration page does.
  /** Template shim so buttons can call onBack(). */
  onBack() {
    this.goBack();
  }

}
