import { afterEach, describe, expect, it } from 'vitest';
import {
  API_PREFIX,
  DEFAULT_PROXIES,
  getLocalServerBase,
  SELF_HOSTED_PROXY,
  setLocalServerPort,
} from '../config';

describe('local server config', () => {
  afterEach(() => {
    setLocalServerPort(3002);
  });

  it('updates all local server URL exports together', () => {
    setLocalServerPort(43123);

    expect(getLocalServerBase()).toBe('http://127.0.0.1:43123');
    expect(API_PREFIX).toBe('http://127.0.0.1:43123');
    expect(SELF_HOSTED_PROXY).toBe('http://127.0.0.1:43123/api/cors-proxy?url=');
    expect(DEFAULT_PROXIES).toEqual([
      'http://127.0.0.1:43123/api/cors-proxy?url=',
    ]);
  });

  it.each([0, 65536, 1.5, Number.NaN])('rejects invalid port %s', (port) => {
    expect(() => setLocalServerPort(port)).toThrow('Invalid local server port');
  });
});
