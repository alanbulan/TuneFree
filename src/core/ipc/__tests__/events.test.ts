import { describe, expect, it, vi } from 'vitest';
import { emitTo, listen } from '@tauri-apps/api/event';
import { emitEventTo, listenEvent } from '../events';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(), emitTo: vi.fn().mockResolvedValue(undefined) }));

describe('窗口事件门面', () => {
  it('监听解包 payload，保留原生取消订阅方法', async () => {
    const unlisten = vi.fn(), handler = vi.fn();
    vi.mocked(listen).mockResolvedValueOnce(unlisten);
    expect(await listenEvent('lock-change', handler)).toBe(unlisten);
    vi.mocked(listen).mock.lastCall?.[1]({ event: 'lock-change', id: 1, payload: true });
    expect(handler).toHaveBeenCalledWith(true);
  });
  it('仅向指定窗口发送完整事件', async () => {
    await emitEventTo('desktop-lyric', 'lock-change', false);
    expect(emitTo).toHaveBeenCalledWith('desktop-lyric', 'lock-change', false);
  });
});
