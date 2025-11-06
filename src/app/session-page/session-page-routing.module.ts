import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { SessionPagePage } from './session-page.page';

const routes: Routes = [
  {
    path: '',
    component: SessionPagePage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class SessionPagePageRoutingModule {}
