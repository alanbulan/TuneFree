import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildGDStudioRequestBody,
  calculateMD5,
  classifyGDStudioFailure,
} from '../gdStudioClient';

describe('GD Studio client', () => {
  it('uses the standard MD5 algorithm', async () => {
    const value = '178374500|music.gdstudio.org|20260616|%E6%9E%97%E4%BF%8A%E6%9D%B0';
    expect(await calculateMD5(value)).toBe(createHash('md5').update(value).digest('hex'));
  });

  it('encodes name once and maps QQ to Tencent', async () => {
    const body = await buildGDStudioRequestBody({
      types: 'search', source: 'qq', name: '林俊杰', count: 20, pages: 1,
    }, 1_783_745_000_000);
    const signature = createHash('md5')
      .update('178374500|music.gdstudio.org|20260616|%E6%9E%97%E4%BF%8A%E6%9D%B0')
      .digest('hex')
      .slice(-8)
      .toUpperCase();

    expect(body.get('name')).toBe('林俊杰');
    expect(body.get('source')).toBe('tencent');
    expect(body.get('s')).toBe(signature);
    expect(body.toString()).not.toContain('%25E6');
  });

  it('classifies detail failures', () => {
    expect(classifyGDStudioFailure(400, 'Value of source is not supported.'))
      .toBe('UNSUPPORTED_SOURCE');
    expect(classifyGDStudioFailure(429, 'Too many requests')).toBe('RATE_LIMIT');
    expect(classifyGDStudioFailure(503, 'Service unavailable')).toBe('UNAVAILABLE');
    expect(classifyGDStudioFailure(200, '<html>invalid</html>')).toBe('BAD_RESPONSE');
  });
});
