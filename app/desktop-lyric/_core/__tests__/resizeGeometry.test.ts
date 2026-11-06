import { describe, expect, it } from 'vitest';
import { resizeLyricBounds, type ResizeDirection } from '../resizeGeometry';

const bounds = { x: -1200, y: 100, width: 1800, height: 600 };
describe('Retina lyric window resize', () => {
  it.each<[ResizeDirection, number[]]>([
    ['East', [-1200, 100, 1900, 600]], ['West', [-1100, 100, 1700, 600]],
    ['South', [-1200, 100, 1800, 760]], ['North', [-1200, 260, 1800, 440]],
    ['SouthEast', [-1200, 100, 1900, 760]], ['SouthWest', [-1100, 100, 1700, 760]],
    ['NorthEast', [-1200, 260, 1900, 440]], ['NorthWest', [-1100, 260, 1700, 440]],
  ])('resizes %s while anchoring the opposite edge', (direction, expected) => {
    expect(Object.values(resizeLyricBounds(bounds, direction, 100, 160, 2))).toEqual(expected);
  });
  it('clamps to logical minimums and keeps the opposite corner fixed', () => {
    expect(resizeLyricBounds(bounds, 'NorthWest', 5000, 5000, 2))
      .toEqual({ x: -200, y: 300, width: 800, height: 400 });
    expect(resizeLyricBounds(bounds, 'SouthEast', -5000, -5000, 1))
      .toEqual({ x: -1200, y: 100, width: 400, height: 200 });
  });
});
