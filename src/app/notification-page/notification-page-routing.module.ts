import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { NotificationPagePage } from './notification-page.page';

const routes: Routes = [
  {
    path: '',
    component: NotificationPagePage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class NotificationPagePageRoutingModule {}
