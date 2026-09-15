import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomSelect from '../components/CustomSelect';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const options = [
  { value: '', label: '选择模型', disabled: true },
  { value: 'a', label: '模型 A' },
  { value: 'b', label: '模型 B' },
  { value: 'c', label: '模型 C' },
];

describe('自定义模型选择器', () => {
  it('以已选项获得焦点，键盘切换跳过占位项，选择后回到触发按钮', () => {
    const onChange = vi.fn();
    render(<><label htmlFor="models">模型</label><CustomSelect id="models" value="b" options={options} onChange={onChange} /></>);
    const trigger = screen.getByLabelText('模型');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('option', { name: '模型 B' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('option', { name: '模型 C' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('option', { name: '模型 B' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByRole('option', { name: '模型 A' }));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    fireEvent.click(document.activeElement!);
    expect(onChange).toHaveBeenCalledWith('c');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('长列表在窗口底部向上打开，Escape、点击外部及移出焦点都能关闭', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: window.innerHeight - 60, bottom: window.innerHeight - 20,
    } as DOMRect);
    render(<><CustomSelect value="" options={options} onChange={vi.fn()} /><button>外部按钮</button></>);
    const trigger = screen.getByRole('button', { name: '选择模型' });
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox').classList.contains('opens-upwards')).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('option', { name: '模型 A' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole('button', { name: '外部按钮' }));
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    fireEvent.click(trigger);
    fireEvent.blur(document.activeElement!, { relatedTarget: screen.getByRole('button', { name: '外部按钮' }) });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('没有模型时禁止打开；同一个触发按钮可关闭列表', () => {
    const view = render(<CustomSelect value="" options={[options[0]]} disabled onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: '选择模型' });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.queryByRole('listbox')).toBeNull();
    view.rerender(<CustomSelect value="a" options={options} onChange={vi.fn()} />);
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('下拉范围遵循内容滚动区，避开顶部栏和底部播放器', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this.classList.contains('view-scroll') ? { top: 80, bottom: 500 } : { top: 300, bottom: 340 }) as DOMRect;
    });
    const models = Array.from({ length: 29 }, (_, index) => ({ value: String(index), label: `模型 ${index}` }));
    render(<div className="view-scroll"><CustomSelect value="0" options={models} onChange={vi.fn()} /></div>);
    fireEvent.click(screen.getByRole('button', { name: '模型 0' }));
    const menu = screen.getByRole('listbox');
    expect(menu.classList.contains('opens-upwards')).toBe(true);
    expect(menu.style.maxHeight).toBe('208px');
  });
});
