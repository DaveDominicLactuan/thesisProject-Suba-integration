import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatPagePage } from './chat-page.page';

describe('ChatPagePage', () => {
  let component: ChatPagePage;
  let fixture: ComponentFixture<ChatPagePage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ChatPagePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
