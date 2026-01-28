import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { HomePage2Page } from './home-page2.page';

const routes: Routes = [
  {
    path: '',
    component: HomePage2Page
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class HomePage2PageRoutingModule {}
