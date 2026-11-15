import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  page: number;
  total: number;
  pageSize: number;
  label: string;
  disabled?: boolean;
  onChange: (page: number) => void;
}

export default function LibraryPagination({ page, total, pageSize, label, disabled, onChange }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <nav className="library-pagination" aria-label={`${label}分页`}>
    <span className="library-pagination-total">共 {total} {label === '歌单' ? '个歌单' : '首歌曲'}</span>
    <div className="library-pagination-controls">
      <button type="button" className="soft-button" aria-label={`${label}上一页`} disabled={disabled || page === 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft size={14} aria-hidden="true" />上一页</button>
      <span>第 {page} / {pages} 页</span>
      <button type="button" className="soft-button" aria-label={`${label}下一页`} disabled={disabled || page >= pages} onClick={() => onChange(page + 1)}>
        下一页<ChevronRight size={14} aria-hidden="true" /></button>
    </div>
  </nav>;
}
