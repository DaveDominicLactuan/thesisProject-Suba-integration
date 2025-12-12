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

  /** Lifecycle: ready hook (no-op). */
  ngOnInit() {
  }

  /** Navigate to registration page. */
  goToRegistration() {
    this.router.navigate(['/registration-page']);
    console.log('Navigating to Sign Up page');
  }

  /** Navigate to login page. */
  goToLogIn() {
    this.router.navigate(['/login-page']);
    console.log('Navigating to Sign Up page');
  }

  
  /** Example route to notes (currently points to registration). */
  goToNotesPage() {
    this.router.navigate(['/registration-page']);
    console.log('Navigating to Sign Up page');
  }

  /** Example second-page route (currently points to registration). */
  goToSecondPage() {
    this.router.navigate(['/registration-page']);
    console.log('Navigating to Sign Up page');
  }

  /** Button click handler (currently routes to registration). */
  onButtonClick() {
    this.router.navigate(['/registration-page']);
    console.log('Navigating to Sign Up page');
  }

  /** Example calendar route (currently points to registration). */
  goToCalendarPage() {
    this.router.navigate(['/registration-page']);
    console.log('Navigating to Sign Up page');
  }

  /** Example profile route (currently points to registration). */
  goToProfilePage() {
    this.router.navigate(['/registration-page']);
    console.log('Navigating to Sign Up page');
  }

}
