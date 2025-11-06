import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeedbackPage2Page } from './feedback-page2.page';

describe('FeedbackPage2Page', () => {
  let component: FeedbackPage2Page;
  let fixture: ComponentFixture<FeedbackPage2Page>;

  beforeEach(() => {
    fixture = TestBed.createComponent(FeedbackPage2Page);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
