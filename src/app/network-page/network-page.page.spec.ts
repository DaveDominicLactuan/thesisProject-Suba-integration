import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NetworkPagePage } from './network-page.page';

describe('NetworkPagePage', () => {
  let component: NetworkPagePage;
  let fixture: ComponentFixture<NetworkPagePage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(NetworkPagePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
