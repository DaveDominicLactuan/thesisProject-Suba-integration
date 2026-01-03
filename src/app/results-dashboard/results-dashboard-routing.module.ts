import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ResultsDashboardPage } from './results-dashboard.page';

const routes: Routes = [
  {
    path: '',
    component: ResultsDashboardPage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ResultsDashboardRoutingModule {}
