import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { BrowseFilePagePage } from './browse-file-page.page';

const routes: Routes = [
  {
    path: '',
    component: BrowseFilePagePage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class BrowseFilePagePageRoutingModule {}
