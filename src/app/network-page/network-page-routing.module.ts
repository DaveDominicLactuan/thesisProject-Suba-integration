import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { NetworkPagePage } from './network-page.page';

const routes: Routes = [
  {
    path: '',
    component: NetworkPagePage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class NetworkPagePageRoutingModule {}
