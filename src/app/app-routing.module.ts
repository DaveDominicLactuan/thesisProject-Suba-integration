import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: 'home',
    loadChildren: () => import('./home/home.module').then( m => m.HomePageModule)
  },
  {
    path: '',
    redirectTo: 'landing-page',
    pathMatch: 'full'
  },
  {
    path: 'landing-page',
    loadChildren: () => import('./landing-page/landing-page.module').then( m => m.LandingPagePageModule)
  },
  {
    path: 'registration-page',
    loadChildren: () => import('./registration-page/registration-page.module').then( m => m.RegistrationPagePageModule)
  },
  {
    path: 'login-page',
    loadChildren: () => import('./login-page/login-page.module').then( m => m.LoginPagePageModule)
  },
  {
    path: 'feedback-page',
    loadChildren: () => import('./feedback-page/feedback-page.module').then( m => m.FeedbackPagePageModule)
  },
  {
    path: 'pdf-page-test03',
    loadChildren: () => import('./pdf-page-test03/pdf-page-test03.module').then( m => m.PdfPageTest03PageModule)
  },
  {
    path: 'upload-image-page',
    loadChildren: () => import('./upload-image-page/upload-image-page.module').then( m => m.UploadImagePagePageModule)
  },
  {
    path: 'camera-page2',
    loadChildren: () => import('./camera-page2/camera-page2.module').then( m => m.CameraPage2PageModule)

  },
  {
    path: 'session-page',
    loadChildren: () => import('./session-page/session-page.module').then( m => m.SessionPagePageModule)
  },
  {
    path: 'results-dashboard',
    loadChildren: () => import('./results-dashboard/results-dashboard.module').then(m => m.ResultsDashboardModule)
  },
  {
    path: 'home-page2',
    loadChildren: () => import('./home-page2/home-page2.module').then( m => m.HomePage2PageModule)
  },
  {
    path: 'browse-file-page',
    loadChildren: () => import('./browse-file-page/browse-file-page.module').then( m => m.BrowseFilePagePageModule)
  },
  {
    path: 'profile-page',
    loadChildren: () => import('./profile-page/profile-page.module').then( m => m.ProfilePagePageModule)
  },
  {
    path: 'chat-page',
    loadChildren: () => import('./chat-page/chat-page.module').then( m => m.ChatPagePageModule)
  },  {
    path: 'office-map-marker-page',
    loadChildren: () => import('./office-map-marker-page/office-map-marker-page.module').then( m => m.OfficeMapMarkerPagePageModule)
  },
  {
    path: 's3-page',
    loadChildren: () => import('./s3-page/s3-page.module').then( m => m.S3PagePageModule)
  },
  {
    path: 'notification-page',
    loadChildren: () => import('./notification-page/notification-page.module').then( m => m.NotificationPagePageModule)
  },




];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule { }
