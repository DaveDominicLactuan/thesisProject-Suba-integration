import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { CameraPage2Page } from './camera-page2.page';

const routes: Routes = [
  {
    path: '',
    component: CameraPage2Page
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class CameraPage2PageRoutingModule {}
