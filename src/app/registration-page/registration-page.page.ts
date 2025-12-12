import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService} from '../services/auth.service';
import { NavController } from '@ionic/angular';
// import { HttpClient } from '@angular/common/http';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Auth3Service } from '../services/auth3.service';

@Component({
  selector: 'app-registration-page',
  templateUrl: './registration-page.page.html',
  styleUrls: ['./registration-page.page.scss'],
  standalone: false
})
export class RegistrationPagePage implements OnInit {
//  regForm = this.fb.group({
  //   firstName: ['', Validators.required],
  //   lastName: ['', Validators.required],
  //   engineeringID: ['', Validators.required],
  //   email: ['', [Validators.required, Validators.email]],
  //   password: ['', [Validators.required, Validators.minLength(6)]],
  // });


    email: string | null = null;
password: string = '';
confirmPassword: string = '';
rememberMe: boolean = false;
showPassword: boolean = false;
username: string = '';
firstName: string = '';
lastName: string = '';
selectedRole: string | null = null;
error = '';
engineeringId: string = '';
fullName: string = '';
regForm!: FormGroup; // our single form
  submitted: boolean = false;
  registrationError: string | null = null;

// signupForm: FormGroup;

  /** Inject auth, router, firestore; form is built in ngOnInit. */
  constructor(
  private formBuilder: FormBuilder,
  private router: Router, private fb: FormBuilder,
  private auth: AuthService, private auth3: Auth3Service,
  private navCtrl: NavController, private firestore: AngularFirestore
) {
 
}

/**
 * Lifecycle: build the reactive registration form with validators.
 */
ngOnInit() {
this.regForm = this.fb.group({
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      engineeringID: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', Validators.required]
    }, {
      validators: this.passwordMatchValidator
    });
}

//Function to check if the password and confirmPassword are the same

 /**
  * Cross-field validator to ensure password and confirmPassword match.
  */
 passwordMatchValidator(formGroup: FormGroup) {
    const password = formGroup.get('password')?.value;
    const confirmPassword = formGroup.get('confirmPassword')?.value;
    return password === confirmPassword ? null : { mismatch: true };
  }


// Function to handle registration
/**
 * Handle registration: validate form & role, call Auth3Service.register,
 * then navigate to landing on success or show error on failure.
 */
async onRegister() {
  // Mark the form as submitted so validation error messages appear on the UI
  this.submitted = true;
  // Clear any previous registration error messages
  this.registrationError = null;

  // Extract all form field values from the reactive form
  const { email, password, firstName, lastName, engineeringID, confirmPassword } = this.regForm.value;

  // Log all extracted values to the console for debugging purposes
  console.log("Debug - Form Values:");
  console.log("Email:", email);
  console.log("Password:", password);
  console.log("Password:", confirmPassword);
  console.log("First Name:", firstName);
  console.log("Last Name:", lastName);
  console.log("Engineering ID:", engineeringID);
  
  // Check if the user has selected a role (Engineer or User)
  // If not, set error message and exit early
  if (!this.selectedRole) {
    this.registrationError = 'Please select a role (Engineer or User).';
    return;
  }

  // Validate the entire form to ensure all required fields meet validation rules
  // If form is invalid, mark all controls as touched so error messages display
  if (this.regForm.invalid) {
    // Mark all form controls as touched to trigger error display in the template
    this.regForm.markAllAsTouched();
    // Check if the specific error is password mismatch
    if (this.regForm.errors?.['mismatch']) {
      this.registrationError = 'Passwords do not match.';
    } else {
      // Otherwise show a generic error asking user to fix highlighted fields
      this.registrationError = 'Please fix the highlighted fields.';
    }
    // Exit early without attempting registration
    return;
  }

  // Check if the selected role is 'parent' (Engineer) and if engineeringID is provided
  // If it's Engineer role but no ID provided, show error and exit
  if (this.selectedRole === 'parent' && !engineeringID) {
    this.registrationError = 'Engineering ID is required for Engineer role.';
    return;
  }

  // If all validation passes, attempt to create the user account
  try {
    // Call the auth service to register a new user with provided credentials
    await this.auth3.register(
      email ?? '',           // Email address (use empty string if null)
      password ?? '',        // Password (use empty string if null)
      firstName ?? '',       // First name (use empty string if null)
      lastName ?? '',        // Last name (use empty string if null)
      engineeringID ?? ''    // Engineering ID (use empty string if null)
    );

    // If registration succeeds, show success alert to the user
    alert('Account created successfully. Press OK to continue.');
    // Navigate to landing page and replace the current history entry
    this.router.navigateByUrl('/landing-page', { replaceUrl: true });
  } catch (err: any) {
    // If registration fails, extract the error message from the exception
    this.registrationError = err?.message || 'Registration failed';
    // Show the error message in an alert dialog
    alert(this.registrationError);
  }
}

  // convenience getter for template
  /** Convenience getter for template error checks: `f['email']` etc. */
  get f() {
    return this.regForm.controls;
  }




  /** Navigate back to login screen. */
  goToLogin() {
    this.navCtrl.navigateBack('/login');
  }

//function to select role
/** Track selected role; required for Engineer ID validation. */
selectRole(role: string) {
  this.selectedRole = role;
  console.log('Selected Role:', role);
}

//function to toggle password visibility
/** Toggle password input visibility in the form. */
togglePasswordVisibility() {
  this.showPassword = !this.showPassword;
}



  /** Navigate to Home page after registration or for testing. */
  goToHomePage() {
    this.router.navigate(['/home-page']);
    console.log('Navigating to Sign Up page');
  }

  //function to go back to landing page
  /**
   * Back behavior: if a role was chosen, deselect it; otherwise navigate
   * to landing (fallback to navCtrl.back()).
   */
  onBack() {
  // If a role is selected, deselect it. Otherwise navigate back to landing page.
  if (this.selectedRole) {
    this.selectedRole = null;
    return;
  }

  // No role selected: navigate back to landing page
  try {
    this.router.navigateByUrl('/landing-page');
  } catch (e) {
    this.navCtrl.back();
  }
}

}
