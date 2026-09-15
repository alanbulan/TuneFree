import { describe, expect, it } from 'vitest';
import { CookieJar } from '../cookieJar';

describe('CookieJar', () => {
  it('按 host-only 与 Domain 规则匹配主机', () => {
    const jar = new CookieJar();
    jar.store('https://api.test/login', ['session=abc; Path=/']);
    expect(jar.headerFor('https://api.test/song')).toBe('session=abc');
    // host-only：子域不匹配
    expect(jar.headerFor('https://sub.api.test/song')).toBe('');

    jar.store('https://api.test/login', ['wide=1; Domain=.api.test']);
    expect(jar.headerFor('https://sub.api.test/song')).toBe('wide=1');
    expect(jar.headerFor('https://api.test/song')).toBe('session=abc; wide=1');
  });

  it('拒绝与请求主机无关的 Domain（防第三方塞 cookie）', () => {
    const jar = new CookieJar();
    jar.store('https://api.test/login', ['evil=1; Domain=other.test']);
    expect(jar.size()).toBe(0);
    expect(jar.headerFor('https://other.test/x')).toBe('');
  });

  it('路径前缀、Secure 与有效期都会被考虑', () => {
    const jar = new CookieJar();
    jar.store('https://api.test/api/login', ['a=1; Path=/api', 'b=2; Path=/other', 'c=3; Secure']);
    expect(jar.headerFor('https://api.test/api/song')).toBe('a=1; c=3');
    expect(jar.headerFor('https://api.test/elsewhere')).toBe('');
    expect(jar.headerFor('https://api.test/apix/song')).toBe('');
    expect(jar.headerFor('https://api.test/api')).toBe('a=1; c=3');
    // Secure cookie 不走 http
    expect(jar.headerFor('http://api.test/api/song')).toBe('a=1');
  });

  it('过期时间：Max-Age 优先于 Expires，过期与清除即失效', () => {
    const jar = new CookieJar();
    const future = new Date(Date.now() + 60_000).toUTCString();
    jar.store('https://api.test/', ['keep=1; Expires=' + future, 'gone=1; Max-Age=0', 'later=1; Max-Age=-5']);
    expect(jar.headerFor('https://api.test/')).toBe('keep=1');
    expect(jar.size()).toBe(1);

    // Max-Age 覆盖同一 cookie 的 Expires
    jar.store('https://api.test/', [`keep=2; Max-Age=30`]);
    expect(jar.headerFor('https://api.test/')).toBe('keep=2');
    expect(jar.size()).toBe(1);

    // 非法时间戳按会话 cookie 处理
    jar.store('https://api.test/', ['weird=1; Expires=not-a-date']);
    expect(jar.headerFor('https://api.test/')).toContain('weird=1');
  });

  it('同名同域同路径覆盖，不同路径各自保留', () => {
    const jar = new CookieJar();
    jar.store('https://api.test/', ['token=one']);
    jar.store('https://api.test/', ['token=two']);
    expect(jar.headerFor('https://api.test/')).toBe('token=two');

    jar.store('https://api.test/', ['token=scoped; Path=/deep']);
    // Path=/ 的 cookie 覆盖全部路径；Path=/deep 的只覆盖该前缀
    expect(jar.headerFor('https://api.test/deep/x')).toBe('token=scoped; token=two');
    expect(jar.headerFor('https://api.test/')).toBe('token=two');
  });

  it('忽略畸形输入：空名、超长值、无效 URL', () => {
    const jar = new CookieJar();
    jar.store('not a url', ['a=1']);
    jar.store('https://api.test/', ['=novalue', 'novalue', `${'x'.repeat(5000)}=1`, 'ok=1']);
    expect(jar.size()).toBe(1);
    expect(jar.headerFor('https://api.test/')).toBe('ok=1');
    expect(jar.headerFor('not a url')).toBe('');
  });

  it('缺省及无效 Path 采用响应 URL 的目录，不泄露给相邻路径', () => {
    const jar = new CookieJar();
    jar.store('https://api.test/account/login', ['session=secret', 'token=value; Path=invalid']);
    expect(jar.headerFor('https://api.test/account/me')).toBe('session=secret; token=value');
    expect(jar.headerFor('https://api.test/account')).toBe('session=secret; token=value');
    expect(jar.headerFor('https://api.test/accounts')).toBe('');
    expect(jar.headerFor('https://api.test/public')).toBe('');
  });

  it('数量上限与 clear', () => {
    const jar = new CookieJar();
    for (let index = 0; index < 60; index += 1) {
      jar.store('https://api.test/', [`c${index}=1`]);
    }
    expect(jar.size()).toBe(50);
    // 超出上限时保留最新写入的
    expect(jar.headerFor('https://api.test/')).toContain('c59=1');
    jar.clear();
    expect(jar.size()).toBe(0);
    expect(jar.headerFor('https://api.test/')).toBe('');
  });

  it('一次响应里的多条 set-cookie 都会被记录', () => {
    const jar = new CookieJar();
    jar.store('https://api.test/', ['a=1; Path=/', 'b=2; Path=/']);
    expect(jar.headerFor('https://api.test/')).toBe('a=1; b=2');
  });
});
