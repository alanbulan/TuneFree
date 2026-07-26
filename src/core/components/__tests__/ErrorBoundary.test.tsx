// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../ErrorBoundary';

let shouldThrow = true;
let thrownMessage = '渲染炸了';

const Boom = () => {
  if (shouldThrow) throw new Error(thrownMessage);
  return <span>正常内容</span>;
};

describe('ErrorBoundary 降级与恢复', () => {
  beforeEach(() => {
    shouldThrow = true;
    thrownMessage = '渲染炸了';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('子树抛错时渲染中文降级界面而不是整树卸载', () => {
    render(
      <div>
        <span>外层壳仍在</span>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </div>,
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('应用出现异常')).toBeTruthy();
    expect(screen.getByText('渲染炸了')).toBeTruthy();
    expect(screen.getByText('外层壳仍在')).toBeTruthy();
    expect(screen.queryByText('正常内容')).toBeNull();
  });

  it('点击"重试"后恢复渲染子树并回调 onReset', () => {
    const onReset = vi.fn();
    render(
      <ErrorBoundary onReset={onReset}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByText('重试'));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByText('正常内容')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('重试后仍然抛错时留在降级界面', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    thrownMessage = '第二次也炸';
    fireEvent.click(screen.getByText('重试'));

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('第二次也炸')).toBeTruthy();
  });

  it('超长错误摘要被截断，不撑破降级卡片', () => {
    thrownMessage = '错'.repeat(400);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    const message = screen.getByRole('alert').querySelector('.error-boundary-message');
    expect(message?.textContent).toHaveLength(201);
    expect(message?.textContent?.endsWith('…')).toBe(true);
  });

  it('"清除本地数据并重启"会清空本地存储', () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    });
    localStorage.setItem('tunefree_queue', '[]');
    sessionStorage.setItem('temp', '1');

    try {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
      fireEvent.click(screen.getByText('清除本地数据并重启'));

      expect(localStorage.getItem('tunefree_queue')).toBeNull();
      expect(sessionStorage.getItem('temp')).toBeNull();
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});
