import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { Platform } from '@ionic/angular';
import { PresenceService } from './services/presence.service';
import { Auth3Service } from './services/auth3.service';
import { UserPrefetchCacheService } from './services/user-prefetch-cache.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {
  constructor(private router: Router, private platform: Platform, private presenceService: PresenceService, private auth3: Auth3Service, private userPrefetchCache: UserPrefetchCacheService) {
    this.platform.ready().then(async () => {
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

      // Wait for auth user (best-effort) then start presence listener
      try {
        const authedUser = await this.auth3.waitForAuthUser(10000);
        if (authedUser?.uid) {
          this.userPrefetchCache.warmUserDataInBackground(authedUser.uid, 'app-startup');
        }
        try { this.presenceService.start(); } catch (e) { console.warn('Presence start failed in AppComponent', e); }
      } catch (e) {
        console.warn('Auth wait failed in AppComponent', e);
      }
    });
  }
}
