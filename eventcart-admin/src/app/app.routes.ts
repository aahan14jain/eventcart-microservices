import { Routes } from '@angular/router';
import { DlqPageComponent } from './pages/dlq-page/dlq-page.component';
import { SagasPageComponent } from './pages/sagas-page/sagas-page.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'sagas' },
  { path: 'sagas', component: SagasPageComponent },
  { path: 'dlq', component: DlqPageComponent },
  { path: '**', redirectTo: 'sagas' },
];
