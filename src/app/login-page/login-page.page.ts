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

  constructor(private formBuilder: FormBuilder, private router: Router, private auth: AuthService, private navCtrl: NavController, private auth3: Auth3Service) {
    this.signupForm = this.formBuilder.group({
      username: ['', Validators.required],
      password: ['', Validators.required],
    });
  }

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

  goToRegister() {
    this.navCtrl.navigateForward('/register');
    
  }

  onSubmit() {
    if (this.signupForm.valid) {
      console.log('Form Submitted:', this.signupForm.value);
    } else {
      console.log('Form Invalid');
    }
  }

 

selectRole(role: string) {
  this.selectedRole = role;
  console.log('Selected Role:', role);
}

togglePasswordVisibility() {
  this.showPassword = !this.showPassword;
}


  ngOnInit() {
  }

  goToHomePage() {
    this.router.navigate(['/home-page']);
    console.log('camera page');
  }

}
