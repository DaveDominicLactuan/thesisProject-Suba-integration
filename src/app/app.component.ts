import { Component } from '@angular/core';
import { Platform } from '@ionic/angular';
import { SplashScreen } from '@capacitor/splash-screen';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {
  constructor(private platform: Platform) {
    this.initializeApp();
  }

  async initializeApp() {
    await this.platform.ready();

    // Perform any init tasks here (e.g., load settings, fonts, data)
    // When ready, hide the splash:
    try {
      await SplashScreen.hide();
    } catch (e) {
      // fallback if plugin not available in web
      console.warn('SplashScreen.hide() failed', e);
    }
  }
}
