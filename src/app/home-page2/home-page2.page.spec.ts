import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HomePage2Page } from './home-page2.page';

describe('HomePage2Page', () => {
  let component: HomePage2Page;
  let fixture: ComponentFixture<HomePage2Page>;

  beforeEach(() => {
    fixture = TestBed.createComponent(HomePage2Page);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
