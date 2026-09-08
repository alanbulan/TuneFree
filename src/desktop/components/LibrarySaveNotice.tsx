import { useEffect } from 'react';
import { useLibraryData } from '../../core/contexts/LibraryContext';
import { useToast } from './ToastHost';

export function LibrarySaveNotice() {
  const { saveError } = useLibraryData();
  const { showToast } = useToast();
  useEffect(() => {
    if (saveError) showToast(saveError.message, 'error');
  }, [saveError, showToast]);
  return null;
}
