import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { CameraPagePage } from './camera-page.page';

const routes: Routes = [
  {
    path: '',
    component: CameraPagePage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class CameraPagePageRoutingModule {}
