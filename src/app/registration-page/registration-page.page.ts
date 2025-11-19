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

// signupForm: FormGroup;

  constructor(
  private formBuilder: FormBuilder,
  private router: Router, private fb: FormBuilder,
  private auth: AuthService, private auth3: Auth3Service,
  private navCtrl: NavController, private firestore: AngularFirestore
) {
 
}

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

 passwordMatchValidator(formGroup: FormGroup) {
    const password = formGroup.get('password')?.value;
    const confirmPassword = formGroup.get('confirmPassword')?.value;
    return password === confirmPassword ? null : { mismatch: true };
  }



async onRegister() {

  const { email, password, firstName, lastName, engineeringID, confirmPassword } = this.regForm.value;

  console.log("Debug - Form Values:");
  console.log("Email:", email);
  console.log("Password:", password);
  console.log("Password:", confirmPassword);
  console.log("First Name:", firstName);
  console.log("Last Name:", lastName);
  console.log("Engineering ID:", engineeringID);
  
  if (this.regForm.invalid) {
    if (this.regForm.errors?.['mismatch']) {
      alert('Passwords do not match');
    } else {
      alert('Please fill out all required fields, password must be at least 6 characters long, and email must be valid');

    }
    return;
  }

  try {
    await this.auth3.register(
      email ?? '',
      password ?? '',
      firstName ?? '',
      lastName ?? '',
      engineeringID ?? ''
    );
    this.router.navigateByUrl('/landing-page', { replaceUrl: true });
  } catch (err: any) {
    alert(err.message || 'Registration failed');
  }
}




  goToLogin() {
    this.navCtrl.navigateBack('/login');
  }


selectRole(role: string) {
  this.selectedRole = role;
  console.log('Selected Role:', role);
}

togglePasswordVisibility() {
  this.showPassword = !this.showPassword;
}



  goToHomePage() {
    this.router.navigate(['/home-page']);
    console.log('Navigating to Sign Up page');
  }

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
