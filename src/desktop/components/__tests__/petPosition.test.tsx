import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMiraPetPosition, useReducedMotion } from '../useMiraPetPosition';

const key = 'tunefree_desktop_mira_position_v3';
const capture = vi.fn(), release = vi.fn();
function Pet() {
  const { petRef, position, dragging, movementAction, handlePointerDown, handlePointerMove, finishDrag, handleKeyDown } = useMiraPetPosition();
  const reduced = useReducedMotion();
  return <div ref={petRef} tabIndex={0} role="button" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
    onPointerUp={finishDrag} onPointerCancel={finishDrag} onKeyDown={handleKeyDown}
    data-position={JSON.stringify(position)} data-dragging={dragging} data-action={movementAction} data-reduced={reduced}>伙伴</div>;
}
const position = () => JSON.parse(screen.getByRole('button').getAttribute('data-position')!) as { x: number; y: number };
const frame = async () => { await act(async () => vi.advanceTimersByTimeAsync(20)); };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear();
  vi.stubGlobal('innerWidth', 900); vi.stubGlobal('innerHeight', 700);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 50, y: 400, left: 50, top: 400, width: 112, height: 112, right: 162, bottom: 512, toJSON: () => ({}) });
  Object.defineProperties(HTMLElement.prototype, { setPointerCapture: { configurable: true, value: capture },
    hasPointerCapture: { configurable: true, value: () => true }, releasePointerCapture: { configurable: true, value: release } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const method of ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture']) Reflect.deleteProperty(HTMLElement.prototype, method); });

describe('伙伴拖动和键盘移动', () => {
  it('读取坐标并裁切到视口，键盘移动、复位和缩窗保持可见', async () => {
    localStorage.setItem(key, JSON.stringify({ x: 300, y: 450 })); render(<Pet />); await frame(); expect(position()).toEqual({ x: 300, y: 450 });
    const pet = screen.getByRole('button');
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) fireEvent.keyDown(pet, { key });
    expect(position()).toEqual({ x: 300, y: 450 }); fireEvent.keyDown(pet, { key: 'ArrowRight', shiftKey: true }); expect(position().x).toBe(332);
    fireEvent.keyDown(pet, { key: 'Home' }); expect(position()).toEqual({ x: 52, y: 468 });
    vi.stubGlobal('innerWidth', 90); vi.stubGlobal('innerHeight', 80); fireEvent.resize(window); expect(position()).toEqual({ x: 8, y: 8 });
    fireEvent.keyDown(pet, { key: 'Tab' }); expect(position()).toEqual({ x: 8, y: 8 });
  });
  it('只处理当前指针，区分单击与拖动，取消不保存未完成位置', async () => {
    render(<Pet />); await frame(); const pet = screen.getByRole('button');
    fireEvent.pointerMove(pet, { pointerId: 1 }); fireEvent.pointerUp(pet, { pointerId: 1 });
    fireEvent.pointerDown(pet, { pointerId: 1, pointerType: 'mouse', button: 2 }); expect(capture).not.toHaveBeenCalled();
    fireEvent.pointerDown(pet, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 60, clientY: 410 });
    fireEvent.pointerMove(pet, { pointerId: 2, clientX: 100, clientY: 420 }); fireEvent.pointerUp(pet, { pointerId: 2 });
    fireEvent.pointerMove(pet, { pointerId: 1, clientX: 61, clientY: 410 }); expect(pet.getAttribute('data-dragging')).toBe('false');
    fireEvent.pointerUp(pet, { pointerId: 1, clientX: 61, clientY: 410 }); expect(pet.getAttribute('data-action')).toBe('wink');
    fireEvent.pointerDown(pet, { pointerId: 3, clientX: 60, clientY: 410 }); fireEvent.pointerMove(pet, { pointerId: 3, clientX: 600, clientY: 610 });
    expect(pet.getAttribute('data-dragging')).toBe('true'); fireEvent.pointerUp(pet, { pointerId: 3, clientX: 600, clientY: 610 });
    expect(position()).toEqual({ x: 590, y: 580 }); const saved = localStorage.getItem(key);
    fireEvent.pointerDown(pet, { pointerId: 4, clientX: 60, clientY: 410 }); fireEvent.pointerMove(pet, { pointerId: 4, clientX: 400, clientY: 200 });
    fireEvent.pointerCancel(pet, { pointerId: 4, clientX: 400, clientY: 200 }); expect(localStorage.getItem(key)).toBe(saved); expect(pet.getAttribute('data-action')).toBeNull(); expect(release).toHaveBeenCalledTimes(3);
  });
  it('无效存储和写入失败不妨碍互动，重复手势替换恢复计时器', async () => {
    localStorage.setItem(key, '{bad'); const view = render(<Pet />); await frame(); expect(position().x).toBe(52);
    const pet = screen.getByRole('button'); fireEvent.keyDown(pet, { key: 'Enter' }); fireEvent.keyDown(pet, { key: ' ' }); expect(pet.getAttribute('data-action')).toBe('burst');
    await act(async () => vi.advanceTimersByTimeAsync(1800)); expect(pet.getAttribute('data-action')).toBeNull();
    const storage = localStorage; vi.stubGlobal('localStorage', { getItem: storage.getItem.bind(storage), setItem: () => { throw new Error('quota'); } });
    fireEvent.keyDown(pet, { key: 'Home' }); expect(position().x).toBe(52); view.unmount();
  });
});
