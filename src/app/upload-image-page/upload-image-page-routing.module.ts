import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { UploadImagePagePage } from './upload-image-page.page';

const routes: Routes = [
  {
    path: '',
    component: UploadImagePagePage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class UploadImagePagePageRoutingModule {}
