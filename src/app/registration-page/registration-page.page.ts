import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService} from '../services/auth.service';
import { NavController } from '@ionic/angular';
// import { HttpClient } from '@angular/common/http';
import { Firestore, doc, setDoc } from '@angular/fire/firestore';
import { Auth3Service } from '../services/auth3.service';
import { RegistrationMapCoordinates } from './registration-leaflet-map/registration-leaflet-map.component';
@Component({
  selector: 'app-registration-page',
  templateUrl: './registration-page.page.html',
  styleUrls: ['./registration-page.page.scss'],
  standalone: false
})
export class RegistrationPagePage implements OnInit {
  // Stepper state for multi-stage registration
  step: number = 1;
  maxStep: number = 4; // 1: Basic Info, 2: PRC, 3: Account Info, 4: Confirm

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
showConfirmPassword: boolean = false;
username: string = '';
firstName: string = '';
userID: string = '';
lastName: string = '';
selectedRole: string | null = null;
error = '';
engineeringId: string = '';
fullName: string = '';
regForm!: FormGroup; // our single form
  submitted: boolean = false;
  registrationError: string | null = null;
  registrationSuccess: string | null = null;
  isRegistering: boolean = false;
  officeLocationCoordinates: RegistrationMapCoordinates | null = null;
  showRegistrationNotice: boolean = false;

// signupForm: FormGroup;

  /** Inject auth, router, firestore; form is built in ngOnInit. */
  constructor(
  private formBuilder: FormBuilder,
  private router: Router, private fb: FormBuilder,
  private auth: AuthService, private auth3: Auth3Service,
  private navCtrl: NavController, private firestore: Firestore
) {
 
}

/**
 * Lifecycle: build the reactive registration form with validators.
 */
  ngOnInit() {
    // Build the registration form with form controls, values and validators
    this.regForm = this.fb.group({
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      engineeringID: ['', this.selectedRole === 'engineer' ? Validators.required : []], // PRC required for engineer
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', Validators.required],
      phoneNumber: ['', Validators.required],
      location: ['', Validators.required],
      officeLatitude: [null, Validators.required],
      officeLongitude: [null, Validators.required]
    }, {
      validators: this.passwordMatchValidator
    });
  }

// Stepper navigation
  nextStep() {
    if (this.isRegistering) return;
    if (this.step < this.maxStep) this.step++;
  }
  prevStep() {
    if (this.isRegistering) return;
    if (this.step > 1) this.step--;
  }

  /** Jump to a specific step when step indicator is clicked/tapped. */
  goToStep(stepNumber: number) {
    if (this.isRegistering) return; // prevent navigation during in-progress registration
    if (!this.selectedRole) return; // only allow step navigation after role selection
    const n = Number(stepNumber);
    if (!n || n < 1 || n > this.maxStep) return;
    this.step = n;
  }

//Function to check if the password and confirmPassword are the same
 passwordMatchValidator(formGroup: FormGroup) {
    const password = formGroup.get('password')?.value;
    const confirmPassword = formGroup.get('confirmPassword')?.value;
    return password === confirmPassword ? null : { mismatch: true };
  }

  private waitForUiPaint(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  /**
   * Generate a unique ID for pending engineer accounts.
   * Uses timestamp + random string to ensure uniqueness without Firebase Auth.
   */
  private generatePendingAccountId(): string {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 9);
    return `pending_${timestamp}_${randomStr}`;
  }

// Function to handle registration
/**
 * Handle registration based on selectedRole:
 * - For engineers: skip Firebase Auth creation, write to pendingAccounts collection only, show approval notice
 * - For users: create Firebase Auth user, write to users collection, save office location, navigate to landing
 */
async onRegister() {
  if (this.isRegistering) {
    return;
  }

  // Mark the form as submitted so validation error messages appear on the UI
  this.submitted = true;
  // Clear any previous registration error messages
  this.registrationError = null;
  this.registrationSuccess = null;

  // Extract all form field values from the reactive form
  const { email, password, firstName, lastName, engineeringID, confirmPassword, phoneNumber, location, officeLatitude, officeLongitude } = this.regForm.value;

  // Log all extracted values to the console for debugging purposes
  console.log("Debug - Form Values:");
  console.log("Email:", email);
  console.log("Password:", password);
  console.log("Password:", confirmPassword);
  console.log("First Name:", firstName);
  console.log("Last Name:", lastName);
  console.log("Engineering ID:", engineeringID);
  console.log('Office Latitude:', officeLatitude);
  console.log('Office Longitude:', officeLongitude);

  const registrationCredentials = {
    email: email ?? '',
    password: password ? '[REDACTED]' : '',
    confirmPassword: confirmPassword ? '[REDACTED]' : '',
    firstName: firstName ?? '',
    lastName: lastName ?? '',
    engineeringID: engineeringID ?? '',
    phoneNumber: phoneNumber ?? '',
    location: location ?? '',
    officeLatitude: officeLatitude ?? null,
    officeLongitude: officeLongitude ?? null,
    role: this.selectedRole ?? ''
  };

  console.log('[RegistrationPage] Registration credentials/payload:', registrationCredentials);
  
  // Check if the user has selected a role (Engineer or User)
  // If not, set error message and exit early
  if (!this.selectedRole) {
    this.registrationError = 'Please select a role (Engineer or User).';
    return;
  }

  // Validate the entire form to ensure all required fields meet validation rules
  // If form is invalid, mark all controls as touched so error messages display
  if (this.regForm.invalid) {
    // Mark all form controls as touched, to allow for trigger error display in the template
    this.regForm.markAllAsTouched();
    // Check if the specific error is password mismatch,
    if (this.regForm.errors?.['mismatch']) {
      this.registrationError = 'Passwords do not match.';
    } else {
      // Otherwise show error asking user to fix highlighted fields
      this.registrationError = 'Please fix the highlighted fields.';
    }
    // Exit early without attempting registration
    return;
  }

  // Check if the selected role is 'engineer' and if PRC is provided
  if (this.selectedRole === 'engineer' && !engineeringID) {
    this.registrationError = 'PRC Number is required for Engineer role.';
    return;
  }

  this.isRegistering = true;
  await this.waitForUiPaint();

  try {
    if (this.selectedRole === 'engineer') {
      // ENGINEER FLOW: Create pending account (no Firebase Auth yet)
      console.log('[RegistrationPage] Processing engineer registration as pending account');
      
      // Generate a unique ID for the pending account (no Firebase Auth user yet)
      const pendingUid = this.generatePendingAccountId();
      
      // Create pending account payload
      const pendingPayload = {
        userID: pendingUid,
        firstName: firstName ?? '',
        lastName: lastName ?? '',
        prcNumber: engineeringID ?? '',
        email: email ?? '',
        password: password ?? '', // Store hashed password later by admin? Or delete after review
        role: 'engineer',
        officeLocation: {
          latitude: officeLatitude ?? null,
          longitude: officeLongitude ?? null
        },
        ifAdmin: false,
        createdAt: new Date(),
        status: 'pending',
        approvedAt: null,
        approvedBy: null
      };

      console.log('[RegistrationPage] Engineer registration payload to be written:', pendingPayload);

      const pendingOfficeLocationPayload = {
        markerId: pendingUid,
        pendingAccountId: pendingUid,
        userID: pendingUid,
        firstName: firstName ?? '',
        lastName: lastName ?? '',
        role: 'engineer',
        status: 'pending',
        location: {
          latitude: officeLatitude ?? null,
          longitude: officeLongitude ?? null
        },
        officeAddress: location ?? '',
        createdAt: new Date()
      };

      console.log('[RegistrationPage] Pending engineer account payload:', pendingPayload);
      
      // Write to pendingAccounts collection only (no Firebase Auth user created)
      await setDoc(doc(this.firestore, 'pendingAccounts', pendingUid), pendingPayload);
      console.log('[RegistrationPage] Pending engineer account written with id:', pendingUid);

      // Write the pending engineer office location marker to its own collection.
      await setDoc(doc(this.firestore, 'pendingUserOfficeLocationMarker', pendingUid), pendingOfficeLocationPayload);
      console.log('[RegistrationPage] Pending engineer office location written with id:', pendingUid);

      // Set success message
      this.registrationSuccess = 'Account request submitted successfully. Your account is under review.';
      console.log('[RegistrationPage] engineer account pending', {
        email,
        firstName,
        lastName,
        engineeringID,
        pendingUid
      });

      // Show the admin-notice overlay for engineer approval workflow
      this.showNoticeWindow();
    } else {
      // USER FLOW: Create Firebase Auth user and regular user profile
      console.log('[RegistrationPage] Processing user registration with Firebase Auth');
      
      // Call the auth service to register a new user with provided credentials
      console.log('[RegistrationPage] User registration payload before Auth3Service.register:', {
        email: email ?? '',
        password: password ? '[REDACTED]' : '',
        firstName: firstName ?? '',
        lastName: lastName ?? '',
        engineeringID: engineeringID ?? '',
        role: this.selectedRole ?? 'user',
        isAdmin: false
      });
      const userCredential = await this.auth3.register(
        email ?? '',           // Email address
        password ?? '',        // Password
        firstName ?? '',       // First name
        lastName ?? '',        // Last name
        engineeringID ?? '',   // Engineering ID (empty for users)
        this.selectedRole ?? 'user', // User role
        false                  // isAdmin
      );
     
      // Log that the registration call succeeded at the auth layer
      const createdUid = userCredential?.user?.uid;
      console.log('[RegistrationPage] Auth registration succeeded for', email, 'uid=', createdUid);

      // Auth3Service.register() already writes the user profile to Firestore users collection
      try {
        const uid = userCredential?.user?.uid;
        if (uid) {
          console.log(`[RegistrationPage] Firestore user profile written via Auth3Service for uid: ${uid}`);

          // Save office location for users
          try {
            await this.auth3.saveOfficeLocation(uid, {
              email: email ?? '',
              firstName: firstName ?? '',
              lastName: lastName ?? '',
              phoneNumber: phoneNumber ?? '',
              officeAddress: location ?? '',
              latitude: officeLatitude ?? 0,
              longitude: officeLongitude ?? 0,
              role: this.selectedRole ?? 'user',
            });
            console.log(`[RegistrationPage] Office location saved for uid: ${uid}`);
          } catch (locationErr) {
            console.warn('[RegistrationPage] Failed to save office location:', locationErr);
          }
        } else {
          console.warn('[RegistrationPage] could not determine uid after register; profile not written');
        }
      } catch (fireErr) {
        console.warn('[RegistrationPage] Firestore write failed:', fireErr);
      }

      // Set success message and navigate
      this.registrationSuccess = 'Account created successfully. You can now sign in.';
      console.log('[RegistrationPage] user account created', {
        email,
        firstName,
        lastName,
        role: this.selectedRole,
        officeLatitude,
        officeLongitude
      });

      // Non-engineer: short delay then navigate to landing page
      setTimeout(() => {
        this.router.navigate(['/landing-page']);
      }, 400);
    }
  } catch (err: any) {
    // If registration fails, extract the error message from the exception
    console.error('[RegistrationPage] Registration failed:', err);
    this.registrationError = err?.message || 'Registration failed';
    // Show the error message in an alert dialog
    alert(this.registrationError);
  } finally {
    this.isRegistering = false;
  }
}

  // convenience getter for template
  /** Convenience getter for template error checks: `f['email']` etc. */
  get f() {
    return this.regForm.controls;
  }

  get officeLocationText(): string {
    if (!this.officeLocationCoordinates) {
      return 'Tap the map preview to choose your exact office location.';
    }

    return `Latitude ${this.officeLocationCoordinates.latitude.toFixed(6)}, Longitude ${this.officeLocationCoordinates.longitude.toFixed(6)}`;
  }

  onOfficeLocationSelected(location: RegistrationMapCoordinates): void {
    this.officeLocationCoordinates = {
      latitude: location.latitude,
      longitude: location.longitude
    };

    this.regForm.patchValue({
      officeLatitude: location.latitude,
      officeLongitude: location.longitude
    });
    this.regForm.get('officeLatitude')?.markAsTouched();
    this.regForm.get('officeLongitude')?.markAsTouched();

    console.log('[RegistrationPage] Office location confirmed:', {
      latitude: location.latitude,
      longitude: location.longitude
    });
  }




  /** Navigate back to login screen. */
  goToLogin() {
    this.navCtrl.navigateBack('/login');
  }

//function to select role
/** Track selected role; required for Engineer ID validation. */
selectRole(role: string) {
  if (this.isRegistering) {
    return;
  }

  this.selectedRole = role;
  console.log('Selected Role:', role);
}

//function to toggle password visibility
/** Toggle password input visibility in the form. */
togglePasswordVisibility() {
  this.showPassword = !this.showPassword;
}

/** Toggle confirm password input visibility in the form. */
toggleConfirmPasswordVisibility() {
  this.showConfirmPassword = !this.showConfirmPassword;
}



  /** Navigate to Home page after registration or for testing. */
  goToHomePage() {
    this.router.navigate(['/home-page']);
    console.log('Navigating to Sign Up page');
  }

  private navigateToLandingPage(): void {
    try {
      this.router.navigateByUrl('/landing-page');
    } catch (e) {
      this.navCtrl.back();
    }
  }

  //function to go back to landing page
  /**
   * Back behavior: move to the previous step when possible; from step 1 or
   * the role-selection screen, leave the registration flow and return to landing.
   */
  onBack() {
    if (this.isRegistering) {
      return;
    }

    if (!this.selectedRole) {
      this.navigateToLandingPage();
      return;
    }

    if (this.step > 1) {
      this.step--;
      return;
    }

    this.selectedRole = null;
    this.navigateToLandingPage();
  }

  /**
   * Dynamically create and append a notice window to the document body.
   * The notice matches the attached image: header, message and a Confirm button
   * which will call `closeNoticeWindow()` to remove it and navigate.
   */
  showNoticeWindow() {
    this.showRegistrationNotice = true;
  }

  /**
   * Remove the notice overlay. If `navigate` is true, navigate to landing page.
   */
  closeNoticeWindow(navigate: boolean = false) {
    this.showRegistrationNotice = false;
    if (navigate) {
      try {
        this.router.navigate(['/landing-page']);
      } catch (e) {
        this.navCtrl.back();
      }
    }
  }

}
