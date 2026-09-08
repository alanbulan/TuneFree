import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MotionPanel from '../MotionPanel';
import MotionDisclosure from '../MotionDisclosure';
import MotionChoice from '../MotionChoice';
import SearchControls from '../../features/search/SearchControls';
import QualitySelector from '../QualitySelector';
import CustomSelect from '../../features/library/components/CustomSelect';

const animation = vi.hoisted(() => {
  const stop = vi.fn();
  return { stop, animate: vi.fn(() => ({ stop })), reduced: false };
});
vi.mock('framer-motion', async (importOriginal) => {
  const original = await importOriginal<typeof import('framer-motion')>();
  const { useRef } = await import('react');
  return { ...original, useAnimate: () => [useRef(null), animation.animate], useReducedMotion: () => animation.reduced };
});
function StatefulContent() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((value) => value + 1)}>计数 {count}</button>;
}
beforeEach(() => { vi.clearAllMocks(); animation.reduced = false; });

describe('Motion 切换和控件交互', () => {
  it('每次切页重新播放并停止旧动画，保留子树状态', () => {
    const view = render(<MotionPanel transitionKey="favorites"><StatefulContent /></MotionPanel>);
    fireEvent.click(screen.getByRole('button', { name: '计数 0' }));
    expect(animation.animate).toHaveBeenCalledTimes(1);
    view.rerender(<MotionPanel transitionKey="downloads"><StatefulContent /></MotionPanel>);
    expect(screen.getByRole('button', { name: '计数 1' })).toBeTruthy();
    expect(animation.animate).toHaveBeenCalledTimes(2);
    expect(animation.stop).toHaveBeenCalledTimes(1);
    animation.reduced = true;
    view.rerender(<MotionPanel transitionKey="settings"><StatefulContent /></MotionPanel>);
    expect(animation.animate).toHaveBeenLastCalledWith(expect.anything(), { opacity: 1, y: 0 }, expect.objectContaining({ duration: 0 }));
    view.unmount(); expect(animation.stop).toHaveBeenCalledTimes(3);
  });

  it('选中指示器、折叠区的展开和退出均保留正确的可访问状态', async () => {
    const onClick = vi.fn();
    const view = render(<><MotionChoice selected indicatorId="choice" onClick={onClick}>选中项</MotionChoice>
      <MotionDisclosure label="高级参数"><input aria-label="候选数" /></MotionDisclosure></>);
    expect(view.container.querySelectorAll('.selection-indicator')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '选中项' }));
    expect(onClick).toHaveBeenCalledOnce();
    const toggle = screen.getByRole('button', { name: '高级参数' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('region').id).toBe(toggle.getAttribute('aria-controls'));
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
  });

  it('搜索输入保留输入法合成，所有范围与音源选项能切换', () => {
    const handlers = { onQuery: vi.fn(), onMode: vi.fn(), onSource: vi.fn(), onExtended: vi.fn(), onSearch: vi.fn() };
    const view = render(<SearchControls query="" mode="aggregate" source="netease" extended={false} {...handlers} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '夜曲' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(handlers.onSearch).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(handlers.onSearch).toHaveBeenCalledOnce();
    expect(handlers.onQuery).toHaveBeenCalledWith('夜曲');
    fireEvent.click(screen.getByRole('button', { name: '全部音源' }));
    fireEvent.click(screen.getByRole('button', { name: '指定音源' }));
    expect(handlers.onMode.mock.calls).toEqual([['aggregate'], ['single']]);
    fireEvent.click(screen.getByRole('button', { name: '扩展源 关' }));
    expect(handlers.onExtended).toHaveBeenCalledWith(true);
    view.rerender(<SearchControls query="夜曲" mode="single" source="qq" extended {...handlers} />);
    for (const radio of screen.getAllByRole('radio')) fireEvent.click(radio);
    expect(handlers.onSource.mock.calls.length).toBe(screen.getAllByRole('radio').length);
    expect((input as HTMLInputElement).placeholder).toContain('QQ');
    view.rerender(<SearchControls query="夜曲" mode="aggregate" source="qq" extended {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: '扩展源 开' }));
    expect(handlers.onExtended).toHaveBeenLastCalledWith(false);
  });

  it('多个音质组的选中层互不串联，并转发全部音质', () => {
    const onQualityChange = vi.fn();
    const view = render(<QualitySelector audioQuality="320k" onQualityChange={onQualityChange} />);
    for (const button of screen.getAllByRole('button')) fireEvent.click(button);
    expect(onQualityChange.mock.calls).toEqual([['128k'], ['320k'], ['flac'], ['flac24bit']]);
    view.rerender(<QualitySelector audioQuality="flac24bit" onQualityChange={onQualityChange} />);
    expect(screen.getByRole('button', { name: 'Hi-Res' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('下拉菜单可选择、外部关闭和 Escape 关闭，未知值显示首项', async () => {
    const onChange = vi.fn();
    render(<CustomSelect value="unknown" options={[{ label: '浅色', value: 'light' }, { label: '深色', value: 'dark' }]} onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: '浅色' });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'a' });
    fireEvent.mouseDown(screen.getByRole('listbox'));
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: '深色' }));
    expect(onChange).toHaveBeenCalledWith('dark');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    fireEvent.click(trigger); fireEvent.keyDown(trigger, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger); fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });
});
