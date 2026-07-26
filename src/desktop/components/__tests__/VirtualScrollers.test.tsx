// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VirtualList from '../VirtualList';
import VirtualRail from '../VirtualRail';

const items = Array.from({ length: 200 }, (_, index) => ({ id: String(index), label: `行 ${index}` }));

const scrollTo = (element: HTMLElement, position: Partial<{ scrollTop: number; scrollLeft: number }>) => {
  Object.assign(element, position);
  fireEvent.scroll(element, { target: position });
};

describe('VirtualList 窗口稳定性', () => {
  let renderItem: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    renderItem = vi.fn((item: { id: string; label: string }) => <span>{item.label}</span>);
  });

  const mount = () => render(
    <VirtualList
      items={items}
      itemHeight={40}
      getKey={(item) => item.id}
      renderItem={renderItem as unknown as (item: { id: string; label: string }) => React.ReactNode}
    />,
  );

  it('只渲染视窗内的行并保留列表语义', () => {
    mount();
    const rows = screen.getAllByRole('listitem');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(items.length);
    expect(rows[0].getAttribute('aria-setsize')).toBe('200');
    expect(rows[0].getAttribute('aria-posinset')).toBe('1');
  });

  it('窗口索引未变化的滚动不触发任何重渲染', () => {
    mount();
    const list = screen.getByRole('list');
    const initialRenders = renderItem.mock.calls.length;

    for (const scrollTop of [4, 12, 20]) {
      scrollTo(list, { scrollTop });
    }
    expect(renderItem.mock.calls.length).toBe(initialRenders);
  });

  it('窗口真正移动后才重新渲染，并换掉可见行', () => {
    mount();
    const list = screen.getByRole('list');
    const initialRenders = renderItem.mock.calls.length;

    scrollTo(list, { scrollTop: 1200 });
    expect(renderItem.mock.calls.length).toBeGreaterThan(initialRenders);
    expect(screen.queryByText('行 0')).toBeNull();
    expect(screen.getByText('行 30')).toBeTruthy();
  });
});

describe('VirtualRail 窗口稳定性', () => {
  let renderItem: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    renderItem = vi.fn((item: { id: string; label: string }) => <span>{item.label}</span>);
  });

  const mount = () => render(
    <VirtualRail
      items={items.slice(0, 60)}
      itemWidth={180}
      itemHeight={220}
      getKey={(item) => item.id}
      renderItem={renderItem as unknown as (item: { id: string; label: string }) => React.ReactNode}
    />,
  );

  it('窗口索引未变化的横向滚动不触发重渲染', () => {
    mount();
    const rail = screen.getByRole('list');
    const initialRenders = renderItem.mock.calls.length;

    for (const scrollLeft of [10, 30, 60]) {
      scrollTo(rail, { scrollLeft });
    }
    expect(renderItem.mock.calls.length).toBe(initialRenders);
  });

  it('横向滚过一整屏后才换卡片', () => {
    mount();
    const rail = screen.getByRole('list');
    const initialRenders = renderItem.mock.calls.length;

    scrollTo(rail, { scrollLeft: 2000 });
    expect(renderItem.mock.calls.length).toBeGreaterThan(initialRenders);
    expect(screen.queryByText('行 0')).toBeNull();
  });
});
