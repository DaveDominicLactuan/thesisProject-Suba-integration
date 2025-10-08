import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PdfPageTest02Page } from './pdf-page-test02.page';

describe('PdfPageTest02Page', () => {
  let component: PdfPageTest02Page;
  let fixture: ComponentFixture<PdfPageTest02Page>;

  beforeEach(() => {
    fixture = TestBed.createComponent(PdfPageTest02Page);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
