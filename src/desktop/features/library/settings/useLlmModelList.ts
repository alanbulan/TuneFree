import { useCallback, useEffect, useRef, useState } from 'react';
import { listLlmModels, type LlmConfigView } from '../../../../core/services/recommendation';
import { describeIpcFailure } from '../ipcErrorFeedback';

export function useLlmModelList(config: LlmConfigView, apiKey: string, clearApiKey: boolean) {
  const [response, setResponse] = useState({ connection: '', models: [] as string[], loading: false, error: '' });
  const requestId = useRef(0);
  const initialFetch = useRef(false);
  const connection = `${config.baseUrl.trim()}\0${apiKey.trim()}\0${clearApiKey}`;

  const fetchModels = useCallback(async () => {
    const request = ++requestId.current;
    setResponse({ connection, models: [], loading: true, error: '' });
    try {
      const fetched = await listLlmModels({
        enabled: config.enabled,
        baseUrl: config.baseUrl,
        model: '',
        timeoutMs: config.timeoutMs,
        apiKey: apiKey.trim() || undefined,
        clearApiKey,
      });
      if (request === requestId.current) setResponse({ connection, models: fetched, loading: false, error: '' });
    } catch (failure) {
      if (request === requestId.current) {
        setResponse({ connection, models: [], loading: false, error: describeIpcFailure(failure, '获取模型列表失败').message ?? '' });
      }
    }
  }, [apiKey, clearApiKey, config.baseUrl, config.enabled, config.timeoutMs, connection]);

  useEffect(() => () => { requestId.current += 1; }, []);

  useEffect(() => {
    if (initialFetch.current || !config.baseUrl || !config.hasApiKey) return;
    initialFetch.current = true;
    void fetchModels();
  }, [config.baseUrl, config.hasApiKey, fetchModels]);

  const current = response.connection === connection;
  return { models: current ? response.models : [], loading: current && response.loading, error: current ? response.error : '', fetchModels };
}
