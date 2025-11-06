import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SessionPagePage } from './session-page.page';

describe('SessionPagePage', () => {
  let component: SessionPagePage;
  let fixture: ComponentFixture<SessionPagePage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(SessionPagePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
