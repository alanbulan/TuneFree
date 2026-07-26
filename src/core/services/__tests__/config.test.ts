import { afterEach, describe, expect, it } from 'vitest';
import {
  API_PREFIX,
  DEFAULT_PROXIES,
  getLocalServerBase,
  getLocalServerToken,
  buildLocalServerHeaders,
  LOCAL_SERVER_TOKEN_HEADER,
  SELF_HOSTED_PROXY,
  setLocalServerInfo,
} from '../config';

describe('local server config', () => {
  afterEach(() => {
    setLocalServerInfo({ port: 3002, token: '' });
  });

  it('updates all local server URL exports together', () => {
    setLocalServerInfo({ port: 43123, token: 'abc123' });

    expect(getLocalServerBase()).toBe('http://127.0.0.1:43123');
    expect(API_PREFIX).toBe('http://127.0.0.1:43123');
    expect(SELF_HOSTED_PROXY).toBe(
      'http://127.0.0.1:43123/api/cors-proxy?token=abc123&url=',
    );
    expect(DEFAULT_PROXIES).toEqual([
      'http://127.0.0.1:43123/api/cors-proxy?token=abc123&url=',
    ]);
    expect(getLocalServerToken()).toBe('abc123');
  });

  it('keeps the `url=` suffix so callers can append an encoded target', () => {
    setLocalServerInfo({ port: 43123, token: 'tok' });

    const target = 'https://music.163.com/api?a=1&b=2';
    const finalUrl = SELF_HOSTED_PROXY + encodeURIComponent(target);
    const parsed = new URL(finalUrl);

    expect(parsed.searchParams.get('token')).toBe('tok');
    expect(parsed.searchParams.get('url')).toBe(target);
  });

  it('URL-encodes the token inside the proxy prefix', () => {
    setLocalServerInfo({ port: 3010, token: 'a&b=c' });

    expect(SELF_HOSTED_PROXY).toBe(
      'http://127.0.0.1:3010/api/cors-proxy?token=a%26b%3Dc&url=',
    );
  });

  it('falls back to an empty token for browser dev environments', () => {
    expect(getLocalServerToken()).toBe('');
    expect(SELF_HOSTED_PROXY).toBe('http://127.0.0.1:3002/api/cors-proxy?token=&url=');
    expect(buildLocalServerHeaders()).toEqual({});
  });

  it('exposes the token header only when a token is present', () => {
    setLocalServerInfo({ port: 3002, token: 'deadbeef' });

    expect(buildLocalServerHeaders()).toEqual({
      [LOCAL_SERVER_TOKEN_HEADER]: 'deadbeef',
    });
    expect(LOCAL_SERVER_TOKEN_HEADER).toBe('x-tunefree-token');
  });

  it.each([0, 65536, 1.5, Number.NaN])('rejects invalid port %s', (port) => {
    expect(() => setLocalServerInfo({ port, token: '' })).toThrow(
      'Invalid local server port',
    );
  });
});
