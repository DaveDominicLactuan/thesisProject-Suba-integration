import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeedbackPagePage } from './feedback-page.page';

describe('FeedbackPagePage', () => {
  let component: FeedbackPagePage;
  let fixture: ComponentFixture<FeedbackPagePage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(FeedbackPagePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
