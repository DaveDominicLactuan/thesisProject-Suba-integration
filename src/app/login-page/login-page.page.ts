import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { NavController } from '@ionic/angular';
import { Auth3Service } from '../services/auth3.service';


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
fullName: string = '';

signupForm: FormGroup;

  /** Inject auth/router; build a minimal form for demonstration, 
   * for login with authentication from auth 3 and fetches and stores basic profile data. using field for username and password */
  constructor(private formBuilder: FormBuilder, private router: Router, private auth: AuthService, private navCtrl: NavController, private auth3: Auth3Service) {
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
      await this.auth3.login(this.email, this.password);
      console.log('[LoginPage] Auth login succeeded for', this.email);
      // After successful login, persist login state and basic user data
      try {
        // Fetch user profile from Firestore using the login credentials of Auth3Service
        const profile = await this.auth3.getUserProfile();
        console.log('[LoginPage] Retrieved user profile from Firestore:', profile);
        const firstName = profile['firstName'] || '';
        const lastName = profile['lastName'] || '';
        const engineeringID = profile['engineeringID'] || '';
        const email = profile['email'] || this.email;
        const username = (firstName && lastName) ? `${firstName} ${lastName}` : (email || '');
        const userRole = engineeringID ? 'engineer' : 'user';
        //compiles user data as object for storing locally on device for offline access
        const userData = { username, userRole, firstName, lastName, engineeringID, email };
        // Keep component fields updated for template/console visibility
        this.firstName = firstName;
        this.lastName = lastName;
        this.username = username;
        this.engineeringID = engineeringID;
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
      console.log('[LoginPage] navigating to /home-page');
      this.router.navigateByUrl('/home-page', { replaceUrl: true });


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
