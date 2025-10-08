import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PdfPageTest03Page } from './pdf-page-test03.page';

describe('PdfPageTest03Page', () => {
  let component: PdfPageTest03Page;
  let fixture: ComponentFixture<PdfPageTest03Page>;

  beforeEach(() => {
    fixture = TestBed.createComponent(PdfPageTest03Page);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
