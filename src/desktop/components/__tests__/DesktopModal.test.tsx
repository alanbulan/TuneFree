import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DesktopModal from '../DesktopModal';
afterEach(cleanup);
it('contains keyboard focus, preserves background inert state and restores focus on close', () => {
  const trigger = document.createElement('button'); trigger.textContent = '打开'; document.body.append(trigger); trigger.focus();
  const prior = document.body.style.overflow;
  const close = vi.fn(); const view = render(<DesktopModal title="预览" description="描述" onClose={close} actions={<button>最后一个</button>}><button>第一个</button></DesktopModal>);
  const first = screen.getByRole('button', { name: '关闭预览' }); const last = screen.getByRole('button', { name: '最后一个' });
  expect(document.activeElement).toBe(first); expect(trigger.inert).toBe(true); expect(document.body.style.overflow).toBe('hidden');
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: 'Tab' }); expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'ArrowDown' }); expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(first, { key: 'Escape' }); expect(close).toHaveBeenCalledOnce();
  trigger.focus(); expect(document.activeElement).toBe(first);
  fireEvent.mouseDown(screen.getByRole('dialog')); expect(close).toHaveBeenCalledOnce();
  fireEvent.mouseDown(screen.getByRole('presentation')); expect(close).toHaveBeenCalledTimes(2);
  view.unmount(); expect(trigger.inert).toBe(false); expect(document.activeElement).toBe(trigger); expect(document.body.style.overflow).toBe(prior); trigger.remove();
});
it('updates close callbacks and handles removed triggers and optional actions', () => {
  const initial = vi.fn(), next = vi.fn(); const view = render(<DesktopModal title="first" onClose={initial}>内容</DesktopModal>);
  view.rerender(<DesktopModal title="next" onClose={next}>内容</DesktopModal>);
  fireEvent.click(screen.getByRole('button', { name: '关闭预览' })); expect(next).toHaveBeenCalledOnce(); expect(initial).not.toHaveBeenCalled();
});
