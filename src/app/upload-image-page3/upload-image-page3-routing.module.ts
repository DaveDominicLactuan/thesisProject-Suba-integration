import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { UploadImagePage3Page } from './upload-image-page3.page';

const routes: Routes = [
  {
    path: '',
    component: UploadImagePage3Page
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class UploadImagePage3PageRoutingModule {}
