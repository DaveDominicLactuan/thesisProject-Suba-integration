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
    path: 'custom-camera-test',
    loadChildren: () => import('./custom-camera-test/custom-camera-test.module').then( m => m.CustomCameraTestPageModule)
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
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule { }
