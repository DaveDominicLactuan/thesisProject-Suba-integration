import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-landing-page',
  templateUrl: './landing-page.page.html',
  styleUrls: ['./landing-page.page.scss'],
  standalone: false
})
export class LandingPagePage implements OnInit {
  constructor(private router: Router) { }

  ngOnInit() {
  }

  goToRegistration() {
    this.router.navigate(['/registration-page']);
    console.log('Navigating to Sign Up page');
  }

  goToLogIn() {
    this.router.navigate(['/login-page']);
    console.log('Navigating to Sign Up page');
  }

  
  goToNotesPage() {
    this.router.navigate(['/registration-page']);
    console.log('Navigating to Sign Up page');
  }

  goToSecondPage() {
    this.router.navigate(['/registration-page']);
    console.log('Navigating to Sign Up page');
  }

  onButtonClick() {
    this.router.navigate(['/registration-page']);
    console.log('Navigating to Sign Up page');
  }

  goToCalendarPage() {
    this.router.navigate(['/registration-page']);
    console.log('Navigating to Sign Up page');
  }

  goToProfilePage() {
    this.router.navigate(['/registration-page']);
    console.log('Navigating to Sign Up page');
  }

}
