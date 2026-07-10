import { describe, expect, it } from 'vitest';
import {
  calculateVisualizerCanvasSize,
  shouldScheduleVisualizerFrame,
} from '../AudioVisualizer';

describe('shouldScheduleVisualizerFrame', () => {
  it('continues scheduling while audio is playing', () => {
    expect(shouldScheduleVisualizerFrame(true, false)).toBe(true);
    expect(shouldScheduleVisualizerFrame(true, true)).toBe(true);
  });

  it('continues scheduling while paused bars are still decaying', () => {
    expect(shouldScheduleVisualizerFrame(false, false)).toBe(true);
  });

  it('stops scheduling after paused bars have settled', () => {
    expect(shouldScheduleVisualizerFrame(false, true)).toBe(false);
  });
});

describe('calculateVisualizerCanvasSize', () => {
  it('scales the backing store with the current device pixel ratio', () => {
    expect(calculateVisualizerCanvasSize(320, 80, 2)).toEqual({
      width: 320,
      height: 80,
      dpr: 2,
      pixelWidth: 640,
      pixelHeight: 160,
    });
  });

  it('normalizes invalid dimensions and device pixel ratios', () => {
    expect(calculateVisualizerCanvasSize(Number.NaN, -10, 0)).toEqual({
      width: 0,
      height: 0,
      dpr: 1,
      pixelWidth: 1,
      pixelHeight: 1,
    });
  });
});
