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

//Function to check if the password and confirmPassword are the same
 passwordMatchValidator(formGroup: FormGroup) {
    const password = formGroup.get('password')?.value;
    const confirmPassword = formGroup.get('confirmPassword')?.value;
    return password === confirmPassword ? null : { mismatch: true };
  }

  private waitForUiPaint(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }


// Function to handle registration
/**
 * Handle registration: validate form & role, call Auth3Service.register for registration using credentials,
 * then navigate to landing on success or show error on failure.
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
    // Call the auth service to register a new user with provided credentials
    // selectedRole already contains 'engineer' or 'user'
    const userCredential = await this.auth3.register(
      email ?? '',           // Email address (use empty string if null)
      password ?? '',        // Password (use empty string if null)
      firstName ?? '',       // First name (use empty string if null)
      lastName ?? '',        // Last name (use empty string if null)
      engineeringID ?? '',   // Engineering ID (use empty string if null)
      this.selectedRole ?? 'user', // User role ('engineer' or 'user')
      false                  // isAdmin
    );
   
    // Log that the registration call succeeded at the auth layer
    const createdUid = userCredential?.user?.uid;
    console.log('[RegistrationPage] Auth registration succeeded for', email, 'uid=', createdUid);

    // Auth3Service.register() already writes the user profile to Firestore
    // so we skip the redundant write here. Just log success.
    try {
      const uid = userCredential?.user?.uid;
      if (uid) {
        console.log(`[RegistrationPage] Firestore profile written via Auth3Service for uid: ${uid}`);

        // Also create a pending account record for administrative review/approval
        try {
          console.log('[RegistrationPage] Attempting to write pending account record', {
            uid,
            email,
            role: this.selectedRole,
            hasEngineeringId: !!engineeringID
          });
          const pendingPayload = {
            userID: uid,
            firstName: firstName ?? '',
            lastName: lastName ?? '',
            prcNumber: engineeringID ?? '',
            email: email ?? '',
            role: this.selectedRole ?? 'user',
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
          console.log('[RegistrationPage] Pending account payload:', pendingPayload);
          await setDoc(doc(this.firestore, 'pendingAccounts', uid), pendingPayload);
          console.log(`[RegistrationPage] Pending account record written for uid: ${uid}`);

          // Save office location to the 'officeLocations' collection
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
        } catch (pendingErr) {
          console.warn('[RegistrationPage] Failed to write pending account record:', pendingErr);
          console.warn('[RegistrationPage] Pending account write failed details:', {
            uid,
            email,
            role: this.selectedRole
          });
        }
      } else {
        console.warn('[RegistrationPage] could not determine uid after register; profile not written');
      }
    } catch (fireErr) {
      console.warn('[RegistrationPage] Firestore write failed:', fireErr);
    }

    // If registration succeeds, set success message and navigate to login
    this.registrationSuccess = 'Account created successfully. You can now sign in.';
    console.log('[RegistrationPage] account created', {
      email,
      firstName,
      lastName,
      engineeringID,
      role: this.selectedRole,
      officeLatitude,
      officeLongitude
    });
    // Give the success message a brief moment before redirecting to login
    // For engineer role show the admin-notice modal and wait for user confirmation
    if (this.selectedRole === 'engineer') {
      this.showNoticeWindow();
    } else {
      // Non-engineer: short delay then navigate
      setTimeout(() => {
        this.router.navigate(['/landing-page']);
      }, 400);
    }
  } catch (err: any) {
    // If registration fails, extract the error message from the exception
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
  if (this.isRegistering) {
    return;
  }

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

  /**
   * Dynamically create and append a notice window to the document body.
   * The notice matches the attached image: header, message and a Confirm button
   * which will call `closeNoticeWindow()` to remove it and navigate.
   */
  showNoticeWindow() {
    // Avoid creating duplicate overlays
    if (document.getElementById('registration-notice-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'registration-notice-overlay';
    overlay.style.position = 'fixed';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.background = 'rgba(0,0,0,0.35)';
    overlay.style.zIndex = '9999';

    const card = document.createElement('div');
    card.style.width = '560px';
    card.style.maxWidth = '92%';
    card.style.background = '#fff';
    card.style.borderRadius = '12px';
    card.style.overflow = 'hidden';
    card.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
    card.style.fontFamily = 'Arial, Helvetica, sans-serif';

    const header = document.createElement('div');
    header.textContent = 'Notice';
    header.style.background = '#f26522';
    header.style.color = '#fff';
    header.style.fontSize = '40px';
    header.style.textAlign = 'center';
    header.style.padding = '22px 16px';

    const body = document.createElement('div');
    body.style.padding = '20px 26px';
    body.style.color = '#111';
    body.style.textAlign = 'center';
    body.style.lineHeight = '1.4';
    body.style.fontSize = '16px';
    body.innerHTML = `Your request for an account as engineer is sent and processing will take 3 - 5 days. Once confirmation is completed, credentials will be sent to the email used in registration.`;

    const actions = document.createElement('div');
    actions.style.padding = '18px';
    actions.style.display = 'flex';
    actions.style.justifyContent = 'center';

    const btn = document.createElement('button');
    btn.textContent = 'Confirm';
    btn.style.background = '#f26522';
    btn.style.color = '#fff';
    btn.style.border = 'none';
    btn.style.padding = '12px 34px';
    btn.style.borderRadius = '8px';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '18px';
    btn.onclick = () => this.closeNoticeWindow(true);

    actions.appendChild(btn);
    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  /**
   * Remove the notice overlay. If `navigate` is true, navigate to landing page.
   */
  closeNoticeWindow(navigate: boolean = false) {
    const el = document.getElementById('registration-notice-overlay');
    if (el && el.parentElement) el.parentElement.removeChild(el);
    if (navigate) {
      try {
        this.router.navigate(['/landing-page']);
      } catch (e) {
        this.navCtrl.back();
      }
    }
  }

}
