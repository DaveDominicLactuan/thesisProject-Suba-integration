import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { CustomCameraTestPage } from './custom-camera-test.page';

const routes: Routes = [
  {
    path: '',
    component: CustomCameraTestPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class CustomCameraTestPageRoutingModule {}
