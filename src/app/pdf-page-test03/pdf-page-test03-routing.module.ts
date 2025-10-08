import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { PdfPageTest03Page } from './pdf-page-test03.page';

const routes: Routes = [
  {
    path: '',
    component: PdfPageTest03Page
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class PdfPageTest03PageRoutingModule {}
