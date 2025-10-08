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
  // this.signupForm = this.formBuilder.group({
  //   fullName: ['', Validators.required],
  //   engineeringId: ['', Validators.required],
  //   email: ['', [Validators.required, Validators.email]],
  //   password: ['', Validators.required],
  //   confirmPassword: ['', Validators.required]
  // });
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

// async onRegister() {
//   if (this.regForm.invalid) {
//     alert('Please fill out all required fields');
//     return;
//   }

//   const { email, password, firstName, lastName, engineeringID } = this.regForm.value;

//   try {
//     await this.auth3.register(
//       email ?? '',
//       password ?? '',
//       firstName ?? '',
//       lastName ?? '',
//       engineeringID ?? ''
//     );
//     this.router.navigateByUrl('/home', { replaceUrl: true });
//   } catch (err: any) {
//     alert(err.message || 'Registration failed');
//   }
// }

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



  //  async register() {
  //   this.error = '';

  //   // Validate passwords
  //   if (this.password !== this.confirmPassword) {
  //     this.error = 'Passwords do not match';
  //     return;
  //   }

  //   // Optional: validate required fields
  //   if (!this.fullName || !this.engineeringId || !this.email || !this.password) {
  //     this.error = 'All fields are required';
  //     return;
  //   }

  //   try {
  //     await this.auth.register(this.email, this.password, this.fullName, this.engineeringId);
  //     // this.navCtrl.navigateRoot('/home');
  //      this.router.navigate(['/landing-page']);
  //   } catch (err: any) {
  //     this.error = err.message || 'Registration failed';
  //   }
  // }

//   register() {
//   if (this.signupForm.invalid) {
//     this.error = 'Form is invalid';
//     return;
//   }

//   const { fullName, engineeringId, email, password, confirmPassword } = this.signupForm.value;

//   if (password !== confirmPassword) {
//     this.error = 'Passwords do not match';
//     return;
//   }

//   this.auth.register(email, password, fullName, engineeringId)
//     .then(() => this.router.navigate(['/landing-page']))
//     .catch(err => this.error = err.message || 'Registration failed');
// }
// register() {
//   if (this.signupForm.invalid) {
//     this.error = 'Form is invalid';
//     return;
//   }

//   const { email, password, confirmPassword, fullName, engineeringId } = this.signupForm.value;

//   if (password !== confirmPassword) {
//     this.error = 'Passwords do not match';
//     return;
//   }

//  this.auth.register(email, password, fullName, engineeringId)
//   .then(() => this.router.navigate(['/landing-page']))
//   .catch(err => this.error = err.message || 'Registration failed');
// }




  goToLogin() {
    this.navCtrl.navigateBack('/login');
  }

  // onSubmit() {
  //   if (this.signupForm.valid) {
  //     console.log('Form Submitted:', this.signupForm.value);
  //   } else {
  //     console.log('Form Invalid');
  //   }
  // }

 

selectRole(role: string) {
  this.selectedRole = role;
  console.log('Selected Role:', role);
}

togglePasswordVisibility() {
  this.showPassword = !this.showPassword;
}


  // ngOnInit() {
    
  // }

  goToHomePage() {
    this.router.navigate(['/home-page']);
    console.log('Navigating to Sign Up page');
  }

}
