import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { PdfPagePage } from './pdf-page.page';

const routes: Routes = [
  {
    path: '',
    component: PdfPagePage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class PdfPagePageRoutingModule {}
