import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BrowseFilePagePage } from './browse-file-page.page';

describe('BrowseFilePagePage', () => {
  let component: BrowseFilePagePage;
  let fixture: ComponentFixture<BrowseFilePagePage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(BrowseFilePagePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
