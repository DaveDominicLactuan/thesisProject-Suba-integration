import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { PdfPageTestPage } from './pdf-page-test.page';

const routes: Routes = [
  {
    path: '',
    component: PdfPageTestPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class PdfPageTestPageRoutingModule {}
