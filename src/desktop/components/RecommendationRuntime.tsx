import { useEffect } from 'react';
import { startRecommendationRuntime } from '../../core/services/recommendationRuntime';

export function RecommendationRuntime() {
  useEffect(() => startRecommendationRuntime(), []);
  return null;
}
