import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { UploadImagePage2Page } from './upload-image-page2.page';

const routes: Routes = [
  {
    path: '',
    component: UploadImagePage2Page
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class UploadImagePage2PageRoutingModule {}
