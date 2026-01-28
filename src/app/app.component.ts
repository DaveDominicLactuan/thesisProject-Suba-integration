import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { Platform } from '@ionic/angular';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {
  constructor(private router: Router, private platform: Platform) {
    this.platform.ready().then(() => {
      // On app startup, route based on persisted login state
      let loggedIn = false;
      try { loggedIn = localStorage.getItem('isLoggedIn') === 'true'; } catch {}
      if (loggedIn) {
        // Navigate directly to home-page2
        this.router.navigateByUrl('/home-page2', { replaceUrl: true });
      } else {
        // Navigate to landing-page
        this.router.navigateByUrl('/landing-page', { replaceUrl: true });
      }
    });
  }
}
