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

  /** Inject auth/router; build a minimal form for demonstration. */
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
      await this.auth3.login(this.email, this.password);
      // this.navCtrl.navigateRoot('/home');
       this.router.navigate(['/home-page']);


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

 

/** Track selected role (UX only, no auth effect here). */
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
