import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { S3PagePage } from './s3-page.page';

const routes: Routes = [
  {
    path: '',
    component: S3PagePage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class S3PagePageRoutingModule {}
