import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NotificationPagePage } from './notification-page.page';

describe('NotificationPagePage', () => {
  let component: NotificationPagePage;
  let fixture: ComponentFixture<NotificationPagePage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(NotificationPagePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
