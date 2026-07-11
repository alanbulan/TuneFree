import type { Song } from '../../../core/types';

export const attachContextSearchMeta = (
  songs: Song[],
  requestId: string,
): Song[] => songs.map((song) => ({
  ...song,
  recommendationRequestId: requestId,
  recommendationSource: 'embeat',
}));

export const isCurrentContextSearch = (
  requestId: number,
  currentRequestId: number,
  activeSource: string,
): boolean => requestId === currentRequestId && activeSource === 'embeat';
