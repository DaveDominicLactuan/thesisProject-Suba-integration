import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { FeedbackPage2Page } from './feedback-page2.page';

const routes: Routes = [
  {
    path: '',
    component: FeedbackPage2Page
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class FeedbackPage2PageRoutingModule {}
