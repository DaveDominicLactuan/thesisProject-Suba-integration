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
    path: 'camera-page',
    loadChildren: () => import('./camera-page/camera-page.module').then( m => m.CameraPagePageModule)
  },
  {
    path: 'home-page',
    loadChildren: () => import('./home-page/home-page.module').then( m => m.HomePagePageModule)
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
    path: 'pdf-page',
    loadChildren: () => import('./pdf-page/pdf-page.module').then( m => m.PdfPagePageModule)
  },
  {
    path: 'pdf-page-test',
    loadChildren: () => import('./pdf-page-test/pdf-page-test.module').then( m => m.PdfPageTestPageModule)
  },
  {
    path: 'pdf-page-test02',
    loadChildren: () => import('./pdf-page-test02/pdf-page-test02.module').then( m => m.PdfPageTest02PageModule)
  },
  {
    path: 'pdf-page-test03',
    loadChildren: () => import('./pdf-page-test03/pdf-page-test03.module').then( m => m.PdfPageTest03PageModule)
  },
  {
    path: 'pdf-viewer-page',
    loadChildren: () => import('./pdf-viewer-page/pdf-viewer-page.module').then(m => m.PdfViewerPageModule)
  },
  {
    path: 'pdf-preview-page',
    loadChildren: () => import('./pdf-preview-page/pdf-preview-page.module').then(m => m.PdfPreviewPageModule)
  },
  {
    path: 'pdf-generator-page',
    loadChildren: () => import('./pdf-generator-page/pdf-generator-page.module').then(m => m.PdfGeneratorPageModule)
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
    path: 'feedback-page2',
    loadChildren: () => import('./feedback-page2/feedback-page2.module').then( m => m.FeedbackPage2PageModule)
  },
  {
    path: 'session-page',
    loadChildren: () => import('./session-page/session-page.module').then( m => m.SessionPagePageModule)
  },
  {
    path: 'results-page',
    loadChildren: () => import('./results-page/results-page.module').then( m => m.ResultsPageModule)
  },
  {
    path: 'results-dashboard',
    loadChildren: () => import('./results-dashboard/results-dashboard.module').then(m => m.ResultsDashboardModule)
  },  {
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



];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule { }
