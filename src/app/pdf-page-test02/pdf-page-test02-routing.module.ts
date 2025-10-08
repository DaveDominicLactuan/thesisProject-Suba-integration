import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { PdfPageTest02Page } from './pdf-page-test02.page';

const routes: Routes = [
  {
    path: '',
    component: PdfPageTest02Page
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class PdfPageTest02PageRoutingModule {}
